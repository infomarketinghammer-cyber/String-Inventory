"use server";

import { toUserError } from "@/server/userError";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { disposeRejection } from "@/server/services/rejection";

const schema = z.object({
  rejectionId: z.string().min(1),
  disposal: z.enum(["RTS", "REWORK", "SCRAP", "DEVIATION"]),
  targetOpSeq: z.coerce.number().int().positive().optional(),
  reason: z.string().min(1),
});

export async function disposeRejectionAction(formData: FormData) {
  const user = await requireAction("rejection.disposal"); // Admin-only
  const parsed = schema.safeParse({
    rejectionId: formData.get("rejectionId"),
    disposal: formData.get("disposal"),
    targetOpSeq: formData.get("targetOpSeq") || undefined,
    reason: formData.get("reason"),
  });
  if (!parsed.success) redirect(`/rejections?err=${encodeURIComponent("Please choose a disposal and give a reason.")}`);
  try {
    await disposeRejection({ ...parsed.data, adminId: user.id });
    redirect(`/rejections?ok=${encodeURIComponent("Disposal recorded.")}`);
  } catch (err) {
    const e = toUserError(err);
    redirect(`/rejections?err=${encodeURIComponent(e.message)}`);
  }
}
