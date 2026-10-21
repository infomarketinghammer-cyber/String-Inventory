import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Well-known, seeded location names (Section 5). Looked up by name — never hardcoded ids. */
export const LOCATION_NAMES = {
  INCOMING_QC: "Incoming/QC area",
  RM_STORES: "RM Stores",
  PRODUCTION_FLOOR: "Production floor (WIP)",
  JW_RETURN_QC: "JW Return QC",
  FG_STORES: "FG Stores",
  REJECTION_RM: "Rejection area - RM",
  REJECTION_WIP: "Rejection area - WIP",
  REJECTION_FG: "Rejection area - FG",
  SCRAP_RETURNED: "Scrap/Returned (virtual)",
} as const;

export async function getLocationByName(tx: Tx, name: string) {
  const loc = await tx.location.findUnique({ where: { name } });
  if (!loc) throw new Error(`Seeded location missing: ${name}`);
  return loc;
}

export async function getJobWorkerLocation(tx: Tx, vendorId: string) {
  const vendor = await tx.jobWorker.findUnique({ where: { id: vendorId }, include: { location: true } });
  if (!vendor?.location) throw new Error(`Job worker ${vendorId} has no location configured`);
  return vendor.location;
}
