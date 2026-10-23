"use server";

import { toUserError } from "@/server/userError";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { createGrn } from "@/server/services/grn";
import { createPo } from "@/server/services/po";
import { saveReceipt, saveDocument, removeDocument } from "@/server/services/uploads";
import { ValidationError } from "@/server/services/errors";

const go = (kind: "ok" | "err", msg: string): never => redirect(`/grn?${kind}=${encodeURIComponent(msg)}`);

const bundleSchema = z.object({
  itemId: z.string().min(1),
  heatNo: z.string().trim().min(1),
  tcRef: z.string().optional(),
  weightKg: z.coerce.number().positive(),
});

const schema = z.object({
  poId: z.string().min(1, "Select the purchase order."),
  invoiceNo: z.string().trim().min(1, "Enter the supplier invoice no."),
  // Invoice date and vehicle no. are compulsory on every GRN.
  invoiceDate: z.coerce.date({ errorMap: () => ({ message: "Enter the invoice date." }) }),
  vehicleNo: z.string().trim().min(1, "Enter the vehicle no."),
  bundles: z.array(bundleSchema).min(1, "Add at least one bundle."),
});

const fileOf = (v: FormDataEntryValue | null): File | null => (v instanceof File ? v : null);

export async function createGrnAction(formData: FormData) {
  const user = await requireAction("grn.create");

  const rawBundles: Array<z.infer<typeof bundleSchema>> = [];
  let i = 0;
  while (formData.has(`bundles[${i}][itemId]`)) {
    rawBundles.push({
      itemId: String(formData.get(`bundles[${i}][itemId]`)),
      heatNo: String(formData.get(`bundles[${i}][heatNo]`)),
      tcRef: String(formData.get(`bundles[${i}][tcRef]`) ?? ""),
      weightKg: Number(formData.get(`bundles[${i}][weightKg]`)),
    });
    i++;
  }

  // Received quantity per PO line: fields named lineQty[<itemId>]
  const lineQtys: Record<string, number> = {};
  for (const key of formData.keys()) {
    const m = /^lineQty\[(.+)\]$/.exec(key);
    const raw = String(formData.get(key) ?? "").trim();
    if (m && raw !== "") lineQtys[m[1]!] = Number(raw);
  }

  const parsed = schema.safeParse({
    poId: formData.get("poId"),
    invoiceNo: formData.get("invoiceNo"),
    invoiceDate: String(formData.get("invoiceDate") ?? "") || undefined,
    vehicleNo: String(formData.get("vehicleNo") ?? ""),
    bundles: rawBundles,
  });
  if (!parsed.success) {
    // Name the first missing field (our own wording, never the raw validator output).
    const first = parsed.error.issues.find((i) => ["poId", "invoiceNo", "invoiceDate", "vehicleNo"].includes(String(i.path[0])));
    go("err", first?.message ?? "Every bundle needs a wire item, Heat No. and a weight above zero.");
  }

  try {
    // Store the receipt first so a bad file fails the whole save before any stock is created.
    const receipt = await saveReceipt(fileOf(formData.get("receipt")));
    const result = await createGrn({ ...parsed.data!, lineQtys, userId: user.id, receipt });
    go(
      "ok",
      `GRN ${result.grn.grnNo} saved with ${result.bundles.length} bundle(s) in Quality Hold${receipt ? " and the receipt attached" : ""}.`,
    );
  } catch (err) {
    const e = toUserError(err);
    go("err", e.message);
  }
}

/** Attach (or replace) the receipt on an existing GRN. Same permission as creating a GRN. */
export async function attachReceiptAction(formData: FormData) {
  const user = await requireAction("grn.create");
  const grnId = String(formData.get("grnId") ?? "");
  try {
    const grn = await prisma.grn.findUnique({ where: { id: grnId } });
    if (!grn) throw new ValidationError("GRN not found.");
    // A GRN receipt is uploaded once; after that it can only be viewed.
    if (grn.receiptPath) throw new ValidationError(`${grn.grnNo} already has its receipt; it can be viewed but not replaced.`);
    const receipt = await saveReceipt(fileOf(formData.get("receipt")));
    if (!receipt) throw new ValidationError("Choose a file to upload.");
    // Only attach if still empty, so two uploads at the same moment cannot both win.
    const { count } = await prisma.grn.updateMany({ where: { id: grn.id, receiptPath: null }, data: receipt });
    if (count === 0) {
      await removeDocument(receipt.receiptPath, "grn-receipts");
      throw new ValidationError(`${grn.grnNo} already has its receipt; it can be viewed but not replaced.`);
    }
    await prisma.auditLog.create({
      data: { userId: user.id, action: "GRN_RECEIPT_ATTACHED", entity: "Grn", entityId: grn.id, newValue: { name: receipt.receiptName } },
    });
    go("ok", `Receipt uploaded to ${grn.grnNo}.`);
  } catch (err) {
    const e = toUserError(err);
    go("err", e.message);
  }
}

