"use client";

/**
 * Interactive tables of the dashboard detail pages. Each shows 5 default columns; the rest are
 * added with "+ Add columns". Row values are computed on the server; nothing is recalculated here
 * except column totals.
 */
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatKg, formatNos } from "@/lib/format";
import { Check, LedgerRow, Ref, type LedgerMove } from "./parts";
import { ColumnPicker, DataTable, useColumnSelection, type Column } from "./ColumnTable";

const total = <T,>(rows: T[], f: (r: T) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 100) / 100;
const kgTotal = <T,>(f: (r: T) => number) => (rows: T[]) => formatKg(total(rows, f));
const nosTotal = <T,>(f: (r: T) => number) => (rows: T[]) => formatNos(total(rows, f));
const Muted = ({ children }: { children: React.ReactNode }) => (
  <div className="text-xs" style={{ color: "var(--muted)" }}>
    {children}
  </div>
);
const ledgerDetail = <T extends { moves: LedgerMove[] },>(r: T, colSpan: number) => (
  <LedgerRow moves={r.moves} colSpan={colSpan} />
);

/** Picker + table, sharing one column selection. */
function PickerTable<T>(props: {
  storageKey: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  emptyText: string;
  detailRow?: (r: T, colSpan: number) => React.ReactNode;
  showTotal?: boolean;
}) {
  const selection = useColumnSelection(props.storageKey, props.columns);
  return (
    <>
      <ColumnPicker columns={props.columns} selection={selection} />
      <DataTable
        rows={props.rows}
        columns={selection.visible}
        rowKey={props.rowKey}
        detailRow={props.detailRow}
        emptyText={props.emptyText}
        showTotal={props.showTotal}
      />
    </>
  );
}

// ---------- RM Available: bundles ----------

export interface BundleRowData {
  id: string;
  bundleNo: string;
  item: string;
  heatNo: string;
  grnNo: string;
  poNo: string;
  invoiceNo: string;
  supplier: string;
  inwardDate: string;
  received: number;
  issued: number;
  returned: number;
  adjOut: number;
  balance: number;
  ledgerBalance: number;
  valid: boolean;
  moves: LedgerMove[];
}

export function BundlesTable({ rows, trace }: { rows: BundleRowData[]; trace: boolean }) {
  const columns: Column<BundleRowData>[] = [
    { key: "bundle", label: "Bundle", fixed: true, cell: (r) => <Ref no={r.bundleNo} trace={trace} /> },
    { key: "item", label: "Item", fixed: true, cell: (r) => r.item },
    { key: "heatNo", label: "Heat No.", cell: (r) => r.heatNo },
    {
      key: "grnPo",
      label: "GRN / PO",
      fixed: true,
      wrap: true,
      cell: (r) => (
        <>
          <div>{r.grnNo}</div>
          <Muted>
            {r.poNo} · Inv {r.invoiceNo}
          </Muted>
        </>
      ),
    },
    { key: "supplier", label: "Supplier", cell: (r) => r.supplier },
    { key: "inward", label: "Inward Date", cell: (r) => formatDate(r.inwardDate) },
    { key: "received", label: "Received (kg)", numeric: true, fixed: true, cell: (r) => formatKg(r.received), total: kgTotal((r) => r.received) },
    { key: "issued", label: "Issued (kg)", numeric: true, cell: (r) => formatKg(r.issued), total: kgTotal((r) => r.issued) },
    { key: "returned", label: "Returned (kg)", numeric: true, cell: (r) => formatKg(r.returned), total: kgTotal((r) => r.returned) },
    { key: "adjOut", label: "Adjustment / Out (kg)", numeric: true, cell: (r) => formatKg(r.adjOut), total: kgTotal((r) => r.adjOut) },
    {
      key: "balance",
      label: "Balance (kg)",
      numeric: true,
      fixed: true,
      cell: (r) => <span className="font-semibold">{formatKg(r.balance)}</span>,
      total: kgTotal((r) => r.balance),
    },
    { key: "ledger", label: "Ledger Balance (kg)", numeric: true, cell: (r) => formatKg(r.ledgerBalance), total: kgTotal((r) => r.ledgerBalance) },
    { key: "check", label: "Check", cell: (r) => <Check ok={r.valid} /> },
  ];
  return (
    <PickerTable
      storageKey="dashboard.rmBundles.columns"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      detailRow={ledgerDetail}
      emptyText="No bundles available."
      showTotal
    />
  );
}

