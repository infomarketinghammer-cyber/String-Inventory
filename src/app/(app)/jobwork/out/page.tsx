import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatNos } from "@/lib/format";
import { listPendingForJobWork } from "@/server/services/production";
import { createJwOutAction } from "./actions";

const field = "rounded border px-2 py-1.5 bg-transparent text-sm w-full";

export default async function JwOutPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const [pendingLots, vendors, challans] = await Promise.all([
    listPendingForJobWork(),
    prisma.jobWorker.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.jwOutChallan.findMany({
      include: { vendor: true, lines: { include: { lot: true } } },
      orderBy: { date: "desc" },
      take: 20,
    }),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const firstOp = pendingLots[0]?.part.bomLines.find((b) => b.opSeq === pendingLots[0]!.currentOpSeq);

  return (
    <div className="space-y-6">
      <h1>Job Work — Out Challan</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      <form action={createJwOutAction} className="card p-4 space-y-4">
        <div>
          <h2 className="font-medium">Lots pending to send for job work</h2>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Listed oldest first. Tick the lots going to one job worker on this challan (several lots / Part Nos. allowed).
            FIFO is enforced per operation: the oldest waiting lot must go first. Whole lots are sent.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2 w-10">Send</th>
                <th>Lot</th>
                <th>Part No.</th>
                <th>Operation</th>
                <th>Suggested vendor</th>
                <th>Started</th>
                <th>Qty (nos)</th>
                <th>Qty (kg, ref)</th>
              </tr>
            </thead>
            <tbody>
              {pendingLots.map((lot) => {
                const op = lot.part.bomLines.find((b) => b.opSeq === lot.currentOpSeq);
                const estKg = Math.round(lot.qtyNos * Number(lot.part.netWtPerPcKg) * 100) / 100;
                return (
                  <tr key={lot.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2">
                      <input type="checkbox" name="lotIds" value={lot.id} aria-label={`Send ${lot.lotNo}`} />
                      <input type="hidden" name={`nos[${lot.id}]`} value={lot.qtyNos} />
                    </td>
                    <td className="font-medium">{lot.lotNo}</td>
                    <td>{lot.part.partNo}</td>
                    <td>
                      {lot.currentOpSeq}. {op?.opName}
                    </td>
                    <td>{op?.defaultVendorId ? vendorName.get(op.defaultVendorId) : "—"}</td>
                    <td>{formatDate(lot.startDate)}</td>
                    <td>{formatNos(lot.qtyNos)}</td>
                    <td className="w-32">
                      <input
                        name={`kg[${lot.id}]`}
                        type="number"
                        step="0.01"
                        min="0.01"
                        defaultValue={estKg || undefined}
                        aria-label={`kg for ${lot.lotNo}`}
                        className={field}
                      />
                    </td>
                  </tr>
                );
              })}
              {pendingLots.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-3" style={{ color: "var(--muted)" }}>
                    Nothing pending for job work.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pendingLots.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <label className="text-sm font-medium">
              Job worker <span className="text-red-600">*</span>
              <select name="vendorId" required defaultValue={firstOp?.defaultVendorId ?? ""} className={field}>
                <option value="">Select job worker...</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} (max {v.maxReturnDays} d)
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Expected return date
              <input name="expectedReturnDate" type="date" className={field} />
              <span className="block text-xs font-normal" style={{ color: "var(--muted)" }}>
                Blank = challan date + agreed lead time
              </span>
            </label>
            {isAdmin ? (
              <label className="text-sm font-medium">
                FIFO override reason (Admin)
                <input name="overrideReason" placeholder="only if skipping an older lot" className={field} />
              </label>
            ) : (
              <span />
            )}
            <button type="submit" className="btn-primary px-4 py-2 text-sm min-h-11">
              Create challan
            </button>
          </div>
        )}
      </form>

      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-3">Recent challans</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2">Challan No.</th>
              <th>Date</th>
              <th>Vendor</th>
              <th>Lots</th>
              <th>Expected return</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {challans.map((c) => (
              <tr key={c.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{c.challanNo}</td>
                <td>{formatDate(c.date)}</td>
                <td>{c.vendor.name}</td>
                <td>{c.lines.map((l) => l.lot.lotNo).join(", ")}</td>
                <td>{formatDate(c.expectedReturnDate)}</td>
                <td>
                  <StatusBadge status={c.status !== "CLOSED" && c.expectedReturnDate < new Date() ? "OVERDUE" : c.status} />
                </td>
                <td>
                  <a href={`/print/jw-challan/${c.id}`} target="_blank" rel="noreferrer" className="underline text-xs">
                    Print challan
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
