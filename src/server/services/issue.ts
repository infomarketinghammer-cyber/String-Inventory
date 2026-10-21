/**
 * Material Issue to production (T5) with FIFO — Section 4.5 / 7.
 * Runs inside a Serializable transaction so two concurrent issues can never
 * double-consume a bundle (mandatory architecture rule #3).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { fifoPick, validateFifoScan, type FifoPoolUnit } from "./fifo";
import { genIssueNo, genLotNo, genReturnToStoresNo } from "./docNumber";
import { getLocationByName, LOCATION_NAMES } from "./locations";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Wire currently held by the lots of an MRN: issues minus returns-to-stores and reversals.
 * (Lot-bundle links are decremented by both, so this is the net quantity actually issued.)
 */
export async function netIssuedKg(tx: Tx, mrnId: string): Promise<number> {
  const agg = await tx.lotBundleLink.aggregate({ _sum: { kgConsumed: true }, where: { lot: { mrnId } } });
  return Number(agg._sum.kgConsumed ?? 0);
}

/** Re-derive an MRN's status (Open / Partially Issued / Closed) from the net issued quantity. */
export async function recomputeMrnStatus(tx: Tx, mrnId: string) {
  const mrn = await tx.mrn.findUniqueOrThrow({ where: { id: mrnId } });
  const net = await netIssuedKg(tx, mrnId);
  const status = net <= 0.005 ? "OPEN" : net >= Number(mrn.requiredKg) - 0.005 ? "CLOSED" : "PARTIALLY_ISSUED";
  if (status !== mrn.status) await tx.mrn.update({ where: { id: mrnId }, data: { status } });
}

async function loadEligiblePool(tx: Tx, itemId: string) {
  const rows = await tx.bundle.findMany({
    where: { itemId, status: "AVAILABLE" },
    orderBy: [{ inwardDate: "asc" }, { bundleNo: "asc" }],
  });
  const pool: FifoPoolUnit[] = rows.map((b) => ({
    id: b.id,
    number: b.bundleNo,
    inwardDate: b.inwardDate,
    balance: Number(b.balanceKg),
  }));
  return { rows, pool };
}

/** Preview FIFO suggestion for an MRN (no stock movement) — used by the Issue screen. */
export async function suggestFifoForMrn(mrnId: string) {
  const mrn = await prisma.mrn.findUnique({ where: { id: mrnId }, include: { part: true } });
  if (!mrn) throw new ValidationError("MRN not found.");
  const bomLine = await prisma.bomLine.findFirst({
    where: { partId: mrn.partId, itemId: { not: null } },
    include: { item: true },
  });
  if (!bomLine?.item) throw new ValidationError("No BOM wire item configured for this Part.");
  const { pool } = await loadEligiblePool(prisma, bomLine.item.id);
  const remainingKg = Math.max(0, Number(mrn.requiredKg) - (await netIssuedKg(prisma, mrn.id)));
  const result = fifoPick(pool, remainingKg);
  return { mrn, item: bomLine.item, suggestion: result };
}

export interface IssueLineScan {
  bundleId: string;
  kgIssued: number;
}

/**
 * Create a Material Issue against an Open MRN.
 * `scannedLines` are what the store keeper actually scanned/entered.
 * `overrideReason` lets Admin bypass FIFO ordering (validation #5).
 */