// ---------- Quality Hold ----------

export interface HoldRowData {
  id: string;
  bundleNo: string;
  item: string;
  heatNo: string;
  grnNo: string;
  poNo: string;
  supplier: string;
  inwardDate: string;
  daysInHold: number;
  kg: number;
  iqcState: string;
  valid: boolean;
  ledgerStatus: string | null;
  moves: LedgerMove[];
}

export function QualityHoldTable({ rows, trace }: { rows: HoldRowData[]; trace: boolean }) {
  const columns: Column<HoldRowData>[] = [
    { key: "bundle", label: "Bundle", fixed: true, cell: (r) => <Ref no={r.bundleNo} trace={trace} /> },
    { key: "item", label: "Item", fixed: true, cell: (r) => r.item },
    { key: "heatNo", label: "Heat No.", cell: (r) => r.heatNo },
    {
      key: "grnPo",
      label: "GRN / PO",
      fixed: true,
      wrap: true,
      cell: (r) => (
        <>
          <div>{r.grnNo}</div>
          <Muted>{r.poNo}</Muted>
        </>
      ),
    },
    { key: "supplier", label: "Supplier", cell: (r) => r.supplier },
    { key: "inward", label: "Inward Date", cell: (r) => formatDate(r.inwardDate) },
    { key: "days", label: "Days on Hold", numeric: true, cell: (r) => r.daysInHold },
    { key: "kg", label: "Weight (kg)", numeric: true, fixed: true, cell: (r) => formatKg(r.kg), total: kgTotal((r) => r.kg) },
    { key: "iqc", label: "IQC", fixed: true, cell: (r) => r.iqcState },
    { key: "check", label: "Check", cell: (r) => <Check ok={r.valid} title={`Ledger status: ${r.ledgerStatus ?? "none"}`} /> },
  ];
  return (
    <PickerTable
      storageKey="dashboard.qualityHold.columns"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      detailRow={ledgerDetail}
      emptyText="No bundles in Quality Hold."
      showTotal
    />
  );
}

// ---------- Lots at Job Worker ----------

export interface JwLotRowData {
  id: string;
  lotNo: string;
  partNo: string;
  mrnNo: string;
  vendor: string;
  challanNo: string;
  sentDate: string | null;
  expectedDate: string | null;
  overdueDays: number;
  sentNos: number;
  pendingNos: number;
  ledgerPendingNos: number;
  valid: boolean;
  moves: LedgerMove[];
}

export function AtJobWorkTable({ rows, trace }: { rows: JwLotRowData[]; trace: boolean }) {
  const columns: Column<JwLotRowData>[] = [
    { key: "lot", label: "Lot", fixed: true, cell: (r) => <Ref no={r.lotNo} trace={trace} /> },
    { key: "part", label: "Part", fixed: true, cell: (r) => r.partNo },
    { key: "mrn", label: "MRN", cell: (r) => r.mrnNo },
    { key: "vendor", label: "Job Worker", fixed: true, cell: (r) => r.vendor },
    { key: "challan", label: "Challan", fixed: true, cell: (r) => r.challanNo },
    { key: "sent", label: "Sent Date", cell: (r) => formatDate(r.sentDate) },
    {
      key: "expected",
      label: "Expected Back",
      cell: (r) => (
        <>
          {formatDate(r.expectedDate)}
          {r.overdueDays > 0 && <span className="badge badge-rejected ml-1">{r.overdueDays}d overdue</span>}
        </>
      ),
    },
    { key: "sentNos", label: "Sent (nos)", numeric: true, cell: (r) => formatNos(r.sentNos), total: nosTotal((r) => r.sentNos) },
    {
      key: "pending",
      label: "Pending (nos)",
      numeric: true,
      fixed: true,
      cell: (r) => <span className="font-semibold">{formatNos(r.pendingNos)}</span>,
      total: nosTotal((r) => r.pendingNos),
    },
    {
      key: "ledger",
      label: "Pending per Ledger (nos)",
      numeric: true,
      cell: (r) => formatNos(r.ledgerPendingNos),
      total: nosTotal((r) => r.ledgerPendingNos),
    },
    { key: "check", label: "Check", cell: (r) => <Check ok={r.valid} /> },
  ];
  return (
    <PickerTable
      storageKey="dashboard.atJobWork.columns"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      detailRow={ledgerDetail}
      emptyText="No lots at a job worker."
      showTotal
    />
  );
}

