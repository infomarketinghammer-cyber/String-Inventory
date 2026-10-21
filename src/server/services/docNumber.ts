/**
 * System-generated, sequential, never-reused document numbers (Section 9 #13).
 * - GRN/MRN/Issue/JW-Challan/JW-Receipt/Dispatch/Rejection: sequential per Financial Year (Apr-Mar),
 *   format <PREFIX>-<FYFY>-#### e.g. GRN-2627-0001
 * - Bundle No / Production Lot / FG Lot: sequential per calendar YYMM, format <PREFIX>-YYMM-####
 *   e.g. RM-2609-0031, PL-2610-0012, FG-2610-0031
 *
 * Must be generated inside the same DB transaction as the document it numbers,
 * using an atomic increment (upsert + increment) so two concurrent requests
 * never get the same number.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Financial year label for a date: Apr Y -> Mar Y+1 => "YYYY+1YY" short form e.g. 2026-10 -> "2627" */
export function fiscalYearLabel(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1-12
  const startYear = m >= 4 ? y : y - 1;
  const endYear = startYear + 1;
  const a = String(startYear).slice(-2);
  const b = String(endYear).slice(-2);
  return `${a}${b}`;
}

/** YYMM label for a date, used for Bundle/Lot/FG numbering */
export function yymmLabel(date: Date): string {
  const y = String(date.getUTCFullYear()).slice(-2);
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

export async function nextDocNumber(
  tx: Tx,
  docType: string,
  period: string,
  prefix: string,
  padWidth = 4,
): Promise<string> {
  const seq = await tx.docSequence.upsert({
    where: { docType_fiscalYear: { docType, fiscalYear: period } },
    create: { docType, fiscalYear: period, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  const n = String(seq.lastNumber).padStart(padWidth, "0");
  return `${prefix}-${period}-${n}`;
}

export const genGrnNo = (tx: Tx, date: Date) => nextDocNumber(tx, "GRN", fiscalYearLabel(date), "GRN");
export const genMrnNo = (tx: Tx, date: Date) => nextDocNumber(tx, "MRN", fiscalYearLabel(date), "MRN");
export const genIssueNo = (tx: Tx, date: Date) => nextDocNumber(tx, "ISSUE", fiscalYearLabel(date), "ISS");
export const genIqcNo = (tx: Tx, date: Date) => nextDocNumber(tx, "IQC", fiscalYearLabel(date), "IQC");
export const genChallanNo = (tx: Tx, date: Date) => nextDocNumber(tx, "JWOUT", fiscalYearLabel(date), "JWO");
export const genReceiptNo = (tx: Tx, date: Date) => nextDocNumber(tx, "JWIN", fiscalYearLabel(date), "JWI");
export const genDispatchNo = (tx: Tx, date: Date) => nextDocNumber(tx, "DISPATCH", fiscalYearLabel(date), "DN");
export const genRejectionNo = (tx: Tx, date: Date) => nextDocNumber(tx, "REJ", fiscalYearLabel(date), "REJ");
export const genAdjustmentNo = (tx: Tx, date: Date) => nextDocNumber(tx, "ADJ", fiscalYearLabel(date), "ADJ");
export const genReturnToStoresNo = (tx: Tx, date: Date) => nextDocNumber(tx, "RTSP", fiscalYearLabel(date), "RTP");
export const genCustomerReturnNo = (tx: Tx, date: Date) => nextDocNumber(tx, "CRN", fiscalYearLabel(date), "CRN");
export const genReworkNo = (tx: Tx, date: Date) => nextDocNumber(tx, "RWK", fiscalYearLabel(date), "RWK");
export const genFqiNo = (tx: Tx, date: Date) => nextDocNumber(tx, "FQI", fiscalYearLabel(date), "FQI");
export const genScrapNo = (tx: Tx, date: Date) => nextDocNumber(tx, "SCR", fiscalYearLabel(date), "SCR");

export const genBundleNo = (tx: Tx, date: Date) => nextDocNumber(tx, "BUNDLE", yymmLabel(date), "RM");
export const genLotNo = (tx: Tx, date: Date) => nextDocNumber(tx, "LOT", yymmLabel(date), "PL");
export const genFgLotNo = (tx: Tx, date: Date) => nextDocNumber(tx, "FGLOT", yymmLabel(date), "FG");