export async function createIssue(params: {
  mrnId: string;
  scannedLines: IssueLineScan[];
  userId: string;
  isAdmin: boolean;
  overrideReason?: string;
}) {
  if (params.scannedLines.length === 0) {
    throw new ValidationError("At least one bundle must be scanned.");
  }

  return prisma.$transaction(async (tx) => {
    const mrn = await tx.mrn.findUnique({ where: { id: params.mrnId }, include: { part: true } });
    if (!mrn) throw new ValidationError("MRN not found.");
    // Validation #4: issue only against Open MRN
    if (mrn.status === "CLOSED") throw new ValidationError("MRN is already closed.");

    const bomLine = await tx.bomLine.findFirst({
      where: { partId: mrn.partId, itemId: { not: null } },
      include: { item: true },
    });
    if (!bomLine?.item) throw new ValidationError("No BOM wire item configured for this Part.");

    // SQLite serializes write transactions, so no explicit row lock is needed.
    const { pool } = await loadEligiblePool(tx, bomLine.item.id);

    // Cap the issue at what the MRN still needs (cumulative across earlier issues).
    const issuedSoFar = await netIssuedKg(tx, mrn.id);
    const thisIssueKg = params.scannedLines.reduce((s, l) => s + l.kgIssued, 0);
    const mrnRemaining = Number(mrn.requiredKg) - issuedSoFar;
    if (thisIssueKg > mrnRemaining + 0.005) {
      throw new ValidationError(
        `Issue (${thisIssueKg.toFixed(2)} kg) exceeds what this MRN still needs (${Math.max(0, mrnRemaining).toFixed(2)} kg).`,
      );
    }

    // Validate FIFO against a working copy of the pool that shrinks as each scan is
    // accepted, so scanning RM-A (oldest) then RM-B (next oldest) in one issue is valid
    // but skipping ahead is not.
    const working: FifoPoolUnit[] = pool.map((u) => ({ ...u }));
    const fifoViolations: string[] = [];
    for (const line of params.scannedLines) {
      const unit = working.find((u) => u.id === line.bundleId);
      if (!unit || unit.balance <= 0) {
        throw new ValidationError(
          "Wrong bundle. Scanned bundle is not Available RM stock of the matching grade/diameter.",
        );
      }
      const violation = validateFifoScan(working, line.bundleId);
      if (violation) {
        if (params.isAdmin && params.overrideReason) fifoViolations.push(`${unit.number}: ${violation}`);
        else throw new ValidationError(violation);
      }
      if (line.kgIssued <= 0 || line.kgIssued > unit.balance + 1e-6) {
        throw new ValidationError(
          `Issue qty for ${unit.number} exceeds its available balance (${unit.balance.toFixed(2)} kg).`,
        );
      }
      unit.balance -= line.kgIssued;
    }
    if (fifoViolations.length > 0) {
      await tx.auditLog.create({
        data: {
          userId: params.userId,
          action: "FIFO_OVERRIDE",
          entity: "Issue",
          entityId: mrn.id,
          newValue: { reason: params.overrideReason ?? "", violations: fifoViolations },
        },
      });
    }

    const issueDate = new Date();
    const issueNo = await genIssueNo(tx, issueDate);
    const lotNo = await genLotNo(tx, issueDate);
    const wipLoc = await getLocationByName(tx, LOCATION_NAMES.PRODUCTION_FLOOR);

    const issue = await tx.issue.create({
      data: {
        issueNo,
        mrnId: mrn.id,
        issuedById: params.userId,
        overrideReason: params.overrideReason,
      },
    });

    const lot = await tx.productionLot.create({
      data: {
        lotNo,
        partId: mrn.partId,
        mrnId: mrn.id,
        currentOpSeq: 1,
        qtyNos: 0,
        status: "IN_HOUSE",
        locationId: wipLoc.id,
        startDate: issueDate,
      },
    });

    for (const line of params.scannedLines) {
      const bundle = await tx.bundle.findUniqueOrThrow({ where: { id: line.bundleId } });
      // kg are held to 2 decimals; round so float drift (e.g. 18.950000000000017) never reaches the database
      const newBalance = Math.round((Number(bundle.balanceKg) - line.kgIssued) * 100) / 100;
      if (newBalance < -1e-6) {
        throw new ValidationError("No negative stock allowed: issue exceeds bundle balance.");
      }
      await tx.bundle.update({
        where: { id: bundle.id },
        data: {
          balanceKg: newBalance,
          status: newBalance <= 1e-6 ? "CONSUMED" : "AVAILABLE", // keeps original inward date either way
        },
      });
      await tx.issueLine.create({
        data: { issueId: issue.id, bundleId: bundle.id, kgIssued: line.kgIssued },
      });
      await tx.lotBundleLink.create({
        data: { lotId: lot.id, bundleId: bundle.id, kgConsumed: line.kgIssued },
      });
      await writeLedger(tx, {
        txnType: "T5_ISSUE",
        txnDate: issueDate,
        docNo: issueNo,
        itemType: "RM",
        refNo: bundle.bundleNo,
        fromLocationId: bundle.locationId,
        toLocationId: wipLoc.id,
        fromStatus: "AVAILABLE",
        toStatus: "WIP",
        qty: line.kgIssued,
        uom: "kg",
        userId: params.userId,
        reason: params.overrideReason,
      });
    }

    await recomputeMrnStatus(tx, mrn.id);

    return { issue, lot };
  }, { isolationLevel: "Serializable" });
}

