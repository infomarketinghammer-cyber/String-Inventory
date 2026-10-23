"use server";

import { toUserError } from "@/server/userError";
import { safeProductionPath } from "@/lib/operations";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { recordOperationEntry, skipJobWork } from "@/server/services/production";

const schema = z.object({
  lotId: z.string().min(1),
  opSeq: z.coerce.number().int().positive(),
  // Empty box = 0; anything else must be a whole number (negatives are refused by the service with a clear message).
  goodNos: z.coerce.number().int(),
  rejectedNos: z.coerce.number().int(),
  reasonCodeId: z.string().optional(),
  clientToken: z.string().max(100).optional(),
});

export async function recordOperationAction(formData: FormData) {
  const user = await requireAction("production.entry");
  const num = (k: string) => String(formData.get(k) ?? "").trim() || "0";
  const parsed = schema.safeParse({
    lotId: formData.get("lotId"),
    opSeq: formData.get("opSeq"),
    goodNos: num("goodNos"),
    rejectedNos: num("rejectedNos"),
    reasonCodeId: formData.get("reasonCodeId") || undefined,
    clientToken: formData.get("clientToken") || undefined,
  });
  if (!parsed.success) redirect(`${safeProductionPath(formData.get("back"))}?err=${encodeURIComponent("Enter whole numbers for good and rejected quantities.")}`);
  try {
    const r = await recordOperationEntry({ ...parsed.data, userId: user.id });
    const msg = r.duplicate
      ? "This entry was already saved."
      : r.completed
        ? `${r.lot.lotNo}: entry saved. Operation complete, the lot moved to the next step.`
        : `${r.lot.lotNo}: entry saved. ${r.pending} nos still pending at this operation.`;
    redirect(`${safeProductionPath(formData.get("back"))}?ok=${encodeURIComponent(msg)}`);
  } catch (err) {
    const e = toUserError(err);
    redirect(`${safeProductionPath(formData.get("back"))}?err=${encodeURIComponent(e.message)}`);
  }
}

/** Job work is optional: skip a lot's JW step instead of sending it on a JW Out Challan. */
export async function skipJobWorkAction(formData: FormData) {
  const user = await requireAction("production.entry");
  const lotId = String(formData.get("lotId") ?? "");
  const opSeq = Number(formData.get("opSeq"));
  try {
    const r = await skipJobWork({ lotId, opSeq, reason: String(formData.get("reason") ?? ""), userId: user.id });
    redirect(`${safeProductionPath(formData.get("back"))}?ok=${encodeURIComponent(`${r.lotNo}: ${r.skipped} skipped (no job work). Lot moved to ${r.next}.`)}`);
  } catch (err) {
    const e = toUserError(err);
    redirect(`${safeProductionPath(formData.get("back"))}?err=${encodeURIComponent(e.message)}`);
  }
}
