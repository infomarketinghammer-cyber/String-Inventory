/**
 * MRN — Material Requisition Note. Section 4.4.
 * Reads BOM to propose wire grade/diameter & required_kg; does not move stock.
 * required kg = springs x net weight per spring x (1 + scrap allowance %); the supervisor may edit it
 * within +/- MRN_KG_EDIT_PCT (Admin setting).
 */
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { genMrnNo } from "./docNumber";
import { getMrnKgEditPct } from "./settings";

export function proposedKg(plannedQtyNos: number, netWtPerPcKg: number, scrapAllowancePct: number): number {
  return Math.round(plannedQtyNos * netWtPerPcKg * (1 + scrapAllowancePct / 100) * 100) / 100;
}

export async function createMrn(params: {
  partId: string;
  plannedQtyNos: number;
  /** Supervisor's edited kg (optional); must stay within the Admin-set limit of the proposal. */
  requiredKg?: number;
  userId: string;
}) {
  if (!Number.isInteger(params.plannedQtyNos) || params.plannedQtyNos <= 0) {
    throw new ValidationError("Planned quantity must be a positive whole number.");
  }
  const part = await prisma.part.findUnique({ where: { id: params.partId } });
  if (!part || !part.active) throw new ValidationError("Part not found.");
  const wire = await prisma.bomLine.findFirst({ where: { partId: part.id, itemId: { not: null } } });
  if (!wire) throw new ValidationError("This Part has no wire item in its BOM; ask an Admin to complete the routing.");

  const proposal = proposedKg(params.plannedQtyNos, Number(part.netWtPerPcKg), Number(part.scrapAllowancePct));
  let requiredKg = proposal;
  if (params.requiredKg !== undefined && Math.abs(params.requiredKg - proposal) > 0.005) {
    const pct = await getMrnKgEditPct();
    const min = proposal * (1 - pct / 100);
    const max = proposal * (1 + pct / 100);
    if (!(params.requiredKg >= min - 0.005 && params.requiredKg <= max + 0.005)) {
      throw new ValidationError(
        `Required kg can only be edited within ±${pct}% of the BOM proposal (${min.toFixed(2)} – ${max.toFixed(2)} kg).`,
      );
    }
    requiredKg = Math.round(params.requiredKg * 100) / 100;
  }

  return prisma.$transaction(async (tx) => {
    const mrnNo = await genMrnNo(tx, new Date());
    return tx.mrn.create({
      data: {
        mrnNo,
        partId: params.partId,
        plannedQtyNos: params.plannedQtyNos,
        requiredKg,
        status: "OPEN",
        createdById: params.userId,
      },
    });
  });
}

/** The wire item (grade+diameter) an MRN's Part requires, from the BOM line that names the wire. */
export async function getMrnWireItem(mrnId: string) {
  const mrn = await prisma.mrn.findUnique({ where: { id: mrnId }, include: { part: true } });
  if (!mrn) throw new ValidationError("MRN not found.");
  const bomLine = await prisma.bomLine.findFirst({
    where: { partId: mrn.partId, itemId: { not: null } },
    orderBy: { opSeq: "asc" },
    include: { item: true },
  });
  if (!bomLine?.item) throw new ValidationError("No BOM wire item configured for this Part.");
  return { mrn, item: bomLine.item };
}
