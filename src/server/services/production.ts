/**
 * Production / operation tracking (T7) — Section 4.6.
 * Validation #6: good+rejected <= qty available at that operation; ops follow routing sequence.
 * Validation #7: lot whose next routing step is Job Work cannot move to following in-house op
 * until received back (enforced by requiring explicit JW send/receive to advance past a JW op).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { genRejectionNo } from "./docNumber";

/**
 * The op_seq a lot moves to after completing `current`. When `current` was the last
 * routing operation this returns lastSeq + 1, which means "all operations complete"
 * (the lot is then ready for final inspection).
 */
export function nextOpSeq(bomLines: { opSeq: number }[], current: number): number {
  const seqs = bomLines.map((b) => b.opSeq).sort((a, b) => a - b);
  const next = seqs.find((s) => s > current);
  return next ?? (seqs[seqs.length - 1] ?? current) + 1;
}

/** True once the lot has completed every routing operation. */
export function allOpsComplete(bomLines: { opSeq: number }[], currentOpSeq: number): boolean {
  return bomLines.length > 0 && currentOpSeq > Math.max(...bomLines.map((b) => b.opSeq));
}

type Tx = Prisma.TransactionClient | PrismaClient;

export interface OperationProgress {
  /** Quantity to be processed at this operation. */
  planned: number;
  /** Good + rejected already recorded at this operation (all saved entries). */
  processed: number;
  goodSoFar: number;
  rejectedSoFar: number;
  /** planned - processed */
  pending: number;
  entries: number;
  /** Coiling-type step: the lot holds wire (kg) that this operation converts to pieces. */
  fromWire: boolean;
  /** For fromWire steps: kg held and the most pieces that wire can physically make. */
  kgConsumed?: number;
  wireMaxNos?: number;
}

/**
 * Planned / processed / pending for the lot's CURRENT operation, always recomputed from the saved entries:
 *   pending = planned - (total good + total rejected)   (rejected pieces were processed too)
 * Planned quantity:
 *  - lot still holds wire only (qty 0, e.g. coiling): the MRN's planned springs in proportion to the wire this lot
 *    received (MRN planned nos x lot kg / MRN required kg; a lot holding all the MRN's wire = the MRN's planned nos),
 *    never more than the MRN's planned nos nor than the wire can physically make (kg / net wt per pc);
 *  - otherwise: the pieces that came out good from the previous operation (the lot quantity).
 */
export async function operationProgress(
  tx: Tx,
  lot: { id: string; mrnId: string; qtyNos: number; currentOpSeq: number; part: { netWtPerPcKg: unknown } },
): Promise<OperationProgress> {
  const entries = await tx.operationEntry.findMany({ where: { lotId: lot.id, opSeq: lot.currentOpSeq, skipped: false } });
  const goodSoFar = entries.reduce((s, e) => s + e.goodNos, 0);
  const rejectedSoFar = entries.reduce((s, e) => s + e.rejectedNos, 0);
  let planned = lot.qtyNos;
  let fromWire = false;
  let kgConsumed: number | undefined;
  let wireMaxNos: number | undefined;
  if (lot.qtyNos === 0) {
    fromWire = true;
    const agg = await tx.lotBundleLink.aggregate({ _sum: { kgConsumed: true }, where: { lotId: lot.id } });
    kgConsumed = Number(agg._sum.kgConsumed ?? 0);
    const netWt = Number(lot.part.netWtPerPcKg);
    wireMaxNos = netWt > 0 ? Math.floor(kgConsumed / netWt + 1e-6) : 0;
    const mrn = await tx.mrn.findUnique({ where: { id: lot.mrnId }, select: { plannedQtyNos: true, requiredKg: true } });
    const requiredKg = Number(mrn?.requiredKg ?? 0);
    const share = mrn && requiredKg > 0 ? Math.round((mrn.plannedQtyNos * kgConsumed) / requiredKg) : wireMaxNos;
    planned = Math.max(0, Math.min(wireMaxNos, mrn?.plannedQtyNos ?? wireMaxNos, share));
  }
  const processed = goodSoFar + rejectedSoFar;
  return {
    planned,
    processed,
    goodSoFar,
    rejectedSoFar,
    pending: Math.max(0, planned - processed),
    entries: entries.length,
    fromWire,
    kgConsumed,
    wireMaxNos,
  };
}

/**
 * Record good / rejected pieces at the lot's current in-house operation. Several entries per operation are
 * allowed (partial production); the lot moves to the next routing operation only once good + rejected over
 * all entries equals the planned quantity. Validation (inside one serializable transaction, so concurrent
 * saves can never together exceed the plan):
 *   - whole numbers, never negative, not both zero; a rejected quantity needs a reason code;
 *   - good + rejected of this entry <= pending quantity of the operation.
 * `clientToken` (one per form render) makes a repeated submit of the same form a no-op.
 */
