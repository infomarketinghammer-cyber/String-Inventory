/**
 * Registers built on the same neutral ReportTable as the Section 8 reports, so the page,
 * Excel, CSV and PDF always show the same rows:
 *  - Issue Register (store record of every issue: what was issued, from which bundle, and the balance left)
 *  - PO Register (POs with ordered / received / balance per wire line — exported for IQC)
 *  - JW Out Challan (one challan as a document, for Excel / PDF export)
 */
import { prisma } from "@/lib/prisma";
import { endOfDay, formatD, type ReportTable } from "./reports";

const kg = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- issue register

export interface IssueRegisterFilters {
  from?: Date;
  to?: Date;
  /** MRN no., issue no., bundle no. or part no. (contains) */
  q?: string;
}

/** Inflow/outflow of a bundle's kg per ledger txn type (same rules as db:verify and the aging report). */
function bundleDelta(txnType: string, qty: number): number {
  if (txnType === "T1_GRN" || txnType === "T6_RETURN_TO_STORES" || txnType === "T17_ADJUSTMENT") return qty;
  if (txnType === "T5_ISSUE" || txnType === "T4_RTS" || txnType === "T14_SCRAP") return -qty;
  return 0;
}

export async function issueRegisterTable(f: IssueRegisterFilters = {}): Promise<ReportTable> {
  const q = f.q?.trim();
  const lines = await prisma.issueLine.findMany({
    where: {
      issue: {
        createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: endOfDay(f.to) } : {}) },
      },
      ...(q
        ? {
            OR: [
              { issue: { issueNo: { contains: q } } },
              { issue: { mrn: { mrnNo: { contains: q } } } },
              { issue: { mrn: { part: { partNo: { contains: q } } } } },
              { bundle: { bundleNo: { contains: q } } },
            ],
          }
        : {}),
    },
    include: {
      issue: { include: { mrn: { include: { part: true } } } },
      bundle: { include: { item: true } },
    },
    orderBy: [{ issue: { createdAt: "desc" } }],
  });

  // Balance of each bundle right after the issue, replayed from the ledger (single source of truth).
  const bundleNos = [...new Set(lines.map((l) => l.bundle.bundleNo))];
  const ledger = bundleNos.length
    ? await prisma.stockLedger.findMany({ where: { refNo: { in: bundleNos } }, orderBy: { txnDate: "asc" } })
    : [];
  const running = new Map<string, number>();
  const afterIssue = new Map<string, number>(); // `${issueNo}|${bundleNo}` -> balance after that issue
  for (const r of ledger) {
    const bal = (running.get(r.refNo) ?? 0) + bundleDelta(r.txnType, Number(r.qty));
    running.set(r.refNo, bal);
    if (r.txnType === "T5_ISSUE") afterIssue.set(`${r.docNo}|${r.refNo}`, kg(bal));
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.issue.issuedById))] } },
    select: { id: true, name: true },
  });
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const totalIssued = kg(lines.reduce((s, l) => s + Number(l.kgIssued), 0));
  return {
    title: "Issue Register",
    subtitle: `${lines.length} issue line(s), ${totalIssued.toFixed(2)} kg issued${
      f.from || f.to ? ` · ${f.from ? formatD(f.from) : "start"} to ${f.to ? formatD(f.to) : "today"}` : ""
    }. Balance after issue is replayed from the stock ledger.`,
    columns: [
      "Issue No.",
      "Date",
      "MRN No.",
      "Part No.",
      "RM (wire)",
      "Bundle No.",
      "Heat No.",
      "Issued (kg)",
      "Bundle balance after issue (kg)",
      "Bundle balance now (kg)",
      "Issued by",
      "FIFO override reason",
    ],
    rows: lines.map((l) => [
      l.issue.issueNo,
      formatD(l.issue.createdAt),
      l.issue.mrn.mrnNo,
      l.issue.mrn.part.partNo,
      `${l.bundle.item.itemCode} (${l.bundle.item.grade} ${Number(l.bundle.item.diameterMm)}mm)`,
      l.bundle.bundleNo,
      l.bundle.heatNo,
      kg(Number(l.kgIssued)).toFixed(2),
      (afterIssue.get(`${l.issue.issueNo}|${l.bundle.bundleNo}`) ?? 0).toFixed(2),
      kg(Number(l.bundle.balanceKg)).toFixed(2),
      userName.get(l.issue.issuedById) ?? "-",
      l.issue.overrideReason ?? "",
    ]),
  };
}

