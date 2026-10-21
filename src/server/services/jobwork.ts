/**
 * Job Work out/in — Section 4.7. T8 (send), T9 (receive to JW Return QC),
 * T10 (QC accept/reject). Validation #5 (FIFO on JW send), #7 (can't skip ahead
 * of JW), #8 (receipt <= pending).
 *
 * Lot-level status limitation: a Production Lot is a single stock unit, so while any
 * quantity of a challan line is still at the vendor the lot stays AT_JOB_WORK; it moves to
 * JW Return QC once nothing is pending (fully received, or the challan is closed by Admin
 * with a shortage reason). Each receipt still posts its own T9 ledger row.
 */
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { genChallanNo, genReceiptNo, genRejectionNo } from "./docNumber";
import { getJobWorkerLocation, getLocationByName, LOCATION_NAMES } from "./locations";
import { validateFifoScan, type FifoPoolUnit } from "./fifo";
import { nextOpSeq } from "./production";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface JwSendLine {
  lotId: string;
  qtyNos: number;
  qtyKg: number;
}

export async function createJwOutChallan(params: {
  vendorId: string;
  lines: JwSendLine[];
  userId: string;
  expectedReturnDate?: Date;
  isAdmin?: boolean;
  overrideReason?: string;
}) {
  if (params.lines.length === 0) throw new ValidationError("Challan must have at least one line.");
  const seen = new Set<string>();
  for (const l of params.lines) {
    if (seen.has(l.lotId)) throw new ValidationError("A lot can appear only once on a challan.");
    seen.add(l.lotId);
    if (!(l.qtyNos > 0) || !(l.qtyKg > 0)) throw new ValidationError("Quantity (nos and kg) must be positive.");
  }

  return prisma.$transaction(async (tx) => {
    const vendor = await tx.jobWorker.findUnique({ where: { id: params.vendorId } });
    if (!vendor || !vendor.active) throw new ValidationError("Job worker not found or inactive.");

    const date = new Date();
    const vendorLoc = await getJobWorkerLocation(tx, vendor.id);

    // Working FIFO pools, one per (part, op): lots waiting at that JW operation, oldest first.
    const pools = new Map<string, FifoPoolUnit[]>();
    const overrides: string[] = [];
    const prepared: Array<{ lotId: string; opSeq: number; qtyNos: number; qtyKg: number; leadDays: number }> = [];

    for (const line of params.lines) {
      const lot = await tx.productionLot.findUnique({
        where: { id: line.lotId },
        include: { part: { include: { bomLines: true } } },
      });
      if (!lot) throw new ValidationError("Production Lot not found.");
      if (lot.status !== "IN_HOUSE") {
        throw new ValidationError(`Lot ${lot.lotNo} is not in-house; only in-house stock can be sent for job work.`);
      }
      const op = lot.part.bomLines.find((b) => b.opSeq === lot.currentOpSeq);
      if (!op) throw new ValidationError(`Lot ${lot.lotNo} has completed all operations; send it to final inspection.`);
      if (op.opType !== "JOB_WORK") {
        throw new ValidationError(
          `Lot ${lot.lotNo} is at in-house operation "${op.opName}"; record it on the Production screen.`,
        );
      }
      if (lot.qtyNos <= 0) throw new ValidationError(`Lot ${lot.lotNo} has no quantity to send.`);
      if (line.qtyNos !== lot.qtyNos) {
        throw new ValidationError(
          `Send the whole lot: ${lot.lotNo} holds ${lot.qtyNos} nos (partial lot sends are not supported).`,
        );
      }

      // Validation #5: FIFO — oldest lot waiting at this operation goes first.
      const key = `${lot.partId}:${lot.currentOpSeq}`;
      if (!pools.has(key)) {
        const waiting = await tx.productionLot.findMany({
          where: { partId: lot.partId, currentOpSeq: lot.currentOpSeq, status: "IN_HOUSE", qtyNos: { gt: 0 } },
        });
        pools.set(
          key,
          waiting.map((w) => ({ id: w.id, number: w.lotNo, inwardDate: w.startDate, balance: w.qtyNos })),
        );
      }
      const pool = pools.get(key)!;
      const violation = validateFifoScan(pool, lot.id);
      if (violation) {
        if (params.isAdmin && params.overrideReason) overrides.push(`${lot.lotNo}: ${violation}`);
        else throw new ValidationError(violation.replace("Wrong bundle. Issue", "Wrong lot. Send"));
      }
      const unit = pool.find((u) => u.id === lot.id);
      if (unit) unit.balance = 0;

      prepared.push({
        lotId: lot.id,
        opSeq: lot.currentOpSeq,
        qtyNos: line.qtyNos,
        qtyKg: line.qtyKg,
        leadDays: op.jwLeadDays ?? vendor.maxReturnDays,
      });
    }

    // Expected return = challan date + agreed lead time; editable but never beyond the vendor's max.
    const maxDate = new Date(date.getTime() + vendor.maxReturnDays * DAY_MS);
    const defaultDate = new Date(date.getTime() + Math.max(...prepared.map((p) => p.leadDays)) * DAY_MS);
    const expected = params.expectedReturnDate ?? (defaultDate > maxDate ? maxDate : defaultDate);
    if (expected <= date) throw new ValidationError("Expected return date must be in the future.");
    if (expected.getTime() > maxDate.getTime() + DAY_MS) {
      throw new ValidationError(
        `Expected return date exceeds this vendor's maximum return period of ${vendor.maxReturnDays} days.`,
      );
    }

    const challanNo = await genChallanNo(tx, date);
    const challan = await tx.jwOutChallan.create({
      data: {
        challanNo,
        vendorId: vendor.id,
        date,
        expectedReturnDate: expected,
        status: "OPEN",
        createdById: params.userId,
      },
    });

    for (const p of prepared) {
      const lot = await tx.productionLot.findUniqueOrThrow({ where: { id: p.lotId } });
      await tx.jwChallanLine.create({
        data: { challanId: challan.id, lotId: lot.id, opSeq: p.opSeq, qtyNos: p.qtyNos, qtyKg: p.qtyKg },
      });
      await tx.productionLot.update({
        where: { id: lot.id },
        data: { status: "AT_JOB_WORK", locationId: vendorLoc.id },
      });
      await writeLedger(tx, {
        txnType: "T8_JW_SEND",
        txnDate: date,
        docNo: challanNo,
        itemType: "WIP",
        refNo: lot.lotNo,
        fromLocationId: lot.locationId,
        toLocationId: vendorLoc.id,
        fromStatus: "IN_HOUSE",
        toStatus: "AT_JOB_WORK",
        qty: p.qtyNos,
        uom: "nos",
        userId: params.userId,
        reason: overrides.length ? params.overrideReason : undefined,
      });
    }

    if (overrides.length > 0) {
      await tx.auditLog.create({
        data: {
          userId: params.userId,
          action: "FIFO_OVERRIDE",
          entity: "JwOutChallan",
          entityId: challan.id,
          newValue: { reason: params.overrideReason ?? "", violations: overrides },
        },
      });
    }

    return challan;
  }, { isolationLevel: "Serializable" });
}

