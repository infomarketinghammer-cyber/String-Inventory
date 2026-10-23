"use server";

import { toUserError } from "@/server/userError";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { createJwOutChallan, NEW_JOB_WORKER, type NewJobWorker } from "@/server/services/jobwork";
import { can } from "@/server/policy";

const go = (kind: "ok" | "err", msg: string): never => redirect(`/jobwork/out?${kind}=${encodeURIComponent(msg)}`);

const schema = z.object({
  vendorId: z.string().min(1),
  vehicleNo: z.string().trim().min(1),
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
    vehicleNo: String(formData.get("vehicleNo") ?? ""),
    lines,
    expectedReturnDate: String(formData.get("expectedReturnDate") ?? "").trim() || undefined,
    overrideReason: String(formData.get("overrideReason") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    go("err", "Choose a job worker, enter the vehicle no. and tick at least one lot, with its kg (reference) filled in.");
  }
  const d = parsed.data!;

  // FIFO override is Admin-only (validation #5), enforced here regardless of the UI.
  if (d.overrideReason && !can(user, "issue.fifoOverride")) go("err", "Only an Admin can override FIFO ordering.");

  // A job worker not registered yet: only an Admin (masters) may add one; it is created with the challan.
  let newVendor: NewJobWorker | undefined;
  if (d.vendorId === NEW_JOB_WORKER) {
    if (!can(user, "masters.manage")) go("err", "Only an Admin can add a new job worker.");
    const days = Number(String(formData.get("newVendorMaxReturnDays") ?? "").trim());
    newVendor = {
      name: String(formData.get("newVendorName") ?? ""),
      address: String(formData.get("newVendorAddress") ?? "") || undefined,
      gstin: String(formData.get("newVendorGstin") ?? "") || undefined,
      maxReturnDays: days,
    };
    if (!newVendor.name.trim()) go("err", "Enter the new job worker's name.");
    if (!Number.isInteger(days) || days < 1 || days > 365) go("err", "Enter the new job worker's maximum return days (1 to 365).");
  }
  let expectedReturnDate: Date | undefined;
  if (d.expectedReturnDate) {
    // A picked day means "back by the end of that day" (local time), so today is allowed and past days are not.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.expectedReturnDate)) go("err", "Invalid expected return date.");
    if (d.expectedReturnDate < new Date().toLocaleDateString("en-CA")) go("err", "Expected return date cannot be before today.");
    expectedReturnDate = new Date(`${d.expectedReturnDate}T23:59:59`);
    if (Number.isNaN(expectedReturnDate.getTime())) go("err", "Invalid expected return date.");
  }

  try {
    const challan = await createJwOutChallan({
      vendorId: d.vendorId,
      newVendor,
      vehicleNo: d.vehicleNo,
      lines: d.lines,
      userId: user.id,
      expectedReturnDate,
      isAdmin: user.role === "ADMIN",
      overrideReason: d.overrideReason,
    });
    go(
      "ok",
      `Challan ${challan.challanNo} created with ${d.lines.length} lot(s)${newVendor ? `; job worker ${newVendor.name.trim()} registered` : ""}. Print it from the list below.`,
    );
  } catch (err) {
    const e = toUserError(err);
    go("err", e.message);
  }
}
