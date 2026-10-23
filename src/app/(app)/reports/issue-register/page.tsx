import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { issueRegisterTable } from "@/server/services/registers";
import { ExportLinks, ReportTableView } from "@/components/ReportView";
import { Forbidden } from "@/components/Forbidden";
import { Field, FIELD_INPUT } from "@/components/Field";

/** Store's record of every issue: issue no., MRN, bundle, kg issued and the bundle balance left after it. */
export default async function IssueRegisterPage(props: { searchParams: Promise<{ from?: string; to?: string; q?: string }> }) {
  const sp = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "reports.viewLimited")) return <Forbidden what="the Issue Register" />;

  const valid = (s?: string) => (s && !Number.isNaN(new Date(s).getTime()) ? new Date(s) : undefined);
  const from = valid(sp.from);
  const to = valid(sp.to);
  const q = sp.q?.trim() || undefined;
  const table = await issueRegisterTable({ from, to, q });
  const params = { from: sp.from, to: sp.to, q };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Issue Register</h1>
        <ExportLinks report="issue-register" params={params} csv />
      </div>
      <form className="card p-4 flex flex-wrap gap-3 items-end">
        <Field label="From">
          <input type="date" name="from" defaultValue={sp.from} className={FIELD_INPUT} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={sp.to} className={FIELD_INPUT} />
        </Field>
        <Field label="Search issue / MRN / bundle / part" className="w-72">
          <input name="q" defaultValue={q} placeholder="e.g. MRN-2610-0008 or RM-2608-0006" className={FIELD_INPUT} />
        </Field>
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Apply
        </button>
        {(sp.from || sp.to || q) && (
          <a href="/reports/issue-register" className="text-sm underline self-center">
            Clear
          </a>
        )}
      </form>
      <ReportTableView table={table} />
    </div>
  );
}
