import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { formatDate, formatKg, formatNos } from "@/lib/format";

/** Printable Job Work Out Challan (SOP 4.7 step 3: "Print challan; material leaves"). */
export default async function JwChallanPrintPage(props: { params: Promise<{ challanId: string }> }) {
  const params = await props.params;
  await requireUser();
  const challan = await prisma.jwOutChallan.findUnique({
    where: { id: params.challanId },
    include: {
      vendor: true,
      lines: { include: { lot: { include: { part: { include: { bomLines: true } } } } } },
    },
  });
  if (!challan) notFound();
  const totalNos = challan.lines.reduce((s, l) => s + l.qtyNos, 0);
  const totalKg = challan.lines.reduce((s, l) => s + Number(l.qtyKg), 0);

  return (
    <div className="max-w-3xl mx-auto card p-8 print:border-0 print:shadow-none">
      <div className="flex items-start justify-between border-b pb-4 mb-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <div>
            <div className="text-lg font-semibold">Job Work Delivery Challan</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              Material sent for processing — remains our property
            </div>
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{challan.challanNo}</div>
          <div>Date: {formatDate(challan.date)}</div>
          <div>Expected return: {formatDate(challan.expectedReturnDate)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm mb-5">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Job worker
          </div>
          <div className="font-medium">{challan.vendor.name}</div>
          {challan.vendor.address && <div>{challan.vendor.address}</div>}
          {challan.vendor.gstin && <div>GSTIN: {challan.vendor.gstin}</div>}
        </div>
        <div className="no-print text-right">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Use your browser&apos;s Print (Ctrl+P)
          </span>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            <th className="py-1">#</th>
            <th>Production Lot</th>
            <th>Part No.</th>
            <th>Description</th>
            <th>Operation</th>
            <th className="text-right">Qty (nos)</th>
            <th className="text-right">Qty (kg)</th>
          </tr>
        </thead>
        <tbody>
          {challan.lines.map((l, i) => {
            const op = l.lot.part.bomLines.find((b) => b.opSeq === l.opSeq);
            return (
              <tr key={l.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-1">{i + 1}</td>
                <td>{l.lot.lotNo}</td>
                <td>{l.lot.part.partNo}</td>
                <td>{l.lot.part.description}</td>
                <td>{op?.opName ?? `Op ${l.opSeq}`}</td>
                <td className="text-right">{formatNos(l.qtyNos)}</td>
                <td className="text-right">{formatKg(l.qtyKg)}</td>
              </tr>
            );
          })}
          <tr className="font-semibold">
            <td colSpan={5} className="py-1 text-right">
              Total
            </td>
            <td className="text-right">{formatNos(totalNos)}</td>
            <td className="text-right">{formatKg(totalKg)}</td>
          </tr>
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-8 mt-16 text-sm">
        <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
          Issued by (Stores)
        </div>
        <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
          Received by (Job worker)
        </div>
      </div>
    </div>
  );
}
