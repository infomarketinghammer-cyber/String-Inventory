import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Banner } from "@/components/Banner";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatNos } from "@/lib/format";
import { createJwInAction, jwReturnQcAction, closeChallanAction } from "./actions";

export default async function JwInPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const openChallans = await prisma.jwOutChallan.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
    include: { vendor: true, lines: { include: { lot: true } } },
    orderBy: { expectedReturnDate: "asc" },
  });
  const qcPendingLots = await prisma.productionLot.findMany({
    where: { status: "JW_RETURN_QC" },
    include: { part: true },
  });
  const reasonCodes = await prisma.reasonCode.findMany({ where: { stage: "JW" } });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Job Work — In Receipt &amp; Return QC</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      <div className="card p-4">
        <h2 className="font-medium mb-3">Open challans</h2>
        <div className="space-y-3">
          {openChallans.map((c) => {
            const overdue = c.expectedReturnDate < new Date();
            return (
              <div key={c.id} className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex justify-between text-sm mb-2">
                  <span>
                    <span className="font-medium">{c.challanNo}</span> — {c.vendor.name} · Expected{" "}
                    {formatDate(c.expectedReturnDate)}
                  </span>
                  <StatusBadge status={overdue ? "OVERDUE" : c.status} />
                </div>
                {c.lines.map((line) => {
                  const pending = line.qtyNos - line.receivedNos - line.rejectedNos - line.shortNos;
                  return (
                    <form key={line.id} action={createJwInAction} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end mb-2">
                      <input type="hidden" name="challanId" value={c.id} />
                      <input type="hidden" name="challanLineId" value={line.id} />
                      <div className="text-sm">
                        {line.lot.lotNo} · pending {formatNos(pending)} nos
                      </div>
                      <input aria-label="Received good" name="receivedNos" type="number" min="0" max={pending} placeholder="Received good" className="rounded border px-2 py-1.5 bg-transparent text-sm" />
                      <input aria-label="Rejected by vendor" name="rejectedNos" type="number" min="0" defaultValue={0} placeholder="Rejected by vendor" className="rounded border px-2 py-1.5 bg-transparent text-sm" />
                      <input aria-label="Short/lost" name="shortNos" type="number" min="0" defaultValue={0} placeholder="Short/lost" className="rounded border px-2 py-1.5 bg-transparent text-sm" />
                      <select aria-label="Reason Code" name="reasonCodeId" className="rounded border px-2 py-1.5 bg-transparent text-sm">
                        <option value="">Reason (if vendor-rejected)...</option>
                        {reasonCodes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.code}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="text-sm btn-primary px-3 py-1.5 min-h-11">
                        Save receipt
                      </button>
                    </form>
                  );
                })}
                {can(user, "jw.closeWithShortage") && (
                  <form action={closeChallanAction} className="flex gap-2 items-end mt-1">
                    <input type="hidden" name="challanId" value={c.id} />
                    <input aria-label="Reason to close with shortage" name="reason" placeholder="Reason to close with shortage" className="rounded border px-2 py-1 bg-transparent text-xs flex-1" />
                    <button type="submit" className="text-xs underline">
                      Close with shortage (Admin)
                    </button>
                  </form>
                )}
              </div>
            );
          })}
          {openChallans.length === 0 && <p style={{ color: "var(--muted)" }}>No open challans.</p>}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-3">Awaiting JW Return QC decision</h2>
        <div className="space-y-2">
          {qcPendingLots.map((lot) => (
            <form key={lot.id} action={jwReturnQcAction} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <input type="hidden" name="lotId" value={lot.id} />
              <div className="text-sm">
                {lot.lotNo} — {lot.part.partNo}
                <div style={{ color: "var(--muted)" }}>{formatNos(lot.qtyNos)} nos received for QC</div>
              </div>
              <input aria-label="Accepted (nos)" name="acceptedNos" type="number" min="0" max={lot.qtyNos} defaultValue={lot.qtyNos} placeholder="Accepted (nos)" required className="rounded border px-2 py-1.5 bg-transparent text-sm" />
              <input aria-label="Rejected (nos)" name="rejectedNos" type="number" min="0" defaultValue={0} placeholder="Rejected (nos)" className="rounded border px-2 py-1.5 bg-transparent text-sm" />
              <select aria-label="Reason Code" name="reasonCodeId" className="rounded border px-2 py-1.5 bg-transparent text-sm">
                <option value="">Reason (if rejected)...</option>
                {reasonCodes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code}
                  </option>
                ))}
              </select>
              <button type="submit" className="text-sm btn-primary px-3 py-1.5 min-h-11">
                Save QC decision
              </button>
            </form>
          ))}
          {qcPendingLots.length === 0 && <p style={{ color: "var(--muted)" }}>Nothing awaiting JW return QC.</p>}
        </div>
      </div>
    </div>
  );
}
