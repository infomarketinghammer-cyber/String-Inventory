import Link from "next/link";
import { notFound } from "next/navigation";
import type { StockLedger } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { formatDate, formatKg } from "@/lib/format";
import {
  CARDS,
  isCardKey,
  rmAvailableDetail,
  qualityHoldDetail,
  atJobWorkDetail,
  fgAvailableDetail,
  openMrnsDetail,
  openChallansDetail,
} from "@/server/services/dashboardDetails";
import type { LedgerMove } from "./parts";
import {
  AtJobWorkTable,
  BundlesTable,
  FgAvailableTable,
  OpenChallansTables,
  OpenMrnsTable,
  QualityHoldTable,
} from "./CardTables";

type Move = StockLedger & { user: { name: string } };

/** Drill-down behind a dashboard KPI card: the source records behind the number. */
export default async function DashboardCardDetailPage(props: { params: Promise<{ card: string }> }) {
  const { card } = await props.params;
  if (!isCardKey(card)) notFound();
  const user = await requireUser();
  // Reference numbers open the Traceability Explorer for users who may use it.
  const trace = can(user, "reports.viewAll");
  const meta = CARDS[card];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm" style={{ color: "var(--brand)" }}>
          ← Back to dashboard
        </Link>
        <h1 className="text-xl font-semibold mt-1">{meta.label}: details</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          {meta.source}
        </p>
      </div>
      {card === "rm-available" && <RmAvailable trace={trace} />}
      {card === "quality-hold" && <QualityHold trace={trace} />}
      {card === "at-jobwork" && <AtJobWork trace={trace} />}
      {card === "fg-available" && <FgAvailable trace={trace} />}
      {card === "open-mrns" && <OpenMrns />}
      {card === "open-challans" && <OpenChallans trace={trace} />}
    </div>
  );
}

/** Ledger rows as plain values (Decimal/Date are not serializable into client components). */
function plain(moves: Move[]): LedgerMove[] {
  return moves.map((m) => ({
    id: m.id,
    txnDate: m.txnDate.toISOString(),
    txnType: m.txnType,
    docNo: m.docNo,
    fromStatus: m.fromStatus,
    toStatus: m.toStatus,
    qty: Number(m.qty),
    uom: m.uom,
    userName: m.user.name,
    reason: m.reason,
  }));
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
      {children}
    </p>
  );
}

// ---------- one section per card ----------

