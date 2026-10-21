import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { formatDate, formatNos } from "@/lib/format";

export default async function DispatchNotePage(props: { params: Promise<{ dispatchId: string }> }) {
  const params = await props.params;
  await requireUser();
  const dispatch = await prisma.dispatch.findUnique({
    where: { id: params.dispatchId },
    include: { customer: true, lines: { include: { fgLot: { include: { part: true } } } } },
  });
  if (!dispatch) notFound();

  return (
    <div className="max-w-xl mx-auto card p-6 print:border-0">
      <h1 className="text-lg font-semibold mb-1">Dispatch Note</h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        {dispatch.dispatchNo} · {formatDate(dispatch.date)}
      </p>
      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
        <div>
          <div style={{ color: "var(--muted)" }}>Customer</div>
          <div>{dispatch.customer.name}</div>
        </div>
        <div>
          <div style={{ color: "var(--muted)" }}>Invoice No.</div>
          <div>{dispatch.invoiceNo}</div>
        </div>
        <div>
          <div style={{ color: "var(--muted)" }}>Vehicle No.</div>
          <div>{dispatch.vehicleNo ?? "-"}</div>
        </div>
        <div>
          <div style={{ color: "var(--muted)" }}>Packing details</div>
          <div>{dispatch.packingDetails ?? "-"}</div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            <th className="py-1">FG Lot</th>
            <th>Part</th>
            <th>Qty (nos)</th>
          </tr>
        </thead>
        <tbody>
          {dispatch.lines.map((l) => (
            <tr key={l.id} className="border-b" style={{ borderColor: "var(--border)" }}>
              <td className="py-1">{l.fgLot.fgLotNo}</td>
              <td>{l.fgLot.part.partNo}</td>
              <td>{formatNos(l.qtyNos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
