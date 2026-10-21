import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { jobWorkReport } from "@/server/services/reports";
import { ExportLinks, ReportTableView } from "@/components/ReportView";
import { Forbidden } from "@/components/Forbidden";

export default async function JobWorkReportPage(props: { searchParams: Promise<{ asOn?: string }> }) {
  const sp = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "reports.viewLimited")) return <Forbidden what="the Job Work report" />;

  const d = sp.asOn ? new Date(sp.asOn) : new Date();
  const asOn = Number.isNaN(d.getTime()) ? new Date() : d;
  const { summary, detail } = await jobWorkReport(asOn);
  const statusCol = detail.columns.length - 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Job Work Report</h1>
        <ExportLinks report="jobwork" params={{ asOn: asOn.toISOString().slice(0, 10) }} />
      </div>
      <form className="card p-4 flex gap-3 items-end">
        <div>
          <label className="block text-xs mb-1">As on date</label>
          <input type="date" name="asOn" defaultValue={asOn.toISOString().slice(0, 10)} className="rounded border px-2 py-1.5 bg-transparent" />
        </div>
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Run
        </button>
      </form>
      <ReportTableView table={summary} highlight={(r) => Number(r[4]) > 0} />
      <ReportTableView table={detail} highlight={(r) => r[statusCol] === "Overdue"} />
    </div>
  );
}
