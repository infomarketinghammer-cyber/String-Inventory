import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Banner } from "@/components/Banner";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatKg } from "@/lib/format";
import { enterIqcAction, approveIqcAction } from "./actions";

const field = "rounded border px-2 py-1.5 bg-transparent text-sm w-full";

/** Test results + decision fields shared by the per-bundle and the whole-GRN forms (SOP 4.2 step 2). */
function ResultFields({ reasonCodes }: { reasonCodes: { id: string; code: string; description: string }[] }) {
  return (
    <>
      <label className="text-xs">
        Diameter (mm)
        <input name="diameter" placeholder="measured" className={field} />
      </label>
      <label className="text-xs">
        Tensile (MPa)
        <input name="tensile" placeholder="measured" className={field} />
      </label>
      <label className="text-xs">
        Surface
        <select name="surface" className={field} defaultValue="OK">
          <option value="OK">OK</option>
          <option value="Not OK">Not OK</option>
        </select>
      </label>
      <label className="text-xs">
        Certificate check
        <select name="certificate" className={field} defaultValue="Matches">
          <option value="Matches">Matches</option>
          <option value="Mismatch">Mismatch</option>
          <option value="Missing">Missing</option>
        </select>
      </label>
      <label className="text-xs">
        Decision
        <select name="decision" required className={field}>
          <option value="ACCEPT">Accept</option>
          <option value="ACCEPT_DEVIATION">Accept under deviation</option>
          <option value="REJECT">Reject</option>
        </select>
      </label>
      <label className="text-xs">
        Reason (reject / deviation)
        <select name="reasonCodeId" className={field}>
          <option value="">—</option>
          {reasonCodes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} — {r.description}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export default async function IqcPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const canApprove = can(user, "iqc.approve");
  const canReprint = can(user, "bundleTag.reprint");

  const [pendingBundles, pendingApproval, reasonCodes, accepted] = await Promise.all([
    prisma.bundle.findMany({
      where: { status: "QUALITY_HOLD", iqc: null },
      include: { item: true, grn: { include: { po: { include: { supplier: true } } } } },
      orderBy: [{ inwardDate: "asc" }, { bundleNo: "asc" }],
    }),
    prisma.iqc.findMany({
      where: { approvedAt: null },
      include: { bundle: { include: { item: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.reasonCode.findMany({ where: { stage: "IQC" } }),
    prisma.bundle.findMany({
      where: { iqc: { approvedAt: { not: null } }, status: { in: ["AVAILABLE", "CONSUMED"] } },
      include: { item: true, iqc: true },
      orderBy: { iqc: { approvedAt: "desc" } },
      take: 25,
    }),
  ]);
  const reason = new Map(reasonCodes.map((r) => [r.id, r.code]));

  // group pending bundles by GRN so a whole GRN can be inspected at once
  const byGrn = new Map<string, typeof pendingBundles>();
  for (const b of pendingBundles) byGrn.set(b.grnId, [...(byGrn.get(b.grnId) ?? []), b]);

  return (
    <div className="space-y-6">
      <h1>Incoming Quality Inspection (IQC)</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        QC inspector records results and a decision per bundle (or for a whole GRN). Stock only moves when the Quality
        Admin approves: accepted bundles become Available in RM Stores; rejected bundles go to Rejected – RM. A bundle is
        accepted or rejected whole.
      </p>

      <div className="card p-4 space-y-5">
        <h2 className="font-medium">Pending inspection ({pendingBundles.length} bundles)</h2>
        {[...byGrn.values()].map((bundles) => {
          const g = bundles[0]!.grn;
          return (
            <div key={g.id} className="rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--border)" }}>
              <div className="text-sm">
                <span className="font-semibold">{g.grnNo}</span> · {g.po.supplier.name} · PO {g.po.poNo} · received{" "}
                {formatDate(g.grnDate)} · {bundles.length} bundle(s)
              </div>
              {bundles.length > 1 && (
                <details className="rounded-md p-3" style={{ background: "var(--brand-soft)" }}>
                  <summary className="cursor-pointer text-sm font-medium">Inspect the full GRN ({bundles.length} bundles, same result)</summary>
                  <form action={enterIqcAction} className="mt-3 grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
                    <input type="hidden" name="grnId" value={g.id} />
                    <ResultFields reasonCodes={reasonCodes} />
                    <button type="submit" className="btn-primary text-sm px-3 py-1.5 min-h-11">
                      Record for all
                    </button>
                  </form>
                </details>
              )}
              {bundles.map((b) => (
                <form
                  key={b.id}
                  action={enterIqcAction}
                  className="grid grid-cols-2 md:grid-cols-9 gap-2 items-end border-t pt-3"
                  style={{ borderColor: "var(--border)" }}
                >
                  <input type="hidden" name="bundleId" value={b.id} />
                  <div className="col-span-2 text-sm">
                    <div className="font-medium">{b.bundleNo}</div>
                    <div style={{ color: "var(--muted)" }}>
                      {b.item.grade} {Number(b.item.diameterMm)}mm · {formatKg(b.receivedKg)} kg · Heat {b.heatNo}
                      {b.tcRef ? ` · TC ${b.tcRef}` : ""}
                    </div>
                  </div>
                  <ResultFields reasonCodes={reasonCodes} />
                  <button type="submit" className="btn-primary text-sm px-3 py-1.5 min-h-11">
                    Submit
                  </button>
                </form>
              ))}
            </div>
          );
        })}
        {pendingBundles.length === 0 && <p style={{ color: "var(--muted)" }}>Nothing pending inspection.</p>}
      </div>

      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-3">Awaiting Quality Admin approval ({pendingApproval.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2">IQC No.</th>
              <th>Bundle</th>
              <th>Results</th>
              <th>Decision</th>
              <th>Reason</th>
              <th>Entered</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pendingApproval.map((i) => {
              const r = (i.results ?? {}) as Record<string, string | undefined>;
              return (
                <tr key={i.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2">{i.iqcNo}</td>
                  <td>
                    {i.bundle.bundleNo} <StatusBadge status={i.bundle.status} />
                  </td>
                  <td className="text-xs">
                    Dia {r.diameter ?? "—"} · Tensile {r.tensile ?? "—"} · Surface {r.surface ?? "—"} · Cert {r.certificate ?? "—"}
                  </td>
                  <td>{i.decision.replace("_", " ")}</td>
                  <td>{i.reasonCodeId ? reason.get(i.reasonCodeId) : "—"}</td>
                  <td>{formatDate(i.createdAt)}</td>
                  <td>
                    {canApprove ? (
                      <form action={approveIqcAction}>
                        <input type="hidden" name="iqcId" value={i.id} />
                        <button type="submit" className="btn-primary text-xs px-3 py-1.5">
                          Approve
                        </button>
                      </form>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Awaiting approval</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-1">Accepted bundles — bundle tags (SOP 4.3)</h2>
        <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          Print the tag once the bundle is accepted and fix it to the coil. A store keeper can print a tag once; reprints
          need an Admin.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2">Bundle No.</th>
              <th>Wire</th>
              <th>Weight (kg)</th>
              <th>Accepted</th>
              <th>Tag</th>
            </tr>
          </thead>
          <tbody>
            {accepted.map((b) => (
              <tr key={b.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{b.bundleNo}</td>
                <td>
                  {b.item.grade} {Number(b.item.diameterMm)}mm
                </td>
                <td>{formatKg(b.receivedKg)}</td>
                <td>{formatDate(b.iqc?.approvedAt ?? null)}</td>
                <td>
                  {!b.tagPrintedAt ? (
                    <a href={`/print/bundle-tag/${b.id}`} target="_blank" rel="noreferrer" className="underline">
                      Print tag
                    </a>
                  ) : canReprint ? (
                    <a href={`/print/bundle-tag/${b.id}`} target="_blank" rel="noreferrer" className="underline">
                      Reprint (printed {formatDate(b.tagPrintedAt)})
                    </a>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>Printed {formatDate(b.tagPrintedAt)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
