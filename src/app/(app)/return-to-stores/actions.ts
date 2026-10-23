"use server";

import { toUserError } from "@/server/userError";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { returnToStores } from "@/server/services/issue";

const schema = z.object({
  lotId: z.string().min(1),
  bundleId: z.string().min(1),
  kg: z.coerce.number().positive(),
  reasonCodeId: z.string().min(1),
  remarks: z.string().optional(),
});

/** T6 — unused wire goes back to the SAME bundle, keeping its original inward date. Quantity and reason are mandatory. */
export async function returnToStoresAction(formData: FormData) {
  const user = await requireAction("issue.create");
  const parsed = schema.safeParse({
    lotId: formData.get("lotId"),
    bundleId: formData.get("bundleId"),
    kg: formData.get("kg"),
    reasonCodeId: formData.get("reasonCodeId"),
    remarks: String(formData.get("remarks") ?? "") || undefined,
  });
  if (!parsed.success) {
    redirect(`/return-to-stores?err=${encodeURIComponent("Enter a positive weight and select why the wire is being returned.")}`);
  }
  try {
    await returnToStores({ ...parsed.data, userId: user.id });
    redirect(`/return-to-stores?ok=${encodeURIComponent("Wire returned to stores and restored to its bundle.")}`);
  } catch (err) {
    const e = toUserError(err);
    redirect(`/return-to-stores?err=${encodeURIComponent(e.message)}`);
  }
}
