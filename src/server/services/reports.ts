/**
 * Section 8 reports. Each takes an "as on" date. Bucket/aggregation logic lives here
 * (pure, testable); pages and the Excel/PDF export just render the result.
 *
 * RM and FG aging / stock are reconstructed from the Stock Ledger for the chosen as-on date
 * (quantity and status as they stood on that date). WIP lots have no per-lot quantity history
 * in the ledger, so WIP aging reports each lot's current state for lots started on/before the date.
 */
import { prisma } from "@/lib/prisma";
import { getAgingBuckets } from "./settings";

export type ItemKind = "RM" | "WIP" | "FG";

/** A report in a neutral table form: used by the pages, the Excel export and the PDF export. */
export interface ReportTable {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number)[][];
}

const DAY_MS = 86400000;

export function bucketLabels(buckets: number[]): string[] {
  const labels: string[] = [];
  let prev = -1;
  for (const b of buckets) {
    labels.push(`${prev + 1}-${b}`);
    prev = b;
  }
  labels.push(`over ${buckets[buckets.length - 1] ?? 0}`);
  return labels;
}

export function bucketFor(ageDays: number, buckets: number[]): string {
  const labels = bucketLabels(buckets);
  for (let i = 0; i < buckets.length; i++) {
    if (ageDays <= buckets[i]!) return labels[i]!;
  }
  return labels[labels.length - 1]!;
}

/** End of the chosen as-on day (the picker gives a date, so include everything on that day). */
export function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setUTCHours(23, 59, 59, 999);
  return e;
}

export function formatD(d: Date): string {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------- aging

export interface AgingRow {
  unitNo: string;
  identification: string;
  inwardDate: Date;
  qty: string;
  qtyValue: number;
  locationOrStatus: string;
  ageDays: number;
  bucketLabel: string;
}

export interface AgingFilters {
  status?: string; // RM: QUALITY_HOLD | AVAILABLE | REJECTED; WIP/FG: lot status
  grade?: string; // RM only
  partNo?: string; // WIP / FG
  customer?: string; // WIP / FG (customer name contains)
}

/** Per-bundle position as on a date, rebuilt from the ledger. */
function rmPositionAsOn(
  rows: { txnType: string; qty: unknown; toStatus: string | null; toLocationId: string | null; txnDate: Date }[],
) {
  let qty = 0;
  let status: string | null = null;
  let locationId: string | null = null;
  const sorted = [...rows].sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime());
  for (const r of sorted) {
    const q = Number(r.qty);
    switch (r.txnType) {
      case "T1_GRN":
      case "T6_RETURN_TO_STORES":
      case "T17_ADJUSTMENT":
        qty += q;
        break;
      case "T5_ISSUE":
      case "T4_RTS":
      case "T14_SCRAP":
        qty -= q;
        break;
    }
    if (["T1_GRN", "T2_IQC_ACCEPT", "T3_IQC_REJECT"].includes(r.txnType) && r.toStatus) {
      status = r.toStatus;
      locationId = r.toLocationId ?? locationId;
    }
  }
  return { qty, status, locationId };
}

