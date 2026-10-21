import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { formatDate, formatNos } from "@/lib/format";
import { can } from "@/server/policy";
import { suggestFifoForSchedule } from "@/server/services/dispatch";
import { createDispatchAction, createCustomerReturnAction } from "./actions";

export default async function DispatchPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const canOverDispatch = can(user, "finalInspection.approve");
  const returnReasons = await prisma.reasonCode.findMany({ where: { active: true, stage: { in: ["Customer", "CUSTOMER", "FQI"] } } });
  const schedules = await prisma.customerSchedule.findMany({
    include: { part: true, customer: true },
    orderBy: { dueDate: "asc" },
  });
  const dueSchedules = schedules.filter((s) => s.dispatchedNos < s.qtyNos);
  const proposals = new Map(
    await Promise.all(dueSchedules.map(async (s) => [s.id, (await suggestFifoForSchedule(s.id)).suggestion] as const)),
  );
  const dispatches = await prisma.dispatch.findMany({
    include: { customer: true, lines: { include: { fgLot: true } } },
    orderBy: { date: "desc" },
    take: 15,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dispatch against Customer Schedule</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      <div className="card p-4">
        <h2 className="font-medium mb-1">Due schedule lines</h2>
        <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          The system picks FG Lots of the Part oldest-first (FIFO); the proposal for the open balance is shown on each line.
          Dispatch cannot exceed the FG available or the schedule balance (an Admin may approve an over-dispatch).
        </p>
        <div className="space-y-3">
          {dueSchedules.map((s) => {
            const balance = s.qtyNos - s.dispatchedNos;
            const pick = proposals.get(s.id);
            const field = "w-full rounded border px-2 py-1.5 bg-transparent text-sm";
            return (
              <form key={s.id} action={createDispatchAction} className="border-b pb-3 space-y-2" style={{ borderColor: "var(--border)" }}>
                <input type="hidden" name="scheduleId" value={s.id} />
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <div>
                    <span className="font-medium">{s.customer.name}</span> — {s.part.partNo}
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      · due {formatDate(s.dueDate)} · {s.dispatchedNos > 0 ? "Partially dispatched" : "Not dispatched"} · balance{" "}
                      {formatNos(balance)} nos
                    </span>
                  </div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    FIFO proposal:{" "}
                    {pick && pick.picks.length > 0
                      ? pick.picks.map((p) => `${p.number} (${formatNos(p.qtyPicked)})`).join(", ")
                      : "no FG stock available"}
                    {pick && !pick.fullyCovered && pick.picks.length > 0 && " — FG short of balance"}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                  <label className="text-xs">
                    Qty (nos) *
                    <input name="qtyNos" type="number" min="1" max={canOverDispatch ? undefined : balance} defaultValue={Math.min(balance, pick?.totalPicked ?? 0) || undefined} required className={field} />
                    {canOverDispatch && (
                      <span className="flex items-center gap-1 mt-1" style={{ color: "var(--muted)" }}>
                        <input type="checkbox" name="approveOverDispatch" aria-label="Approve over-dispatch" /> Approve over-dispatch
                      </span>
                    )}
                  </label>
                  <label className="text-xs">
                    Invoice No. *
                    <input name="invoiceNo" required className={field} />
                  </label>
                  <label className="text-xs">
                    Vehicle No.
                    <input name="vehicleNo" className={field} />
                  </label>
                  <label className="text-xs md:col-span-2">
                    Packing details
                    <input name="packingDetails" placeholder="e.g. 12 boxes × 100 nos, palletised" className={field} />
                  </label>
                  <button type="submit" className="text-sm btn-primary px-3 py-1.5 min-h-11">
                    Dispatch
                  </button>
                </div>
              </form>
            );
          })}
          {dueSchedules.length === 0 && <p style={{ color: "var(--muted)" }}>No due schedule lines.</p>}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-1">Customer return</h2>
        <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          Received against the original Dispatch Note and FG Lot; the material goes to Rejected – FG for disposal.
        </p>
        <form action={createCustomerReturnAction} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <input aria-label="Dispatch No. (e.g. DN-2627-0001)" name="dispatchNo" required placeholder="Dispatch No. (e.g. DN-2627-0001)" className="rounded border px-2 py-1.5 bg-transparent text-sm" />
          <input aria-label="FG Lot No." name="fgLotNo" required placeholder="FG Lot No." className="rounded border px-2 py-1.5 bg-transparent text-sm" />
          <input aria-label="Qty (nos)" name="qtyNos" type="number" min="1" required placeholder="Qty (nos)" className="rounded border px-2 py-1.5 bg-transparent text-sm" />
          <select aria-label="Reason Code" name="reasonCodeId" required className="rounded border px-2 py-1.5 bg-transparent text-sm">
            <option value="">Reason...</option>
            {returnReasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code}
              </option>
            ))}
          </select>
          <button type="submit" className="text-sm btn-primary px-3 py-1.5 min-h-11">
            Record return
          </button>
        </form>
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-3">Recent dispatches</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2">Dispatch No.</th>
              <th>Date</th>
              <th>Customer</th>
              <th>FG Lots</th>
              <th>Qty (nos)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {dispatches.map((d) => (
              <tr key={d.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{d.dispatchNo}</td>
                <td>{formatDate(d.date)}</td>
                <td>{d.customer.name}</td>
                <td>{d.lines.map((l) => l.fgLot.fgLotNo).join(", ")}</td>
                <td>{formatNos(d.lines.reduce((s, l) => s + l.qtyNos, 0))}</td>
                <td>
                  <a href={`/print/dispatch-note/${d.id}`} className="underline text-xs">
                    Print
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
