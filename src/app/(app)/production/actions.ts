"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { recordOperationEntry } from "@/server/services/production";
import { ValidationError } from "@/server/services/errors";

const schema = z.object({
  lotId: z.string().min(1),
  opSeq: z.coerce.number().int().positive(),
  goodNos: z.coerce.number().int().min(0),
  rejectedNos: z.coerce.number().int().min(0),
  reasonCodeId: z.string().optional(),
});

export async function recordOperationAction(formData: FormData) {
  const user = await requireAction("production.entry");
  const parsed = schema.safeParse({
    lotId: formData.get("lotId"),
    opSeq: formData.get("opSeq"),
    goodNos: formData.get("goodNos"),
    rejectedNos: formData.get("rejectedNos"),
    reasonCodeId: formData.get("reasonCodeId") || undefined,
  });
  if (!parsed.success) redirect(`/production?err=${encodeURIComponent("Invalid operation entry.")}`);
  try {
    await recordOperationEntry({ ...parsed.data, userId: user.id });
    redirect(`/production?ok=${encodeURIComponent("Operation entry saved.")}`);
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/production?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}