export async function agingReport(asOnInput: Date, itemType: ItemKind, filters: AgingFilters = {}) {
  const asOn = endOfDay(asOnInput);
  const buckets = await getAgingBuckets();
  const labels = bucketLabels(buckets);
  const rows: AgingRow[] = [];
  const push = (r: Omit<AgingRow, "ageDays" | "bucketLabel">, from: Date) => {
    const ageDays = Math.max(0, Math.floor((asOn.getTime() - from.getTime()) / DAY_MS));
    rows.push({ ...r, ageDays, bucketLabel: bucketFor(ageDays, buckets) });
  };

  if (itemType === "RM") {
    const locations = new Map((await prisma.location.findMany()).map((l) => [l.id, l.name]));
    const bundles = await prisma.bundle.findMany({
      where: { inwardDate: { lte: asOn }, ...(filters.grade ? { item: { grade: filters.grade } } : {}) },
      include: { item: true },
    });
    const ledger = await prisma.stockLedger.findMany({
      where: { itemType: "RM", refNo: { in: bundles.map((b) => b.bundleNo) }, txnDate: { lte: asOn } },
    });
    const byBundle = new Map<string, typeof ledger>();
    for (const l of ledger) byBundle.set(l.refNo, [...(byBundle.get(l.refNo) ?? []), l]);

    for (const b of bundles) {
      const rowsFor = byBundle.get(b.bundleNo) ?? [];
      let qty: number;
      let status: string;
      let location: string;
      if (rowsFor.some((r) => r.txnType === "T1_GRN")) {
        const pos = rmPositionAsOn(rowsFor);
        qty = Math.round(pos.qty * 100) / 100;
        status = pos.status ?? b.status;
        location = (pos.locationId && locations.get(pos.locationId)) || locations.get(b.locationId) || "";
      } else {
        // No GRN ledger row (legacy data): fall back to current state.
        qty = Number(b.balanceKg);
        status = b.status;
        location = locations.get(b.locationId) ?? "";
      }
      if (qty <= 1e-6) continue; // nothing on hand on that date
      if (filters.status && status !== filters.status) continue;
      push(
        {
          unitNo: b.bundleNo,
          identification: `${b.item.grade} ${Number(b.item.diameterMm)}mm / Heat ${b.heatNo}`,
          inwardDate: b.inwardDate,
          qty: `${qty.toFixed(2)} kg`,
          qtyValue: qty,
          locationOrStatus: `${location} / ${status}`,
        },
        b.inwardDate,
      );
    }
  } else if (itemType === "WIP") {
    const lots = await prisma.productionLot.findMany({
      where: {
        startDate: { lte: asOn },
        status: filters.status ? (filters.status as never) : { not: "CLOSED" },
        ...(filters.partNo ? { part: { partNo: filters.partNo } } : {}),
        ...(filters.customer ? { part: { customer: { name: { contains: filters.customer } } } } : {}),
      },
      include: { part: { include: { customer: true } }, location: true },
    });
    for (const l of lots) {
      push(
        {
          unitNo: l.lotNo,
          identification: `${l.part.partNo} / ${l.part.customer.name} / op ${l.currentOpSeq}`,
          inwardDate: l.startDate,
          qty: `${l.qtyNos} nos`,
          qtyValue: l.qtyNos,
          locationOrStatus: `${l.location.name} / ${l.status}`,
        },
        l.startDate,
      );
    }
  } else {
    const fgLots = await prisma.fgLot.findMany({
      where: {
        inwardDate: { lte: asOn },
        ...(filters.partNo ? { part: { partNo: filters.partNo } } : {}),
        ...(filters.customer ? { part: { customer: { name: { contains: filters.customer } } } } : {}),
      },
      include: { part: { include: { customer: true } } },
    });
    const ledger = await prisma.stockLedger.findMany({
      where: { itemType: "FG", refNo: { in: fgLots.map((f) => f.fgLotNo) }, txnDate: { lte: asOn } },
    });
    for (const f of fgLots) {
      const mine = ledger.filter((r) => r.refNo === f.fgLotNo);
      const qty = mine.some((r) => r.txnType === "T11_FINAL_INSPECTION")
        ? mine.reduce((s, r) => s + (r.txnType === "T11_FINAL_INSPECTION" ? Number(r.qty) : r.txnType === "T15_DISPATCH" ? -Number(r.qty) : 0), 0)
        : f.balanceNos;
      if (qty <= 0) continue;
      if (filters.status && filters.status !== "AVAILABLE") continue;
      push(
        {
          unitNo: f.fgLotNo,
          identification: `${f.part.partNo} / ${f.part.customer.name}`,
          inwardDate: f.inwardDate,
          qty: `${qty} nos`,
          qtyValue: qty,
          locationOrStatus: "FG Stores / AVAILABLE",
        },
        f.inwardDate,
      );
    }
  }

  rows.sort((a, b) => b.ageDays - a.ageDays);
  const bucketTotals = new Map<string, number>(labels.map((l) => [l, 0]));
  const bucketQty = new Map<string, number>(labels.map((l) => [l, 0]));
  for (const r of rows) {
    bucketTotals.set(r.bucketLabel, (bucketTotals.get(r.bucketLabel) ?? 0) + 1);
    bucketQty.set(r.bucketLabel, (bucketQty.get(r.bucketLabel) ?? 0) + r.qtyValue);
  }
  const topBucketLabel = labels[labels.length - 1]!;
  const unit = itemType === "RM" ? "kg" : "nos";

  const table: ReportTable = {
    title: `Inventory Aging – ${itemType}`,
    subtitle: `As on ${formatD(asOn)}. Buckets (days): ${labels.join(", ")}.`,
    columns: ["Unit no.", "Identification", "Inward date", `Qty (${unit})`, "Location / status", "Age (days)", "Bucket"],
    rows: rows.map((r) => [r.unitNo, r.identification, formatD(r.inwardDate), round(r.qtyValue), r.locationOrStatus, r.ageDays, r.bucketLabel]),
  };
  return { rows, bucketTotals, bucketQty, labels, topBucketLabel, unit, table };
}

