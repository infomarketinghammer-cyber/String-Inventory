import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { poRegisterTable } from "@/server/services/registers";
import { ExportLinks, ReportTableView } from "@/components/ReportView";
import { Forbidden } from "@/components/Forbidden";
import { Field, FIELD_INPUT } from "@/components/Field";

/** PO register (ordered / received / balance per wire line), exportable to Excel / CSV / PDF for IQC. */
export default async function PoRegisterPage(props: {
  searchParams: Promise<{ supplierId?: string; status?: string; q?: string }>;
}) {
  const sp = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "reports.viewLimited")) return <Forbidden what="the PO Register" />;

  const status = sp.status === "OPEN" || sp.status === "CLOSED" ? sp.status : undefined;
  const q = sp.q?.trim() || undefined;
  const [suppliers, table] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    poRegisterTable({ supplierId: sp.supplierId || undefined, status, q }),
  ]);
  const params = { supplierId: sp.supplierId, status, q };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">PO Register</h1>
        <ExportLinks report="po-register" params={params} csv />
      </div>
      <form className="card p-4 flex flex-wrap gap-3 items-end">
        <Field label="Supplier" className="w-56">
          <select name="supplierId" defaultValue={sp.supplierId ?? ""} className={FIELD_INPUT}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" className="w-44">
          <select name="status" defaultValue={status ?? ""} className={FIELD_INPUT}>
            <option value="">All</option>
            <option value="OPEN">Open (balance left)</option>
            <option value="CLOSED">Fully received</option>
          </select>
        </Field>
        <Field label="Search PO / GRN no." className="w-60">
          <input name="q" defaultValue={q} placeholder="e.g. PO-2627-0101" className={FIELD_INPUT} />
        </Field>
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Apply
        </button>
        {(sp.supplierId || status || q) && (
          <a href="/reports/po-register" className="text-sm underline self-center">
            Clear
          </a>
        )}
      </form>
      <ReportTableView table={table} />
    </div>
  );
}
