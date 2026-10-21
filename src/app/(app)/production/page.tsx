import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatNos } from "@/lib/format";
import { recordOperationAction } from "./actions";

export default async function ProductionPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  await requireUser();
  const lots = await prisma.productionLot.findMany({
    where: { status: "IN_HOUSE" },
    include: { part: { include: { bomLines: true } }, bundleLinks: { include: { bundle: true } } },
    orderBy: { startDate: "asc" },
  });
  const reasonCodes = await prisma.reasonCode.findMany({ where: { stage: "WIP" } });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Production / Operation Entry</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      <div className="space-y-4">
        {lots.map((lot) => {
          const op = lot.part.bomLines.find((b) => b.opSeq === lot.currentOpSeq);
          return (
            <div key={lot.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-medium">{lot.lotNo}</span> — {lot.part.partNo}{" "}
                  <StatusBadge status={lot.status} />
                </div>
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  Op {lot.currentOpSeq}: {op?.opName ?? "-"} ({op?.opType}) · Qty {formatNos(lot.qtyNos)} · Started{" "}
                  {formatDate(lot.startDate)}
                </div>
              </div>
              <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
                Bundles consumed:{" "}
                {lot.bundleLinks.map((l) => l.bundle.bundleNo).join(", ") || "none"}
              </div>
              {op?.opType === "IN_HOUSE" ? (
                <form action={recordOperationAction} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                  <input type="hidden" name="lotId" value={lot.id} />
                  <input type="hidden" name="opSeq" value={lot.currentOpSeq} />
                  <input aria-label="Good (nos)" name="goodNos" type="number" min="0" placeholder="Good (nos)" required className="rounded border px-2 py-1.5 bg-transparent text-sm" />
                  <input aria-label="Rejected (nos)" name="rejectedNos" type="number" min="0" placeholder="Rejected (nos)" defaultValue={0} className="rounded border px-2 py-1.5 bg-transparent text-sm" />
                  <select aria-label="Reason Code" name="reasonCodeId" className="rounded border px-2 py-1.5 bg-transparent text-sm">
                    <option value="">Reason (if rejected)...</option>
                    {reasonCodes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.code}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="text-sm btn-primary px-3 py-1.5 min-h-11">
                    Save entry
                  </button>
                </form>
              ) : op ? (
                <p className="text-sm text-blue-700">
                  Next op is Job Work ({op.opName}). Use the JW Out Challan screen to send this lot.
                </p>
              ) : (
                <p className="text-sm text-green-700">
                  All routing operations are complete. This lot is ready for Final Inspection.
                </p>
              )}
            </div>
          );
        })}
        {lots.length === 0 && <p style={{ color: "var(--muted)" }}>No lots currently in-house.</p>}
      </div>
    </div>
  );
}
