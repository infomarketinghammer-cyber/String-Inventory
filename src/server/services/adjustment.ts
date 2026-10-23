/**
 * Stock Adjustment (T17, Admin-only) and Transaction Reversal — Section 4.10 / 9.
 * Validation #1: no negative stock at any Bundle/Lot/FG Lot, ever — a reversal
 * or adjustment that would cause negative stock is rejected with a clear message.
 * Validation #11: reason code mandatory. Validation #12: immutability — corrections
 * only via reversing transaction, fully audited.
 */
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { genAdjustmentNo } from "./docNumber";
import { recomputeMrnStatus } from "./issue";
import { getLocationByName, LOCATION_NAMES } from "./locations";

export async function adjustBundleStock(params: {
  bundleId: string;
  deltaKg: number; // positive or negative
  reason: string;
  adminId: string;
}) {
  if (!params.reason.trim()) throw new ValidationError("Reason is mandatory for stock adjustment.");
  if (!Number.isFinite(params.deltaKg) || params.deltaKg === 0) {
    throw new ValidationError("Adjustment must be a non-zero number of kg.");
  }
  return prisma.$transaction(async (tx) => {
    const bundle = await tx.bundle.findUniqueOrThrow({ where: { id: params.bundleId } });
    const newBalance = Math.round((Number(bundle.balanceKg) + params.deltaKg) * 100) / 100;
    if (newBalance < -1e-6) {
      throw new ValidationError("Adjustment would cause negative stock; rejected.");
    }
    const status =
      bundle.status === "AVAILABLE" && newBalance <= 1e-6
        ? "CONSUMED"
        : bundle.status === "CONSUMED" && newBalance > 1e-6
          ? "AVAILABLE"
          : bundle.status;
    await tx.bundle.update({ where: { id: bundle.id }, data: { balanceKg: newBalance, status } });
    await writeLedger(tx, {
      txnType: "T17_ADJUSTMENT",
      docNo: await genAdjustmentNo(tx, new Date()),
      itemType: "RM",
      refNo: bundle.bundleNo,
      qty: params.deltaKg,
      uom: "kg",
      userId: params.adminId,
      reason: params.reason,
    });
    await tx.auditLog.create({
      data: {
        userId: params.adminId,
        action: "STOCK_ADJUSTMENT",
        entity: "Bundle",
        entityId: bundle.id,
        oldValue: { balanceKg: bundle.balanceKg.toString(), status: bundle.status },
        newValue: { balanceKg: newBalance, status, reason: params.reason },
      },
    });
  });
}

const REVERSIBLE = new Set(["T1_GRN", "T5_ISSUE", "T15_DISPATCH", "T17_ADJUSTMENT"]);

/**
 * Reverse a previously saved transaction. Creates a NEW ledger row with the
 * opposite sign and restores the balance on the affected Bundle/Lot/FgLot.
 * Original row is never edited/deleted (immutability, validation #12).
 * Rejected outright if it would cause negative stock.
 *
 * Only quantity-moving transactions that can be undone cleanly are reversible
 * (GRN, Issue, Dispatch, Adjustment). Status-only moves (IQC, JW, rejections ...) are
 * corrected through their own screens.
 */