export interface JwReceiveLine {
  challanLineId: string;
  receivedNos: number;
  rejectedNos: number;
  shortNos: number;
  reasonCodeId?: string;
}

/** T9 — material arrives, goes to JW Return QC (not yet usable in-house). */
export async function createJwInReceipt(params: { challanId: string; lines: JwReceiveLine[]; userId: string }) {
  if (params.lines.length === 0) throw new ValidationError("Receipt must have at least one line.");
  return prisma.$transaction(async (tx) => {
    const challan = await tx.jwOutChallan.findUnique({
      where: { id: params.challanId },
      include: { lines: true },
    });
    if (!challan) throw new ValidationError("Challan not found.");
    if (challan.status === "CLOSED") throw new ValidationError("Challan already closed.");

    const date = new Date();
    const qcLoc = await getLocationByName(tx, LOCATION_NAMES.JW_RETURN_QC);
    const rejLoc = await getLocationByName(tx, LOCATION_NAMES.REJECTION_WIP);

    // Validate everything before writing anything.
    for (const line of params.lines) {
      const cl = challan.lines.find((l) => l.id === line.challanLineId);
      if (!cl) throw new ValidationError("Challan line not found.");
      if (line.receivedNos < 0 || line.rejectedNos < 0 || line.shortNos < 0) {
        throw new ValidationError("Quantities cannot be negative.");
      }
      const totalThis = line.receivedNos + line.rejectedNos + line.shortNos;
      if (totalThis <= 0) throw new ValidationError("Enter a received, rejected or short quantity.");
      const pending = cl.qtyNos - cl.receivedNos - cl.rejectedNos - cl.shortNos;
      if (totalThis > pending) {
        throw new ValidationError(
          `Receipt quantity (${totalThis}) exceeds challan pending quantity (${pending}) for this line.`,
        );
      }
      if (line.rejectedNos > 0 && !line.reasonCodeId) {
        throw new ValidationError("Reason code is mandatory for quantity rejected by the job worker.");
      }
    }

    const receiptNo = await genReceiptNo(tx, date);
    const receipt = await tx.jwInReceipt.create({
      data: { receiptNo, challanId: challan.id, date, createdById: params.userId },
    });

    for (const line of params.lines) {
      const cl = challan.lines.find((l) => l.id === line.challanLineId)!;
      await tx.jwReceiptLine.create({
        data: {
          receiptId: receipt.id,
          challanLineId: cl.id,
          lotId: cl.lotId,
          receivedNos: line.receivedNos,
          rejectedNos: line.rejectedNos,
          shortNos: line.shortNos,
        },
      });
      const updated = await tx.jwChallanLine.update({
        where: { id: cl.id },
        data: {
          receivedNos: { increment: line.receivedNos },
          rejectedNos: { increment: line.rejectedNos },
          shortNos: { increment: line.shortNos },
        },
      });

      const lot = await tx.productionLot.findUniqueOrThrow({ where: { id: cl.lotId } });
      if (line.receivedNos > 0) {
        await writeLedger(tx, {
          txnType: "T9_JW_RECEIVE",
          txnDate: date,
          docNo: receiptNo,
          itemType: "WIP",
          refNo: lot.lotNo,
          toLocationId: qcLoc.id,
          toStatus: "JW_RETURN_QC",
          qty: line.receivedNos,
          uom: "nos",
          userId: params.userId,
        });
      }
      if (line.rejectedNos > 0) {
        // Rejected by the job worker: Rejected – WIP, against the challan.
        await writeLedger(tx, {
          txnType: "T12_REJECTION",
          txnDate: date,
          docNo: challan.challanNo,
          itemType: "WIP",
          refNo: lot.lotNo,
          toLocationId: rejLoc.id,
          toStatus: "REJECTED",
          qty: line.rejectedNos,
          uom: "nos",
          userId: params.userId,
          reason: line.reasonCodeId,
        });
        await tx.rejection.create({
          data: {
            rejNo: await genRejectionNo(tx, date),
            stage: "JW_RETURN",
            refType: "LOT",
            refId: lot.id,
            qty: line.rejectedNos,
            uom: "nos",
            reasonCodeId: line.reasonCodeId!,
            disposal: "PENDING",
            createdById: params.userId,
          },
        });
      }

      // Lot leaves the vendor only when nothing is pending on its challan line.
      const stillPending = updated.qtyNos - updated.receivedNos - updated.rejectedNos - updated.shortNos;
      if (stillPending <= 0) {
        await releaseLotFromVendor(tx, lot.id, updated.receivedNos);
      }
    }

    const refreshed = await tx.jwOutChallan.findUniqueOrThrow({
      where: { id: challan.id },
      include: { lines: true },
    });
    const allDone = refreshed.lines.every((l) => l.receivedNos + l.rejectedNos + l.shortNos >= l.qtyNos);
    const anyDone = refreshed.lines.some((l) => l.receivedNos + l.rejectedNos + l.shortNos > 0);
    await tx.jwOutChallan.update({
      where: { id: challan.id },
      data: { status: allDone ? "CLOSED" : anyDone ? "PARTIALLY_RECEIVED" : "OPEN" },
    });

    return receipt;
  }, { isolationLevel: "Serializable" });
}

type JwTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Move a lot out of the vendor location once its challan line is settled. */
async function releaseLotFromVendor(tx: JwTx, lotId: string, receivedGoodNos: number) {
  const qcLoc = await getLocationByName(tx, LOCATION_NAMES.JW_RETURN_QC);
  if (receivedGoodNos > 0) {
    await tx.productionLot.update({
      where: { id: lotId },
      data: { status: "JW_RETURN_QC", locationId: qcLoc.id, qtyNos: receivedGoodNos },
    });
  } else {
    // Nothing usable came back (all rejected / short) — nothing left for QC.
    await tx.productionLot.update({ where: { id: lotId }, data: { status: "REJECTED", qtyNos: 0 } });
  }
}

/** T10 — QC decision on JW-returned material: accept -> back to next in-house op; reject -> Rejected-WIP. */
export async function jwReturnQcDecision(params: {
  lotId: string;
  acceptedNos: number;
  rejectedNos: number;
  reasonCodeId?: string;
  userId: string;
}) {
  if (params.acceptedNos < 0 || params.rejectedNos < 0) throw new ValidationError("Quantities cannot be negative.");
  if (params.rejectedNos > 0 && !params.reasonCodeId) {
    throw new ValidationError("Reason code is mandatory for rejection.");
  }
  return prisma.$transaction(async (tx) => {
    const lot = await tx.productionLot.findUniqueOrThrow({
      where: { id: params.lotId },
      include: { part: { include: { bomLines: true } } },
    });
    if (lot.status !== "JW_RETURN_QC") {
      throw new ValidationError("Lot is not awaiting JW Return QC.");
    }
    if (params.acceptedNos + params.rejectedNos !== lot.qtyNos) {
      throw new ValidationError(
        `Accepted + rejected must equal the quantity received for QC (${lot.qtyNos} nos).`,
      );
    }
    const wipLoc = await getLocationByName(tx, LOCATION_NAMES.PRODUCTION_FLOOR);

    if (params.acceptedNos > 0) {
      await tx.productionLot.update({
        where: { id: lot.id },
        data: {
          status: "IN_HOUSE",
          locationId: wipLoc.id,
          currentOpSeq: nextOpSeq(lot.part.bomLines, lot.currentOpSeq),
          qtyNos: params.acceptedNos,
        },
      });
      await writeLedger(tx, {
        txnType: "T10_JW_RETURN_QC",
        docNo: lot.lotNo,
        itemType: "WIP",
        refNo: lot.lotNo,
        fromStatus: "JW_RETURN_QC",
        toLocationId: wipLoc.id,
        toStatus: "IN_HOUSE",
        qty: params.acceptedNos,
        uom: "nos",
        userId: params.userId,
      });
    } else {
      await tx.productionLot.update({ where: { id: lot.id }, data: { status: "REJECTED", qtyNos: 0 } });
    }
    if (params.rejectedNos > 0) {
      const rejLoc = await getLocationByName(tx, LOCATION_NAMES.REJECTION_WIP);
      await writeLedger(tx, {
        txnType: "T12_REJECTION",
        docNo: lot.lotNo,
        itemType: "WIP",
        refNo: lot.lotNo,
        fromStatus: "JW_RETURN_QC",
        toLocationId: rejLoc.id,
        toStatus: "REJECTED",
        qty: params.rejectedNos,
        uom: "nos",
        userId: params.userId,
        reason: params.reasonCodeId,
      });
      await tx.rejection.create({
        data: {
          rejNo: await genRejectionNo(tx, new Date()),
          stage: "JW_RETURN",
          refType: "LOT",
          refId: lot.id,
          qty: params.rejectedNos,
          uom: "nos",
          reasonCodeId: params.reasonCodeId!,
          disposal: "PENDING",
          createdById: params.userId,
        },
      });
    }
    return tx.productionLot.findUniqueOrThrow({ where: { id: lot.id } });
  }, { isolationLevel: "Serializable" });
}

