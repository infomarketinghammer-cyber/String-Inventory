/**
 * Production / operation tracking (T7) — Section 4.6.
 * Validation #6: good+rejected <= qty available at that operation; ops follow routing sequence.
 * Validation #7: lot whose next routing step is Job Work cannot move to following in-house op
 * until received back (enforced by requiring explicit JW send/receive to advance past a JW op).
 */
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

/** At coiling (first in-house op that converts kg->nos), record springs produced from consumed wire. */
export async function recordOperationEntry(params: {
  lotId: string;
  opSeq: number;
  goodNos: number;
  rejectedNos: number;
  reasonCodeId?: string;
  userId: string;
}) {
  if (params.goodNos < 0 || params.rejectedNos < 0) {
    throw new ValidationError("Quantities cannot be negative.");
  }
  if (params.rejectedNos > 0 && !params.reasonCodeId) {
    throw new ValidationError("Reason code is mandatory for rejected quantity.");
  }

  return prisma.$transaction(async (tx) => {
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

    const totalEntered = params.goodNos + params.rejectedNos;
    if (totalEntered <= 0) throw new ValidationError("Enter a good or rejected quantity.");

    // Validation #6: good + rejected <= quantity available at this operation.
    const priorEntries = await tx.operationEntry.count({ where: { lotId: lot.id } });
    if (priorEntries === 0 && lot.qtyNos === 0) {
      // First operation (coiling): convert consumed kg -> nos using the Part's net weight per piece.
      const links = await tx.lotBundleLink.findMany({ where: { lotId: lot.id } });
      const kgConsumed = links.reduce((s, l) => s + Number(l.kgConsumed), 0);
      const netWt = Number(lot.part.netWtPerPcKg);
      const maxNos = netWt > 0 ? Math.floor(kgConsumed / netWt + 1e-6) : Number.MAX_SAFE_INTEGER;
      if (totalEntered > maxNos) {
        throw new ValidationError(
          `Good + rejected (${totalEntered}) exceeds what the issued wire can make: ${kgConsumed.toFixed(2)} kg at ${netWt} kg/pc = ${maxNos} nos.`,
        );
      }
    } else if (totalEntered > lot.qtyNos) {
      throw new ValidationError(
        `Good + rejected (${totalEntered}) exceeds quantity available at this operation (${lot.qtyNos}).`,
      );
    }

    await tx.operationEntry.create({
      data: {
        lotId: lot.id,
        opSeq: params.opSeq,
        goodNos: params.goodNos,
        rejectedNos: params.rejectedNos,
        reasonCodeId: params.reasonCodeId,
        enteredById: params.userId,
      },
    });

    await writeLedger(tx, {
      txnType: "T7_OP_COMPLETE",
      docNo: lot.lotNo,
      itemType: "WIP",
      refNo: lot.lotNo,
      qty: params.goodNos,
      uom: "nos",
      userId: params.userId,
    });

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

    await tx.productionLot.update({
      where: { id: lot.id },
      data: {
        qtyNos: params.goodNos,
        // Past the last routing op => all operations complete, lot is ready for final inspection.
        currentOpSeq: nextOpSeq(lot.part.bomLines, params.opSeq),
      },
    });

    return tx.productionLot.findUnique({ where: { id: lot.id } });
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
