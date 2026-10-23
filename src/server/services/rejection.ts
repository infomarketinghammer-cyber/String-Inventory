/**
 * Rejection disposal (RTS / rework / scrap) — Admin only. Section 4.10.
 * T4 (RTS), T13 (rework), T14 (scrap, final write-off, needs Admin approval + reason).
 *
 * Rework creates a NEW Production Lot for the reworked quantity at the chosen operation. It keeps
 * the source lot's start date (so FIFO position is preserved) and links to the same bundles
 * (kg 0, because the wire was already consumed) so Part <-> Bundle traceability still holds.
 */
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { genLotNo, genReworkNo, genScrapNo } from "./docNumber";
import { getLocationByName, LOCATION_NAMES } from "./locations";

export async function disposeRejection(params: {
  rejectionId: string;
  disposal: "RTS" | "REWORK" | "SCRAP" | "DEVIATION";
  targetOpSeq?: number; // for REWORK
  reason: string;
  adminId: string;
}) {
  if (!params.reason.trim()) throw new ValidationError("Reason is mandatory for disposal.");

  return prisma.$transaction(async (tx) => {
    const rej = await tx.rejection.findUniqueOrThrow({ where: { id: params.rejectionId } });
    if (rej.disposal !== "PENDING") throw new ValidationError("Rejection already disposed.");
    const date = new Date();
    const returned = await getLocationByName(tx, LOCATION_NAMES.SCRAP_RETURNED);
    const rejectionLocName =
      rej.refType === "BUNDLE"
        ? LOCATION_NAMES.REJECTION_RM
        : rej.refType === "FG_LOT"
          ? LOCATION_NAMES.REJECTION_FG
          : LOCATION_NAMES.REJECTION_WIP;
    const rejectionLoc = await getLocationByName(tx, rejectionLocName);

    if (params.disposal === "DEVIATION") {
      // SOP 4.10: an IQC-rejected bundle may be accepted under deviation -> Available in RM Stores,
      // keeping its original inward date (FIFO position).
      if (rej.stage !== "IQC" || rej.refType !== "BUNDLE") {
        throw new ValidationError("Accept under deviation applies only to IQC (incoming RM) rejections.");
      }
      const bundle = await tx.bundle.findUniqueOrThrow({ where: { id: rej.refId } });
      if (bundle.status !== "REJECTED") throw new ValidationError("Bundle is no longer in Rejected – RM.");
      const rmStores = await getLocationByName(tx, LOCATION_NAMES.RM_STORES);
      await tx.bundle.update({ where: { id: bundle.id }, data: { status: "AVAILABLE", locationId: rmStores.id } });
      await writeLedger(tx, {
        txnType: "T2_IQC_ACCEPT",
        docNo: rej.rejNo,
        itemType: "RM",
        refNo: bundle.bundleNo,
        fromLocationId: rejectionLoc.id,
        toLocationId: rmStores.id,
        fromStatus: "REJECTED",
        toStatus: "AVAILABLE",
        qty: bundle.balanceKg,
        uom: "kg",
        userId: params.adminId,
        reason: `Accepted under deviation: ${params.reason}`,
      });
    } else if (params.disposal === "RTS" || (params.disposal === "SCRAP" && rej.refType === "BUNDLE")) {
      if (params.disposal === "RTS" && rej.stage !== "IQC") {
        throw new ValidationError("RTS applies only to IQC (incoming RM) rejections.");
      }
      const bundle = await tx.bundle.findUniqueOrThrow({ where: { id: rej.refId } });
      const qty = Number(rej.qty);
      if (Number(bundle.balanceKg) + 1e-6 < qty) {
        throw new ValidationError("Bundle balance is lower than the rejected quantity; cannot dispose.");
      }
      // Stock leaves the system: bundle balance goes to zero and it sits in the virtual location.
      await tx.bundle.update({
        where: { id: bundle.id },
        data: { balanceKg: { decrement: qty }, locationId: returned.id },
      });
      await writeLedger(tx, {
        txnType: params.disposal === "RTS" ? "T4_RTS" : "T14_SCRAP",
        docNo: params.disposal === "RTS" ? rej.rejNo : await genScrapNo(tx, date),
        itemType: "RM",
        refNo: bundle.bundleNo,
        fromLocationId: rejectionLoc.id,
        toLocationId: returned.id,
        fromStatus: "REJECTED",
        toStatus: params.disposal === "RTS" ? "RETURNED" : "SCRAPPED",
        qty,
        uom: rej.uom,
        userId: params.adminId,
        reason: params.reason,
      });
    } else if (params.disposal === "REWORK") {
      if (rej.stage === "IQC") throw new ValidationError("IQC rejections cannot be reworked, only returned to supplier.");
      if (rej.refType === "BUNDLE") throw new ValidationError("Raw material cannot be reworked.");

      // Resolve the production lot the rejected pieces came from.
      let sourceLotId = rej.refId;
      if (rej.refType === "FG_LOT") {
        const fg = await tx.fgLot.findUniqueOrThrow({ where: { id: rej.refId } });
        sourceLotId = fg.sourceLotId;
      }
      const source = await tx.productionLot.findUniqueOrThrow({
        where: { id: sourceLotId },
        include: { part: { include: { bomLines: true } }, bundleLinks: true },
      });
      if (!params.targetOpSeq) throw new ValidationError("Choose the operation the rework goes back to.");
      if (!source.part.bomLines.some((b) => b.opSeq === params.targetOpSeq)) {
        throw new ValidationError(`Operation ${params.targetOpSeq} is not in this Part's routing.`);
      }

      const wip = await getLocationByName(tx, LOCATION_NAMES.PRODUCTION_FLOOR);
      const lotNo = await genLotNo(tx, date);
      const reworkLot = await tx.productionLot.create({
        data: {
          lotNo,
          partId: source.partId,
          mrnId: source.mrnId,
          currentOpSeq: params.targetOpSeq,
          qtyNos: Math.round(Number(rej.qty)),
          status: "IN_HOUSE",
          locationId: wip.id,
          startDate: source.startDate,
        },
      });
      for (const link of source.bundleLinks) {
        await tx.lotBundleLink.create({ data: { lotId: reworkLot.id, bundleId: link.bundleId, kgConsumed: 0 } });
      }
      await writeLedger(tx, {
        txnType: "T13_REWORK",
        docNo: await genReworkNo(tx, date),
        itemType: "WIP",
        refNo: lotNo,
        fromLocationId: rejectionLoc.id,
        toLocationId: wip.id,
        fromStatus: "REJECTED",
        toStatus: "IN_HOUSE",
        qty: rej.qty,
        uom: rej.uom,
        userId: params.adminId,
        reason: `${params.reason} (rework of ${source.lotNo} at op ${params.targetOpSeq})`,
      });
    } else {
      // SCRAP of WIP / FG — final write-off, stock to zero for that qty.
      await writeLedger(tx, {
        txnType: "T14_SCRAP",
        docNo: await genScrapNo(tx, date),
        itemType: rej.refType === "FG_LOT" ? "FG" : "WIP",
        refNo: await refNoFor(tx, rej.refType, rej.refId),
        fromLocationId: rejectionLoc.id,
        toLocationId: returned.id,
        fromStatus: "REJECTED",
        toStatus: "SCRAPPED",
        qty: rej.qty,
        uom: rej.uom,
        userId: params.adminId,
        reason: params.reason,
      });
      // A lot whose whole quantity was rejected has nothing left; close it out.
      if (rej.refType === "LOT") {
        const lot = await tx.productionLot.findUnique({ where: { id: rej.refId } });
        if (lot && lot.status === "REJECTED" && lot.qtyNos === 0) {
          await tx.productionLot.update({ where: { id: lot.id }, data: { status: "CLOSED" } });
        }
      }
    }

    await tx.auditLog.create({
      data: {
        userId: params.adminId,
        action: `REJECTION_${params.disposal}`,
        entity: "Rejection",
        entityId: rej.id,
        oldValue: { disposal: rej.disposal },
        newValue: { disposal: params.disposal, reason: params.reason },
      },
    });

    return tx.rejection.update({
      where: { id: rej.id },
      data: { disposal: params.disposal, approvedById: params.adminId },
    });
  });
}

type RefTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Human-readable number (bundle_no / lot_no / fg_lot_no) for a rejection's internal ref id. */
export async function refNoFor(tx: RefTx | typeof prisma, refType: string, refId: string): Promise<string> {
  if (refType === "BUNDLE") return (await tx.bundle.findUnique({ where: { id: refId } }))?.bundleNo ?? refId;
  if (refType === "LOT") return (await tx.productionLot.findUnique({ where: { id: refId } }))?.lotNo ?? refId;
  return (await tx.fgLot.findUnique({ where: { id: refId } }))?.fgLotNo ?? refId;
}
