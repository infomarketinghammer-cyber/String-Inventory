/**
 * Final inspection -> FG (T11) — Section 4.8.
 *   1. QC inspector (Floor) records the result: accepted / rejected quantity (+ reason, test results).
 *   2. Quality Admin approves it. Only then is the FG Lot created (validation #9).
 * FG inward date = approval date. Accepted + rejected must cover the whole lot.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { genFgLotNo, genFqiNo, genRejectionNo } from "./docNumber";
import { getLocationByName, LOCATION_NAMES } from "./locations";
import { allOpsComplete } from "./production";

type Tx = Prisma.TransactionClient | PrismaClient;

interface FqiInput {
  lotId: string;
  acceptedNos: number;
  rejectedNos: number;
  reasonCodeId?: string;
  results?: string;
}

async function validateLot(tx: Tx, p: FqiInput) {
  if (p.rejectedNos > 0 && !p.reasonCodeId) {
    throw new ValidationError("Reason code mandatory for rejection at final inspection.");
  }
  if (!Number.isInteger(p.acceptedNos) || !Number.isInteger(p.rejectedNos) || p.acceptedNos < 0 || p.rejectedNos < 0) {
    throw new ValidationError("Quantities must be whole numbers, zero or more.");
  }
  const lot = await tx.productionLot.findUniqueOrThrow({
    where: { id: p.lotId },
    include: { part: { include: { bomLines: true } } },
  });
  if (lot.status !== "IN_HOUSE") {
    throw new ValidationError("Lot must be in-house and at its final operation for final inspection.");
  }
  if (!allOpsComplete(lot.part.bomLines, lot.currentOpSeq)) {
    throw new ValidationError("Lot has not completed the last routing operation yet.");
  }
  if (p.acceptedNos + p.rejectedNos !== lot.qtyNos) {
    throw new ValidationError(
      `Accepted + rejected must equal the lot quantity (${lot.qtyNos} nos); inspect the whole lot.`,
    );
  }
  return lot;
}

/** Step 1 — QC inspector records the result. Does not move stock. */
export async function recordFinalInspection(params: FqiInput & { userId: string }) {
  return prisma.$transaction(async (tx) => {
    await validateLot(tx, params);
    const open = await tx.finalInspection.findFirst({ where: { lotId: params.lotId, approvedAt: null } });
    if (open) throw new ValidationError(`Lot already has a final inspection (${open.fqiNo}) awaiting Admin approval.`);
    return tx.finalInspection.create({
      data: {
        fqiNo: await genFqiNo(tx, new Date()),
        lotId: params.lotId,
        acceptedNos: params.acceptedNos,
        rejectedNos: params.rejectedNos,
        reasonCodeId: params.reasonCodeId,
        results: params.results?.trim() || null,
        enteredById: params.userId,
      },
    });
  }, { isolationLevel: "Serializable" });
}

/** Step 2 — Quality Admin approves a recorded inspection: FG Lot created, rejects to Rejected – FG. */
export async function approveRecordedFinalInspection(params: { fqiId: string; approverId: string }) {
  return prisma.$transaction(async (tx) => {
    const fqi = await tx.finalInspection.findUnique({ where: { id: params.fqiId } });
    if (!fqi) throw new ValidationError("Final inspection record not found.");
    if (fqi.approvedAt) throw new ValidationError("This final inspection has already been approved.");
    // Re-validate against the lot as it is now (it may have changed since the result was recorded).
    const lot = await validateLot(tx, {
      lotId: fqi.lotId,
      acceptedNos: fqi.acceptedNos,
      rejectedNos: fqi.rejectedNos,
      reasonCodeId: fqi.reasonCodeId ?? undefined,
    });
    const fgLot = await convertToFg(tx, lot, fqi.acceptedNos, fqi.rejectedNos, fqi.reasonCodeId ?? undefined, params.approverId, fqi.fqiNo);
    await tx.finalInspection.update({
      where: { id: fqi.id },
      data: { approvedById: params.approverId, approvedAt: new Date(), fgLotNo: fgLot?.fgLotNo ?? null },
    });
    return fgLot;
  }, { isolationLevel: "Serializable" });
}

/**
 * Admin records and approves in one step (Admin has both rights). Kept for the Admin screen
 * and for scripted tests; it writes the same FinalInspection record as the two-step flow.
 */
export async function approveFinalInspection(params: FqiInput & { approverId: string }) {
  const rec = await recordFinalInspection({ ...params, userId: params.approverId });
  return approveRecordedFinalInspection({ fqiId: rec.id, approverId: params.approverId });
}

async function convertToFg(
  tx: Tx,
  lot: { id: string; lotNo: string; partId: string },
  acceptedNos: number,
  rejectedNos: number,
  reasonCodeId: string | undefined,
  approverId: string,
  fqiNo: string,
) {
  const date = new Date();
  let fgLot = null;
  if (acceptedNos > 0) {
    const fgLotNo = await genFgLotNo(tx, date);
    const fgStores = await getLocationByName(tx, LOCATION_NAMES.FG_STORES);
    fgLot = await tx.fgLot.create({
      data: {
        fgLotNo,
        partId: lot.partId,
        sourceLotId: lot.id,
        qtyNos: acceptedNos,
        balanceNos: acceptedNos,
        inwardDate: date,
        status: "AVAILABLE",
        approvedById: approverId,
      },
    });
    await writeLedger(tx, {
      txnType: "T11_FINAL_INSPECTION",
      docNo: fgLotNo,
      itemType: "FG",
      refNo: fgLotNo,
      toLocationId: fgStores.id,
      toStatus: "AVAILABLE",
      qty: acceptedNos,
      uom: "nos",
      userId: approverId,
      reason: fqiNo,
    });
  }

  if (rejectedNos > 0) {
    const rejLoc = await getLocationByName(tx, LOCATION_NAMES.REJECTION_FG);
    await writeLedger(tx, {
      txnType: "T12_REJECTION",
      docNo: fqiNo,
      itemType: "FG",
      refNo: lot.lotNo,
      toLocationId: rejLoc.id,
      toStatus: "REJECTED",
      qty: rejectedNos,
      uom: "nos",
      userId: approverId,
      reason: reasonCodeId,
    });
    await tx.rejection.create({
      data: {
        rejNo: await genRejectionNo(tx, date),
        stage: "FQI",
        refType: "LOT",
        refId: lot.id,
        qty: rejectedNos,
        uom: "nos",
        reasonCodeId: reasonCodeId ?? "",
        disposal: "PENDING",
        createdById: approverId,
      },
    });
  }

  await tx.productionLot.update({ where: { id: lot.id }, data: { status: "CLOSED", qtyNos: 0 } });
  return fgLot;
}
