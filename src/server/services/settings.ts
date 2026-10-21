import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient | PrismaClient;

const DEFAULTS: Record<string, string> = {
  PO_TOLERANCE_PCT: "2",
  AGING_BUCKETS: "30,60,90,180", // upper bounds of 0-30,31-60,61-90,91-180,over180
  QC_HOLD_ALERT_DAYS: "2",
  JW_ALERT_DAYS_BEFORE: "3",
  MRN_KG_EDIT_PCT: "10", // SOP 4.4: supervisor may edit the proposed kg within +/- this %
};

export async function getMrnKgEditPct(tx: Tx = prisma): Promise<number> {
  return Number(await getSetting(tx, "MRN_KG_EDIT_PCT"));
}

export async function getSetting(tx: Tx, key: string): Promise<string> {
  const row = await tx.adminSetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS[key] ?? "";
}

export async function getPoTolerancePct(tx: Tx = prisma): Promise<number> {
  return Number(await getSetting(tx, "PO_TOLERANCE_PCT"));
}

export async function getAgingBuckets(tx: Tx = prisma): Promise<number[]> {
  const raw = await getSetting(tx, "AGING_BUCKETS");
  return raw.split(",").map(Number);
}

export async function getQcHoldAlertDays(tx: Tx = prisma): Promise<number> {
  return Number(await getSetting(tx, "QC_HOLD_ALERT_DAYS"));
}

export async function getJwAlertDaysBefore(tx: Tx = prisma): Promise<number> {
  return Number(await getSetting(tx, "JW_ALERT_DAYS_BEFORE"));
}
