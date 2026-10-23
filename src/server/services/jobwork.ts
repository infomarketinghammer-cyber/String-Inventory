/**
 * Job Work out/in — Section 4.7. T8 (send), T9 (receive to JW Return QC),
 * T10 (QC accept/reject). Validation #5 (FIFO on JW send), #7 (can't skip ahead
 * of JW), #8 (receipt <= pending).
 *
 * Partial returns: while part of a challan line is still at the vendor, the pieces received are split into their
 * own Production Lot (parentLotId = the lot sent) which goes to JW Return QC at once; the parent stays AT_JOB_WORK
 * holding only what is still at the vendor, and moves to JW Return QC with its remaining received pieces once
 * nothing is pending (fully received, or the challan is closed by Admin with a shortage reason).
 * Each receipt posts its own T9 ledger row against the lot that was sent.
 */
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { genChallanNo, genLotNo, genReceiptNo, genRejectionNo } from "./docNumber";
import { getJobWorkerLocation, getLocationByName, LOCATION_NAMES } from "./locations";
import { validateFifoScan, type FifoPoolUnit } from "./fifo";
import { nextOpSeq } from "./production";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface JwSendLine {
  lotId: string;
  qtyNos: number;
  qtyKg: number;
}

export const NEW_JOB_WORKER = "__new__";

export interface NewJobWorker {
  name: string;
  address?: string;
  gstin?: string;
  maxReturnDays: number;
}

type JwTxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Registers a job worker with its own "At Job Worker - <name>" stock location (SOP section 5). */
export async function createJobWorker(tx: JwTxClient, input: NewJobWorker) {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Enter the new job worker's name.");
  if (!Number.isInteger(input.maxReturnDays) || input.maxReturnDays < 1 || input.maxReturnDays > 365) {
    throw new ValidationError("Maximum return days must be a whole number from 1 to 365.");
  }
  const locName = `At Job Worker - ${name}`;
  if ((await tx.jobWorker.findFirst({ where: { name } })) || (await tx.location.findUnique({ where: { name: locName } }))) {
    throw new ValidationError(`A job worker named "${name}" already exists; choose it from the list.`);
  }
  const location = await tx.location.create({ data: { name: locName, type: "JW_VENDOR" } });
  return tx.jobWorker.create({
    data: {
      name,
      address: input.address?.trim() || null,
      gstin: input.gstin?.trim() || null,
      maxReturnDays: input.maxReturnDays,
      locationId: location.id,
    },
  });
}

export async function createJwOutChallan(params: {
  /** An existing job worker id, or NEW_JOB_WORKER together with `newVendor` (registered in the same save). */
  vendorId: string;
  newVendor?: NewJobWorker;
  vehicleNo?: string;
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
    // A new job worker is created with the challan, all or nothing: if the challan fails, no vendor is left behind.
    const vendor =
      params.vendorId === NEW_JOB_WORKER
        ? params.newVendor
          ? await createJobWorker(tx, params.newVendor)
          : null
        : await tx.jobWorker.findUnique({ where: { id: params.vendorId } });
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
    if (expected.toLocaleDateString("en-CA") < date.toLocaleDateString("en-CA") || expected <= date) {
      throw new ValidationError("Expected return date cannot be before today.");
    }
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
        vehicleNo: params.vehicleNo?.trim().toUpperCase() || null,
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
  });
}

export interface JwReceiveLine {
  challanLineId: string;
  receivedNos: number;
  rejectedNos: number;
  shortNos: number;
  reasonCodeId?: string;
}

/** YYYY-MM-DD in the plant's (server's) local time zone. */
const localDay = (d: Date) => d.toLocaleDateString("en-CA");

/**
 * T9 — a return batch arrives from the job worker against the original challan; its good pieces go to
 * JW Return QC at once (see the file header). One challan can receive any number of batches.
 * `receiptDate` is the actual arrival date (default now; not in the future, not before the challan date).
 * `clientToken` (one per form render) makes a repeated submit of the same receipt a no-op.
 */
