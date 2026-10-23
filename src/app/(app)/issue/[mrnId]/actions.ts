"use server";

import { toUserError } from "@/server/userError";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { createIssue } from "@/server/services/issue";
import { can } from "@/server/policy";

const schema = z.object({
  mrnId: z.string().min(1),
  lines: z
    .array(z.object({ bundleId: z.string().min(1), kgIssued: z.coerce.number().positive() }))
    .min(1),
  overrideReason: z.string().optional(),
});

export async function createIssueAction(formData: FormData) {
  const user = await requireAction("issue.create");

  const lines: Array<{ bundleId: string; kgIssued: number }> = [];
  let i = 0;
  while (formData.has(`lines[${i}][bundleId]`)) {
    lines.push({
      bundleId: String(formData.get(`lines[${i}][bundleId]`)),
      kgIssued: Number(formData.get(`lines[${i}][kgIssued]`)),
    });
    i++;
  }

  const overrideReason = String(formData.get("overrideReason") ?? "").trim() || undefined;
  const mrnId = String(formData.get("mrnId"));

  const parsed = schema.safeParse({ mrnId, lines, overrideReason });
  if (!parsed.success) redirect(`/issue/${mrnId}?err=${encodeURIComponent("Please scan at least one bundle with a valid weight.")}`);

  // FIFO override is Admin-only (validation #5) - server-enforced even if a Floor
  // user somehow submits an overrideReason value.
  const wantsOverride = Boolean(overrideReason);
  if (wantsOverride && !can(user, "issue.fifoOverride")) {
    redirect(`/issue/${mrnId}?err=${encodeURIComponent("Only an Admin can override FIFO ordering.")}`);
  }

  try {
    const result = await createIssue({
      mrnId: parsed.data.mrnId,
      scannedLines: parsed.data.lines,
      userId: user.id,
      isAdmin: user.role === "ADMIN",
      overrideReason: parsed.data.overrideReason,
    });
    redirect(`/issue?ok=${encodeURIComponent(`Issue ${result.issue.issueNo} saved. Production Lot ${result.lot.lotNo} created.`)}`);
  } catch (err) {
    const e = toUserError(err);
    redirect(`/issue/${mrnId}?err=${encodeURIComponent(e.message)}`);
  }
}
