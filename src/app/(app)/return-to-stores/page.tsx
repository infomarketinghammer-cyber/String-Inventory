import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { Field, FIELD_INPUT } from "@/components/Field";
import { formatDate, formatKg } from "@/lib/format";
import { returnToStoresAction } from "./actions";

export default async function ReturnToStoresPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  await requireUser();
  // Only lots that still hold wire from a bundle (and haven't progressed past coiling) can return it.
  const [links, reasons, history] = await Promise.all([
    prisma.lotBundleLink.findMany({
      where: { kgConsumed: { gt: 0 }, lot: { status: "IN_HOUSE", opEntries: { none: {} } } },
      include: { lot: { include: { part: true } }, bundle: true },
      orderBy: { lot: { startDate: "desc" } },
    }),
    prisma.reasonCode.findMany({ where: { stage: "Return", active: true }, orderBy: { code: "asc" } }),
    // Every return is a T6 ledger row; the reason (why) is kept on it.
    prisma.stockLedger.findMany({
      where: { txnType: "T6_RETURN_TO_STORES" },
      include: { user: { select: { name: true } } },
      orderBy: { txnDate: "desc" },
      take: 25,
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Return to Stores</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Unused wire from the floor is returned against the same bundle. The bundle keeps its original inward date, so it
        keeps its FIFO place. Only lots that have not started production can return wire. The quantity and the reason
        for every return are recorded.
      </p>
      <div className="card p-4 space-y-2">
        {links.map((l) => (
          <form
            key={l.id}
            action={returnToStoresAction}
            className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border-b pb-2"
            style={{ borderColor: "var(--border)" }}
          >
            <input type="hidden" name="lotId" value={l.lotId} />
            <input type="hidden" name="bundleId" value={l.bundleId} />
            <div className="text-sm self-center">
              <div className="font-medium">
                {l.lot.lotNo} ← {l.bundle.bundleNo}
              </div>
              <div style={{ color: "var(--muted)" }}>
                {l.lot.part.partNo} · holds {formatKg(l.kgConsumed)} kg from this bundle
              </div>
            </div>
            <Field label="Return quantity (kg) *">
              <input
                name="kg"
                type="number"
                step="0.01"
                min="0.01"
                max={Number(l.kgConsumed)}
                required
                placeholder={`Up to ${formatKg(l.kgConsumed)}`}
                className={FIELD_INPUT}
              />
            </Field>
            <Field label="Why returned? *">
              <select name="reasonCodeId" required defaultValue="" className={FIELD_INPUT}>
                <option value="">Select reason…</option>
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {r.description}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Remarks">
              <input name="remarks" placeholder="Optional details" className={FIELD_INPUT} />
            </Field>
            <button type="submit" className="text-sm btn-primary px-3 py-1.5 min-h-11">
              Return to stores
            </button>
          </form>
        ))}
        {links.length === 0 && <p style={{ color: "var(--muted)" }}>No lots hold returnable wire.</p>}
        {reasons.length === 0 && links.length > 0 && (
          <p className="text-sm text-red-700">No return reasons are set up. An Admin can add them in Masters (stage “Return”).</p>
        )}
      </div>

      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-3">Recent returns</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2">Return No.</th>
              <th>Date</th>
              <th>Bundle</th>
              <th className="text-right pr-4">Quantity (kg)</th>
              <th>Reason</th>
              <th>Returned by</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 whitespace-nowrap">{h.docNo}</td>
                <td className="whitespace-nowrap">{formatDate(h.txnDate)}</td>
                <td className="whitespace-nowrap">{h.refNo}</td>
                <td className="text-right pr-4">{formatKg(h.qty)}</td>
                <td>{h.reason ?? <span style={{ color: "var(--muted)" }}>not recorded</span>}</td>
                <td>{h.user.name}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3" style={{ color: "var(--muted)" }}>
                  No returns yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