const poSchema = z.object({
  poNo: z.string().trim().min(1),
  supplierId: z.string().min(1), // an existing supplier id, or "__new__" (then newSupplierName is used)
  lines: z.array(z.object({ itemId: z.string().min(1), orderedKg: z.coerce.number().positive() })).min(1),
});

/** Record a new PO (with one or more wire lines) so it can be received against. Admin-only (Masters). */
export async function createPoAction(formData: FormData) {
  const user = await requireAction("masters.manage");
  const lines: Array<{ itemId: string; orderedKg: number }> = [];
  let i = 0;
  while (formData.has(`lines[${i}][itemId]`)) {
    lines.push({
      itemId: String(formData.get(`lines[${i}][itemId]`)),
      orderedKg: Number(formData.get(`lines[${i}][orderedKg]`)),
    });
    i++;
  }
  const parsed = poSchema.safeParse({
    poNo: formData.get("poNo"),
    supplierId: formData.get("supplierId"),
    lines,
  });
  if (!parsed.success) go("err", "Enter the PO no., supplier and at least one line with item and ordered kg.");
  try {
    const document = await saveDocument(fileOf(formData.get("document")), "po-documents", "PO document");
    const po = await createPo({
      ...parsed.data!,
      newSupplier: {
        name: String(formData.get("newSupplierName") ?? ""),
        gstin: String(formData.get("newSupplierGstin") ?? ""),
      },
      document,
    });
    if (formData.get("aiConfirmed")) {
      // Values were pre-filled by AI OCR and confirmed by this user before saving.
      await prisma.auditLog.create({
        data: { userId: user.id, action: "PO_CREATED_FROM_AI_OCR", entity: "Po", entityId: po.id, newValue: { poNo: po.poNo } },
      });
    }
    go(
      "ok",
      `PO ${po.poNo} added with ${po.lines.length} line(s)${document ? " and its document attached" : ""}. You can now receive against it.`,
    );
  } catch (err) {
    const e = toUserError(err);
    go("err", e.message);
  }
}

/** Attach (or replace) the scanned PO document on an existing PO. Admin-only, like adding a PO. */
export async function attachPoDocumentAction(formData: FormData) {
  const user = await requireAction("masters.manage");
  const poId = String(formData.get("poId") ?? "");
  try {
    const po = await prisma.po.findUnique({ where: { id: poId } });
    if (!po) throw new ValidationError("PO not found.");
    // A PO document is uploaded once; after that it can only be viewed.
    if (po.documentPath) throw new ValidationError(`PO ${po.poNo} already has its document; it can be viewed but not replaced.`);
    const doc = await saveDocument(fileOf(formData.get("document")), "po-documents", "PO document");
    if (!doc) throw new ValidationError("Choose a file to upload.");
    // Only attach if still empty, so two uploads at the same moment cannot both win.
    const { count } = await prisma.po.updateMany({
      where: { id: po.id, documentPath: null },
      data: { documentPath: doc.path, documentName: doc.name, documentMime: doc.mime },
    });
    if (count === 0) {
      await removeDocument(doc.path, "po-documents");
      throw new ValidationError(`PO ${po.poNo} already has its document; it can be viewed but not replaced.`);
    }
    await prisma.auditLog.create({
      data: { userId: user.id, action: "PO_DOCUMENT_ATTACHED", entity: "Po", entityId: po.id, newValue: { name: doc.name } },
    });
    go("ok", `Document uploaded to PO ${po.poNo}.`);
  } catch (err) {
    const e = toUserError(err);
    go("err", e.message);
  }
}
