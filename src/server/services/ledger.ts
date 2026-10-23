/**
 * Stock Ledger service — the single source of truth (mandatory architecture rule #1).
 * Every stock movement writes a row here in the SAME db transaction as the
 * balance update on Bundle/ProductionLot/FgLot. Reports read only from here.
 * Rows are immutable (rule #2) — corrections are reversing entries, never edits.
 */
import { randomUUID } from "crypto";
import type { Prisma, PrismaClient, ItemType, TxnType } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface LedgerEntryInput {
  txnType: TxnType;
  txnDate?: Date;
  docNo: string;
  itemType: ItemType;
  refNo: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  qty: number | string | { toString(): string };
  uom: string;
  userId: string;
  reason?: string | null;
}

/** Reasons are mandatory for T3 (IQC reject), T12 (rejection), T14 (scrap), T17 (adjustment). */
const REASON_MANDATORY: ReadonlySet<TxnType> = new Set([
  "T3_IQC_REJECT",
  "T12_REJECTION",
  "T14_SCRAP",
  "T17_ADJUSTMENT",
]);

export async function writeLedger(tx: Tx, entry: LedgerEntryInput) {
  if (REASON_MANDATORY.has(entry.txnType) && !entry.reason) {
    throw new Error(`Reason code is mandatory for transaction type ${entry.txnType}`);
  }
  return tx.stockLedger.create({
    data: {
      txnId: randomUUID(),
      txnType: entry.txnType,
      txnDate: entry.txnDate ?? new Date(),
      docNo: entry.docNo,
      itemType: entry.itemType,
      refNo: entry.refNo,
      fromLocationId: entry.fromLocationId ?? null,
      toLocationId: entry.toLocationId ?? null,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      // Stored as a number (MongoDB); rounded so kg sums never drift (e.g. 18.950000000000017).
      qty: Math.round(Number(typeof entry.qty === "number" ? entry.qty : entry.qty.toString()) * 1e6) / 1e6,
      uom: entry.uom,
      userId: entry.userId,
      reason: entry.reason ?? null,
    },
  });
}

/** Sum of signed ledger quantities for a ref (used by db:verify reconciliation). */
export function ledgerBalanceFormula(): never {
  throw new Error(
    "Balances are maintained denormalized on Bundle/Lot/FgLot for performance; " +
      "db:verify recomputes from ledger independently for reconciliation. See prisma/verify.ts",
  );
}
