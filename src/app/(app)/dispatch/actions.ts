"use server";

import { toUserError } from "@/server/userError";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { createDispatch, createCustomerReturn } from "@/server/services/dispatch";
import { can } from "@/server/policy";

const schema = z.object({
  scheduleId: z.string().min(1),
  qtyNos: z.coerce.number().int().positive(),
  invoiceNo: z.string().min(1),
  vehicleNo: z.string().optional(),
  packingDetails: z.string().optional(),
});

export async function createDispatchAction(formData: FormData) {
  const user = await requireAction("dispatch.create");
  const parsed = schema.safeParse({
    scheduleId: formData.get("scheduleId"),
    qtyNos: formData.get("qtyNos"),
    invoiceNo: formData.get("invoiceNo"),
    vehicleNo: formData.get("vehicleNo") || undefined,
    packingDetails: formData.get("packingDetails") || undefined,
  });
  if (!parsed.success) redirect(`/dispatch?err=${encodeURIComponent("Invalid dispatch input.")}`);
  try {
    const dispatch = await createDispatch({
      ...parsed.data,
      userId: user.id,
      // Over-dispatch (validation #10) needs an explicit Admin approval, never implicit.
      adminOverride: formData.get("approveOverDispatch") === "on" && can(user, "finalInspection.approve"),
    });
    redirect(`/dispatch?ok=${encodeURIComponent(`Dispatch ${dispatch.dispatchNo} saved.`)}`);
  } catch (err) {
    const e = toUserError(err);
    redirect(`/dispatch?err=${encodeURIComponent(e.message)}`);
  }
}

const returnSchema = z.object({
  dispatchNo: z.string().min(1),
  fgLotNo: z.string().min(1),
  qtyNos: z.coerce.number().int().positive(),
  reasonCodeId: z.string().min(1),
});

/** T16 — Customer Return Note, received against the original Dispatch Note and FG Lot into Rejected – FG. */
export async function createCustomerReturnAction(formData: FormData) {
  const user = await requireAction("dispatch.create");
  const parsed = returnSchema.safeParse({
    dispatchNo: formData.get("dispatchNo"),
    fgLotNo: formData.get("fgLotNo"),
    qtyNos: formData.get("qtyNos"),
    reasonCodeId: formData.get("reasonCodeId"),
  });
  if (!parsed.success) redirect(`/dispatch?err=${encodeURIComponent("Enter dispatch no., FG lot, quantity and a reason.")}`);
  try {
    const rej = await createCustomerReturn({ ...parsed.data, userId: user.id });
    redirect(`/dispatch?ok=${encodeURIComponent(`Customer return recorded as ${rej.rejNo} (Rejected – FG).`)}`);
  } catch (err) {
    const e = toUserError(err);
    redirect(`/dispatch?err=${encodeURIComponent(e.message)}`);
  }
}
