/**
 * IQC (T2/T3) — Incoming Quality Inspection. Section 4.2.
 * Per-bundle, no partial acceptance (Section 10 Q1/Q2).
 * Entry by Floor (iqc.enter), approval by Admin (iqc.approve) which actually
 * moves stock. Bundle numbering (4.3) happens at acceptance.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { genIqcNo, genRejectionNo } from "./docNumber";
import { getLocationByName, LOCATION_NAMES } from "./locations";

export type IqcDecision = "ACCEPT" | "REJECT" | "ACCEPT_DEVIATION";

export async function enterIqcResult(params: {
  bundleId: string;
  results: Record<string, unknown>;
  decision: IqcDecision;
  reasonCodeId?: string;
  userId: string;
}) {
  const bundle = await prisma.bundle.findUnique({ where: { id: params.bundleId } });
  if (!bundle) throw new ValidationError("Bundle not found.");
  if (bundle.status !== "QUALITY_HOLD") {
    throw new ValidationError("IQC can only be entered for bundles in Quality Hold.");
  }
  if (params.decision === "REJECT" && !params.reasonCodeId) {
    throw new ValidationError("Reason code is mandatory for rejection.");
  }
  return prisma.$transaction(async (tx) => {
    if (await tx.iqc.findUnique({ where: { bundleId: params.bundleId } })) {
      throw new ValidationError("An IQC result has already been entered for this bundle.");
    }
    const iqcNo = await genIqcNo(tx, new Date());
    return tx.iqc.create({
      data: {
        iqcNo,
        bundleId: params.bundleId,
        results: params.results as Prisma.InputJsonObject,
        decision: params.decision,
        reasonCodeId: params.reasonCodeId,
        enteredById: params.userId,
      },
    });
  });
}

/**
 * SOP 4.2 step 1: "pick a bundle or the full GRN". Records the same result and decision for every
 * bundle of the GRN still waiting for inspection (each bundle still gets its own IQC record).
 */
export async function enterIqcForGrn(params: {
  grnId: string;
  results: Record<string, unknown>;
  decision: IqcDecision;
  reasonCodeId?: string;
  userId: string;
}) {
  if (params.decision === "REJECT" && !params.reasonCodeId) {
    throw new ValidationError("Reason code is mandatory for rejection.");
  }
  return prisma.$transaction(async (tx) => {
    const bundles = await tx.bundle.findMany({
      where: { grnId: params.grnId, status: "QUALITY_HOLD", iqc: null },
      orderBy: { bundleNo: "asc" },
    });
    if (bundles.length === 0) throw new ValidationError("No bundles of this GRN are waiting for inspection.");
    const created = [];
    for (const b of bundles) {
      created.push(
        await tx.iqc.create({
          data: {
            iqcNo: await genIqcNo(tx, new Date()),
            bundleId: b.id,
            results: params.results as Prisma.InputJsonObject,
            decision: params.decision,
            reasonCodeId: params.reasonCodeId,
            enteredById: params.userId,
          },
        }),
      );
    }
    return created;
  });
}

/** Admin approval actually moves stock — T2 (accept) or T3 (reject). */
export async function approveIqc(params: { iqcId: string; approverId: string }) {
  return prisma.$transaction(async (tx) => {
    const iqc = await tx.iqc.findUnique({ where: { id: params.iqcId }, include: { bundle: true } });
    if (!iqc) throw new ValidationError("IQC record not found.");
    if (iqc.approvedAt) throw new ValidationError("This IQC has already been approved.");
    const bundle = iqc.bundle;
    if (bundle.status !== "QUALITY_HOLD") {
      throw new ValidationError("Bundle is not in Quality Hold; cannot approve IQC.");
    }

    await tx.iqc.update({
      where: { id: iqc.id },
      data: { approvedById: params.approverId, approvedAt: new Date() },
    });

    if (iqc.decision === "ACCEPT" || iqc.decision === "ACCEPT_DEVIATION") {
      const rmStores = await getLocationByName(tx, LOCATION_NAMES.RM_STORES);
      await tx.bundle.update({
        where: { id: bundle.id },
        data: { status: "AVAILABLE", locationId: rmStores.id },
      });
      await writeLedger(tx, {
        txnType: "T2_IQC_ACCEPT",
        docNo: iqc.iqcNo,
        itemType: "RM",
        refNo: bundle.bundleNo,
        fromLocationId: bundle.locationId,
        toLocationId: rmStores.id,
        fromStatus: "QUALITY_HOLD",
        toStatus: "AVAILABLE",
        qty: bundle.balanceKg,
        uom: "kg",
        userId: params.approverId,
      });
    } else {
      // REJECT: whole bundle, no partial acceptance.
      const rejArea = await getLocationByName(tx, LOCATION_NAMES.REJECTION_RM);
      await tx.bundle.update({
        where: { id: bundle.id },
        data: { status: "REJECTED", locationId: rejArea.id },
      });
      await writeLedger(tx, {
        txnType: "T3_IQC_REJECT",
        docNo: iqc.iqcNo,
        itemType: "RM",
        refNo: bundle.bundleNo,
        fromLocationId: bundle.locationId,
        toLocationId: rejArea.id,
        fromStatus: "QUALITY_HOLD",
        toStatus: "REJECTED",
        qty: bundle.balanceKg,
        uom: "kg",
        userId: params.approverId,
        reason: iqc.reasonCodeId ?? "IQC_REJECT",
      });
      await tx.rejection.create({
        data: {
          rejNo: await genRejectionNo(tx, new Date()),
          stage: "IQC",
          refType: "BUNDLE",
          refId: bundle.id,
          qty: bundle.balanceKg,
          uom: "kg",
          reasonCodeId: iqc.reasonCodeId ?? "",
          disposal: "PENDING",
          createdById: params.approverId,
        },
      });
    }

    return tx.iqc.findUnique({ where: { id: iqc.id }, include: { bundle: true } });
  }, { isolationLevel: "Serializable" });
}
