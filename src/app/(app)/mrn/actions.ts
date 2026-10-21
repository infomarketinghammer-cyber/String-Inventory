"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { createMrn } from "@/server/services/mrn";
import { ValidationError } from "@/server/services/errors";

const schema = z.object({
  partId: z.string().min(1),
  plannedQtyNos: z.coerce.number().int().positive(),
  requiredKg: z.coerce.number().positive().optional(),
});

export async function createMrnAction(formData: FormData) {
  const user = await requireAction("mrn.create");
  const parsed = schema.safeParse({
    partId: formData.get("partId"),
    plannedQtyNos: formData.get("plannedQtyNos"),
    requiredKg: String(formData.get("requiredKg") ?? "").trim() || undefined,
  });
  if (!parsed.success) redirect(`/mrn?err=${encodeURIComponent("Please select a Part and a valid quantity.")}`);
  try {
    const mrn = await createMrn({ ...parsed.data, userId: user.id });
    redirect(`/mrn?ok=${encodeURIComponent(`${mrn.mrnNo} created (requires ${Number(mrn.requiredKg).toFixed(2)} kg). Status: Open.`)}`);
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/mrn?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}