export async function recordOperationEntry(params: {
  lotId: string;
  opSeq: number;
  goodNos: number;
  rejectedNos: number;
  reasonCodeId?: string;
  userId: string;
  clientToken?: string;
}) {
  if (!Number.isInteger(params.goodNos) || !Number.isInteger(params.rejectedNos)) {
    throw new ValidationError("Quantities must be whole numbers.");
  }
  if (params.goodNos < 0 || params.rejectedNos < 0) {
    throw new ValidationError("Quantities cannot be negative.");
  }
  if (params.goodNos + params.rejectedNos === 0) {
    throw new ValidationError("Enter a good or rejected quantity; an entry of 0 cannot be saved.");
  }
  if (params.rejectedNos > 0 && !params.reasonCodeId) {
    throw new ValidationError("Reason code is mandatory for rejected quantity.");
  }

  return prisma.$transaction(async (tx) => {
    // Same form submitted twice (double click / resubmit): the first save already counted it.
    if (params.clientToken) {
      const dup = await tx.operationEntry.findUnique({ where: { clientToken: params.clientToken } });
      if (dup) {
        const lot = await tx.productionLot.findUniqueOrThrow({ where: { id: dup.lotId } });
        return { lot, completed: lot.currentOpSeq !== dup.opSeq, pending: 0, duplicate: true };
      }
    }

    const lot = await tx.productionLot.findUnique({
      where: { id: params.lotId },
      include: { part: { include: { bomLines: { orderBy: { opSeq: "asc" } } } } },
    });
    if (!lot) throw new ValidationError("Production Lot not found.");
    if (lot.status !== "IN_HOUSE") {
      throw new ValidationError("Lot is not in-house; cannot record an in-house operation entry.");
    }
    if (params.opSeq !== lot.currentOpSeq) {
      throw new ValidationError(
        `Operations must follow routing sequence. This lot is at op ${lot.currentOpSeq}, not ${params.opSeq}.`,
      );
    }
    const opLine = lot.part.bomLines.find((b) => b.opSeq === params.opSeq);
    if (!opLine) throw new ValidationError("All routing operations are already complete; send the lot for final inspection.");
    if (opLine.opType !== "IN_HOUSE") {
      throw new ValidationError("This operation is Job Work; use the JW Out Challan screen instead.");
    }
    if (params.rejectedNos > 0) {
      const reason = await tx.reasonCode.findUnique({ where: { id: params.reasonCodeId! } });
      if (!reason || !reason.active) throw new ValidationError("Select a valid rejection reason.");
    }

    // Validation #6: good + rejected of this entry <= what is still pending at this operation.
    const progress = await operationProgress(tx, lot);
    if (progress.planned <= 0) {
      throw new ValidationError(
        progress.fromWire ? "No quantity to process: the lot holds no wire. Issue material against the MRN first." : "No quantity to process at this operation.",
      );
    }
    const entered = params.goodNos + params.rejectedNos;
    if (progress.pending === 0) throw new ValidationError("This operation is already complete. No pending quantity remains.");
    if (entered > progress.pending) {
      throw new ValidationError(`Entered quantity (${entered}) exceeds the remaining quantity of ${progress.pending} units.`);
    }

    await tx.operationEntry.create({
      data: {
        lotId: lot.id,
        opSeq: params.opSeq,
        goodNos: params.goodNos,
        rejectedNos: params.rejectedNos,
        reasonCodeId: params.rejectedNos > 0 ? params.reasonCodeId : null,
        enteredById: params.userId,
        clientToken: params.clientToken || null,
      },
    });

    if (params.goodNos > 0) {
      await writeLedger(tx, {
        txnType: "T7_OP_COMPLETE",
        docNo: lot.lotNo,
        itemType: "WIP",
        refNo: lot.lotNo,
        qty: params.goodNos,
        uom: "nos",
        userId: params.userId,
        reason: `op ${params.opSeq} ${opLine.opName}`,
      });
    }

    if (params.rejectedNos > 0) {
      await writeLedger(tx, {
        txnType: "T12_REJECTION",
        docNo: lot.lotNo,
        itemType: "WIP",
        refNo: lot.lotNo,
        qty: params.rejectedNos,
        uom: "nos",
        userId: params.userId,
        reason: params.reasonCodeId,
      });
      await tx.rejection.create({
        data: {
          rejNo: await genRejectionNo(tx, new Date()),
          stage: "WIP",
          refType: "LOT",
          refId: lot.id,
          qty: params.rejectedNos,
          uom: "nos",
          reasonCodeId: params.reasonCodeId ?? "",
          disposal: "PENDING",
          createdById: params.userId,
        },
      });
    }

    const pending = progress.pending - entered;
    if (pending > 0) {
      // Partial production: the lot stays at this operation; the remainder can be entered later.
      return { lot: await tx.productionLot.findUniqueOrThrow({ where: { id: lot.id } }), completed: false, pending, duplicate: false };
    }

    // Operation complete: the lot carries the total good pieces to the next routing operation.
    // Past the last routing op => all operations complete, lot is ready for final inspection.
    const totalGood = progress.goodSoFar + params.goodNos;
    const updated = await tx.productionLot.update({
      where: { id: lot.id },
      data: {
        qtyNos: totalGood,
        currentOpSeq: nextOpSeq(lot.part.bomLines, params.opSeq),
        // Every piece was rejected: nothing left to process (same rule as a job-work return with no good pieces).
        ...(totalGood === 0 ? { status: "REJECTED" as const } : {}),
      },
    });
    return { lot: updated, completed: true, pending: 0, duplicate: false };
  }, { isolationLevel: "Serializable" });
}

