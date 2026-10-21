"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { recordFinalInspection, approveRecordedFinalInspection } from "@/server/services/finalInspection";
import { ValidationError } from "@/server/services/errors";

const go = (kind: "ok" | "err", msg: string): never => redirect(`/final-inspection?${kind}=${encodeURIComponent(msg)}`);

const schema = z.object({
  lotId: z.string().min(1),
  acceptedNos: z.coerce.number().int().min(0),
  rejectedNos: z.coerce.number().int().min(0),
  reasonCodeId: z.string().optional(),
  results: z.string().optional(),
});

/** Step 1 (QC inspector, Floor or Admin): record the final inspection result. */
export async function recordFinalInspectionAction(formData: FormData) {
  const user = await requireAction("finalInspection.enter");
  const parsed = schema.safeParse({
    lotId: formData.get("lotId"),
    acceptedNos: formData.get("acceptedNos"),
    rejectedNos: formData.get("rejectedNos") || 0,
    reasonCodeId: formData.get("reasonCodeId") || undefined,
    results: formData.get("results") || undefined,
  });
  if (!parsed.success) go("err", "Invalid final inspection entry.");
  try {
    const fqi = await recordFinalInspection({ ...parsed.data!, userId: user.id });
    go("ok", `${fqi.fqiNo} recorded. Awaiting Quality Admin approval.`);
  } catch (e) {
    if (e instanceof ValidationError) go("err", e.message);
    throw e;
  }
}

/** Step 2 (Quality Admin only): approve — creates the FG Lot. */
export async function approveFinalInspectionAction(formData: FormData) {
  const user = await requireAction("finalInspection.approve");
  const fqiId = String(formData.get("fqiId") ?? "");
  try {
    const fgLot = await approveRecordedFinalInspection({ fqiId, approverId: user.id });
    go("ok", fgLot ? `Approved. FG Lot ${fgLot.fgLotNo} created with ${fgLot.qtyNos} nos.` : "Approved (all rejected; no FG Lot).");
  } catch (e) {
    if (e instanceof ValidationError) go("err", e.message);
    throw e;
  }
}