// ---------- FG Available ----------

export interface FgRowData {
  id: string;
  fgLotNo: string;
  partNo: string;
  customer: string;
  sourceLotNo: string;
  fqiNo: string;
  approvedBy: string;
  inwardDate: string;
  inward: number;
  dispatched: number;
  dispatchNos: string;
  balance: number;
  ledgerBalance: number;
  valid: boolean;
  moves: LedgerMove[];
}

export function FgAvailableTable({ rows, trace }: { rows: FgRowData[]; trace: boolean }) {
  const columns: Column<FgRowData>[] = [
    { key: "fgLot", label: "FG Lot", fixed: true, cell: (r) => <Ref no={r.fgLotNo} trace={trace} /> },
    { key: "part", label: "Part", fixed: true, cell: (r) => r.partNo },
    { key: "customer", label: "Customer", fixed: true, cell: (r) => r.customer },
    { key: "source", label: "From Lot", cell: (r) => r.sourceLotNo },
    {
      key: "fqi",
      label: "Final Inspection",
      cell: (r) => (
        <>
          <div>{r.fqiNo}</div>
          <Muted>approved by {r.approvedBy}</Muted>
        </>
      ),
    },
    { key: "inwardDate", label: "Inward Date", cell: (r) => formatDate(r.inwardDate) },
    { key: "accepted", label: "Accepted (nos)", numeric: true, fixed: true, cell: (r) => formatNos(r.inward), total: nosTotal((r) => r.inward) },
    {
      key: "dispatched",
      label: "Dispatched (nos)",
      numeric: true,
      cell: (r) => (
        <>
          {formatNos(r.dispatched)}
          {r.dispatchNos && <Muted>{r.dispatchNos}</Muted>}
        </>
      ),
      total: nosTotal((r) => r.dispatched),
    },
    {
      key: "balance",
      label: "Balance (nos)",
      numeric: true,
      fixed: true,
      cell: (r) => <span className="font-semibold">{formatNos(r.balance)}</span>,
      total: nosTotal((r) => r.balance),
    },
    { key: "ledger", label: "Ledger Balance (nos)", numeric: true, cell: (r) => formatNos(r.ledgerBalance), total: nosTotal((r) => r.ledgerBalance) },
    { key: "check", label: "Check", cell: (r) => <Check ok={r.valid} /> },
  ];
  return (
    <PickerTable
      storageKey="dashboard.fgAvailable.columns"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      detailRow={ledgerDetail}
      emptyText="No FG stock available."
      showTotal
    />
  );
}

// ---------- Open MRNs ----------

export interface MrnRowData {
  id: string;
  mrnNo: string;
  date: string;
  partNo: string;
  createdBy: string;
  plannedNos: number;
  requiredKg: number;
  issuedKg: number;
  balanceKg: number;
  issueNos: string;
  status: string;
  derivedStatus: string;
  valid: boolean;
}

export function OpenMrnsTable({ rows }: { rows: MrnRowData[] }) {
  const columns: Column<MrnRowData>[] = [
    {
      key: "mrn",
      label: "MRN",
      fixed: true,
      cell: (r) => (
        <Link href={`/issue/${r.id}`} className="font-medium underline" style={{ color: "var(--brand)" }}>
          {r.mrnNo}
        </Link>
      ),
    },
    { key: "date", label: "Date", cell: (r) => formatDate(r.date) },
    { key: "part", label: "Part", fixed: true, cell: (r) => r.partNo },
    { key: "createdBy", label: "Raised By", cell: (r) => r.createdBy },
    { key: "planned", label: "Planned (nos)", numeric: true, cell: (r) => formatNos(r.plannedNos), total: nosTotal((r) => r.plannedNos) },
    { key: "required", label: "Required (kg)", numeric: true, fixed: true, cell: (r) => formatKg(r.requiredKg), total: kgTotal((r) => r.requiredKg) },
    { key: "issued", label: "Issued (kg)", numeric: true, cell: (r) => formatKg(r.issuedKg), total: kgTotal((r) => r.issuedKg) },
    {
      key: "balance",
      label: "Balance (kg)",
      numeric: true,
      fixed: true,
      cell: (r) => <span className="font-semibold">{formatKg(r.balanceKg)}</span>,
      total: kgTotal((r) => r.balanceKg),
    },
    { key: "issues", label: "Issues", wrap: true, cell: (r) => <span className="text-xs">{r.issueNos || "-"}</span> },
    { key: "status", label: "Status", fixed: true, cell: (r) => <StatusBadge status={r.status} /> },
    { key: "check", label: "Check", cell: (r) => <Check ok={r.valid} title={`Re-derived status: ${r.derivedStatus}`} /> },
  ];
  return (
    <PickerTable
      storageKey="dashboard.openMrns.columns"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      emptyText="No open MRNs."
      showTotal
    />
  );
}