/**
 * Job work is optional per lot (client rule): at a Job Work routing step production decides either to send the lot
 * on a JW Out Challan, or to skip that step. Skipping moves the lot to the next routing operation; after the last
 * operation the lot is ready for Final Inspection, whose approval creates the FG Lot in FG Stores.
 * A skip moves no stock (the lot stays in-house on the production floor), so there is no ledger row; it is kept
 * as an OperationEntry flagged `skipped` with the mandatory reason, plus an audit record.
 */
export async function skipJobWork(params: { lotId: string; opSeq: number; reason: string; userId: string }) {
  const reason = params.reason.trim();
  if (!reason) throw new ValidationError("Enter why this job work is being skipped.");
  return prisma.$transaction(async (tx) => {
    const lot = await tx.productionLot.findUnique({
      where: { id: params.lotId },
      include: { part: { include: { bomLines: { orderBy: { opSeq: "asc" } } } } },
    });
    if (!lot) throw new ValidationError("Production Lot not found.");
    if (lot.status !== "IN_HOUSE") throw new ValidationError(`Lot ${lot.lotNo} is not in-house; it cannot skip job work now.`);
    if (lot.currentOpSeq !== params.opSeq) {
      throw new ValidationError(`Lot ${lot.lotNo} is at op ${lot.currentOpSeq}, not ${params.opSeq}. Refresh the page.`);
    }
    const op = lot.part.bomLines.find((b) => b.opSeq === lot.currentOpSeq);
    if (!op || op.opType !== "JOB_WORK") throw new ValidationError("Only a Job Work step can be skipped.");
    if (lot.qtyNos <= 0) throw new ValidationError(`Lot ${lot.lotNo} has no quantity.`);

    const next = nextOpSeq(lot.part.bomLines, lot.currentOpSeq);
    await tx.operationEntry.create({
      data: {
        lotId: lot.id,
        opSeq: op.opSeq,
        goodNos: lot.qtyNos,
        rejectedNos: 0,
        enteredById: params.userId,
        skipped: true,
        remarks: reason,
      },
    });
    await tx.productionLot.update({ where: { id: lot.id }, data: { currentOpSeq: next } });
    const nextOp = lot.part.bomLines.find((b) => b.opSeq === next);
    await tx.auditLog.create({
      data: {
        userId: params.userId,
        action: "JW_SKIPPED",
        entity: "ProductionLot",
        entityId: lot.id,
        oldValue: { lotNo: lot.lotNo, opSeq: op.opSeq, opName: op.opName },
        newValue: { opSeq: next, next: nextOp ? nextOp.opName : "Final Inspection", reason },
      },
    });
    return { lotNo: lot.lotNo, skipped: op.opName, next: nextOp ? `op ${next} ${nextOp.opName}` : "Final Inspection" };
  }, { isolationLevel: "Serializable" });
}

/** Lots whose next routing op is Job Work, ready to send (Section 4.6 "Pending-to-send-for-JW"). */
export async function listPendingForJobWork() {
  const lots = await prisma.productionLot.findMany({
    where: { status: "IN_HOUSE", qtyNos: { gt: 0 } },
    include: { part: { include: { bomLines: true } } },
    orderBy: [{ startDate: "asc" }, { lotNo: "asc" }],
  });
  return lots.filter((lot) => {
    const op = lot.part.bomLines.find((b) => b.opSeq === lot.currentOpSeq);
    return op?.opType === "JOB_WORK";
  });
}