/**
 * Admin: close a challan with a shortage before it is fully received. The outstanding
 * quantity is written off as short, and lots are released from the vendor.
 */
export async function closeChallanWithShortage(params: { challanId: string; reason: string; adminId: string }) {
  if (!params.reason.trim()) throw new ValidationError("Reason is mandatory to close a challan with shortage.");
  return prisma.$transaction(async (tx) => {
    const challan = await tx.jwOutChallan.findUnique({ where: { id: params.challanId }, include: { lines: true } });
    if (!challan) throw new ValidationError("Challan not found.");
    if (challan.status === "CLOSED") throw new ValidationError("Challan is already closed.");

    for (const l of challan.lines) {
      const pending = l.qtyNos - l.receivedNos - l.rejectedNos - l.shortNos;
      if (pending <= 0) continue;
      const updated = await tx.jwChallanLine.update({ where: { id: l.id }, data: { shortNos: { increment: pending } } });
      await releaseLotFromVendor(tx, l.lotId, updated.receivedNos);
    }
    const closed = await tx.jwOutChallan.update({
      where: { id: challan.id },
      data: { status: "CLOSED", closedWithShortageReason: params.reason },
    });
    await tx.auditLog.create({
      data: {
        userId: params.adminId,
        action: "JW_CHALLAN_CLOSED_WITH_SHORTAGE",
        entity: "JwOutChallan",
        entityId: challan.id,
        newValue: { reason: params.reason },
      },
    });
    return closed;
  }, { isolationLevel: "Serializable" });
}
