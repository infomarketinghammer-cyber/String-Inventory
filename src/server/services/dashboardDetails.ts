/**
 * Drill-down data behind each dashboard KPI card.
 * Every detail lists the source records that make up the card's number, and re-derives each
 * record's quantity from the StockLedger (single source of truth) so the user can see the
 * figure is valid. Read-only — no stock movement happens here.
 */
import type { StockLedger } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { netIssuedKg } from "./issue";

export type CardKey = "rm-available" | "quality-hold" | "at-jobwork" | "fg-available" | "open-mrns" | "open-challans";

export const CARDS: Record<CardKey, { label: string; source: string }> = {
  "rm-available": {
    label: "RM Available (kg)",
    source: "Sum of the balance kg of every bundle in status Available (RM Stores).",
  },
  "quality-hold": {
    label: "Bundles in Quality Hold",
    source: "Count of bundles received on a GRN and still waiting for an approved IQC decision.",
  },
  "at-jobwork": {
    label: "Lots At Job Worker",
    source: "Count of production lots sent out on a JW Out Challan and not yet received back.",
  },
  "fg-available": {
    label: "FG Available (nos)",
    source: "Sum of the balance nos of every FG lot in status Available (FG Stores).",
  },
  "open-mrns": {
    label: "Open/Partial MRNs",
    source: "Count of MRNs whose required kg has not been fully issued yet.",
  },
  "open-challans": {
    label: "Open JW Challans",
    source: "Count of JW Out Challans that are Open or Partially Received.",
  },
};

export const isCardKey = (k: string): k is CardKey => k in CARDS;

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const sumOf = (rows: StockLedger[], type: string) =>
  rows.filter((r) => r.txnType === type).reduce((s, r) => s + Number(r.qty), 0);

/** Ledger rows grouped by refNo (bundle / lot / FG lot number), oldest first. */
async function ledgerFor(refNos: string[]) {
  const rows = refNos.length
    ? await prisma.stockLedger.findMany({
        where: { refNo: { in: refNos } },
        include: { user: { select: { name: true } } },
        orderBy: { txnDate: "asc" },
      })
    : [];
  const map = new Map<string, typeof rows>();
  for (const r of rows) map.set(r.refNo, [...(map.get(r.refNo) ?? []), r]);
  return map;
}

/** Same formula as `npm run db:verify`: received + returned + adjusted - issued - returned to supplier - scrapped. */
function bundleLedgerBalance(rows: StockLedger[]) {
  const received = sumOf(rows, "T1_GRN");
  const issued = sumOf(rows, "T5_ISSUE");
  const returned = sumOf(rows, "T6_RETURN_TO_STORES");
  const adjusted = sumOf(rows, "T17_ADJUSTMENT");
  const left = sumOf(rows, "T4_RTS") + sumOf(rows, "T14_SCRAP");
  return { received, issued, returned, adjusted, left, balance: round(received - issued + returned + adjusted - left) };
}

/** Status the ledger says the record is in: the target status of its latest status-changing movement. */
function ledgerStatus(rows: StockLedger[]) {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.toStatus) return rows[i]!.toStatus;
  return null;
}