// ---------- Open JW Challans (one picker for all challans) ----------

export interface ChallanLineData {
  id: string;
  lotNo: string;
  partNo: string;
  opSeq: number;
  sentNos: number;
  sentInLedger: number;
  receivedNos: number;
  rejectedNos: number;
  shortNos: number;
  pending: number;
  ledgerPending: number;
  valid: boolean;
}

export interface ChallanData {
  id: string;
  challanNo: string;
  vendor: string;
  date: string;
  expectedDate: string;
  overdueDays: number;
  status: string;
  valid: boolean;
  receipts: string;
  lines: ChallanLineData[];
}

export function OpenChallansTables({ challans, trace }: { challans: ChallanData[]; trace: boolean }) {
  const columns: Column<ChallanLineData>[] = [
    { key: "lot", label: "Lot", fixed: true, cell: (r) => <Ref no={r.lotNo} trace={trace} /> },
    { key: "part", label: "Part", fixed: true, cell: (r) => r.partNo },
    { key: "op", label: "Op", numeric: true, cell: (r) => r.opSeq },
    { key: "sent", label: "Sent (nos)", numeric: true, fixed: true, cell: (r) => formatNos(r.sentNos), total: nosTotal((r) => r.sentNos) },
    {
      key: "sentLedger",
      label: "Sent per Ledger (nos)",
      numeric: true,
      cell: (r) => formatNos(r.sentInLedger),
      total: nosTotal((r) => r.sentInLedger),
    },
    { key: "received", label: "Received (nos)", numeric: true, fixed: true, cell: (r) => formatNos(r.receivedNos), total: nosTotal((r) => r.receivedNos) },
    { key: "rejected", label: "Rejected (nos)", numeric: true, cell: (r) => formatNos(r.rejectedNos), total: nosTotal((r) => r.rejectedNos) },
    { key: "short", label: "Short (nos)", numeric: true, cell: (r) => formatNos(r.shortNos), total: nosTotal((r) => r.shortNos) },
    {
      key: "pending",
      label: "Pending (nos)",
      numeric: true,
      fixed: true,
      cell: (r) => <span className="font-semibold">{formatNos(r.pending)}</span>,
      total: nosTotal((r) => r.pending),
    },
    {
      key: "ledgerPending",
      label: "Pending per Ledger (nos)",
      numeric: true,
      cell: (r) => formatNos(r.ledgerPending),
      total: nosTotal((r) => r.ledgerPending),
    },
    { key: "check", label: "Check", cell: (r) => <Check ok={r.valid} /> },
  ];
  const selection = useColumnSelection("dashboard.openChallans.columns", columns);
  const showCheck = selection.extra.has("check");

  if (challans.length === 0) {
    return (
      <div className="card p-4 text-sm" style={{ color: "var(--muted)" }}>
        No open job work challans.
      </div>
    );
  }
  return (
    <>
      <div className="card p-4 pb-1">
        <ColumnPicker columns={columns} selection={selection} />
      </div>
      {challans.map((c) => (
        <div key={c.id} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <Link href={`/jobwork/challan/${c.id}`} className="font-semibold underline" style={{ color: "var(--brand)" }}>
                {c.challanNo}
              </Link>{" "}
              · {c.vendor} · sent {formatDate(c.date)} · expected back {formatDate(c.expectedDate)}{" "}
              {c.overdueDays > 0 && <span className="badge badge-rejected">{c.overdueDays}d overdue</span>}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={c.status} />
              {showCheck && <Check ok={c.valid} />}
            </div>
          </div>
          <DataTable rows={c.lines} columns={selection.visible} rowKey={(r) => r.id} emptyText="No lines." showTotal />
          {c.receipts && (
            <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
              Receipts: {c.receipts}
            </p>
          )}
        </div>
      ))}
    </>
  );
}
