import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { rejectionReport } from "@/server/services/reports";
import { ExportLinks, ReportTableView } from "@/components/ReportView";
import { Forbidden } from "@/components/Forbidden";

export default async function RejectionReportPage(props: { searchParams: Promise<{ stage?: string; disposal?: string }> }) {
  const sp = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "reports.viewAll")) return <Forbidden what="the Rejection report" />;

  const { table } = await rejectionReport({ stage: sp.stage || undefined, disposal: sp.disposal || undefined });
  const input = "rounded border px-2 py-1.5 bg-transparent";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Rejection Report</h1>
        <ExportLinks report="rejections" params={sp} />
      </div>
      <form className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs mb-1">Stage</label>
          <select name="stage" defaultValue={sp.stage ?? ""} className={input}>
            <option value="">All</option>
            <option value="IQC">IQC</option>
            <option value="WIP">WIP</option>
            <option value="JW_RETURN">JW return</option>
            <option value="FQI">Final inspection</option>
            <option value="CUSTOMER_RETURN">Customer return</option>
          </select>
        </div>
        <div>
          <label className="block text-xs mb-1">Disposal</label>
          <select name="disposal" defaultValue={sp.disposal ?? ""} className={input}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="RTS">Return to supplier</option>
            <option value="REWORK">Rework</option>
            <option value="SCRAP">Scrap</option>
          </select>
        </div>
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Run
        </button>
      </form>
      <ReportTableView table={table} />
    </div>
  );
}
