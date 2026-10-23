import { randomUUID } from "crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Banner } from "@/components/Banner";
import { FIELD_INPUT, FIELD_LABEL } from "@/components/Field";
import { formatDate, formatNos } from "@/lib/format";
import { challanSummary, type ChallanPrimaryStatus } from "@/server/services/jwChallan";
import { closeChallanAction } from "../../in/actions";
import { BatchQcForm, RecordReturnForm } from "./forms";

const STATUS_STYLE: Record<ChallanPrimaryStatus, string> = {
  "Awaiting Vendor Return": "badge-atjw",
  "Partially Returned": "badge-hold",
  "QC Pending": "badge-hold",
  "QC In Progress": "badge-hold",
  "Rejections Pending Disposal": "badge-rejected",
  Completed: "badge-available",
};
const BATCH_STYLE: Record<string, string> = {
  "Awaiting QC": "badge-hold",
  "QC In Progress": "badge-hold",
  "QC Complete": "badge-available",
  "No pieces to inspect": "badge-atjw",
  "Before batch tracking": "badge-atjw",
};

const localDay = (d: Date) => d.toLocaleDateString("en-CA");

/** One JW Out Challan with all its return batches and their QC (partial vendor returns, batch-wise QC). */
export default async function ChallanDetailPage(props: {
  params: Promise<{ challanId: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const [{ challanId }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser();
  const s = await challanSummary(challanId);
  if (!s) notFound();
  const canReceive = can(user, "jw.receipt");
  const reasons = (await prisma.reasonCode.findMany({ where: { stage: "JW", active: true }, orderBy: { code: "asc" } })).map((r) => ({
    id: r.id,
    code: r.code,
    description: r.description,
  }));
  const t = s.totals;
  const open = s.challan.dbStatus !== "CLOSED";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/jobwork/in" className="text-sm" style={{ color: "var(--brand)" }}>
          ← JW In Receipt
        </Link>
        <div className="flex flex-wrap items-center gap-3 mt-1">
          <h1 className="text-xl font-semibold">{s.challan.challanNo}</h1>
          <span className={`badge ${STATUS_STYLE[s.status]}`}>{s.status}</span>
          {s.indicators.map((i) => (
            <span key={i} className={`badge ${i === "Overdue" ? "badge-rejected" : "badge-atjw"}`}>
              {i}
            </span>
          ))}
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          {s.vendor.name} · sent {formatDate(s.challan.date)} · vehicle {s.challan.vehicleNo ?? "-"} · expected back{" "}
          {formatDate(s.challan.expectedReturnDate)} ·{" "}
          <a href={`/print/jw-challan/${s.challan.id}`} target="_blank" rel="noreferrer" className="underline">
            print
          </a>
        </p>
      </div>
      <Banner ok={sp.ok} err={sp.err} />

      <div className="card p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            ["Dispatched", t.dispatched],
            ["Returned (good)", t.returned],
            ["Outstanding with vendor", t.outstanding],
            ["Pending QC", t.pendingQc],
            ["QC passed", t.qcPassed],
            ["QC rejected", t.qcRejected],
          ].map(([label, v]) => (
            <div key={label as string}>
              <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {label}
              </div>
              <div className="text-2xl font-semibold tabular-nums" style={{ color: "var(--brand-ink)" }}>
                {formatNos(v as number)}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
          Outstanding = dispatched − returned − rejected by vendor ({formatNos(t.rejectedByVendor)}) − short / written off (
          {formatNos(t.short)}). Pending QC = returned − QC passed − QC rejected.
          {t.rejectedPendingDisposal > 0 && ` ${formatNos(t.rejectedPendingDisposal)} rejected pcs await a disposal decision on Rejections / Disposal.`}
        </p>
      </div>

      <div className="card p-4 space-y-4">
        <h2 className="font-medium">Lots on this challan</h2>
        {s.lines.map((l) => (
          <div key={l.id} className="space-y-2 border-b pb-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <span className="font-medium">{l.lotNo}</span> · {l.partNo} · op {l.opSeq} {l.opName}
              </div>
              <div className="tabular-nums" style={{ color: "var(--muted)" }}>
                sent {formatNos(l.dispatched)} · returned {formatNos(l.received)} · vendor rejected {formatNos(l.rejectedByVendor)} · short{" "}
                {formatNos(l.short)} · <span className="font-semibold" style={{ color: "var(--fg)" }}>with vendor {formatNos(l.outstanding)}</span>
              </div>
            </div>
            {open && canReceive && l.outstanding > 0 && (
              <RecordReturnForm
                challanId={s.challan.id}
                line={{ id: l.id, lotNo: l.lotNo, outstanding: l.outstanding }}
                challanDate={localDay(s.challan.date)}
                today={localDay(new Date())}
                clientToken={randomUUID()}
                reasons={reasons}
              />
            )}
          </div>
        ))}
        {open && can(user, "jw.closeWithShortage") && t.outstanding > 0 && (
          <form action={closeChallanAction} className="flex flex-wrap gap-2 items-end">
            <input type="hidden" name="challanId" value={s.challan.id} />
            <input type="hidden" name="backChallanId" value={s.challan.id} />
            <div className="flex-1 min-w-64">
              <label htmlFor="close-reason" className={FIELD_LABEL}>
                Reason to close with shortage (Admin) — writes off the {formatNos(t.outstanding)} pcs still with the vendor
              </label>
              <input id="close-reason" name="reason" required placeholder="e.g. vendor confirmed pieces lost" className={FIELD_INPUT} />
            </div>
            <button type="submit" className="btn-secondary px-3 py-2 text-sm">
              Close with shortage
            </button>
          </form>
        )}
        {s.challan.closedWithShortageReason && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Closed with shortage: {s.challan.closedWithShortageReason}
          </p>
        )}
      </div>

      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-3">Return batches ({s.batches.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2 pr-3">Batch</th>
              <th className="pr-3">Receipt date</th>
              <th className="pr-3">Lot</th>
              <th className="pr-3 text-right">Received</th>
              <th className="pr-3 text-right">Vendor rej. / short</th>
              <th className="pr-3 text-right">QC passed</th>
              <th className="pr-3 text-right">QC rejected</th>
              <th className="pr-3 text-right">Pending QC</th>
              <th className="pr-3">QC status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {s.batches.map((b) => (
              <tr key={b.id} className="border-b align-top" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <div className="font-medium">{b.batchNo}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {b.vendorDcNo ? `Vendor DC ${b.vendorDcNo}` : ""}
                    {b.remarks ? `${b.vendorDcNo ? " · " : ""}${b.remarks}` : ""}
                  </div>
                </td>
                <td className="pr-3 whitespace-nowrap">{formatDate(b.date)}</td>
                <td className="pr-3 whitespace-nowrap">
                  {b.lotNo}
                  {b.qcLotNo && b.qcLotNo !== b.lotNo && (
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      QC lot {b.qcLotNo}
                    </div>
                  )}
                </td>
                <td className="pr-3 text-right tabular-nums">{formatNos(b.received)}</td>
                <td className="pr-3 text-right tabular-nums">
                  {formatNos(b.rejectedByVendor)} / {formatNos(b.short)}
                </td>
                <td className="pr-3 text-right tabular-nums">{b.tracked ? formatNos(b.qcPassed) : "-"}</td>
                <td className="pr-3 text-right tabular-nums">{b.tracked ? formatNos(b.qcRejected) : "-"}</td>
                <td className="pr-3 text-right tabular-nums font-semibold">{b.tracked ? formatNos(b.pendingQc) : "-"}</td>
                <td className="pr-3">
                  <span className={`badge whitespace-nowrap ${BATCH_STYLE[b.qcStatus]}`}>{b.qcStatus}</span>
                  {b.lastInspection && (
                    <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                      last by {b.lastInspection.by}, {formatDate(b.lastInspection.at)}
                    </div>
                  )}
                </td>
                <td>
                  {canReceive && b.qcLotId && b.pendingQc > 0 && (
                    <BatchQcForm
                      challanId={s.challan.id}
                      batchNo={b.batchNo}
                      qcLotId={b.qcLotId}
                      pending={b.pendingQc}
                      started={b.qcPassed + b.qcRejected > 0}
                      clientToken={randomUUID()}
                      reasons={reasons}
                    />
                  )}
                </td>
              </tr>
            ))}
            {s.batches.length === 0 && (
              <tr>
                <td colSpan={10} className="py-3" style={{ color: "var(--muted)" }}>
                  Nothing has come back from the vendor yet. Use “Record Partial Return” when material arrives.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {s.batches.some((b) => b.inspections.length > 0) && (
        <div className="card p-4 overflow-x-auto">
          <h2 className="font-medium mb-3">QC history</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2 pr-3">Batch</th>
                <th className="pr-3">Inspected</th>
                <th className="pr-3">Inspector</th>
                <th className="pr-3 text-right">Passed</th>
                <th className="pr-3 text-right">Rejected</th>
                <th className="pr-3">Reason</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {s.batches.flatMap((b) =>
                b.inspections.map((e, i) => (
                  <tr key={`${b.id}-${i}`} className="border-b" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 pr-3">{b.batchNo}</td>
                    <td className="pr-3 whitespace-nowrap">
                      {formatDate(e.at)} {e.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="pr-3">{e.by}</td>
                    <td className="pr-3 text-right tabular-nums">{formatNos(e.accepted)}</td>
                    <td className="pr-3 text-right tabular-nums">{formatNos(e.rejected)}</td>
                    <td className="pr-3">{e.reason ?? ""}</td>
                    <td>{e.remarks ?? ""}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
