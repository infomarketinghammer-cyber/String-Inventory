import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { stockSummaryReport } from "@/server/services/reports";
import { ExportLinks, ReportTableView } from "@/components/ReportView";
import { Forbidden } from "@/components/Forbidden";

export default async function StockSummaryPage(props: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "reports.viewLimited")) return <Forbidden what="the Stock Summary report" />;

  const valid = (s?: string) => (s && !Number.isNaN(new Date(s).getTime()) ? new Date(s) : undefined);
  const to = valid(sp.to) ?? new Date();
  const from = valid(sp.from) ?? new Date(to.getTime() - 90 * 86400000);
  const { table } = await stockSummaryReport(from, to);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Stock Summary Report</h1>
        <ExportLinks report="stock-summary" params={{ from: fromStr, to: toStr }} />
      </div>
      <form className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs mb-1">From</label>
          <input type="date" name="from" defaultValue={fromStr} className="rounded border px-2 py-1.5 bg-transparent" />
        </div>
        <div>
          <label className="block text-xs mb-1">To</label>
          <input type="date" name="to" defaultValue={toStr} className="rounded border px-2 py-1.5 bg-transparent" />
        </div>
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Run
        </button>
      </form>
      <ReportTableView table={table} />
    </div>
  );
}
