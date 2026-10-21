"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { createJwInReceipt, jwReturnQcDecision, closeChallanWithShortage } from "@/server/services/jobwork";
import { ValidationError } from "@/server/services/errors";

const receiptSchema = z.object({
  challanId: z.string().min(1),
  challanLineId: z.string().min(1),
  receivedNos: z.coerce.number().int().min(0),
  rejectedNos: z.coerce.number().int().min(0),
  shortNos: z.coerce.number().int().min(0),
  reasonCodeId: z.string().optional(),
});

export async function createJwInAction(formData: FormData) {
  const user = await requireAction("jw.receipt");
  const parsed = receiptSchema.safeParse({
    challanId: formData.get("challanId"),
    challanLineId: formData.get("challanLineId"),
    receivedNos: formData.get("receivedNos") || 0,
    rejectedNos: formData.get("rejectedNos") || 0,
    shortNos: formData.get("shortNos") || 0,
    reasonCodeId: formData.get("reasonCodeId") || undefined,
  });
  if (!parsed.success) redirect(`/jobwork/in?err=${encodeURIComponent("Invalid receipt input.")}`);
  try {
    await createJwInReceipt({
      challanId: parsed.data.challanId,
      lines: [
        {
          challanLineId: parsed.data.challanLineId,
          receivedNos: parsed.data.receivedNos,
          rejectedNos: parsed.data.rejectedNos,
          shortNos: parsed.data.shortNos,
          reasonCodeId: parsed.data.reasonCodeId,
        },
      ],
      userId: user.id,
    });
    redirect(
      `/jobwork/in?ok=${encodeURIComponent(
        "Receipt saved. Once the whole line is received (or the challan is closed), the lot moves to JW Return QC.",
      )}`,
    );
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/jobwork/in?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

const qcSchema = z.object({
  lotId: z.string().min(1),
  acceptedNos: z.coerce.number().int().min(0),
  rejectedNos: z.coerce.number().int().min(0),
  reasonCodeId: z.string().optional(),
});

export async function jwReturnQcAction(formData: FormData) {
  const user = await requireAction("jw.receipt");
  const parsed = qcSchema.safeParse({
    lotId: formData.get("lotId"),
    acceptedNos: formData.get("acceptedNos"),
    rejectedNos: formData.get("rejectedNos"),
    reasonCodeId: formData.get("reasonCodeId") || undefined,
  });
  if (!parsed.success) redirect(`/jobwork/in?err=${encodeURIComponent("Invalid QC decision.")}`);
  try {
    await jwReturnQcDecision({ ...parsed.data, userId: user.id });
    redirect(`/jobwork/in?ok=${encodeURIComponent("JW Return QC decision saved.")}`);
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/jobwork/in?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

export async function closeChallanAction(formData: FormData) {
  const user = await requireAction("jw.closeWithShortage"); // Admin-only
  const challanId = String(formData.get("challanId"));
  const reason = String(formData.get("reason") ?? "");
  try {
    await closeChallanWithShortage({ challanId, reason, adminId: user.id });
    redirect(`/jobwork/in?ok=${encodeURIComponent("Challan closed with shortage, reason logged.")}`);
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/jobwork/in?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}