async function userNames(ids: string[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function rmAvailableDetail() {
  const bundles = await prisma.bundle.findMany({
    where: { status: "AVAILABLE" },
    include: { item: true, location: true, grn: { include: { po: { include: { supplier: true } } } }, iqc: true },
    orderBy: [{ inwardDate: "asc" }, { bundleNo: "asc" }],
  });
  const ledger = await ledgerFor(bundles.map((b) => b.bundleNo));
  const rows = bundles.map((b) => {
    const moves = ledger.get(b.bundleNo) ?? [];
    const l = bundleLedgerBalance(moves);
    const balance = round(Number(b.balanceKg));
    return { bundle: b, ledger: l, moves, balance, valid: Math.abs(l.balance - balance) < 0.005 };
  });
  const cardValue = round(rows.reduce((s, r) => s + r.balance, 0));
  const ledgerTotal = round(rows.reduce((s, r) => s + r.ledger.balance, 0));

  const byItem = new Map<string, { item: string; bundles: number; kg: number }>();
  for (const r of rows) {
    const key = `${r.bundle.item.grade} ${Number(r.bundle.item.diameterMm)}mm`;
    const e = byItem.get(key) ?? { item: key, bundles: 0, kg: 0 };
    e.bundles += 1;
    e.kg = round(e.kg + r.balance);
    byItem.set(key, e);
  }
  return { rows, cardValue, ledgerTotal, byItem: [...byItem.values()] };
}

export async function qualityHoldDetail() {
  const bundles = await prisma.bundle.findMany({
    where: { status: "QUALITY_HOLD" },
    include: { item: true, location: true, grn: { include: { po: { include: { supplier: true } } } }, iqc: true },
    orderBy: [{ inwardDate: "asc" }, { bundleNo: "asc" }],
  });
  const ledger = await ledgerFor(bundles.map((b) => b.bundleNo));
  const now = Date.now();
  const rows = bundles.map((b) => {
    const moves = ledger.get(b.bundleNo) ?? [];
    const status = ledgerStatus(moves);
    const l = bundleLedgerBalance(moves);
    const kg = round(Number(b.balanceKg));
    return {
      bundle: b,
      moves,
      kg,
      daysInHold: Math.floor((now - b.inwardDate.getTime()) / 86400000),
      iqcState: !b.iqc ? "Not inspected" : b.iqc.approvedAt ? `Approved (${b.iqc.decision})` : `Awaiting approval (${b.iqc.decision})`,
      ledgerStatus: status,
      valid: status === "QUALITY_HOLD" && Math.abs(l.balance - kg) < 0.005,
    };
  });
  return {
    rows,
    cardValue: rows.length,
    totalKg: round(rows.reduce((s, r) => s + r.kg, 0)),
    ledgerCount: rows.filter((r) => r.ledgerStatus === "QUALITY_HOLD").length,
  };
}

export async function atJobWorkDetail() {
  const lots = await prisma.productionLot.findMany({
    where: { status: "AT_JOB_WORK" },
    include: {
      part: true,
      mrn: true,
      location: true,
      jwChallanLines: {
        include: { challan: { include: { vendor: true, receipts: true } }, JwReceiptLine: true },
        orderBy: { challan: { date: "desc" } },
      },
    },
    orderBy: { startDate: "asc" },
  });
  const ledger = await ledgerFor(lots.map((l) => l.lotNo));
  const now = Date.now();
  const rows = lots.map((lot) => {
    const moves = ledger.get(lot.lotNo) ?? [];
    // The challan line that sent the lot out and is still waiting for it.
    const line = lot.jwChallanLines.find((l) => l.qtyNos - l.receivedNos - l.rejectedNos - l.shortNos > 0) ?? lot.jwChallanLines[0];
    const pendingNos = line ? line.qtyNos - line.receivedNos - line.rejectedNos - line.shortNos : 0;
    const ledgerPendingNos = line ? jwLedgerPending(moves, line) : 0;
    const overdueDays = line ? Math.floor((now - line.challan.expectedReturnDate.getTime()) / 86400000) : 0;
    return {
      lot,
      line,
      pendingNos,
      ledgerPendingNos,
      overdueDays,
      moves,
      valid: !!line && pendingNos > 0 && ledgerPendingNos === pendingNos,
    };
  });
  return {
    rows,
    cardValue: rows.length,
    totalPendingNos: rows.reduce((s, r) => s + r.pendingNos, 0),
    totalLedgerPendingNos: rows.reduce((s, r) => s + r.ledgerPendingNos, 0),
    ledgerCount: rows.filter((r) => r.ledgerPendingNos > 0).length,
  };
}

/**
 * Pieces of a lot still at the job worker on one challan, from the ledger:
 * sent (T8 on the challan) − received back (T9 on its receipts) − rejected by the job worker (T12 on the challan)
 * − short. Shortages are not stock movements, so they come from the receipt lines.
 */
function jwLedgerPending(
  moves: StockLedger[],
  line: { qtyNos: number; challan: { challanNo: string; receipts: { receiptNo: string }[] }; JwReceiptLine: { shortNos: number }[] },
) {
  const receiptNos = new Set(line.challan.receipts.map((r) => r.receiptNo));
  const onChallan = (type: string) =>
    moves.filter((m) => m.txnType === type && m.docNo === line.challan.challanNo).reduce((s, m) => s + Number(m.qty), 0);
  const received = moves
    .filter((m) => m.txnType === "T9_JW_RECEIVE" && receiptNos.has(m.docNo))
    .reduce((s, m) => s + Number(m.qty), 0);
  const short = line.JwReceiptLine.reduce((s, r) => s + r.shortNos, 0);
  return onChallan("T8_JW_SEND") - received - onChallan("T12_REJECTION") - short;
}

export async function fgAvailableDetail() {
  const lots = await prisma.fgLot.findMany({
    where: { status: "AVAILABLE" },
    include: {
      part: { include: { customer: true } },
      sourceLot: { include: { finalInspections: true } },
      dispatchLines: { include: { dispatch: true } },
    },
    orderBy: [{ inwardDate: "asc" }, { fgLotNo: "asc" }],
  });
  const ledger = await ledgerFor(lots.map((l) => l.fgLotNo));
  const names = await userNames(lots.map((l) => l.approvedById));
  const rows = lots.map((fg) => {
    const moves = ledger.get(fg.fgLotNo) ?? [];
    const inward = sumOf(moves, "T11_FINAL_INSPECTION");
    const dispatched = sumOf(moves, "T15_DISPATCH");
    const ledgerBalance = inward - dispatched;
    const fqi = fg.sourceLot.finalInspections.find((f) => f.fgLotNo === fg.fgLotNo);
    return {
      fg,
      fqi,
      approvedBy: names.get(fg.approvedById) ?? "-",
      moves,
      inward,
      dispatched,
      ledgerBalance,
      valid: ledgerBalance === fg.balanceNos && inward === fg.qtyNos,
    };
  });
  return {
    rows,
    cardValue: rows.reduce((s, r) => s + r.fg.balanceNos, 0),
    ledgerTotal: rows.reduce((s, r) => s + r.ledgerBalance, 0),
  };
}

export async function openMrnsDetail() {
  const mrns = await prisma.mrn.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_ISSUED"] } },
    include: { part: true, issues: { include: { lines: true }, orderBy: { createdAt: "asc" } }, productionLots: true },
    orderBy: { createdAt: "asc" },
  });
  const names = await userNames(mrns.map((m) => m.createdById));
  const rows = [];
  for (const mrn of mrns) {
    const issuedKg = round(await netIssuedKg(prisma, mrn.id));
    const requiredKg = round(Number(mrn.requiredKg));
    const derived = issuedKg <= 0.005 ? "OPEN" : issuedKg >= requiredKg - 0.005 ? "CLOSED" : "PARTIALLY_ISSUED";
    rows.push({
      mrn,
      createdBy: names.get(mrn.createdById) ?? "-",
      requiredKg,
      issuedKg,
      balanceKg: round(requiredKg - issuedKg),
      derivedStatus: derived,
      valid: derived === mrn.status,
    });
  }
  return {
    rows,
    cardValue: rows.length,
    totalBalanceKg: round(rows.reduce((s, r) => s + r.balanceKg, 0)),
  };
}