/** T6 — Return unused wire from floor to the SAME bundle, restoring kg & original inward date. */
export async function returnToStores(params: { bundleId: string; lotId: string; kg: number; userId: string }) {
  if (params.kg <= 0) throw new ValidationError("Return quantity must be positive.");
  return prisma.$transaction(async (tx) => {
    const bundle = await tx.bundle.findUniqueOrThrow({ where: { id: params.bundleId } });
    if (bundle.status !== "AVAILABLE" && bundle.status !== "CONSUMED") {
      throw new ValidationError("Only wire from an Available/consumed bundle can be returned to stores.");
    }
    const lot = await tx.productionLot.findUnique({
      where: { id: params.lotId },
      include: { opEntries: { select: { id: true } } },
    });
    if (!lot) throw new ValidationError("Production Lot not found.");
    if (lot.status !== "IN_HOUSE" || lot.opEntries.length > 0) {
      throw new ValidationError(
        `Lot ${lot.lotNo} has already started production; wire can only be returned before the first operation is recorded.`,
      );
    }
    // Can only return what that lot actually drew from this bundle.
    const link = await tx.lotBundleLink.findFirst({ where: { lotId: params.lotId, bundleId: bundle.id } });
    if (!link) throw new ValidationError("This bundle was not issued to the selected Production Lot.");
    if (params.kg > Number(link.kgConsumed) + 1e-6) {
      throw new ValidationError(
        `Cannot return ${params.kg} kg: lot only holds ${Number(link.kgConsumed).toFixed(2)} kg from this bundle.`,
      );
    }
    await tx.lotBundleLink.update({
      where: { id: link.id },
      data: { kgConsumed: { decrement: params.kg } },
    });
    const rmStores = await getLocationByName(tx, LOCATION_NAMES.RM_STORES);
    await tx.bundle.update({
      where: { id: bundle.id },
      data: { balanceKg: { increment: params.kg }, status: "AVAILABLE", locationId: rmStores.id },
    });
    await writeLedger(tx, {
      txnType: "T6_RETURN_TO_STORES",
      docNo: await genReturnToStoresNo(tx, new Date()),
      itemType: "RM",
      refNo: bundle.bundleNo,
      toLocationId: rmStores.id,
      toStatus: "AVAILABLE",
      qty: params.kg,
      uom: "kg",
      userId: params.userId,
    });
    // A lot with no wire left is empty; and the MRN may need (re)issuing.
    const remaining = await tx.lotBundleLink.aggregate({ _sum: { kgConsumed: true }, where: { lotId: lot.id } });
    if (Number(remaining._sum.kgConsumed ?? 0) <= 1e-6) {
      await tx.productionLot.update({ where: { id: lot.id }, data: { status: "CLOSED", qtyNos: 0 } });
    }
    await recomputeMrnStatus(tx, lot.mrnId);
  }, { isolationLevel: "Serializable" });
}
