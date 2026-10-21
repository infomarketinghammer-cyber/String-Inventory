import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Banner } from "@/components/Banner";
import { Forbidden } from "@/components/Forbidden";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { refNoFor } from "@/server/services/rejection";
import { disposeRejectionAction } from "./actions";

export default async function RejectionsPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "rejection.disposal")) return <Forbidden what="Rejections / Disposal" />;
  const rejections = await prisma.rejection.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const reasonCodes = await prisma.reasonCode.findMany();
  const reasonMap = new Map(reasonCodes.map((r) => [r.id, r.code]));
  const refNos = new Map<string, string>();
  for (const r of rejections) refNos.set(r.id, await refNoFor(prisma, r.refType, r.refId));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Rejections &amp; Disposal</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      <div className="card p-4">
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
                      <form action={disposeRejectionAction} className="flex gap-1 items-center">
                        <input type="hidden" name="rejectionId" value={r.id} />
                        <select aria-label="Disposal" name="disposal" required className="rounded border px-1 py-1 bg-transparent text-xs">
                          {r.stage === "IQC" && <option value="RTS">Return to supplier</option>}
                          {r.stage === "IQC" && <option value="DEVIATION">Accept under deviation</option>}
                          {r.stage !== "IQC" && <option value="REWORK">Rework</option>}
                          <option value="SCRAP">Scrap</option>
                        </select>
                        {r.stage !== "IQC" && (
                          <input aria-label="Rework op #" name="targetOpSeq" type="number" min="1" placeholder="Rework op #" title="Operation the rework goes back to (Rework only)" className="w-24 rounded border px-1 py-1 bg-transparent text-xs" />
                        )}
                        <input aria-label="Reason" name="reason" placeholder="Reason" required className="w-24 rounded border px-1 py-1 bg-transparent text-xs" />
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
