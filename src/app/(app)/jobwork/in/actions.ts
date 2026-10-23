"use server";

import { toUserError } from "@/server/userError";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { createJwInReceipt, jwReturnQcDecision, closeChallanWithShortage } from "@/server/services/jobwork";

/** Where to come back to: the challan detail page when the form was on it, else the JW In list. */
function backTo(formData: FormData) {
  const id = String(formData.get("backChallanId") ?? "");
  return id ? `/jobwork/challan/${encodeURIComponent(id)}` : "/jobwork/in";
}
const go = (base: string, kind: "ok" | "err", msg: string): never => redirect(`${base}?${kind}=${encodeURIComponent(msg)}`);
const int = (v: FormDataEntryValue | null) => (String(v ?? "").trim() === "" ? 0 : Number(v));

const receiptSchema = z.object({
  challanId: z.string().min(1),
  challanLineId: z.string().min(1),
  receivedNos: z.number().int(),
  rejectedNos: z.number().int(),
  shortNos: z.number().int(),
  reasonCodeId: z.string().optional(),
  receiptDate: z.string().optional(),
  vendorDcNo: z.string().max(60).optional(),
  remarks: z.string().max(500).optional(),
  clientToken: z.string().max(100).optional(),
});

/** Record a (partial) return batch from the job worker against the original challan. */
export async function createJwInAction(formData: FormData) {
  const user = await requireAction("jw.receipt");
  const base = backTo(formData);
  const parsed = receiptSchema.safeParse({
    challanId: formData.get("challanId"),
    challanLineId: formData.get("challanLineId"),
    receivedNos: int(formData.get("receivedNos")),
    rejectedNos: int(formData.get("rejectedNos")),
    shortNos: int(formData.get("shortNos")),
    reasonCodeId: formData.get("reasonCodeId") || undefined,
    receiptDate: String(formData.get("receiptDate") ?? "").trim() || undefined,
    vendorDcNo: String(formData.get("vendorDcNo") ?? "").trim() || undefined,
    remarks: String(formData.get("remarks") ?? "").trim() || undefined,
    clientToken: formData.get("clientToken") || undefined,
  });
  if (!parsed.success) go(base, "err", "Enter whole numbers for the received, rejected and short quantities.");
  const d = parsed.data!;
  let receiptDate: Date | undefined;
  if (d.receiptDate) {
    // A picked day is recorded at the current time of day when it is today, else at noon of that day.
    const today = new Date().toLocaleDateString("en-CA");
    receiptDate = d.receiptDate === today ? new Date() : new Date(`${d.receiptDate}T12:00:00`);
  }
  try {
    const r = await createJwInReceipt({
      challanId: d.challanId,
      lines: [{ challanLineId: d.challanLineId, receivedNos: d.receivedNos, rejectedNos: d.rejectedNos, shortNos: d.shortNos, reasonCodeId: d.reasonCodeId }],
      userId: user.id,
      receiptDate,
      vendorDcNo: d.vendorDcNo,
      remarks: d.remarks,
      clientToken: d.clientToken,
    });
    go(
      base,
      "ok",
      r.duplicate
        ? `This return was already saved as ${r.receiptNo}.`
        : `Return batch ${r.receiptNo} saved.${d.receivedNos > 0 ? ` ${d.receivedNos} pcs are ready for QC now.` : ""}`,
    );
  } catch (err) {
    const e = toUserError(err);
    go(base, "err", e.message);
  }
}

const qcSchema = z.object({
  lotId: z.string().min(1),
  acceptedNos: z.number().int(),
  rejectedNos: z.number().int(),
  reasonCodeId: z.string().optional(),
  remarks: z.string().max(500).optional(),
  clientToken: z.string().max(100).optional(),
});

/** QC of (part of) a return batch. */
export async function jwReturnQcAction(formData: FormData) {
  const user = await requireAction("jw.receipt");
  const base = backTo(formData);
  const parsed = qcSchema.safeParse({
    lotId: formData.get("lotId"),
    acceptedNos: int(formData.get("acceptedNos")),
    rejectedNos: int(formData.get("rejectedNos")),
    reasonCodeId: formData.get("reasonCodeId") || undefined,
    remarks: String(formData.get("remarks") ?? "").trim() || undefined,
    clientToken: formData.get("clientToken") || undefined,
  });
  if (!parsed.success) go(base, "err", "Enter whole numbers for the accepted and rejected quantities.");
  try {
    const r = await jwReturnQcDecision({ ...parsed.data!, userId: user.id });
    go(
      base,
      "ok",
      r.duplicate
        ? "This QC entry was already saved."
        : r.pendingQc > 0
          ? `QC saved. ${r.pendingQc} pcs of this batch are still pending QC.`
          : "QC saved. This batch is fully inspected.",
    );
  } catch (err) {
    const e = toUserError(err);
    go(base, "err", e.message);
  }
}

export async function closeChallanAction(formData: FormData) {
  const user = await requireAction("jw.closeWithShortage"); // Admin-only
  const base = backTo(formData);
  const challanId = String(formData.get("challanId"));
  const reason = String(formData.get("reason") ?? "");
  try {
    await closeChallanWithShortage({ challanId, reason, adminId: user.id });
    go(base, "ok", "Challan closed with shortage, reason logged.");
  } catch (err) {
    const e = toUserError(err);
    go(base, "err", e.message);
  }
}
