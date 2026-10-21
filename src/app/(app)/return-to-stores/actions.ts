"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { returnToStores } from "@/server/services/issue";
import { ValidationError } from "@/server/services/errors";

const schema = z.object({
  lotId: z.string().min(1),
  bundleId: z.string().min(1),
  kg: z.coerce.number().positive(),
});

/** T6 — unused wire goes back to the SAME bundle, keeping its original inward date. */
export async function returnToStoresAction(formData: FormData) {
  const user = await requireAction("issue.create");
  const parsed = schema.safeParse({
    lotId: formData.get("lotId"),
    bundleId: formData.get("bundleId"),
    kg: formData.get("kg"),
  });
  if (!parsed.success) redirect(`/return-to-stores?err=${encodeURIComponent("Choose a lot, bundle and a positive weight.")}`);
  try {
    await returnToStores({ ...parsed.data, userId: user.id });
    redirect(`/return-to-stores?ok=${encodeURIComponent("Wire returned to stores and restored to its bundle.")}`);
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/return-to-stores?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}
