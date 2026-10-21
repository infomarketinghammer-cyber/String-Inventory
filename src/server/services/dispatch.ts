/**
 * Dispatch against customer schedule (T15), FIFO by FG Lot — Section 4.9.
 * Validation #10: dispatch <= FG available for Part AND <= schedule balance.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { writeLedger } from "./ledger";
import { fifoPick, type FifoPoolUnit } from "./fifo";
import { genDispatchNo, genCustomerReturnNo, genRejectionNo } from "./docNumber";
import { getLocationByName, LOCATION_NAMES } from "./locations";

type Tx = Prisma.TransactionClient | PrismaClient;

async function loadFgPool(tx: Tx, partId: string): Promise<FifoPoolUnit[]> {
  const rows = await tx.fgLot.findMany({
    where: { partId, status: "AVAILABLE", balanceNos: { gt: 0 } },
    orderBy: [{ inwardDate: "asc" }, { fgLotNo: "asc" }],
  });
  return rows.map((f) => ({ id: f.id, number: f.fgLotNo, inwardDate: f.inwardDate, balance: f.balanceNos }));
}

export async function suggestFifoForSchedule(scheduleId: string) {
  const schedule = await prisma.customerSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
  const pool = await loadFgPool(prisma, schedule.partId);
  const remaining = schedule.qtyNos - schedule.dispatchedNos;
  return { schedule, suggestion: fifoPick(pool, remaining) };
}

export async function createDispatch(params: {
  scheduleId: string;
  qtyNos: number;
  invoiceNo: string;
  vehicleNo?: string;
  packingDetails?: string;
  userId: string;
  adminOverride?: boolean;
}) {
  if (params.qtyNos <= 0) throw new ValidationError("Dispatch quantity must be positive.");

  return prisma.$transaction(async (tx) => {
    const schedule = await tx.customerSchedule.findUniqueOrThrow({ where: { id: params.scheduleId } });
    const scheduleBalance = schedule.qtyNos - schedule.dispatchedNos;
    if (params.qtyNos > scheduleBalance + 1e-6 && !params.adminOverride) {
      throw new ValidationError(
        `Dispatch qty (${params.qtyNos}) exceeds schedule balance (${scheduleBalance}). Admin approval required to over-dispatch.`,
      );
    }

    const pool = await loadFgPool(tx, schedule.partId);
    const totalAvailable = pool.reduce((s, u) => s + u.balance, 0);
    if (params.qtyNos > totalAvailable + 1e-6) {
      throw new ValidationError(
        `Dispatch qty (${params.qtyNos}) exceeds FG available (${totalAvailable}) for this Part.`,
      );
    }

    const result = fifoPick(pool, params.qtyNos);
    if (!result.fullyCovered) {
      throw new ValidationError("Insufficient FG stock to cover dispatch quantity.");
    }

    const date = new Date();
    const dispatchNo = await genDispatchNo(tx, date);
    const dispatch = await tx.dispatch.create({
      data: {
        dispatchNo,
        date,
        customerId: schedule.customerId,
        invoiceNo: params.invoiceNo,
        vehicleNo: params.vehicleNo,
        packingDetails: params.packingDetails?.trim() || null,
        createdById: params.userId,
      },
    });

    for (const pick of result.picks) {
      const fgLot = await tx.fgLot.findUniqueOrThrow({ where: { id: pick.id } });
      const newBalance = fgLot.balanceNos - pick.qtyPicked;
      if (newBalance < 0) throw new ValidationError("No negative FG stock allowed.");
      await tx.fgLot.update({
        where: { id: fgLot.id },
        data: { balanceNos: newBalance, status: newBalance === 0 ? "CONSUMED" : "AVAILABLE" },
      });
      await tx.dispatchLine.create({
        data: {
          dispatchId: dispatch.id,
          scheduleId: schedule.id,
          fgLotId: fgLot.id,
          qtyNos: pick.qtyPicked,
        },
      });
      await writeLedger(tx, {
        txnType: "T15_DISPATCH",
        txnDate: date,
        docNo: dispatchNo,
        itemType: "FG",
        refNo: fgLot.fgLotNo,
        fromStatus: "AVAILABLE",
        qty: pick.qtyPicked,
        uom: "nos",
        userId: params.userId,
      });
    }

    await tx.customerSchedule.update({
      where: { id: schedule.id },
      data: { dispatchedNos: { increment: params.qtyNos } },
    });

    return dispatch;
  }, { isolationLevel: "Serializable" });
}

/** T16 — customer return received into Rejected-FG (Section 4.10, 10.Q10). */
export async function createCustomerReturn(params: {
  dispatchNo: string;
  fgLotNo: string;
  qtyNos: number;
  reasonCodeId: string;
  userId: string;
}) {
  if (!params.reasonCodeId) throw new ValidationError("Reason code is mandatory for customer returns.");
  if (!Number.isInteger(params.qtyNos) || params.qtyNos <= 0) {
    throw new ValidationError("Return quantity must be a positive whole number.");
  }
  return prisma.$transaction(async (tx) => {
    // Received against the original Dispatch Note and FG Lot (SOP 4.10).
    const dispatch = await tx.dispatch.findUnique({ where: { dispatchNo: params.dispatchNo.trim() } });
    if (!dispatch) throw new ValidationError("Dispatch Note not found.");
    const fgLot = await tx.fgLot.findUnique({ where: { fgLotNo: params.fgLotNo.trim() } });
    if (!fgLot) throw new ValidationError("FG Lot not found.");
    const lines = await tx.dispatchLine.findMany({ where: { dispatchId: dispatch.id, fgLotId: fgLot.id } });
    if (lines.length === 0) throw new ValidationError(`FG Lot ${fgLot.fgLotNo} was not part of ${dispatch.dispatchNo}.`);

    const dispatched = lines.reduce((s, l) => s + l.qtyNos, 0);
    const earlier = await tx.rejection.aggregate({
      _sum: { qty: true },
      where: { stage: "CUSTOMER_RETURN", refType: "FG_LOT", refId: fgLot.id },
    });
    const alreadyReturned = Number(earlier._sum.qty ?? 0);
    if (params.qtyNos > dispatched - alreadyReturned) {
      throw new ValidationError(
        `Return qty exceeds what was dispatched on this note (${dispatched} dispatched, ${alreadyReturned} already returned).`,
      );
    }

    const date = new Date();
    const rejLoc = await getLocationByName(tx, LOCATION_NAMES.REJECTION_FG);
    const crnNo = await genCustomerReturnNo(tx, date);
    await writeLedger(tx, {
      txnType: "T16_CUSTOMER_RETURN",
      docNo: crnNo,
      itemType: "FG",
      refNo: fgLot.fgLotNo,
      toLocationId: rejLoc.id,
      toStatus: "REJECTED",
      qty: params.qtyNos,
      uom: "nos",
      userId: params.userId,
      reason: `${dispatch.dispatchNo}: ${params.reasonCodeId}`,
    });
    return tx.rejection.create({
      data: {
        rejNo: await genRejectionNo(tx, date),
        stage: "CUSTOMER_RETURN",
        refType: "FG_LOT",
        refId: fgLot.id,
        qty: params.qtyNos,
        uom: "nos",
        reasonCodeId: params.reasonCodeId,
        disposal: "PENDING",
        createdById: params.userId,
      },
    });
  }, { isolationLevel: "Serializable" });
}
