import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Banner } from "@/components/Banner";
import { formatDate, formatKg, formatNos } from "@/lib/format";
import { getSetting } from "@/server/services/settings";
import {
  addBomLineAction,
  createCustomerAction,
  createItemAction,
  createJobWorkerAction,
  createPartAction,
  createPoAction,
  createReasonCodeAction,
  createScheduleAction,
  createSupplierAction,
  saveSettingsAction,
} from "./actions";

const input = "rounded border px-2 py-1 bg-transparent text-sm";
const btn = "text-sm underline";

export default async function MastersPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const [items, parts, suppliers, jobWorkers, customers, reasonCodes, locations, pos, schedules] = await Promise.all([
    prisma.item.findMany({ orderBy: { itemCode: "asc" } }),
    prisma.part.findMany({
      include: { customer: true, bomLines: { include: { item: true, defaultVendor: true }, orderBy: { opSeq: "asc" } } },
      orderBy: { partNo: "asc" },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.jobWorker.findMany({ orderBy: { name: "asc" } }),
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
    prisma.reasonCode.findMany({ orderBy: { code: "asc" } }),
    prisma.location.findMany({ orderBy: { name: "asc" } }),
    prisma.po.findMany({ include: { supplier: true, lines: { include: { item: true } } }, orderBy: { poDate: "desc" }, take: 15 }),
    prisma.customerSchedule.findMany({ include: { customer: true, part: true }, orderBy: { dueDate: "asc" }, take: 20 }),
  ]);
  const settings = {
    PO_TOLERANCE_PCT: await getSetting(prisma, "PO_TOLERANCE_PCT"),
    AGING_BUCKETS: await getSetting(prisma, "AGING_BUCKETS"),
    QC_HOLD_ALERT_DAYS: await getSetting(prisma, "QC_HOLD_ALERT_DAYS"),
    JW_ALERT_DAYS_BEFORE: await getSetting(prisma, "JW_ALERT_DAYS_BEFORE"),
    MRN_KG_EDIT_PCT: await getSetting(prisma, "MRN_KG_EDIT_PCT"),
  };

  const canManage = can(user, "masters.manage");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Masters {canManage ? "" : "(view-only)"}</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      {canManage && (
        <Section title="Admin settings">
          <form action={saveSettingsAction} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <Field label="PO receipt tolerance (%)">
              <input name="PO_TOLERANCE_PCT" type="number" step="0.1" min="0" defaultValue={settings.PO_TOLERANCE_PCT} className={input} />
            </Field>
            <Field label="Aging buckets (upper days)">
              <input name="AGING_BUCKETS" defaultValue={settings.AGING_BUCKETS} className={input} />
            </Field>
            <Field label="Quality Hold alert (days)">
              <input name="QC_HOLD_ALERT_DAYS" type="number" min="0" defaultValue={settings.QC_HOLD_ALERT_DAYS} className={input} />
            </Field>
            <Field label="JW due alert (days before)">
              <input name="JW_ALERT_DAYS_BEFORE" type="number" min="0" defaultValue={settings.JW_ALERT_DAYS_BEFORE} className={input} />
            </Field>
            <Field label="MRN kg edit limit (± %)">
              <input name="MRN_KG_EDIT_PCT" type="number" step="0.5" min="0" max="100" defaultValue={settings.MRN_KG_EDIT_PCT} className={input} />
            </Field>
            <button type="submit" className={btn}>
              Save settings
            </button>
          </form>
        </Section>
      )}

      <Section title={`Items / Wire grades (${items.length})`}>
        <Table head={["Code", "Grade", "Diameter (mm)", "UOM"]}>
          {items.map((i) => (
            <tr key={i.id} className="border-b" style={{ borderColor: "var(--border)" }}>
              <td className="py-1">{i.itemCode}</td>
              <td>{i.grade}</td>
              <td>{Number(i.diameterMm)}</td>
              <td>{i.uom}</td>
            </tr>
          ))}
        </Table>
        {canManage && (
          <form action={createItemAction} className="mt-3 flex gap-2 flex-wrap">
            <input aria-label="Item code" name="itemCode" placeholder="Item code" required className={input} />
            <input aria-label="Grade" name="grade" placeholder="Grade" required className={input} />
            <input aria-label="Diameter mm" name="diameterMm" type="number" step="0.01" placeholder="Diameter mm" required className={input} />
            <button type="submit" className={btn}>
              Add item
            </button>
          </form>
        )}
      </Section>

      <Section title={`Parts and BOM / routing (${parts.length})`}>
        <div className="space-y-3">
          {parts.map((p) => (
            <div key={p.id} className="border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <div className="text-sm">
                <span className="font-medium">{p.partNo}</span> — {p.description} · {p.customer.name} · {Number(p.netWtPerPcKg)} kg/pc · scrap{" "}
                {Number(p.scrapAllowancePct)}%
              </div>
              <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                {p.bomLines.length === 0
                  ? "No routing yet"
                  : p.bomLines
                      .map(
                        (b) =>
                          `${b.opSeq}. ${b.opName} (${b.opType === "JOB_WORK" ? `JW${b.defaultVendor ? ` @ ${b.defaultVendor.name}` : ""}${b.jwLeadDays ? `, ${b.jwLeadDays}d` : ""}` : "in-house"})${b.item ? ` [wire ${b.item.itemCode}]` : ""}`,
                      )
                      .join("  →  ")}
              </div>
            </div>
          ))}
        </div>
        {canManage && (
          <div className="mt-4 space-y-3">
            <form action={createPartAction} className="flex gap-2 flex-wrap items-end">
              <input aria-label="Part no." name="partNo" placeholder="Part no." required className={input} />
              <select aria-label="Customer" name="customerId" required className={input}>
                <option value="">Customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input aria-label="Description" name="description" placeholder="Description" required className={input} />
              <input aria-label="Net wt/pc (kg)" name="netWtPerPcKg" type="number" step="0.0001" min="0" placeholder="Net wt/pc (kg)" required className={input} />
              <input aria-label="Scrap %" name="scrapAllowancePct" type="number" step="0.1" min="0" defaultValue={0} placeholder="Scrap %" className={`${input} w-24`} />
              <button type="submit" className={btn}>
                Add part
              </button>
            </form>
            <form action={addBomLineAction} className="flex gap-2 flex-wrap items-end">
              <select aria-label="Part" name="partId" required className={input}>
                <option value="">Add routing step to…</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNo}
                  </option>
                ))}
              </select>
              <input aria-label="Seq" name="opSeq" type="number" min="1" placeholder="Seq" required className={`${input} w-20`} />
              <input aria-label="Operation (e.g. Coiling)" name="opName" placeholder="Operation (e.g. Coiling)" required className={input} />
              <select aria-label="Op Type" name="opType" className={input} defaultValue="IN_HOUSE">
                <option value="IN_HOUSE">In-house</option>
                <option value="JOB_WORK">Job work</option>
              </select>
              <select aria-label="Item" name="itemId" className={input}>
                <option value="">Wire item (step 1)…</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.itemCode}
                  </option>
                ))}
              </select>
              <select aria-label="Default Vendor" name="defaultVendorId" className={input}>
                <option value="">Default vendor (JW)…</option>
                {jobWorkers.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
              <input aria-label="JW lead days" name="jwLeadDays" type="number" min="1" placeholder="JW lead days" className={`${input} w-28`} />
              <button type="submit" className={btn}>
                Add step
              </button>
            </form>
          </div>
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title={`Suppliers (${suppliers.length})`}>
          <ul className="text-sm space-y-1">
            {suppliers.map((s) => (
              <li key={s.id}>
                {s.name} {s.gstin && <span style={{ color: "var(--muted)" }}>({s.gstin})</span>}
              </li>
            ))}
          </ul>
          {canManage && (
            <form action={createSupplierAction} className="mt-3 flex gap-2 flex-wrap">
              <input aria-label="Supplier name" name="name" placeholder="Supplier name" required className={input} />
              <input aria-label="GSTIN" name="gstin" placeholder="GSTIN" className={input} />
              <button type="submit" className={btn}>
                Add
              </button>
            </form>
          )}
        </Section>
        <Section title={`Job Workers (${jobWorkers.length})`}>
          <ul className="text-sm space-y-1">
            {jobWorkers.map((j) => (
              <li key={j.id}>
                {j.name} <span style={{ color: "var(--muted)" }}>(max return {j.maxReturnDays}d)</span>
              </li>
            ))}
          </ul>
          {canManage && (
            <form action={createJobWorkerAction} className="mt-3 flex gap-2 flex-wrap">
              <input aria-label="Job worker name" name="name" placeholder="Job worker name" required className={input} />
              <input aria-label="Address" name="address" placeholder="Address" className={input} />
              <input aria-label="GSTIN" name="gstin" placeholder="GSTIN" className={input} />
              <input aria-label="Maximum return days" name="maxReturnDays" type="number" min="1" max="365" defaultValue={10} className={`${input} w-24`} title="Maximum return days" />
              <button type="submit" className={btn}>
                Add
              </button>
            </form>
          )}
        </Section>
        <Section title={`Customers (${customers.length})`}>
          <ul className="text-sm space-y-1">
            {customers.map((c) => (
              <li key={c.id}>{c.name}</li>
            ))}
          </ul>
          {canManage && (
            <form action={createCustomerAction} className="mt-3 flex gap-2 flex-wrap">
              <input aria-label="Customer name" name="name" placeholder="Customer name" required className={input} />
              <input aria-label="GSTIN" name="gstin" placeholder="GSTIN" className={input} />
              <button type="submit" className={btn}>
                Add
              </button>
            </form>
          )}
        </Section>
        <Section title={`Locations (${locations.length})`}>
          <ul className="text-sm space-y-1">
            {locations.map((l) => (
              <li key={l.id}>
                {l.name} <span style={{ color: "var(--muted)" }}>({l.type})</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Purchase orders (reference data for GRN)">
        <Table head={["PO no.", "Supplier", "Date", "Lines (ordered / received kg)"]}>
          {pos.map((p) => (
            <tr key={p.id} className="border-b" style={{ borderColor: "var(--border)" }}>
              <td className="py-1">{p.poNo}</td>
              <td>{p.supplier.name}</td>
              <td>{formatDate(p.poDate)}</td>
              <td>{p.lines.map((l) => `${l.item.itemCode}: ${formatKg(l.orderedKg)} / ${formatKg(l.receivedKg)}`).join("; ")}</td>
            </tr>
          ))}
        </Table>
        {canManage && (
          <form action={createPoAction} className="mt-3 flex gap-2 flex-wrap items-end">
            <input aria-label="PO no. (re-use to add a line)" name="poNo" placeholder="PO no. (re-use to add a line)" required className={input} />
            <select aria-label="Supplier" name="supplierId" required className={input}>
              <option value="">Supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select aria-label="Item" name="itemId" required className={input}>
              <option value="">Wire item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemCode}
                </option>
              ))}
            </select>
            <input aria-label="Ordered kg" name="orderedKg" type="number" step="0.01" min="0.01" placeholder="Ordered kg" required className={input} />
            <button type="submit" className={btn}>
              Add PO / line
            </button>
          </form>
        )}
      </Section>

      <Section title="Customer schedule (reference data for dispatch)">
        <Table head={["Customer", "Part", "Due", "Qty (nos)", "Dispatched"]}>
          {schedules.map((s) => (
            <tr key={s.id} className="border-b" style={{ borderColor: "var(--border)" }}>
              <td className="py-1">{s.customer.name}</td>
              <td>{s.part.partNo}</td>
              <td>{formatDate(s.dueDate)}</td>
              <td>{formatNos(s.qtyNos)}</td>
              <td>{formatNos(s.dispatchedNos)}</td>
            </tr>
          ))}
        </Table>
        {canManage && (
          <form action={createScheduleAction} className="mt-3 flex gap-2 flex-wrap items-end">
            <select aria-label="Part" name="partId" required className={input}>
              <option value="">Part…</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partNo} — {p.customer.name}
                </option>
              ))}
            </select>
            <input aria-label="Due Date" name="dueDate" type="date" required className={input} />
            <input aria-label="Qty (nos)" name="qtyNos" type="number" min="1" placeholder="Qty (nos)" required className={input} />
            <button type="submit" className={btn}>
              Add schedule line
            </button>
          </form>
        )}
      </Section>

      <Section title={`Reason codes (${reasonCodes.length})`}>
        <Table head={["Code", "Stage", "Description"]}>
          {reasonCodes.map((r) => (
            <tr key={r.id} className="border-b" style={{ borderColor: "var(--border)" }}>
              <td className="py-1">{r.code}</td>
              <td>{r.stage}</td>
              <td>{r.description}</td>
            </tr>
          ))}
        </Table>
        {canManage && (
          <form action={createReasonCodeAction} className="mt-3 flex gap-2 flex-wrap">
            <input aria-label="Code" name="code" placeholder="Code" required className={input} />
            <select aria-label="Stage" name="stage" required className={input}>
              <option value="">Stage…</option>
              {["IQC", "WIP", "JW", "FQI", "Customer", "Adjustment"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input aria-label="Description" name="description" placeholder="Description" required className={input} />
            <button type="submit" className={btn}>
              Add reason code
            </button>
          </form>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h2 className="font-medium mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="block mb-1" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            {head.map((h) => (
              <th key={h} className="py-1 pr-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