export async function openChallansDetail() {
  const challans = await prisma.jwOutChallan.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
    include: {
      vendor: true,
      lines: { include: { lot: { include: { part: true } }, JwReceiptLine: true } },
      receipts: true,
    },
    orderBy: { expectedReturnDate: "asc" },
  });
  const ledger = await ledgerFor(challans.flatMap((c) => c.lines.map((l) => l.lot.lotNo)));
  const now = Date.now();
  const rows = challans.map((c) => {
    const lines = c.lines.map((l) => {
      const pending = l.qtyNos - l.receivedNos - l.rejectedNos - l.shortNos;
      const moves = ledger.get(l.lot.lotNo) ?? [];
      // Ledger cross-check: nos sent on this challan (T8) must equal the line quantity,
      // and what the ledger says is still at the vendor must equal the challan's pending quantity.
      const sentInLedger = moves
        .filter((m) => m.txnType === "T8_JW_SEND" && m.docNo === c.challanNo)
        .reduce((s, m) => s + Number(m.qty), 0);
      const ledgerPending = jwLedgerPending(moves, { ...l, challan: c });
      return {
        line: l,
        pending,
        sentInLedger,
        ledgerPending,
        valid: pending >= 0 && sentInLedger === l.qtyNos && ledgerPending === pending,
      };
    });
    const sent = lines.reduce((s, l) => s + l.line.qtyNos, 0);
    const back = lines.reduce((s, l) => s + l.line.receivedNos + l.line.rejectedNos + l.line.shortNos, 0);
    const pending = sent - back;
    return {
      challan: c,
      lines,
      sent,
      back,
      pending,
      overdueDays: Math.floor((now - c.expectedReturnDate.getTime()) / 86400000),
      // An open challan must still be waiting for something, and its lines must match the ledger.
      valid: pending > 0 && lines.every((l) => l.valid),
    };
  });
  return { rows, cardValue: rows.length, totalPendingNos: rows.reduce((s, r) => s + r.pending, 0) };
}
