import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { mrnStatusTable } from "@/server/services/reports";
import { ExportLinks, ReportTableView } from "@/components/ReportView";
import { Forbidden } from "@/components/Forbidden";

export default async function MrnStatusPage() {
  const user = await requireUser();
  if (!can(user, "reports.viewLimited")) return <Forbidden what="the MRN Status report" />;
  const table = await mrnStatusTable();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">MRN Status Report (Open / Partially Issued)</h1>
        <ExportLinks report="mrn-status" params={{}} />
      </div>
      <ReportTableView table={table} />
    </div>
  );
}
