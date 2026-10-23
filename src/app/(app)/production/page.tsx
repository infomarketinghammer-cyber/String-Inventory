import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { randomUUID } from "crypto";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatKg, formatNos } from "@/lib/format";
import { allOpsComplete, nextOpSeq, operationProgress, type OperationProgress } from "@/server/services/production";
import { JobWorkChoice } from "./JobWorkChoice";
import { OperationEntryForm } from "./OperationEntryForm";

export default async function ProductionPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  await requireUser();
  const inHouse = await prisma.productionLot.findMany({
    where: { status: "IN_HOUSE" },
    include: { part: { include: { bomLines: true } }, bundleLinks: { include: { bundle: true } } },
    orderBy: { startDate: "asc" },
  });
  // Lots that finished every routing operation leave this screen: they wait at Final Inspection, whose approval
  // turns them into Finished Goods.
  const lots = inHouse.filter((l) => !allOpsComplete(l.part.bomLines, l.currentOpSeq));
  const readyForFqi = inHouse.length - lots.length;
  const reasonCodes = await prisma.reasonCode.findMany({ where: { stage: "WIP", active: true } });
  // Planned / processed / pending of each lot's current operation, recomputed from the saved entries.
  const progress = new Map<string, OperationProgress>();
  for (const lot of lots) progress.set(lot.id, await operationProgress(prisma, lot));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Production / Operation Entry</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />
      {readyForFqi > 0 && (
        <p className="card px-4 py-3 text-sm">
          {readyForFqi} lot{readyForFqi === 1 ? " has" : "s have"} finished all operations and{" "}
          {readyForFqi === 1 ? "is" : "are"} waiting at{" "}
          <a href="/final-inspection" className="underline font-medium" style={{ color: "var(--brand)" }}>
            Final Inspection
          </a>{" "}
          → Finished Goods.
        </p>
      )}

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
                  Op {lot.currentOpSeq}: {op?.opName ?? "-"}
                  {op ? (op.opType === "JOB_WORK" ? " (Job Work)" : " (In-house)") : ""}
                  {lot.qtyNos > 0 ? ` · Qty ${formatNos(lot.qtyNos)}` : ""} · Started{" "}
                  {formatDate(lot.startDate)}
                </div>
              </div>
              <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
                Bundles consumed:{" "}
                {lot.bundleLinks.map((l) => l.bundle.bundleNo).join(", ") || "none"}
              </div>
              {op?.opType === "IN_HOUSE" ? (
                (() => {
                  const pr = progress.get(lot.id)!;
                  return (
                    <OperationEntryForm
                      lotId={lot.id}
                      opSeq={lot.currentOpSeq}
                      planned={pr.planned}
                      processed={pr.processed}
                      pending={pr.pending}
                      clientToken={randomUUID()}
                      reasonCodes={reasonCodes.map((r) => ({ id: r.id, code: r.code }))}
                      plannedNote={
                        pr.fromWire
                          ? `from ${formatKg(pr.kgConsumed ?? 0)} kg wire issued (max ${formatNos(pr.wireMaxNos ?? 0)} by weight)`
                          : `good pieces from the previous step`
                      }
                    />
                  );
                })()
              ) : op ? (
                <JobWorkChoice
                  lotId={lot.id}
                  opSeq={lot.currentOpSeq}
                  // Where the lot goes if this JW step is skipped: the next routing op, or Final Inspection -> FG.
                  nextLabel={
                    lot.part.bomLines.find((b) => b.opSeq === nextOpSeq(lot.part.bomLines, lot.currentOpSeq))?.opName ??
                    "Final Inspection"
                  }
                />
              ) : (
                <p className="text-sm text-green-700">
                  Production completed. No pending quantity remains. All routing operations are done; this lot is ready for{" "}
                  <a href="/final-inspection" className="underline">
                    Final Inspection
                  </a>
                  ; on approval it becomes a Finished Goods lot in FG Stores.
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
