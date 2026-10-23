/**
 * Job work challan summary: one original challan, any number of return batches (JW In Receipt lines), and
 * independent QC per batch. Everything here is derived from saved records (challan lines, receipt lines,
 * QC entries, rejections), never stored twice, so the figures always reconcile:
 *
 *   outstanding with vendor = dispatched − received good − rejected by vendor − short / written off
 *   pending QC (per batch)  = received − QC passed − QC rejected
 *
 * Primary status (vendor side first, then QC, then disposal):
 *   Awaiting Vendor Return · Partially Returned · QC Pending · QC In Progress · Rejections Pending Disposal · Completed
 * with secondary indicators (awaiting QC, outstanding, passed, rejected, overdue) shown beside it.
 */
import { prisma } from "@/lib/prisma";

export type ChallanPrimaryStatus =
  | "Awaiting Vendor Return"
  | "Partially Returned"
  | "QC Pending"
  | "QC In Progress"
  | "Rejections Pending Disposal"
  | "Completed";

export interface ReturnBatch {
  id: string; // receipt line id
  batchNo: string; // receipt no. (JWI-…), the batch ID shown to users
  receiptId: string;
  date: Date;
  vendorDcNo: string | null;
  remarks: string | null;
  lotNo: string; // lot sent on the challan line
  challanLineId: string;
  received: number;
  rejectedByVendor: number;
  short: number;
  qcLotId: string | null;
  qcLotNo: string | null;
  qcPassed: number;
  qcRejected: number;
  pendingQc: number;
  /** false for batches received before batch QC tracking existed (their QC, if any, is in the lot history). */
  tracked: boolean;
  qcStatus: "No pieces to inspect" | "Awaiting QC" | "QC In Progress" | "QC Complete" | "Before batch tracking";
  lastInspection: { by: string; at: Date } | null;
  inspections: { at: Date; by: string; accepted: number; rejected: number; reason: string | null; remarks: string | null }[];
}

export interface ChallanSummary {
  challan: { id: string; challanNo: string; date: Date; expectedReturnDate: Date; vehicleNo: string | null; dbStatus: string; closedWithShortageReason: string | null };
  vendor: { name: string; gstin: string | null; address: string | null };
  lines: { id: string; lotId: string; lotNo: string; partNo: string; opSeq: number; opName: string; dispatched: number; received: number; rejectedByVendor: number; short: number; outstanding: number }[];
  batches: ReturnBatch[];
  totals: {
    dispatched: number;
    returned: number; // received good
    rejectedByVendor: number;
    short: number;
    outstanding: number;
    pendingQc: number;
    qcPassed: number;
    qcRejected: number;
    rejectedPendingDisposal: number;
  };
  status: ChallanPrimaryStatus;
  indicators: string[];
  overdue: boolean;
}

