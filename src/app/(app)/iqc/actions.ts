"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { enterIqcResult, enterIqcForGrn, approveIqc } from "@/server/services/iqc";
import { ValidationError } from "@/server/services/errors";

const go = (kind: "ok" | "err", msg: string): never => redirect(`/iqc?${kind}=${encodeURIComponent(msg)}`);

const enterSchema = z.object({
  bundleId: z.string().optional(),
  grnId: z.string().optional(),
  decision: z.enum(["ACCEPT", "REJECT", "ACCEPT_DEVIATION"]),
  reasonCodeId: z.string().optional(),
  diameter: z.string().optional(),
  tensile: z.string().optional(),
  surface: z.string().optional(),
  certificate: z.string().optional(),
});

/** SOP 4.2 steps 1-2 (QC inspector): record test results + decision for one bundle or a whole GRN. */
export async function enterIqcAction(formData: FormData) {
  const user = await requireAction("iqc.enter");
  const val = (k: string) => String(formData.get(k) ?? "").trim() || undefined;
  const parsed = enterSchema.safeParse({
    bundleId: val("bundleId"),
    grnId: val("grnId"),
    decision: formData.get("decision"),
    reasonCodeId: val("reasonCodeId"),
    diameter: val("diameter"),
    tensile: val("tensile"),
    surface: val("surface"),
    certificate: val("certificate"),
  });
  if (!parsed.success || (!parsed.data.bundleId && !parsed.data.grnId)) go("err", "Invalid IQC entry.");
  const d = parsed.data!;
  const results = { diameter: d.diameter, tensile: d.tensile, surface: d.surface, certificate: d.certificate };

  try {
    if (d.grnId) {
      const recs = await enterIqcForGrn({ grnId: d.grnId, decision: d.decision, reasonCodeId: d.reasonCodeId, results, userId: user.id });
      go("ok", `IQC recorded for ${recs.length} bundle(s) of the GRN. Awaiting Quality Admin approval.`);
    }
    const iqc = await enterIqcResult({ bundleId: d.bundleId!, decision: d.decision, reasonCodeId: d.reasonCodeId, results, userId: user.id });
    go("ok", `IQC ${iqc.iqcNo} entered. Awaiting Quality Admin approval.`);
  } catch (e) {
    if (e instanceof ValidationError) go("err", e.message);
    throw e;
  }
}

/** SOP 4.2 step 3 (Quality Admin only): approve — this is what moves the stock. */
export async function approveIqcAction(formData: FormData) {
  const user = await requireAction("iqc.approve");
  const iqcId = String(formData.get("iqcId"));
  try {
    const result = await approveIqc({ iqcId, approverId: user.id });
    go(
      "ok",
      result?.decision === "REJECT"
        ? `IQC approved: bundle ${result.bundle.bundleNo} moved to Rejected – RM (Return-to-Supplier list).`
        : `IQC approved: bundle ${result?.bundle.bundleNo} is now Available in RM Stores. Print its bundle tag below.`,
    );
  } catch (e) {
    if (e instanceof ValidationError) go("err", e.message);
    throw e;
  }
}
