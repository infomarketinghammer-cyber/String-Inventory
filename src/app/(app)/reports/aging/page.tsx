import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { agingReport, type ItemKind } from "@/server/services/reports";
import { ExportLinks, ReportTableView } from "@/components/ReportView";
import { Forbidden } from "@/components/Forbidden";

type SP = { asOn?: string; type?: string; status?: string; grade?: string; partNo?: string; customer?: string };

export default async function AgingReportPage(props: { searchParams: Promise<SP> }) {
  const sp = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "reports.viewAll")) return <Forbidden what="the Inventory Aging report" />;

  const asOnDate = sp.asOn ? new Date(sp.asOn) : new Date();
  const asOn = Number.isNaN(asOnDate.getTime()) ? new Date() : asOnDate;
  const itemType = (["RM", "WIP", "FG"].includes(sp.type ?? "") ? sp.type : "RM") as ItemKind;
  const { bucketTotals, bucketQty, labels, topBucketLabel, unit, table } = await agingReport(asOn, itemType, {
    status: sp.status || undefined,
    grade: sp.grade || undefined,
    partNo: sp.partNo || undefined,
    customer: sp.customer || undefined,
  });
  const [items, parts, customers] = await Promise.all([
    prisma.item.findMany({ select: { grade: true }, distinct: ["grade"], orderBy: { grade: "asc" } }),
    prisma.part.findMany({ select: { partNo: true }, orderBy: { partNo: "asc" } }),
    prisma.customer.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  const input = "rounded border px-2 py-1.5 bg-transparent";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inventory Aging Report</h1>
        <ExportLinks report="aging" params={{ ...sp, type: itemType, asOn: asOn.toISOString().slice(0, 10) }} />
      </div>
      <form className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs mb-1">As on date</label>
          <input type="date" name="asOn" defaultValue={asOn.toISOString().slice(0, 10)} className={input} />
        </div>
        <div>
          <label className="block text-xs mb-1">Item type</label>
          <select name="type" defaultValue={itemType} className={input}>
            <option value="RM">RM</option>
            <option value="WIP">WIP</option>
            <option value="FG">FG</option>
          </select>
        </div>
        <div>
          <label className="block text-xs mb-1">Status</label>
          <select name="status" defaultValue={sp.status ?? ""} className={input}>
            <option value="">All</option>
            {itemType === "RM" && (
              <>
                <option value="QUALITY_HOLD">Quality Hold</option>
                <option value="AVAILABLE">Available</option>
                <option value="REJECTED">Rejected</option>
              </>
            )}
            {itemType === "WIP" && (
              <>
                <option value="IN_HOUSE">In-house</option>
                <option value="AT_JOB_WORK">At job work</option>
                <option value="JW_RETURN_QC">JW return QC</option>
                <option value="REJECTED">Rejected</option>
              </>
            )}
            {itemType === "FG" && <option value="AVAILABLE">Available</option>}
          </select>
        </div>
        {itemType === "RM" && (
          <div>
            <label className="block text-xs mb-1">Wire grade</label>
            <select name="grade" defaultValue={sp.grade ?? ""} className={input}>
              <option value="">All</option>
              {items.map((i) => (
                <option key={i.grade} value={i.grade}>
                  {i.grade}
                </option>
              ))}
            </select>
          </div>
        )}
        {itemType !== "RM" && (
          <>
            <div>
              <label className="block text-xs mb-1">Part no.</label>
              <select name="partNo" defaultValue={sp.partNo ?? ""} className={input}>
                <option value="">All</option>
                {parts.map((p) => (
                  <option key={p.partNo} value={p.partNo}>
                    {p.partNo}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1">Customer</label>
              <select name="customer" defaultValue={sp.customer ?? ""} className={input}>
                <option value="">All</option>
                {customers.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Run
        </button>
      </form>

      <div className="card p-4">
        <h2 className="font-medium mb-3">Totals by age bucket</h2>
        <div className="flex flex-wrap gap-6 text-sm">
          {labels.map((l) => (
            <div key={l}>
              <div style={{ color: "var(--muted)" }}>{l} days</div>
              <div className="text-lg font-semibold">{bucketTotals.get(l) ?? 0} units</div>
              <div style={{ color: "var(--muted)" }}>
                {(bucketQty.get(l) ?? 0).toFixed(unit === "kg" ? 2 : 0)} {unit}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ReportTableView table={table} highlight={(r) => r[6] === topBucketLabel} />
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Rows in the oldest bucket ({topBucketLabel} days) are highlighted. RM and FG are rebuilt from the Stock Ledger as
        on the chosen date; WIP shows each lot&apos;s current state for lots started on or before it.
      </p>
    </div>
  );
}