async function RmAvailable({ trace }: { trace: boolean }) {
  const d = await rmAvailableDetail();
  return (
    <>
      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-2">By grade / diameter</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-1">Item</th>
              <th className="text-right">Bundles</th>
              <th className="text-right">Available kg</th>
            </tr>
          </thead>
          <tbody>
            {d.byItem.map((i) => (
              <tr key={i.item}>
                <td className="py-1">{i.item}</td>
                <td className="text-right">{i.bundles}</td>
                <td className="text-right">{formatKg(i.kg)}</td>
              </tr>
            ))}
            {d.byItem.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3" style={{ color: "var(--muted)" }}>
                  No RM stock available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="card p-4">
        <h2 className="font-medium mb-1">Bundles (oldest first, FIFO order)</h2>
        <Note>
          Ledger balance = received (T1) + returned to stores (T6) + adjustments (T17) − issued (T5) − returned to
          supplier (T4) − scrapped (T14).
        </Note>
        <BundlesTable
          trace={trace}
          rows={d.rows.map((r) => ({
            id: r.bundle.id,
            bundleNo: r.bundle.bundleNo,
            item: `${r.bundle.item.grade} ${Number(r.bundle.item.diameterMm)}mm`,
            heatNo: r.bundle.heatNo,
            grnNo: r.bundle.grn.grnNo,
            poNo: r.bundle.grn.po.poNo,
            invoiceNo: r.bundle.grn.invoiceNo,
            supplier: r.bundle.grn.po.supplier.name,
            inwardDate: r.bundle.inwardDate.toISOString(),
            received: r.ledger.received,
            issued: r.ledger.issued,
            returned: r.ledger.returned,
            adjOut: r.ledger.adjusted - r.ledger.left,
            balance: r.balance,
            ledgerBalance: r.ledger.balance,
            valid: r.valid,
            moves: plain(r.moves),
          }))}
        />
      </div>
    </>
  );
}

async function QualityHold({ trace }: { trace: boolean }) {
  const d = await qualityHoldDetail();
  return (
    <div className="card p-4">
      <QualityHoldTable
        trace={trace}
        rows={d.rows.map((r) => ({
          id: r.bundle.id,
          bundleNo: r.bundle.bundleNo,
          item: `${r.bundle.item.grade} ${Number(r.bundle.item.diameterMm)}mm`,
          heatNo: r.bundle.heatNo,
          grnNo: r.bundle.grn.grnNo,
          poNo: r.bundle.grn.po.poNo,
          supplier: r.bundle.grn.po.supplier.name,
          inwardDate: r.bundle.inwardDate.toISOString(),
          daysInHold: r.daysInHold,
          kg: r.kg,
          iqcState: r.iqcState,
          valid: r.valid,
          ledgerStatus: r.ledgerStatus,
          moves: plain(r.moves),
        }))}
      />
    </div>
  );
}

async function AtJobWork({ trace }: { trace: boolean }) {
  const d = await atJobWorkDetail();
  return (
    <div className="card p-4">
      <Note>
        Pending per ledger = sent on the challan (T8) − received back (T9) − rejected by the job worker (T12) − short. A
        lot stays At Job Worker until nothing is pending on its challan line.
      </Note>
      <AtJobWorkTable
        trace={trace}
        rows={d.rows.map((r) => ({
          id: r.lot.id,
          lotNo: r.lot.lotNo,
          partNo: r.lot.part.partNo,
          mrnNo: r.lot.mrn.mrnNo,
          vendor: r.line?.challan.vendor.name ?? "-",
          challanNo: r.line?.challan.challanNo ?? "-",
          sentDate: iso(r.line?.challan.date),
          expectedDate: iso(r.line?.challan.expectedReturnDate),
          overdueDays: r.overdueDays,
          sentNos: r.line?.qtyNos ?? 0,
          pendingNos: r.pendingNos,
          ledgerPendingNos: r.ledgerPendingNos,
          valid: r.valid,
          moves: plain(r.moves),
        }))}
      />
    </div>
  );
}

async function FgAvailable({ trace }: { trace: boolean }) {
  const d = await fgAvailableDetail();
  return (
    <div className="card p-4">
      <Note>Ledger balance = accepted at final inspection (T11) − dispatched (T15).</Note>
      <FgAvailableTable
        trace={trace}
        rows={d.rows.map((r) => ({
          id: r.fg.id,
          fgLotNo: r.fg.fgLotNo,
          partNo: r.fg.part.partNo,
          customer: r.fg.part.customer.name,
          sourceLotNo: r.fg.sourceLot.lotNo,
          fqiNo: r.fqi?.fqiNo ?? "-",
          approvedBy: r.approvedBy,
          inwardDate: r.fg.inwardDate.toISOString(),
          inward: r.inward,
          dispatched: r.dispatched,
          dispatchNos: [...new Set(r.fg.dispatchLines.map((l) => l.dispatch.dispatchNo))].join(", "),
          balance: r.fg.balanceNos,
          ledgerBalance: r.ledgerBalance,
          valid: r.valid,
          moves: plain(r.moves),
        }))}
      />
    </div>
  );
}

async function OpenMrns() {
  const d = await openMrnsDetail();
  return (
    <div className="card p-4">
      <Note>
        Issued kg = wire held by the MRN&apos;s production lots (issues − returns to stores − reversals). Balance =
        required − issued.
      </Note>
      <OpenMrnsTable
        rows={d.rows.map((r) => ({
          id: r.mrn.id,
          mrnNo: r.mrn.mrnNo,
          date: r.mrn.createdAt.toISOString(),
          partNo: r.mrn.part.partNo,
          createdBy: r.createdBy,
          plannedNos: r.mrn.plannedQtyNos,
          requiredKg: r.requiredKg,
          issuedKg: r.issuedKg,
          balanceKg: r.balanceKg,
          issueNos: r.mrn.issues.map((i) => i.issueNo).join(", "),
          status: r.mrn.status,
          derivedStatus: r.derivedStatus,
          valid: r.valid,
        }))}
      />
    </div>
  );
}

async function OpenChallans({ trace }: { trace: boolean }) {
  const d = await openChallansDetail();
  return (
    <OpenChallansTables
      trace={trace}
      challans={d.rows.map((r) => ({
        id: r.challan.id,
        challanNo: r.challan.challanNo,
        vendor: r.challan.vendor.name,
        date: r.challan.date.toISOString(),
        expectedDate: r.challan.expectedReturnDate.toISOString(),
        overdueDays: r.overdueDays,
        status: r.challan.status,
        valid: r.valid,
        receipts: r.challan.receipts
          .map((x) => `${x.receiptNo} (${formatDate(x.date)})`)
          .join(", "),
        lines: r.lines.map((l) => ({
          id: l.line.id,
          lotNo: l.line.lot.lotNo,
          partNo: l.line.lot.part.partNo,
          opSeq: l.line.opSeq,
          sentNos: l.line.qtyNos,
          sentInLedger: l.sentInLedger,
          receivedNos: l.line.receivedNos,
          rejectedNos: l.line.rejectedNos,
          shortNos: l.line.shortNos,
          pending: l.pending,
          ledgerPending: l.ledgerPending,
          valid: l.valid,
        })),
      }))}
    />
  );
}
