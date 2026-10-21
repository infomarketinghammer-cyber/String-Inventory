import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Banner } from "@/components/Banner";
import { Forbidden } from "@/components/Forbidden";
import { formatDate, formatNos } from "@/lib/format";
import { allOpsComplete } from "@/server/services/production";
import { recordFinalInspectionAction, approveFinalInspectionAction } from "./actions";

const field = "rounded border px-2 py-1.5 bg-transparent text-sm w-full";

export default async function FinalInspectionPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "finalInspection.enter")) return <Forbidden what="Final Inspection" />;
  const canApprove = can(user, "finalInspection.approve");

  const [lots, pending, reasonCodes, users] = await Promise.all([
    prisma.productionLot.findMany({
      where: { status: "IN_HOUSE" },
      include: { part: { include: { bomLines: true } }, finalInspections: { where: { approvedAt: null } } },
      orderBy: { startDate: "asc" },
    }),
    prisma.finalInspection.findMany({
      where: { approvedAt: null },
      include: { lot: { include: { part: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.reasonCode.findMany({ where: { stage: "FQI" } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const readyLots = lots.filter(
    (lot) => allOpsComplete(lot.part.bomLines, lot.currentOpSeq) && lot.qtyNos > 0 && lot.finalInspections.length === 0,
  );
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const reasonCode = new Map(reasonCodes.map((r) => [r.id, r.code]));

  return (
    <div className="space-y-6">
      <h1>Final Inspection (FQI / PDI) → FG</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Step 1: the QC inspector records the result for the whole lot. Step 2: the Quality Admin approves it, and only then
        is the FG Lot created (FG inward date = approval date).
      </p>

      <div className="card p-4 space-y-3">
        <h2 className="font-medium">Step 1 — Lots ready for final inspection ({readyLots.length})</h2>
        {readyLots.map((lot) => (
          <form
            key={lot.id}
            action={recordFinalInspectionAction}
            className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end border-b pb-3"
            style={{ borderColor: "var(--border)" }}
          >
            <input type="hidden" name="lotId" value={lot.id} />
            <div className="md:col-span-3 text-sm">
              <div className="font-medium">{lot.lotNo}</div>
              <div style={{ color: "var(--muted)" }}>
                {lot.part.partNo} · {formatNos(lot.qtyNos)} nos to inspect
              </div>
            </div>
            <label className="md:col-span-2 text-xs">
              Accepted (nos)
              <input name="acceptedNos" type="number" min="0" max={lot.qtyNos} defaultValue={lot.qtyNos} required className={field} />
            </label>
            <label className="md:col-span-2 text-xs">
              Rejected (nos)
              <input name="rejectedNos" type="number" min="0" defaultValue={0} className={field} />
            </label>
            <label className="md:col-span-2 text-xs">
              Reason (if rejected)
              <select name="reasonCodeId" className={field}>
                <option value="">—</option>
                {reasonCodes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {r.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-2 text-xs">
              Test results / remarks
              <input name="results" placeholder="e.g. load OK, free length OK" className={field} />
            </label>
            <button type="submit" className="md:col-span-1 text-sm btn-primary px-3 py-1.5 min-h-11">
              Record
            </button>
          </form>
        ))}
        {readyLots.length === 0 && <p style={{ color: "var(--muted)" }}>No lots waiting for inspection.</p>}
      </div>

      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-3">Step 2 — Awaiting Quality Admin approval ({pending.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>FQI No.</th>
              <th>Lot / Part</th>
              <th>Accepted</th>
              <th>Rejected</th>
              <th>Reason</th>
              <th>Results</th>
              <th>Recorded by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((f) => (
              <tr key={f.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{f.fqiNo}</td>
                <td>
                  {f.lot.lotNo} / {f.lot.part.partNo}
                </td>
                <td>{formatNos(f.acceptedNos)}</td>
                <td>{formatNos(f.rejectedNos)}</td>
                <td>{f.reasonCodeId ? reasonCode.get(f.reasonCodeId) : "—"}</td>
                <td>{f.results ?? "—"}</td>
                <td>
                  {userName.get(f.enteredById) ?? "—"} · {formatDate(f.createdAt)}
                </td>
                <td>
                  {canApprove ? (
                    <form action={approveFinalInspectionAction}>
                      <input type="hidden" name="fqiId" value={f.id} />
                      <button type="submit" className="btn-primary text-xs px-3 py-1.5">
                        Approve → FG
                      </button>
                    </form>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>Awaiting approval</span>
                  )}
                </td>
              </tr>
            ))}
            {pending.length === 0 && (
              <tr>
                <td colSpan={8} className="py-3" style={{ color: "var(--muted)" }}>
                  Nothing awaiting approval.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
