"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { createJwOutChallan } from "@/server/services/jobwork";
import { ValidationError } from "@/server/services/errors";
import { can } from "@/server/policy";

const go = (kind: "ok" | "err", msg: string): never => redirect(`/jobwork/out?${kind}=${encodeURIComponent(msg)}`);

const schema = z.object({
  vendorId: z.string().min(1),
  lines: z.array(z.object({ lotId: z.string().min(1), qtyNos: z.number().int().positive(), qtyKg: z.number().positive() })).min(1),
  expectedReturnDate: z.string().optional(),
  overrideReason: z.string().optional(),
});

/** SOP 4.7 send-out: one challan to one job worker, carrying one or more Production Lots. */
export async function createJwOutAction(formData: FormData) {
  const user = await requireAction("jw.challan");
  const lotIds = formData.getAll("lotIds").map(String).filter(Boolean);
  const lines = lotIds.map((lotId) => ({
    lotId,
    qtyNos: Number(formData.get(`nos[${lotId}]`)),
    qtyKg: Number(formData.get(`kg[${lotId}]`)),
  }));
  const parsed = schema.safeParse({
    vendorId: formData.get("vendorId"),
    lines,
    expectedReturnDate: String(formData.get("expectedReturnDate") ?? "").trim() || undefined,
    overrideReason: String(formData.get("overrideReason") ?? "").trim() || undefined,
  });
  if (!parsed.success) go("err", "Choose a job worker and tick at least one lot, with its kg (reference) filled in.");
  const d = parsed.data!;

  // FIFO override is Admin-only (validation #5), enforced here regardless of the UI.
  if (d.overrideReason && !can(user, "issue.fifoOverride")) go("err", "Only an Admin can override FIFO ordering.");
  let expectedReturnDate: Date | undefined;
  if (d.expectedReturnDate) {
    expectedReturnDate = new Date(d.expectedReturnDate);
    if (Number.isNaN(expectedReturnDate.getTime())) go("err", "Invalid expected return date.");
  }

  try {
    const challan = await createJwOutChallan({
      vendorId: d.vendorId,
      lines: d.lines,
      userId: user.id,
      expectedReturnDate,
      isAdmin: user.role === "ADMIN",
      overrideReason: d.overrideReason,
    });
    go("ok", `Challan ${challan.challanNo} created with ${d.lines.length} lot(s). Print it from the list below.`);
  } catch (e) {
    if (e instanceof ValidationError) go("err", e.message);
    throw e;
  }
}