export async function challanSummary(challanId: string): Promise<ChallanSummary | null> {
  const c = await prisma.jwOutChallan.findUnique({
    where: { id: challanId },
    include: {
      vendor: true,
      lines: { include: { lot: { include: { part: { include: { bomLines: true } } } } } },
      receipts: {
        include: { lines: { include: { qcEntries: { orderBy: { createdAt: "asc" } } } } },
        orderBy: [{ date: "asc" }, { receiptNo: "asc" }],
      },
    },
  });
  if (!c) return null;

  const lines = c.lines.map((l) => ({
    id: l.id,
    lotId: l.lotId,
    lotNo: l.lot.lotNo,
    partNo: l.lot.part.partNo,
    opSeq: l.opSeq,
    opName: l.lot.part.bomLines.find((b) => b.opSeq === l.opSeq)?.opName ?? `Op ${l.opSeq}`,
    dispatched: l.qtyNos,
    received: l.receivedNos,
    rejectedByVendor: l.rejectedNos,
    short: l.shortNos,
    outstanding: Math.max(0, l.qtyNos - l.receivedNos - l.rejectedNos - l.shortNos),
  }));

  const qcLotIds = c.receipts.flatMap((r) => r.lines.map((l) => l.qcLotId).filter((x): x is string => !!x));
  const userIds = c.receipts.flatMap((r) => r.lines.flatMap((l) => l.qcEntries.map((e) => e.inspectedById)));
  const [qcLots, users, reasons] = await Promise.all([
    prisma.productionLot.findMany({ where: { id: { in: qcLotIds } }, select: { id: true, lotNo: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true } }),
    prisma.reasonCode.findMany({ select: { id: true, code: true } }),
  ]);
  const lotNo = new Map(qcLots.map((l) => [l.id, l.lotNo]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const reasonCode = new Map(reasons.map((r) => [r.id, r.code]));

  const batches: ReturnBatch[] = [];
  for (const r of c.receipts) {
    for (const rl of r.lines) {
      const line = lines.find((l) => l.id === rl.challanLineId);
      const qcPassed = rl.qcEntries.reduce((s, e) => s + e.acceptedNos, 0);
      const qcRejected = rl.qcEntries.reduce((s, e) => s + e.rejectedNos, 0);
      const tracked = !!rl.qcLotId || rl.receivedNos === 0;
      const pendingQc = tracked ? Math.max(0, rl.receivedNos - qcPassed - qcRejected) : 0;
      const last = rl.qcEntries[rl.qcEntries.length - 1];
      batches.push({
        id: rl.id,
        batchNo: r.receiptNo,
        receiptId: r.id,
        date: r.date,
        vendorDcNo: r.vendorDcNo,
        remarks: r.remarks,
        lotNo: line?.lotNo ?? "-",
        challanLineId: rl.challanLineId,
        received: rl.receivedNos,
        rejectedByVendor: rl.rejectedNos,
        short: rl.shortNos,
        qcLotId: rl.qcLotId,
        qcLotNo: rl.qcLotId ? (lotNo.get(rl.qcLotId) ?? null) : null,
        qcPassed,
        qcRejected,
        pendingQc,
        tracked,
        qcStatus:
          rl.receivedNos === 0
            ? "No pieces to inspect"
            : !tracked
              ? "Before batch tracking"
              : pendingQc === 0
                ? "QC Complete"
                : qcPassed + qcRejected > 0
                  ? "QC In Progress"
                  : "Awaiting QC",
        lastInspection: last ? { by: userName.get(last.inspectedById) ?? "-", at: last.createdAt } : null,
        inspections: rl.qcEntries.map((e) => ({
          at: e.createdAt,
          by: userName.get(e.inspectedById) ?? "-",
          accepted: e.acceptedNos,
          rejected: e.rejectedNos,
          reason: e.reasonCodeId ? (reasonCode.get(e.reasonCodeId) ?? null) : null,
          remarks: e.remarks,
        })),
      });
    }
  }

  // Rejections still awaiting a decision (rework / return to vendor / scrap) for this challan's lots and batches.
  const lotIds = [...new Set([...lines.map((l) => l.lotId), ...qcLotIds])];
  const pendingRej = await prisma.rejection.aggregate({
    _sum: { qty: true },
    where: { stage: "JW_RETURN", refType: "LOT", refId: { in: lotIds }, disposal: "PENDING", createdAt: { gte: c.date } },
  });

  const sum = (f: (x: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + f(l), 0);
  const totals = {
    dispatched: sum((l) => l.dispatched),
    returned: sum((l) => l.received),
    rejectedByVendor: sum((l) => l.rejectedByVendor),
    short: sum((l) => l.short),
    outstanding: sum((l) => l.outstanding),
    pendingQc: batches.reduce((s, b) => s + b.pendingQc, 0),
    qcPassed: batches.reduce((s, b) => s + b.qcPassed, 0),
    qcRejected: batches.reduce((s, b) => s + b.qcRejected, 0),
    rejectedPendingDisposal: Math.round(Number(pendingRej._sum.qty ?? 0)),
  };

  const anyBack = totals.returned + totals.rejectedByVendor + totals.short > 0;
  const anyInspected = totals.qcPassed + totals.qcRejected > 0;
  let status: ChallanPrimaryStatus;
  if (totals.outstanding > 0) status = anyBack ? "Partially Returned" : "Awaiting Vendor Return";
  else if (totals.pendingQc > 0) status = anyInspected ? "QC In Progress" : "QC Pending";
  else if (totals.rejectedPendingDisposal > 0) status = "Rejections Pending Disposal";
  else status = "Completed";

  const overdue = totals.outstanding > 0 && c.expectedReturnDate < new Date();
  const n = (x: number) => x.toLocaleString("en-IN");
  const indicators = [
    totals.pendingQc > 0 ? `${n(totals.pendingQc)} pcs awaiting QC` : "",
    totals.outstanding > 0 ? `${n(totals.outstanding)} pcs outstanding with vendor` : "",
    totals.qcPassed > 0 ? `${n(totals.qcPassed)} pcs QC passed` : "",
    totals.qcRejected + totals.rejectedByVendor > 0 ? `${n(totals.qcRejected + totals.rejectedByVendor)} pcs rejected` : "",
    totals.rejectedPendingDisposal > 0 ? `${n(totals.rejectedPendingDisposal)} pcs awaiting disposal` : "",
    overdue ? "Overdue" : "",
  ].filter(Boolean);

  return {
    challan: {
      id: c.id,
      challanNo: c.challanNo,
      date: c.date,
      expectedReturnDate: c.expectedReturnDate,
      vehicleNo: c.vehicleNo,
      dbStatus: c.status,
      closedWithShortageReason: c.closedWithShortageReason,
    },
    vendor: { name: c.vendor.name, gstin: c.vendor.gstin, address: c.vendor.address },
    lines,
    batches,
    totals,
    status,
    indicators,
    overdue,
  };
}