// ---------------------------------------------------------------- job work

export async function jobWorkReport(asOnInput: Date = new Date()) {
  const asOn = endOfDay(asOnInput);
  const challans = await prisma.jwOutChallan.findMany({
    where: { date: { lte: asOn } },
    include: { vendor: true, lines: { include: { lot: { include: { part: true } } } } },
    orderBy: [{ vendorId: "asc" }, { date: "asc" }],
  });

  const lineRows = challans.flatMap((c) =>
    c.lines.map((line) => {
      const pending = line.qtyNos - line.receivedNos - line.rejectedNos - line.shortNos;
      const pendingKg = line.qtyNos > 0 ? (Number(line.qtyKg) * pending) / line.qtyNos : 0;
      const daysOutstanding = Math.floor((asOn.getTime() - c.date.getTime()) / DAY_MS);
      const daysOverdue = Math.max(0, Math.floor((asOn.getTime() - c.expectedReturnDate.getTime()) / DAY_MS));
      const closed = c.status === "CLOSED" || pending <= 0;
      const status = closed
        ? "Closed"
        : daysOverdue > 0
          ? "Overdue"
          : line.receivedNos + line.rejectedNos + line.shortNos > 0
            ? "Partially received"
            : "Open";
      return { challan: c, line, pending, pendingKg, daysOutstanding, daysOverdue: closed ? 0 : daysOverdue, status };
    }),
  );

  const byVendor = new Map<string, typeof lineRows>();
  for (const r of lineRows) byVendor.set(r.challan.vendor.name, [...(byVendor.get(r.challan.vendor.name) ?? []), r]);
  const vendorSummary = [...byVendor.entries()].map(([vendor, rs]) => {
    const open = rs.filter((r) => r.pending > 0 && r.challan.status !== "CLOSED");
    return {
      vendor,
      pendingNos: open.reduce((s, r) => s + r.pending, 0),
      pendingKg: open.reduce((s, r) => s + r.pendingKg, 0),
      oldestAge: open.reduce((m, r) => Math.max(m, r.daysOutstanding), 0),
      overdueCount: new Set(open.filter((r) => r.daysOverdue > 0).map((r) => r.challan.id)).size,
    };
  });

  const detail: ReportTable = {
    title: "Job Work Report (sent but not received)",
    subtitle: `As on ${formatD(asOn)}`,
    columns: ["Job worker", "Challan", "Challan date", "Lot", "Part no.", "Op", "Sent (nos)", "Sent (kg)", "Received", "Rejected", "Short", "Pending (nos)", "Pending (kg)", "Expected return", "Days outstanding", "Days overdue", "Status"],
    rows: lineRows.map((r) => [
      r.challan.vendor.name, r.challan.challanNo, formatD(r.challan.date), r.line.lot.lotNo, r.line.lot.part.partNo, r.line.opSeq,
      r.line.qtyNos, Number(r.line.qtyKg), r.line.receivedNos, r.line.rejectedNos, r.line.shortNos, r.pending,
      Number(r.pendingKg.toFixed(2)), formatD(r.challan.expectedReturnDate), r.daysOutstanding, r.daysOverdue, r.status,
    ]),
  };
  const summary: ReportTable = {
    title: "Job Work Summary by vendor",
    subtitle: `As on ${formatD(asOn)}`,
    columns: ["Job worker", "Pending (nos)", "Pending (kg)", "Oldest challan age (days)", "Overdue challans"],
    rows: vendorSummary.map((v) => [v.vendor, v.pendingNos, Number(v.pendingKg.toFixed(2)), v.oldestAge, v.overdueCount]),
  };
  return { lineRows, vendorSummary, detail, summary };
}

