import { randomUUID } from "crypto";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { Field, FIELD_INPUT } from "@/components/Field";
import { formatDate, formatNos } from "@/lib/format";
import { challanSummary, type ChallanPrimaryStatus, type ChallanSummary } from "@/server/services/jwChallan";
import { jwReturnQcAction } from "./actions";

/** Short status tags for the list (the full status is the tooltip and is shown on the challan page). */
const SHORT_STATUS: Record<ChallanPrimaryStatus, { label: string; cls: string }> = {
  "Awaiting Vendor Return": { label: "At vendor", cls: "badge-atjw" },
  "Partially Returned": { label: "Partial", cls: "badge-hold" },
  "QC Pending": { label: "QC pending", cls: "badge-hold" },
  "QC In Progress": { label: "In QC", cls: "badge-hold" },
  "Rejections Pending Disposal": { label: "Disposal", cls: "badge-rejected" },
  Completed: { label: "Done", cls: "badge-available" },
};

/**
 * JW In Receipt: every challan that still has material with the vendor or pieces waiting for QC.
 * Receipts (return batches) and batch QC are recorded on each challan's own page.
 */
export default async function JwInPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  await requireUser();
  const qcPendingLots = await prisma.productionLot.findMany({
    where: { status: "JW_RETURN_QC" },
    include: { part: true, parentLot: { select: { lotNo: true } } },
    orderBy: [{ startDate: "asc" }, { lotNo: "asc" }],
  });
  // Which challan / batch each lot in QC belongs to.
  const batchOf = new Map(
    (
      await prisma.jwReceiptLine.findMany({
        where: { qcLotId: { in: qcPendingLots.map((l) => l.id) } },
        include: { receipt: { include: { challan: true } } },
        orderBy: { receipt: { date: "desc" } },
      })
    ).map((rl) => [rl.qcLotId!, rl] as const),
  );
  const openIds = (await prisma.jwOutChallan.findMany({ where: { status: { not: "CLOSED" } }, select: { id: true } })).map((c) => c.id);
  const challanIds = [...new Set([...openIds, ...[...batchOf.values()].map((rl) => rl.receipt.challanId)])];
  const summaries = (await Promise.all(challanIds.map((id) => challanSummary(id)))).filter((x): x is ChallanSummary => !!x);
  summaries.sort((a, b) => a.challan.expectedReturnDate.getTime() - b.challan.expectedReturnDate.getTime());
  const legacyLots = qcPendingLots.filter((l) => !batchOf.has(l.id));
  const reasonCodes = await prisma.reasonCode.findMany({ where: { stage: "JW", active: true } });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Job Work — In Receipt &amp; Return QC</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Vendors may return material in several batches. Record each batch on its challan when it arrives; the pieces can
        be inspected straight away while the rest is still tracked against the challan.
      </p>

      <div className="card p-4 overflow-x-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="font-medium">Challans in progress ({summaries.length})</h2>
          <span className="text-xs flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "rgba(239, 68, 68, 0.35)" }} aria-hidden />
            Red row = overdue (material still with the vendor after the expected date)
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2 pr-3">Challan</th>
              <th className="pr-3">Job worker</th>
              <th className="pr-3">Expected back</th>
              <th className="pr-3 text-right">Dispatched</th>
              <th className="pr-3 text-right">Returned</th>
              <th className="pr-3 text-right">With vendor</th>
              <th className="pr-3 text-right">Pending QC</th>
              <th className="pr-3">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr
                key={s.challan.id}
                className="border-b"
                // Overdue (material still with the vendor past the expected date): the whole row is red.
                style={{ borderColor: "var(--border)", ...(s.overdue ? { background: "rgba(239, 68, 68, 0.12)" } : {}) }}
                title={s.overdue ? "Overdue: material still with the vendor after the expected return date" : undefined}
              >
                <td className="py-2 pr-3 font-medium whitespace-nowrap">{s.challan.challanNo}</td>
                <td className="pr-3">{s.vendor.name}</td>
                <td className={`pr-3 whitespace-nowrap ${s.overdue ? "font-semibold text-red-700" : ""}`}>
                  {formatDate(s.challan.expectedReturnDate)}
                </td>
                <td className="pr-3 text-right tabular-nums">{formatNos(s.totals.dispatched)}</td>
                <td className="pr-3 text-right tabular-nums">{formatNos(s.totals.returned)}</td>
                <td className="pr-3 text-right tabular-nums">{formatNos(s.totals.outstanding)}</td>
                <td className="pr-3 text-right tabular-nums font-semibold">{formatNos(s.totals.pendingQc)}</td>
                <td className="pr-3">
                  <span className={`badge whitespace-nowrap ${SHORT_STATUS[s.status].cls}`} title={s.status}>
                    {SHORT_STATUS[s.status].label}
                  </span>
                </td>
                <td>
                  <Link href={`/jobwork/challan/${s.challan.id}`} className="btn-primary inline-block px-3 py-1.5 text-sm whitespace-nowrap">
                    Open challan
                  </Link>
                </td>
              </tr>
            ))}
            {summaries.length === 0 && (
              <tr>
                <td colSpan={9} className="py-3" style={{ color: "var(--muted)" }}>
                  No challans in progress.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-3">Awaiting JW Return QC ({qcPendingLots.length})</h2>
        <div className="space-y-2">
          {qcPendingLots
            .filter((l) => batchOf.has(l.id))
            .map((lot) => {
              const rl = batchOf.get(lot.id)!;
              return (
                <div key={lot.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm" style={{ borderColor: "var(--border)" }}>
                  <div>
                    <span className="font-medium">{lot.lotNo}</span> — {lot.part.partNo} · batch {rl.receipt.receiptNo} of {rl.receipt.challan.challanNo}
                    <div style={{ color: "var(--muted)" }}>{formatNos(lot.qtyNos)} pcs waiting for QC</div>
                  </div>
                  <Link href={`/jobwork/challan/${rl.receipt.challanId}`} className="btn-secondary px-3 py-1.5 text-sm">
                    QC on the challan
                  </Link>
                </div>
              );
            })}
          {/* Lots that reached QC before batch tracking: inspect them here (partial QC allowed). */}
          {legacyLots.map((lot) => (
            <form key={lot.id} action={jwReturnQcAction} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <input type="hidden" name="lotId" value={lot.id} />
              <input type="hidden" name="clientToken" value={randomUUID()} />
              <div className="text-sm self-center">
                {lot.lotNo} — {lot.part.partNo}
                <div style={{ color: "var(--muted)" }}>
                  {formatNos(lot.qtyNos)} pcs waiting for QC{lot.parentLot && ` · partial return of ${lot.parentLot.lotNo}`}
                </div>
              </div>
              <Field id={`acc-${lot.id}`} label="QC passed (pcs)">
                <input id={`acc-${lot.id}`} name="acceptedNos" type="number" min="0" max={lot.qtyNos} placeholder={`Up to ${lot.qtyNos}`} className={FIELD_INPUT} />
              </Field>
              <Field id={`qcrej-${lot.id}`} label="QC rejected (pcs)">
                <input id={`qcrej-${lot.id}`} name="rejectedNos" type="number" min="0" placeholder="0" className={FIELD_INPUT} />
              </Field>
              <Field id={`qcreason-${lot.id}`} label="Rejection reason">
                <select id={`qcreason-${lot.id}`} name="reasonCodeId" className={FIELD_INPUT}>
                  <option value="">Select if rejected…</option>
                  {reasonCodes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="submit" className="text-sm btn-primary px-3 py-1.5 min-h-11">
                Save QC
              </button>
            </form>
          ))}
          {qcPendingLots.length === 0 && <p style={{ color: "var(--muted)" }}>Nothing awaiting JW return QC.</p>}
        </div>
      </div>
    </div>
  );
}
