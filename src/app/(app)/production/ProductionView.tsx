import Link from "next/link";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { Banner } from "@/components/Banner";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatKg, formatNos } from "@/lib/format";
import { opSlug, type OperationTab } from "@/lib/operations";
import { allOpsComplete, nextOpSeq, operationProgress, type OperationProgress } from "@/server/services/production";
import { JobWorkChoice } from "./JobWorkChoice";
import { OperationEntryForm } from "./OperationEntryForm";

/**
 * Production / Operations, split by routing operation. `tab` is an operation's URL name (e.g. "grinding"),
 * or undefined for "All". Each lot appears under the operation it is currently at.
 */
export async function ProductionView({ tab, tabs, ok, err }: { tab?: string; tabs: OperationTab[]; ok?: string; err?: string }) {
  const inHouse = await prisma.productionLot.findMany({
    where: { status: "IN_HOUSE" },
    include: { part: { include: { bomLines: true } }, bundleLinks: { include: { bundle: true } } },
    orderBy: { startDate: "asc" },
  });
  // Lots that finished every routing operation leave this screen: they wait at Final Inspection, whose approval
  // turns them into Finished Goods.
  const working = inHouse.filter((l) => !allOpsComplete(l.part.bomLines, l.currentOpSeq));
  const readyForFqi = inHouse.length - working.length;
  const currentOpSlug = (l: (typeof working)[number]) => opSlug(l.part.bomLines.find((b) => b.opSeq === l.currentOpSeq)?.opName ?? "");
  const countBy = new Map<string, number>();
  for (const l of working) countBy.set(currentOpSlug(l), (countBy.get(currentOpSlug(l)) ?? 0) + 1);
  const lots = tab ? working.filter((l) => currentOpSlug(l) === tab) : working;
  const active = tabs.find((t) => t.slug === tab);
  const back = tab ? `/production/${tab}` : "/production";

  // Planned / processed / pending of each lot's current operation, recomputed from the saved entries.
  // Fetched in parallel (one database round trip for all lots, not one after another).
  const [reasonCodes, progressList] = await Promise.all([
    prisma.reasonCode.findMany({ where: { stage: "WIP", active: true } }),
    Promise.all(lots.map((lot) => operationProgress(prisma, lot))),
  ]);
  const progress = new Map<string, OperationProgress>(lots.map((lot, i) => [lot.id, progressList[i]!]));

  const tabClass = (on: boolean) =>
    `inline-flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-sm whitespace-nowrap ${on ? "font-semibold" : ""}`;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Production / Operations{active ? ` — ${active.name}` : ""}</h1>
      <Banner ok={ok} err={err} />

      {/* One tab per routing operation, in routing order; the count is lots currently at that operation. */}
      <nav aria-label="Operations" className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }}>
        <Link
          href="/production"
          aria-current={!tab ? "page" : undefined}
          className={tabClass(!tab)}
          style={{ borderColor: !tab ? "var(--brand)" : "transparent", color: !tab ? "var(--brand-ink)" : "var(--muted)" }}
        >
          All <span className="badge badge-atjw">{working.length}</span>
        </Link>
        {tabs.map((t, i) => {
          const on = t.slug === tab;
          return (
            <Link
              key={t.slug}
              href={`/production/${t.slug}`}
              aria-current={on ? "page" : undefined}
              className={tabClass(on)}
              style={{ borderColor: on ? "var(--brand)" : "transparent", color: on ? "var(--brand-ink)" : "var(--muted)" }}
            >
              <span>
                {i + 1}. {t.name}
                {t.jobWork && <span className="text-xs font-normal"> (JW)</span>}
              </span>
              <span className={`badge ${countBy.get(t.slug) ? "badge-hold" : "badge-atjw"}`}>{countBy.get(t.slug) ?? 0}</span>
            </Link>
          );
        })}
        <Link
          href="/final-inspection"
          className={tabClass(false)}
          style={{ borderColor: "transparent", color: "var(--muted)" }}
          title="Lots that finished all operations"
        >
          <span>{tabs.length + 1}. Final Inspection →</span>
          <span className="badge badge-available">{readyForFqi}</span>
        </Link>
      </nav>

      {active?.jobWork && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {active.name} is a job-work step: send each lot on a JW Out Challan, or skip the job work with a reason.
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
                  {lot.qtyNos > 0 ? ` · Qty ${formatNos(lot.qtyNos)}` : ""} · Started {formatDate(lot.startDate)}
                </div>
              </div>
              <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
                Bundles consumed: {lot.bundleLinks.map((l) => l.bundle.bundleNo).join(", ") || "none"}
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
                      back={back}
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
                  back={back}
                  // Where the lot goes if this JW step is skipped: the next routing op, or Final Inspection -> FG.
                  nextLabel={lot.part.bomLines.find((b) => b.opSeq === nextOpSeq(lot.part.bomLines, lot.currentOpSeq))?.opName ?? "Final Inspection"}
                />
              ) : null}
            </div>
          );
        })}
        {lots.length === 0 && (
          <p className="card px-4 py-6 text-sm" style={{ color: "var(--muted)" }}>
            {active ? `No lots are at ${active.name} right now.` : "No lots currently in production."}
          </p>
        )}
      </div>
    </div>
  );
}
