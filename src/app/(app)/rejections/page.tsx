import { Field, FIELD_INPUT } from "@/components/Field";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Banner } from "@/components/Banner";
import { Forbidden } from "@/components/Forbidden";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { refNoFor } from "@/server/services/rejection";
import { disposeRejectionAction } from "./actions";

const STAGES = ["IQC", "WIP", "JW_RETURN", "FQI", "CUSTOMER_RETURN"] as const;
const DISPOSALS = ["PENDING", "RTS", "REWORK", "SCRAP", "DEVIATION"] as const;

export default async function RejectionsPage(props: {
  searchParams: Promise<{ ok?: string; err?: string; stage?: string; disposal?: string; q?: string }>;
}) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "rejection.disposal")) return <Forbidden what="Rejections / Disposal" />;
  const stage = STAGES.find((s) => s === searchParams.stage);
  const disposal = DISPOSALS.find((d) => d === searchParams.disposal);
  const q = searchParams.q?.trim() || undefined;
  const filtered = Boolean(stage || disposal || q);
  const rejections = await prisma.rejection.findMany({
    where: { ...(stage ? { stage } : {}), ...(disposal ? { disposal } : {}), ...(q ? { rejNo: { contains: q } } : {}) },
    orderBy: { createdAt: "desc" },
    take: filtered ? 200 : 30,
  });
  const reasonCodes = await prisma.reasonCode.findMany();
  const reasonMap = new Map(reasonCodes.map((r) => [r.id, r.code]));
  const refNos = new Map<string, string>();
  for (const r of rejections) refNos.set(r.id, await refNoFor(prisma, r.refType, r.refId));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Rejections &amp; Disposal</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      <div className="card p-4 overflow-x-auto">
        <form className="flex flex-wrap gap-3 items-end mb-4">
          <Field label="Stage" className="w-44">
            <select name="stage" defaultValue={stage ?? ""} className={FIELD_INPUT}>
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Disposal" className="w-44">
            <select name="disposal" defaultValue={disposal ?? ""} className={FIELD_INPUT}>
              <option value="">All</option>
              {DISPOSALS.map((d) => (
                <option key={d} value={d}>
                  {d === "RTS" ? "Returned to supplier" : d.charAt(0) + d.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rejection No." className="w-48">
            <input name="q" defaultValue={q} placeholder="REJ-…" className={FIELD_INPUT} />
          </Field>
          <button type="submit" className="btn-secondary text-sm px-3 py-1.5">
            Apply
          </button>
          {filtered && (
            <a href="/rejections" className="text-sm underline self-center">
              Clear
            </a>
          )}
        </form>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2">Rej No.</th>
              <th>Stage</th>
              <th>Ref</th>
              <th>Qty</th>
              <th>Reason</th>
              <th>Disposal</th>
              <th>Date</th>
              {can(user, "rejection.disposal") && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {rejections.map((r) => (
              <tr key={r.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{r.rejNo}</td>
                <td>{r.stage}</td>
                <td>
                  {refNos.get(r.id)}
                </td>
                <td>
                  {Number(r.qty)} {r.uom}
                </td>
                <td>{reasonMap.get(r.reasonCodeId) ?? r.reasonCodeId}</td>
                <td>
                  <StatusBadge status={r.disposal} />
                </td>
                <td>{formatDate(r.createdAt)}</td>
                {can(user, "rejection.disposal") && (
                  <td>
                    {r.disposal === "PENDING" ? (
                      <form action={disposeRejectionAction} className="flex gap-1 items-end">
                        <input type="hidden" name="rejectionId" value={r.id} />
                        <Field label="Disposal">
                          <select name="disposal" required className="w-full rounded border px-1 py-1 bg-transparent text-xs">
                            {r.stage === "IQC" && <option value="RTS">Return to supplier</option>}
                            {r.stage === "IQC" && <option value="DEVIATION">Accept under deviation</option>}
                            {r.stage !== "IQC" && <option value="REWORK">Rework</option>}
                            <option value="SCRAP">Scrap</option>
                          </select>
                        </Field>
                        {r.stage !== "IQC" && (
                          <Field label="Rework op #">
                            <input name="targetOpSeq" type="number" min="1" placeholder="Rework op #" title="Operation the rework goes back to (Rework only)" className="w-24 rounded border px-1 py-1 bg-transparent text-xs" />
                          </Field>
                        )}
                        <Field label="Reason">
                          <input name="reason" placeholder="Reason" required className="w-24 rounded border px-1 py-1 bg-transparent text-xs" />
                        </Field>
                        <button type="submit" className="text-xs underline">
                          Save
                        </button>
                      </form>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Done</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
