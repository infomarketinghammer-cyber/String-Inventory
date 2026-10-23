/**
 * Purchase orders are reference data for the module (SOP section 1: PO creation/approval workflow is out of
 * scope). This records a PO with its wire lines so a GRN can be received against it.
 */
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";

export interface NewPoLine {
  itemId: string;
  orderedKg: number;
}

export const NEW_SUPPLIER = "__new__";

export async function createPo(params: {
  poNo: string;
  /** An existing supplier id, or NEW_SUPPLIER together with `newSupplier`. */
  supplierId: string;
  newSupplier?: { name: string; gstin?: string };
  lines: NewPoLine[];
  document?: { path: string; name: string; mime: string } | null;
}) {
  const poNo = params.poNo.trim();
  if (!poNo) throw new ValidationError("PO number is required.");
  if (params.lines.length === 0) throw new ValidationError("Add at least one wire line to the PO.");
  const seen = new Set<string>();
  for (const l of params.lines) {
    if (!l.itemId) throw new ValidationError("Choose a wire item on every PO line.");
    if (!(l.orderedKg > 0)) throw new ValidationError("Ordered kg must be greater than zero on every line.");
    if (seen.has(l.itemId)) throw new ValidationError("The same wire item appears twice on this PO; combine the lines.");
    seen.add(l.itemId);
  }

  return prisma.$transaction(async (tx) => {
    let supplier;
    if (params.supplierId === NEW_SUPPLIER) {
      // Vendor not registered yet: create it together with the PO (all or nothing).
      const name = params.newSupplier?.name.trim() ?? "";
      if (!name) throw new ValidationError("Enter the new supplier's name.");
      const clash = await tx.supplier.findFirst({ where: { name } });
      if (clash) throw new ValidationError(`A supplier named "${name}" already exists; choose it from the list.`);
      supplier = await tx.supplier.create({ data: { name, gstin: params.newSupplier?.gstin?.trim() || undefined } });
    } else {
      supplier = await tx.supplier.findUnique({ where: { id: params.supplierId } });
    }
    if (!supplier || !supplier.active) throw new ValidationError("Choose an active supplier.");
    if (await tx.po.findUnique({ where: { poNo } })) throw new ValidationError(`PO ${poNo} already exists.`);
    const items = await tx.item.count({ where: { id: { in: params.lines.map((l) => l.itemId) }, active: true } });
    if (items !== params.lines.length) throw new ValidationError("One of the wire items is unknown or inactive.");
    return tx.po.create({
      data: {
        poNo,
        supplierId: supplier.id,
        // A PO is always dated today: no post-dated or back-dated POs (client rule). Not user-editable.
        poDate: new Date(),
        ...(params.document
          ? { documentPath: params.document.path, documentName: params.document.name, documentMime: params.document.mime }
          : {}),
        lines: { create: params.lines.map((l) => ({ itemId: l.itemId, orderedKg: l.orderedKg })) },
      },
      include: { lines: true },
    });
  });
}
