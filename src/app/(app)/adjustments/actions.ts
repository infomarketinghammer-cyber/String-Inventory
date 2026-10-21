"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { adjustBundleStock } from "@/server/services/adjustment";
import { ValidationError } from "@/server/services/errors";

const schema = z.object({
  bundleId: z.string().min(1),
  deltaKg: z.coerce.number().refine((n) => n !== 0, "Adjustment cannot be zero."),
  reason: z.string().min(1),
});

export async function adjustStockAction(formData: FormData) {
  const user = await requireAction("stock.adjust"); // Admin-only
  const parsed = schema.safeParse({
    bundleId: formData.get("bundleId"),
    deltaKg: formData.get("deltaKg"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) redirect(`/adjustments?err=${encodeURIComponent("Please provide a bundle, non-zero quantity, and reason.")}`);
  try {
    await adjustBundleStock({ ...parsed.data, adminId: user.id });
    redirect(`/adjustments?ok=${encodeURIComponent("Adjustment recorded.")}`);
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/adjustments?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}
