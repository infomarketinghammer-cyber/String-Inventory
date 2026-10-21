import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatKg, formatNos } from "@/lib/format";
import { getMrnKgEditPct } from "@/server/services/settings";
import { MrnForm } from "./MrnForm";

export default async function MrnPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  await requireUser();
  const [parts, mrns, editPct] = await Promise.all([
    prisma.part.findMany({
      where: { active: true },
      include: { bomLines: { where: { itemId: { not: null } }, include: { item: true }, orderBy: { opSeq: "asc" } } },
      orderBy: { partNo: "asc" },
    }),
    prisma.mrn.findMany({ include: { part: true }, orderBy: { createdAt: "desc" }, take: 25 }),
    getMrnKgEditPct(),
  ]);

  return (
    <div className="space-y-6">
      <h1>Material Requisition Note (MRN)</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        An MRN is a request to Stores. It does not move or reserve stock; wire is picked FIFO only at the actual issue.
      </p>

      <MrnForm
        editPct={editPct}
        parts={parts.map((p) => {
          const item = p.bomLines[0]?.item;
          return {
            id: p.id,
            label: `${p.partNo} — ${p.description}`,
            netWtPerPcKg: Number(p.netWtPerPcKg),
            scrapAllowancePct: Number(p.scrapAllowancePct),
            wire: item ? { grade: item.grade, diameterMm: Number(item.diameterMm), itemCode: item.itemCode } : null,
          };
        })}
      />

      <div className="card p-4">
        <h2 className="font-medium mb-3">Recent MRNs</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2">MRN No.</th>
              <th>Part</th>
              <th>Planned (nos)</th>
              <th>Required (kg)</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {mrns.map((m) => (
              <tr key={m.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{m.mrnNo}</td>
                <td>{m.part.partNo}</td>
                <td>{formatNos(m.plannedQtyNos)}</td>
                <td>{formatKg(m.requiredKg)}</td>
                <td>
                  <StatusBadge status={m.status} />
                </td>
                <td>{formatDate(m.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