// ---------------------------------------------------------------- PO register

export interface PoRegisterFilters {
  supplierId?: string;
  /** OPEN = some line still has balance; CLOSED = fully received */
  status?: "OPEN" | "CLOSED";
  q?: string;
}

export async function poRegisterTable(f: PoRegisterFilters = {}): Promise<ReportTable> {
  const q = f.q?.trim();
  const pos = await prisma.po.findMany({
    where: {
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(q ? { OR: [{ poNo: { contains: q } }, { grns: { some: { grnNo: { contains: q } } } }] } : {}),
    },
    include: {
      supplier: true,
      lines: { include: { item: true } },
      grns: { include: { bundles: { select: { itemId: true } } }, orderBy: { grnDate: "asc" } },
    },
    orderBy: { poDate: "desc" },
  });
  const rows: (string | number)[][] = [];
  for (const po of pos) {
    const open = po.lines.some((l) => Number(l.orderedKg) - Number(l.receivedKg) > 0.005);
    if (f.status === "OPEN" && !open) continue;
    if (f.status === "CLOSED" && open) continue;
    for (const l of po.lines) {
      const ordered = kg(Number(l.orderedKg));
      const received = kg(Number(l.receivedKg));
      const grnNos = po.grns.filter((g) => g.bundles.some((b) => b.itemId === l.itemId)).map((g) => g.grnNo);
      rows.push([
        po.poNo,
        formatD(po.poDate),
        po.supplier.name,
        l.item.itemCode,
        l.item.grade,
        Number(l.item.diameterMm),
        ordered.toFixed(2),
        received.toFixed(2),
        kg(Math.max(0, ordered - received)).toFixed(2),
        grnNos.join(", "),
        ordered - received > 0.005 ? "Open" : "Fully received",
      ]);
    }
  }
  return {
    title: "Purchase Order Register",
    subtitle: `${rows.length} PO line(s). Ordered, received and balance per wire line, with the GRNs received against each.`,
    columns: [
      "PO No.",
      "PO date",
      "Supplier",
      "Item code",
      "Grade",
      "Diameter (mm)",
      "Ordered (kg)",
      "Received (kg)",
      "Balance (kg)",
      "GRN No(s).",
      "Line status",
    ],
    rows,
  };
}

// ---------------------------------------------------------------- JW Out Challan document

export async function jwChallanTable(challanId: string): Promise<ReportTable> {
  const challan = await prisma.jwOutChallan.findUnique({
    where: { id: challanId },
    include: {
      vendor: true,
      lines: { include: { lot: { include: { part: { include: { bomLines: true } } } } } },
    },
  });
  if (!challan) return { title: "Job Work Delivery Challan", subtitle: "Challan not found.", columns: [], rows: [] };
  const totalNos = challan.lines.reduce((s, l) => s + l.qtyNos, 0);
  const totalKg = kg(challan.lines.reduce((s, l) => s + Number(l.qtyKg), 0));
  return {
    title: `Job Work Delivery Challan ${challan.challanNo}`,
    subtitle: [
      `Date: ${formatD(challan.date)}`,
      `Job worker: ${challan.vendor.name}${challan.vendor.gstin ? ` (GSTIN ${challan.vendor.gstin})` : ""}`,
      challan.vendor.address ? `Address: ${challan.vendor.address}` : "",
      `Vehicle No.: ${challan.vehicleNo ?? "-"}`,
      `Expected return: ${formatD(challan.expectedReturnDate)}`,
      "Material sent for processing - remains our property",
    ]
      .filter(Boolean)
      .join(" | "),
    columns: ["#", "Production Lot", "Part No.", "Description", "Operation", "Qty (nos)", "Qty (kg)"],
    rows: [
      ...challan.lines.map((l, i) => {
        const op = l.lot.part.bomLines.find((b) => b.opSeq === l.opSeq);
        return [
          i + 1,
          l.lot.lotNo,
          l.lot.part.partNo,
          l.lot.part.description,
          op?.opName ?? `Op ${l.opSeq}`,
          l.qtyNos,
          kg(Number(l.qtyKg)).toFixed(2),
        ];
      }),
      ["", "", "", "", "Total", totalNos, totalKg.toFixed(2)],
    ],
  };
}
