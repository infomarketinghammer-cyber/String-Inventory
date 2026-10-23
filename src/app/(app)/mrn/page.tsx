import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { Field, FIELD_INPUT } from "@/components/Field";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatKg, formatNos } from "@/lib/format";
import { getMrnKgEditPct } from "@/server/services/settings";
import { MrnForm } from "./MrnForm";

const MRN_STATUSES = ["OPEN", "PARTIALLY_ISSUED", "CLOSED"] as const;

export default async function MrnPage(props: {
  searchParams: Promise<{ ok?: string; err?: string; q?: string; status?: string; partId?: string }>;
}) {
  const searchParams = await props.searchParams;
  await requireUser();
  const q = searchParams.q?.trim() ?? "";
  const status = MRN_STATUSES.find((s) => s === searchParams.status);
  const partId = searchParams.partId || undefined;
  const filtered = Boolean(q || status || partId);

  const [parts, mrns, editPct] = await Promise.all([
    prisma.part.findMany({
      where: { active: true },
      include: { bomLines: { where: { itemId: { not: null } }, include: { item: true }, orderBy: { opSeq: "asc" } } },
      orderBy: { partNo: "asc" },
    }),
    prisma.mrn.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(partId ? { partId } : {}),
        ...(q
          ? {
              OR: [
                { mrnNo: { contains: q } },
                // RM no.: an issued bundle number, or the wire item code
                { productionLots: { some: { bundleLinks: { some: { bundle: { bundleNo: { contains: q } } } } } } },
                { part: { bomLines: { some: { item: { itemCode: { contains: q } } } } } },
              ],
            }
          : {}),
      },
      include: {
        part: { include: { bomLines: { where: { itemId: { not: null } }, include: { item: true }, orderBy: { opSeq: "asc" } } } },
        productionLots: { include: { bundleLinks: { include: { bundle: { select: { bundleNo: true } } } } } },
      },
      orderBy: { createdAt: "desc" },
      take: filtered ? 200 : 25,
    }),
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

      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-3">{filtered ? `MRNs (${mrns.length} found)` : "Recent MRNs"}</h2>
        <form className="flex flex-wrap gap-3 items-end mb-4">
          <Field label="Search MRN / RM no." className="w-64">
            <input name="q" defaultValue={q} placeholder="MRN-…, RM-… or wire code" className={FIELD_INPUT} />
          </Field>
          <Field label="Part" className="w-44">
            <select name="partId" defaultValue={partId ?? ""} className={FIELD_INPUT}>
              <option value="">All parts</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partNo}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status" className="w-44">
            <select name="status" defaultValue={status ?? ""} className={FIELD_INPUT}>
              <option value="">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="PARTIALLY_ISSUED">Partially Issued</option>
              <option value="CLOSED">Closed</option>
            </select>
          </Field>
          <button type="submit" className="btn-secondary text-sm px-3 py-1.5">
            Apply
          </button>
          {filtered && (
            <a href="/mrn" className="text-sm underline self-center">
              Clear
            </a>
          )}
        </form>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2">MRN No.</th>
              <th>Part</th>
              <th>RM (wire)</th>
              <th>RM bundle no(s). issued</th>
              <th>Planned (nos)</th>
              <th>Required (kg)</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {mrns.map((m) => {
              const wire = m.part.bomLines[0]?.item;
              const bundleNos = [
                ...new Set(m.productionLots.flatMap((l) => l.bundleLinks.map((b) => b.bundle.bundleNo))),
              ];
              return (
                <tr key={m.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 whitespace-nowrap">{m.mrnNo}</td>
                  <td>{m.part.partNo}</td>
                  <td className="whitespace-nowrap">
                    {/* One line: grade + diameter (the item code says the same thing, so it is only the tooltip). */}
                    {wire ? (
                      <span title={`Item code ${wire.itemCode}`}>
                        {wire.grade} · {Number(wire.diameterMm)} mm
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="text-xs">{bundleNos.join(", ") || <span style={{ color: "var(--muted)" }}>not issued yet</span>}</td>
                  <td>{formatNos(m.plannedQtyNos)}</td>
                  <td>{formatKg(m.requiredKg)}</td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="whitespace-nowrap">{formatDate(m.createdAt)}</td>
                </tr>
              );
            })}
            {mrns.length === 0 && (
              <tr>
                <td colSpan={8} className="py-3" style={{ color: "var(--muted)" }}>
                  No MRNs match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