export async function createJwInReceipt(params: {
  challanId: string;
  lines: JwReceiveLine[];
  userId: string;
  receiptDate?: Date;
  vendorDcNo?: string;
  remarks?: string;
  clientToken?: string;
}) {
  if (params.lines.length === 0) throw new ValidationError("Receipt must have at least one line.");
  return prisma.$transaction(async (tx) => {
    if (params.clientToken) {
      const dup = await tx.jwInReceipt.findUnique({ where: { clientToken: params.clientToken } });
      if (dup) return Object.assign(dup, { duplicate: true });
    }
    const challan = await tx.jwOutChallan.findUnique({
      where: { id: params.challanId },
      include: { lines: true },
    });
    if (!challan) throw new ValidationError("Challan not found.");
    if (challan.status === "CLOSED") throw new ValidationError("Challan already closed.");

    const now = new Date();
    const date = params.receiptDate ?? now;
    if (Number.isNaN(date.getTime())) throw new ValidationError("Invalid receipt date.");
    if (localDay(date) > localDay(now)) throw new ValidationError("Receipt date cannot be in the future.");
    if (localDay(date) < localDay(challan.date)) {
      throw new ValidationError(`Receipt date cannot be before the challan date (${localDay(challan.date)}).`);
    }
    const qcLoc = await getLocationByName(tx, LOCATION_NAMES.JW_RETURN_QC);
    const rejLoc = await getLocationByName(tx, LOCATION_NAMES.REJECTION_WIP);

    // Validate everything before writing anything (inside the transaction, so concurrent receipts see each other).
    for (const line of params.lines) {
      const cl = challan.lines.find((l) => l.id === line.challanLineId);
      if (!cl) throw new ValidationError("Challan line not found.");
      if (![line.receivedNos, line.rejectedNos, line.shortNos].every(Number.isInteger)) {
        throw new ValidationError("Quantities must be whole numbers.");
      }
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
      data: {
        receiptNo,
        challanId: challan.id,
        date,
        createdById: params.userId,
        vendorDcNo: params.vendorDcNo?.trim() || null,
        remarks: params.remarks?.trim() || null,
        clientToken: params.clientToken || undefined, // none sent: the schema generates a unique one
      },
    });

    for (const line of params.lines) {
      const cl = challan.lines.find((l) => l.id === line.challanLineId)!;
      const updated = await tx.jwChallanLine.update({
        where: { id: cl.id },
        data: {
          receivedNos: { increment: line.receivedNos },
          rejectedNos: { increment: line.rejectedNos },
          shortNos: { increment: line.shortNos },
        },
      });
      const stillPending = updated.qtyNos - updated.receivedNos - updated.rejectedNos - updated.shortNos;

      const lot = await tx.productionLot.findUniqueOrThrow({ where: { id: cl.lotId }, include: { bundleLinks: true } });
      // SOP 4.7 / process flow: partial returns go to QC straight away. When pieces come back but some are still
      // at the vendor, the returned pieces are split into their own lot (same Part, MRN, bundles and start date,
      // so traceability and FIFO age are kept) which goes to JW Return QC; the rest stays At Job Worker.
      let splitLot: { id: string; lotNo: string } | null = null;
      if (line.receivedNos > 0 && stillPending > 0) {
        splitLot = await tx.productionLot.create({
          data: {
            lotNo: await genLotNo(tx, date),
            partId: lot.partId,
            mrnId: lot.mrnId,
            currentOpSeq: lot.currentOpSeq,
            qtyNos: line.receivedNos,
            status: "JW_RETURN_QC",
            locationId: qcLoc.id,
            startDate: lot.startDate,
            parentLotId: lot.id,
          },
        });
        for (const link of lot.bundleLinks) {
          await tx.lotBundleLink.create({ data: { lotId: splitLot.id, bundleId: link.bundleId, kgConsumed: 0 } });
        }
      }
      // Pieces still at the vendor under the parent lot.
      await tx.productionLot.update({
        where: { id: lot.id },
        data: { qtyNos: Math.max(0, lot.qtyNos - line.receivedNos - line.rejectedNos - line.shortNos) },
      });
      await tx.jwReceiptLine.create({
        data: {
          receiptId: receipt.id,
          challanLineId: cl.id,
          lotId: cl.lotId,
          receivedNos: line.receivedNos,
          rejectedNos: line.rejectedNos,
          shortNos: line.shortNos,
          splitLotId: splitLot?.id ?? null,
          // The lot this batch is inspected in: its own split lot, or (last batch of the line) the sent lot itself.
          qcLotId: line.receivedNos > 0 ? (splitLot?.id ?? (stillPending <= 0 ? lot.id : null)) : null,
        },
      });

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
          reason: splitLot ? `partial return: to JW Return QC as ${splitLot.lotNo}` : undefined,
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

      // The parent lot leaves the vendor once nothing is pending on its challan line, carrying the good pieces
      // received that were not already split off to QC.
      if (stillPending <= 0) await releaseLotFromVendor(tx, lot.id, cl.id);
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

    return Object.assign(receipt, { duplicate: false });
  });
}

type JwTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Move a lot out of the vendor location once its challan line is settled. Its quantity for QC is the good pieces
 * received on that line that were not already split off to QC as their own lot by an earlier partial return.
 */
async function releaseLotFromVendor(tx: JwTx, lotId: string, challanLineId: string) {
  const qcLoc = await getLocationByName(tx, LOCATION_NAMES.JW_RETURN_QC);
  const line = await tx.jwChallanLine.findUniqueOrThrow({ where: { id: challanLineId } });
  const split = await tx.jwReceiptLine.aggregate({ _sum: { receivedNos: true }, where: { challanLineId, splitLotId: { not: null } } });
  const receivedGoodNos = line.receivedNos - (split._sum.receivedNos ?? 0);
  if (receivedGoodNos > 0) {
    await tx.productionLot.update({
      where: { id: lotId },
      data: { status: "JW_RETURN_QC", locationId: qcLoc.id, qtyNos: receivedGoodNos },
    });
  } else if ((split._sum.receivedNos ?? 0) > 0) {
    // Everything good already went to QC as split lots; nothing is left in this lot.
    await tx.productionLot.update({ where: { id: lotId }, data: { status: "CLOSED", qtyNos: 0, locationId: qcLoc.id } });
  } else {
    // Nothing usable came back (all rejected / short) — nothing left for QC.
    await tx.productionLot.update({ where: { id: lotId }, data: { status: "REJECTED", qtyNos: 0 } });
  }
}

/**
 * T10 — JW Return QC of a received batch: accepted pieces go back in-house at the next operation; rejected
 * pieces go to Rejected – WIP. Partial QC is allowed: accepted + rejected may be less than the pieces waiting
 * (the rest stays pending QC). In a partial QC the accepted pieces move on as their own lot, so only inspected,
 * accepted pieces ever re-enter production. Every inspection is kept as a JwQcEntry against its return batch.
 * `clientToken` (one per form render) makes a repeated submit a no-op.
 */
