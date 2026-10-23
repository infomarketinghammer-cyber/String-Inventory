import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Forbidden } from "@/components/Forbidden";
import { Field } from "@/components/Field";
import { traceChain } from "@/server/services/traceability";
import { formatDate } from "@/lib/format";

export default async function TraceabilityPage(props: { searchParams: Promise<{ q?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "reports.viewAll")) return <Forbidden what="the Traceability Explorer" />;
  const q = searchParams.q ?? "";
  const chain = q ? await traceChain(q) : null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Traceability Explorer</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Enter any Bundle No., Production Lot No., FG Lot No. or Dispatch No. to see the full forward and backward
        chain: PO → GRN → Bundle (Heat No.) → Issue → Production Lot (Part No.) → JW Challans → FG Lot → Dispatch →
        Customer.
      </p>
      <form className="card p-4 flex gap-2 items-end">
        <Field label="Bundle / Lot / FG Lot / Dispatch No." className="flex-1">
          <input
            name="q"
            defaultValue={q}
            placeholder="e.g. RM-2609-0031, PL-2610-0012, FG-2608-0001, DN-2627-0001"
            className="w-full rounded border px-3 py-2 bg-transparent"
          />
        </Field>
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Trace
        </button>
      </form>

      {q && !chain && <p className="text-sm text-red-700">No Bundle/Lot/FG Lot/Dispatch found for &quot;{q}&quot;.</p>}

      {chain && (
        <div className="space-y-4">
          {chain.po && (
            <ChainBlock title="Purchase Order">
              {chain.po.poNo} — {chain.po.supplier}
            </ChainBlock>
          )}
          {chain.grn && (
            <ChainBlock title="GRN">
              {chain.grn.grnNo} ({formatDate(chain.grn.grnDate)})
            </ChainBlock>
          )}
          <ChainBlock title={`Bundles (${chain.bundles.length})`}>
            {chain.bundles.map((b) => (
              <div key={b.bundleNo}>
                {b.bundleNo} · Heat {b.heatNo} · inward {formatDate(b.inwardDate)} · {b.status}
              </div>
            ))}
          </ChainBlock>
          <ChainBlock title={`Production Lots (${chain.productionLots.length})`}>
            {chain.productionLots.map((l) => (
              <div key={l.lotNo}>
                {l.lotNo} — {l.partNo} · op {l.currentOpSeq} · {l.status}
              </div>
            ))}
          </ChainBlock>
          <ChainBlock title={`JW Challans (${chain.jwChallans.length})`}>
            {chain.jwChallans.map((c) => (
              <div key={c.challanNo}>
                {c.challanNo} — {c.vendor} · {c.status}
              </div>
            ))}
          </ChainBlock>
          <ChainBlock title={`FG Lots (${chain.fgLots.length})`}>
            {chain.fgLots.map((f) => (
              <div key={f.fgLotNo}>
                {f.fgLotNo} — {f.partNo} · inward {formatDate(f.inwardDate)} · {f.status}
              </div>
            ))}
          </ChainBlock>
          <ChainBlock title={`Dispatches (${chain.dispatches.length})`}>
            {chain.dispatches.map((d) => (
              <div key={d.dispatchNo}>
                {d.dispatchNo} — {d.customer} · {formatDate(d.date)} · {d.qtyNos} nos
              </div>
            ))}
          </ChainBlock>
        </div>
      )}
    </div>
  );
}

function ChainBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h2 className="font-medium mb-2 text-sm">{title}</h2>
      <div className="text-sm space-y-1">{children}</div>
    </div>
  );
}
