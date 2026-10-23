/**
 * GRN (T1) — material receipt against PO. Section 4.1 / 9 validation #2.
 * Blocks receipt above PO balance + Admin tolerance %. Creates one Bundle
 * per line, status Quality Hold, location Incoming/QC area.
 */
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { genGrnNo, genBundleNo } from "./docNumber";
import { getLocationByName, LOCATION_NAMES } from "./locations";
import { getPoTolerancePct } from "./settings";

export interface GrnBundleInput {
  itemId: string;
  heatNo: string;
  tcRef?: string;
  weightKg: number;
}

export interface CreateGrnInput {
  poId: string;
  invoiceNo: string;
  vehicleNo?: string;
  invoiceDate?: Date;
  grnDate?: Date;
  bundles: GrnBundleInput[];
  userId: string;
  /**
   * SOP 4.1 step 2: the received quantity entered per PO line (itemId -> kg). When given, it must
   * agree with the sum of the bundle weights entered for that item, and every item received needs one.
   */
  lineQtys?: Record<string, number>;
  receipt?: { receiptPath: string; receiptName: string; receiptMime: string } | null;
}

/** YYYY-MM-DD of a moment in the plant's (server's) local time zone. Date inputs arrive as that calendar day. */
export function localDateString(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

export async function createGrn(input: CreateGrnInput) {
  if (input.bundles.length === 0) {
    throw new ValidationError("GRN must contain at least one bundle.");
  }
  if (!input.invoiceNo.trim()) throw new ValidationError("Supplier invoice no. is required.");
  if (input.bundles.some((b) => !(b.weightKg > 0) || !b.heatNo.trim())) {
    throw new ValidationError("Every bundle needs a Heat No. and a weight above zero.");
  }
  // Client rule: the supplier invoice date can never be post-dated (after today).
  if (input.invoiceDate && input.invoiceDate.toISOString().slice(0, 10) > localDateString(new Date())) {
    throw new ValidationError("Invoice date cannot be in the future.");
  }

  return prisma.$transaction(async (tx) => {
    const po = await tx.po.findUnique({ where: { id: input.poId }, include: { lines: true } });
    if (!po) throw new ValidationError("PO not found.");

    const tolerancePct = await getPoTolerancePct(tx);
    const grnDate = input.grnDate ?? new Date();

    // Validation #2: GRN qty <= PO balance + tolerance%, checked per item across this GRN's bundles.
    const byItem = new Map<string, number>();
    for (const b of input.bundles) {
      byItem.set(b.itemId, (byItem.get(b.itemId) ?? 0) + b.weightKg);
    }
    // Per-line received quantity must match the bundles entered under it (0.05 kg rounding allowance).
    if (input.lineQtys) {
      for (const itemId of Object.keys(input.lineQtys)) {
        if (!byItem.has(itemId) && input.lineQtys[itemId]! > 0) {
          throw new ValidationError("A PO line has a received quantity but no bundles entered for it.");
        }
      }
      for (const [itemId, bundleKg] of byItem) {
        const entered = input.lineQtys[itemId];
        const code = po.lines.find((l) => l.itemId === itemId);
        if (code && (entered === undefined || !(entered > 0))) {
          throw new ValidationError("Enter the received quantity for every PO line you are receiving.");
        }
        if (entered !== undefined && Math.abs(entered - bundleKg) > 0.05) {
          throw new ValidationError(
            `Received quantity (${entered.toFixed(2)} kg) does not match the bundle weights entered (${bundleKg.toFixed(2)} kg) for a PO line.`,
          );
        }
      }
    }

    for (const [itemId, qty] of byItem) {
      const line = po.lines.find((l) => l.itemId === itemId);
      if (!line) {
        throw new ValidationError("Item does not belong to the selected PO.");
      }
      const ordered = Number(line.orderedKg);
      const received = Number(line.receivedKg);
      const balance = ordered - received;
      const allowed = balance * (1 + tolerancePct / 100);
      if (qty > allowed + 1e-6) {
        throw new ValidationError(
          `Receipt qty (${qty.toFixed(2)} kg) exceeds PO balance + tolerance (${allowed.toFixed(
            2,
          )} kg) for this item.`,
        );
      }
    }

    const grnNo = await genGrnNo(tx, grnDate);
    const grn = await tx.grn.create({
      data: {
        grnNo,
        grnDate,
        poId: po.id,
        invoiceNo: input.invoiceNo,
        invoiceDate: input.invoiceDate,
        vehicleNo: input.vehicleNo,
        createdById: input.userId,
        ...(input.receipt ?? {}),
      },
    });

    const incomingLoc = await getLocationByName(tx, LOCATION_NAMES.INCOMING_QC);

    const createdBundles = [];
    for (const b of input.bundles) {
      const bundleNo = await genBundleNo(tx, grnDate);
      const bundle = await tx.bundle.create({
        data: {
          bundleNo,
          grnId: grn.id,
          itemId: b.itemId,
          heatNo: b.heatNo,
          tcRef: b.tcRef,
          receivedKg: b.weightKg,
          balanceKg: b.weightKg,
          inwardDate: grnDate,
          status: "QUALITY_HOLD",
          locationId: incomingLoc.id,
        },
      });

      await writeLedger(tx, {
        txnType: "T1_GRN",
        txnDate: grnDate,
        docNo: grnNo,
        itemType: "RM",
        refNo: bundleNo,
        toLocationId: incomingLoc.id,
        toStatus: "QUALITY_HOLD",
        qty: b.weightKg,
        uom: "kg",
        userId: input.userId,
      });

      createdBundles.push(bundle);
    }

    // update PO line received_kg
    for (const [itemId, qty] of byItem) {
      const line = po.lines.find((l) => l.itemId === itemId)!;
      await tx.poLine.update({ where: { id: line.id }, data: { receivedKg: { increment: qty } } });
    }

    return { grn, bundles: createdBundles };
  }, { isolationLevel: "Serializable" });
}