export async function jwReturnQcDecision(params: {
  lotId: string;
  acceptedNos: number;
  rejectedNos: number;
  reasonCodeId?: string;
  remarks?: string;
  userId: string;
  clientToken?: string;
}) {
  if (!Number.isInteger(params.acceptedNos) || !Number.isInteger(params.rejectedNos)) {
    throw new ValidationError("Quantities must be whole numbers.");
  }
  if (params.acceptedNos < 0 || params.rejectedNos < 0) throw new ValidationError("Quantities cannot be negative.");
  if (params.acceptedNos + params.rejectedNos === 0) throw new ValidationError("Enter an accepted or rejected quantity; an inspection of 0 cannot be saved.");
  if (params.rejectedNos > 0 && !params.reasonCodeId) {
    throw new ValidationError("Reason code is mandatory for rejection.");
  }
  return prisma.$transaction(async (tx) => {
    if (params.clientToken) {
      const dup = await tx.jwQcEntry.findUnique({ where: { clientToken: params.clientToken } });
      if (dup) {
        const qcLot = await tx.productionLot.findUniqueOrThrow({ where: { id: dup.lotId } });
        return Object.assign(qcLot, {
          duplicate: true,
          pendingQc: qcLot.status === "JW_RETURN_QC" ? qcLot.qtyNos : 0,
          acceptedLotId: dup.acceptedLotId as string | null,
        });
      }
    }
    const lot = await tx.productionLot.findUniqueOrThrow({
      where: { id: params.lotId },
      include: { part: { include: { bomLines: true } }, bundleLinks: true },
    });
    if (lot.status !== "JW_RETURN_QC") {
      throw new ValidationError("Lot is not awaiting JW Return QC.");
    }
    const inspected = params.acceptedNos + params.rejectedNos;
    if (inspected > lot.qtyNos) {
      throw new ValidationError(
        `Accepted + rejected (${inspected}) exceeds the ${lot.qtyNos} nos received and still waiting for QC.`,
      );
    }
    const complete = inspected === lot.qtyNos;
    const wipLoc = await getLocationByName(tx, LOCATION_NAMES.PRODUCTION_FLOOR);
    // The return batch these pieces belong to (latest batch inspected in this lot).
    const batch = await tx.jwReceiptLine.findFirst({ where: { qcLotId: lot.id }, orderBy: { receipt: { date: "desc" } } });

    let acceptedLotId: string | null = null;
    if (params.acceptedNos > 0) {
      let acceptedLot = { id: lot.id, lotNo: lot.lotNo };
      if (complete) {
        await tx.productionLot.update({
          where: { id: lot.id },
          data: {
            status: "IN_HOUSE",
            locationId: wipLoc.id,
            currentOpSeq: nextOpSeq(lot.part.bomLines, lot.currentOpSeq),
            qtyNos: params.acceptedNos,
          },
        });
      } else {
        // Partial QC: the accepted pieces continue as their own lot; the rest of the batch stays in QC.
        acceptedLot = await tx.productionLot.create({
          data: {
            lotNo: await genLotNo(tx, new Date()),
            partId: lot.partId,
            mrnId: lot.mrnId,
            currentOpSeq: nextOpSeq(lot.part.bomLines, lot.currentOpSeq),
            qtyNos: params.acceptedNos,
            status: "IN_HOUSE",
            locationId: wipLoc.id,
            startDate: lot.startDate,
            parentLotId: lot.id,
          },
        });
        for (const link of lot.bundleLinks) {
          await tx.lotBundleLink.create({ data: { lotId: acceptedLot.id, bundleId: link.bundleId, kgConsumed: 0 } });
        }
      }
      acceptedLotId = acceptedLot.id;
      await writeLedger(tx, {
        txnType: "T10_JW_RETURN_QC",
        docNo: lot.lotNo,
        itemType: "WIP",
        refNo: acceptedLot.lotNo,
        fromStatus: "JW_RETURN_QC",
        toLocationId: wipLoc.id,
        toStatus: "IN_HOUSE",
        qty: params.acceptedNos,
        uom: "nos",
        userId: params.userId,
        reason: complete ? undefined : `partial QC of ${lot.lotNo}`,
      });
    }
    if (!complete) {
      await tx.productionLot.update({ where: { id: lot.id }, data: { qtyNos: lot.qtyNos - inspected } });
    } else if (params.acceptedNos === 0) {
      await tx.productionLot.update({ where: { id: lot.id }, data: { status: "REJECTED", qtyNos: 0 } });
    }
    await tx.jwQcEntry.create({
      data: {
        receiptLineId: batch?.id ?? null,
        lotId: lot.id,
        acceptedNos: params.acceptedNos,
        rejectedNos: params.rejectedNos,
        reasonCodeId: params.rejectedNos > 0 ? params.reasonCodeId : null,
        remarks: params.remarks?.trim() || null,
        acceptedLotId,
        inspectedById: params.userId,
        clientToken: params.clientToken || undefined, // none sent: the schema generates a unique one
      },
    });
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
    const after = await tx.productionLot.findUniqueOrThrow({ where: { id: lot.id } });
    return Object.assign(after, { duplicate: false, pendingQc: complete ? 0 : lot.qtyNos - inspected, acceptedLotId });
  });
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
      await tx.jwChallanLine.update({ where: { id: l.id }, data: { shortNos: { increment: pending } } });
      await releaseLotFromVendor(tx, l.lotId, l.id);
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
  });
}