// ---------------------------------------------------------------- stock summary

/**
 * Opening / inward / outward / closing for the period, per wire item (RM, kg) and per Part (FG, nos),
 * straight from the Stock Ledger. Reversals are negative rows, so they net out automatically.
 */
export async function stockSummaryReport(fromInput: Date, toInput: Date) {
  const from = new Date(fromInput);
  from.setUTCHours(0, 0, 0, 0);
  const to = endOfDay(toInput);

  const rm = await prisma.stockLedger.findMany({
    where: { itemType: "RM", txnType: { in: ["T1_GRN", "T5_ISSUE", "T6_RETURN_TO_STORES", "T17_ADJUSTMENT", "T4_RTS", "T14_SCRAP"] }, txnDate: { lte: to } },
  });
  const fg = await prisma.stockLedger.findMany({
    where: { itemType: "FG", txnType: { in: ["T11_FINAL_INSPECTION", "T15_DISPATCH"] }, txnDate: { lte: to } },
  });
  const bundles = await prisma.bundle.findMany({ include: { item: true } });
  const itemOf = new Map(bundles.map((b) => [b.bundleNo, `${b.item.itemCode} (${b.item.grade} ${Number(b.item.diameterMm)}mm)`]));
  const fgLots = await prisma.fgLot.findMany({ include: { part: true } });
  const partOf = new Map(fgLots.map((f) => [f.fgLotNo, `${f.part.partNo} – ${f.part.description}`]));

  const acc = new Map<string, { kind: string; unit: string; opening: number; inward: number; outward: number }>();
  const add = (key: string, kind: string, unit: string, delta: number, when: Date) => {
    const e = acc.get(key) ?? { kind, unit, opening: 0, inward: 0, outward: 0 };
    if (when < from) e.opening += delta;
    else if (delta >= 0) e.inward += delta;
    else e.outward += -delta;
    acc.set(key, e);
  };
  const sign = (t: string) => (["T1_GRN", "T6_RETURN_TO_STORES", "T17_ADJUSTMENT", "T11_FINAL_INSPECTION"].includes(t) ? 1 : -1);
  for (const r of rm) add(itemOf.get(r.refNo) ?? r.refNo, "RM", "kg", sign(r.txnType) * Number(r.qty), r.txnDate);
  for (const r of fg) add(partOf.get(r.refNo) ?? r.refNo, "FG", "nos", sign(r.txnType) * Number(r.qty), r.txnDate);

  const rows = [...acc.entries()]
    .map(([name, v]) => ({ name, ...v, closing: v.opening + v.inward - v.outward }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const table: ReportTable = {
    title: "Stock Summary",
    subtitle: `${formatD(from)} to ${formatD(to)} (RM per wire item in kg, FG per Part in nos)`,
    columns: ["Type", "Item / Part", "UOM", "Opening", "Inward", "Outward", "Closing"],
    rows: rows.map((r) => [r.kind, r.name, r.unit, round(r.opening), round(r.inward), round(r.outward), round(r.closing)]),
  };
  return { rows, table };
}

const round = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- rejections

export async function rejectionReport(filters: { stage?: string; disposal?: string } = {}) {
  const rows = await prisma.rejection.findMany({
    where: { ...(filters.stage ? { stage: filters.stage as never } : {}), ...(filters.disposal ? { disposal: filters.disposal as never } : {}) },
    orderBy: { createdAt: "desc" },
  });
  const reasons = new Map((await prisma.reasonCode.findMany()).map((r) => [r.id, r]));

  const bundleIds = rows.filter((r) => r.refType === "BUNDLE").map((r) => r.refId);
  const lotIds = rows.filter((r) => r.refType === "LOT").map((r) => r.refId);
  const fgIds = rows.filter((r) => r.refType === "FG_LOT").map((r) => r.refId);
  const bundles = await prisma.bundle.findMany({ where: { id: { in: bundleIds } }, include: { grn: { include: { po: { include: { supplier: true } } } } } });
  const lots = await prisma.productionLot.findMany({ where: { id: { in: lotIds } }, include: { part: true, jwChallanLines: { include: { challan: { include: { vendor: true } } } } } });
  const fgs = await prisma.fgLot.findMany({ where: { id: { in: fgIds } }, include: { part: true } });

  const enriched = rows.map((r) => {
    let refNo = r.refId;
    let supplier = "";
    let jobWorker = "";
    let partNo = "";
    if (r.refType === "BUNDLE") {
      const b = bundles.find((x) => x.id === r.refId);
      refNo = b?.bundleNo ?? refNo;
      supplier = b?.grn.po.supplier.name ?? "";
    } else if (r.refType === "LOT") {
      const l = lots.find((x) => x.id === r.refId);
      refNo = l?.lotNo ?? refNo;
      partNo = l?.part.partNo ?? "";
      if (r.stage === "JW_RETURN") jobWorker = l?.jwChallanLines.at(-1)?.challan.vendor.name ?? "";
    } else {
      const f = fgs.find((x) => x.id === r.refId);
      refNo = f?.fgLotNo ?? refNo;
      partNo = f?.part.partNo ?? "";
    }
    const reason = reasons.get(r.reasonCodeId);
    return { ...r, refNo, supplier, jobWorker, partNo, reason, reasonCode: reason?.code ?? "" };
  });

  const table: ReportTable = {
    title: "Rejection Report",
    columns: ["Rej no.", "Date", "Stage", "Ref", "Part no.", "Supplier", "Job worker", "Qty", "UOM", "Reason", "Disposal"],
    rows: enriched.map((r) => [r.rejNo, formatD(r.createdAt), r.stage, r.refNo, r.partNo, r.supplier, r.jobWorker, Number(r.qty), r.uom, r.reasonCode, r.disposal]),
  };
  return { rows: enriched, table };
}

// ---------------------------------------------------------------- MRN / schedule

export async function mrnStatusReport() {
  return prisma.mrn.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_ISSUED"] } },
    include: { part: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function mrnStatusTable(): Promise<ReportTable> {
  const rows = await mrnStatusReport();
  const issued = await Promise.all(
    rows.map(async (m) => {
      const agg = await prisma.lotBundleLink.aggregate({ _sum: { kgConsumed: true }, where: { lot: { mrnId: m.id } } });
      return Number(agg._sum.kgConsumed ?? 0);
    }),
  );
  return {
    title: "MRN Status (open / partially issued)",
    columns: ["MRN no.", "Date", "Part no.", "Planned (nos)", "Required (kg)", "Issued (kg)", "Balance (kg)", "Status"],
    rows: rows.map((m, i) => [m.mrnNo, formatD(m.createdAt), m.part.partNo, m.plannedQtyNos, Number(m.requiredKg), round(issued[i]!), round(Number(m.requiredKg) - issued[i]!), m.status]),
  };
}

export async function scheduleVsDispatchReport() {
  const schedules = await prisma.customerSchedule.findMany({
    include: { customer: true, part: true },
    orderBy: { dueDate: "asc" },
  });
  const results = [];
  for (const s of schedules) {
    const fgAvailable = await prisma.fgLot.aggregate({
      _sum: { balanceNos: true },
      where: { partId: s.partId, status: "AVAILABLE" },
    });
    results.push({
      schedule: s,
      shortfall: Math.max(0, s.qtyNos - s.dispatchedNos),
      fgAvailable: fgAvailable._sum.balanceNos ?? 0,
    });
  }
  return results;
}

export async function scheduleVsDispatchTable(): Promise<ReportTable> {
  const rows = await scheduleVsDispatchReport();
  return {
    title: "Schedule vs Dispatch",
    columns: ["Customer", "Part no.", "Due date", "Scheduled (nos)", "Dispatched (nos)", "Short (nos)", "FG available (nos)"],
    rows: rows.map((r) => [r.schedule.customer.name, r.schedule.part.partNo, formatD(r.schedule.dueDate), r.schedule.qtyNos, r.schedule.dispatchedNos, r.shortfall, r.fgAvailable]),
  };
}
