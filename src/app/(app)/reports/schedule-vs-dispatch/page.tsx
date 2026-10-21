import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { scheduleVsDispatchTable } from "@/server/services/reports";
import { ExportLinks, ReportTableView } from "@/components/ReportView";
import { Forbidden } from "@/components/Forbidden";

export default async function ScheduleVsDispatchPage() {
  const user = await requireUser();
  if (!can(user, "reports.viewAll")) return <Forbidden what="the Schedule vs Dispatch report" />;
  const table = await scheduleVsDispatchTable();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Schedule vs Dispatch Report</h1>
        <ExportLinks report="schedule-vs-dispatch" params={{}} />
      </div>
      <ReportTableView table={table} highlight={(r) => Number(r[5]) > 0 && Number(r[6]) < Number(r[5])} />
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Highlighted rows: shortfall exceeds the FG currently available for that Part.
      </p>
    </div>
  );
}