export async function reverseTransaction(params: { ledgerId: string; reason: string; adminId: string }) {
  if (!params.reason.trim()) throw new ValidationError("Reason is mandatory for a reversal.");

  return prisma.$transaction(async (tx) => {
    const original = await tx.stockLedger.findUniqueOrThrow({ where: { id: params.ledgerId } });

    if (original.docNo.startsWith("REV-")) throw new ValidationError("A reversal entry cannot itself be reversed.");
    if (!REVERSIBLE.has(original.txnType)) {
      throw new ValidationError(
        `${original.txnType} cannot be reversed here. Only GRN, Issue, Dispatch and Adjustment entries can; use the relevant screen for other corrections.`,
      );
    }
    const already = await tx.stockLedger.findFirst({
      where: { reason: { startsWith: `Reversal of ${original.txnId}` } },
    });
    if (already) throw new ValidationError("This transaction has already been reversed.");

    const qty = Number(original.qty);

    if (original.itemType === "RM") {
      const bundle = await tx.bundle.findFirstOrThrow({ where: { bundleNo: original.refNo } });
      let delta: number;
      let status = bundle.status;
      let locationId = bundle.locationId;

      if (original.txnType === "T5_ISSUE") {
        delta = qty;
        const rmStores = await getLocationByName(tx, LOCATION_NAMES.RM_STORES);
        if (bundle.status === "CONSUMED") status = "AVAILABLE";
        if (status === "AVAILABLE") locationId = rmStores.id;
        await undoIssueOnLot(tx, original, bundle.id, qty);
      } else if (original.txnType === "T1_GRN") {
        delta = -qty;
        if (bundle.status !== "QUALITY_HOLD" || Math.abs(Number(bundle.balanceKg) - Number(bundle.receivedKg)) > 1e-6) {
          throw new ValidationError(
            "A GRN can only be reversed while its bundle is untouched in Quality Hold (no IQC, issue or adjustment yet).",
          );
        }
        status = "CONSUMED";
        const grn = await tx.grn.findUniqueOrThrow({ where: { id: bundle.grnId } });
        const poLine = await tx.poLine.findFirst({ where: { poId: grn.poId, itemId: bundle.itemId } });
        if (poLine) {
          await tx.poLine.update({ where: { id: poLine.id }, data: { receivedKg: { decrement: qty } } });
        }
      } else {
        // T17: undo the signed adjustment
        delta = -qty;
        const nb = Number(bundle.balanceKg) + delta;
        if (bundle.status === "AVAILABLE" && nb <= 1e-6) status = "CONSUMED";
        if (bundle.status === "CONSUMED" && nb > 1e-6) status = "AVAILABLE";
      }

      const newBalance = Math.round((Number(bundle.balanceKg) + delta) * 100) / 100;
      if (newBalance < -1e-6) {
        throw new ValidationError("Reversal rejected: it would cause negative stock on " + bundle.bundleNo);
      }
      await tx.bundle.update({
        where: { id: bundle.id },
        data: { balanceKg: newBalance, status, locationId },
      });
    } else if (original.itemType === "FG" && original.txnType === "T15_DISPATCH") {
      const fgLot = await tx.fgLot.findFirstOrThrow({ where: { fgLotNo: original.refNo } });
      await tx.fgLot.update({
        where: { id: fgLot.id },
        data: { balanceNos: fgLot.balanceNos + qty, status: "AVAILABLE" },
      });
      // Give the schedule its quantity back.
      const line = await tx.dispatchLine.findFirst({
        where: { fgLotId: fgLot.id, dispatch: { dispatchNo: original.docNo } },
      });
      if (line) {
        await tx.customerSchedule.update({
          where: { id: line.scheduleId },
          data: { dispatchedNos: { decrement: Math.round(qty) } },
        });
      }
    } else {
      throw new ValidationError("This transaction cannot be reversed.");
    }

    const reversal = await writeLedger(tx, {
      txnType: original.txnType,
      docNo: `REV-${original.docNo}`,
      itemType: original.itemType,
      refNo: original.refNo,
      fromLocationId: original.toLocationId,
      toLocationId: original.fromLocationId,
      fromStatus: original.toStatus,
      toStatus: original.fromStatus,
      qty: -qty,
      uom: original.uom,
      userId: params.adminId,
      reason: `Reversal of ${original.txnId}: ${params.reason}`,
    });

    await tx.auditLog.create({
      data: {
        userId: params.adminId,
        action: "REVERSE_TRANSACTION",
        entity: "StockLedger",
        entityId: original.id,
        oldValue: { ...original, qty: original.qty.toString() },
        newValue: { reversalTxnId: reversal.txnId, reason: params.reason },
      },
    });

    return reversal;
  });
}

type RevTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Reversing an issue also takes the wire back off the Production Lot it created and re-opens the MRN. */
async function undoIssueOnLot(
  tx: RevTx,
  original: { docNo: string; txnDate: Date },
  bundleId: string,
  qty: number,
) {
  const issue = await tx.issue.findUnique({ where: { issueNo: original.docNo } });
  if (!issue) return;
  // The lot was created in the same transaction as the issue, so its start date equals the txn date.
  const lot = await tx.productionLot.findFirst({
    where: { mrnId: issue.mrnId, startDate: original.txnDate },
    include: { bundleLinks: true, opEntries: true },
  });
  if (lot) {
    if (lot.opEntries.length > 0 || lot.status !== "IN_HOUSE") {
      throw new ValidationError(
        `Cannot reverse: lot ${lot.lotNo} already has production activity. Reverse is only possible before any operation is recorded.`,
      );
    }
    const link = lot.bundleLinks.find((l) => l.bundleId === bundleId);
    if (link) {
      await tx.lotBundleLink.update({
        where: { id: link.id },
        data: { kgConsumed: { decrement: Math.min(qty, Number(link.kgConsumed)) } },
      });
    }
    const remaining = lot.bundleLinks.reduce(
      (s, l) => s + (l.bundleId === bundleId ? Math.max(0, Number(l.kgConsumed) - qty) : Number(l.kgConsumed)),
      0,
    );
    if (remaining <= 1e-6) {
      await tx.productionLot.update({ where: { id: lot.id }, data: { status: "CLOSED", qtyNos: 0 } });
    }
  }

  await recomputeMrnStatus(tx, issue.mrnId);
}
