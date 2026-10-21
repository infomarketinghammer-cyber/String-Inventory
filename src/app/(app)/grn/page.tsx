import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Banner } from "@/components/Banner";
import { formatDate, formatKg } from "@/lib/format";
import { GrnForm } from "./GrnForm";
import { NewPoForm } from "./NewPoForm";
import { attachReceiptAction, attachPoDocumentAction } from "./actions";

export default async function GrnPage(props: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const canAddPo = can(user, "masters.manage");

  const [pos, items, suppliers, grns] = await Promise.all([
    prisma.po.findMany({
      include: { supplier: true, lines: { include: { item: true } } },
      orderBy: { poDate: "desc" },
    }),
    prisma.item.findMany({ where: { active: true }, orderBy: { itemCode: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.grn.findMany({
      include: { po: { include: { supplier: true } }, bundles: true },
      orderBy: { grnDate: "desc" },
      take: 20,
    }),
  ]);

  const itemLabel = (i: { grade: string; diameterMm: unknown; itemCode: string }) =>
    `${i.grade} ${Number(i.diameterMm)}mm (${i.itemCode})`;
  const open = pos.filter((p) => p.lines.some((l) => Number(l.orderedKg) - Number(l.receivedKg) > 0));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">GRN — Material Receipt against PO</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      {/* Admin-only: not rendered at all for store keepers (Floor users). */}
      {canAddPo && (
        <details className="card p-4" open={pos.length === 0}>
          <summary className="cursor-pointer font-medium">Add new PO</summary>
          <div className="mt-3">
            <NewPoForm
              suppliers={suppliers.map((s) => ({ id: s.id, label: s.name }))}
              items={items.map((i) => ({ id: i.id, label: itemLabel(i) }))}
            />
            {suppliers.length === 0 && (
              <p className="text-sm mt-2 text-amber-700">No suppliers yet — add one under Masters → Suppliers first.</p>
            )}
          </div>
        </details>
      )}

      <GrnForm
        pos={open.map((po) => ({
          id: po.id,
          poNo: po.poNo,
          supplier: po.supplier.name,
          lines: po.lines.map((l) => ({
            itemId: l.itemId,
            itemLabel: itemLabel(l.item),
            grade: l.item.grade,
            diameterMm: Number(l.item.diameterMm),
            orderedKg: Number(l.orderedKg),
            receivedKg: Number(l.receivedKg),
          })),
        }))}
      />

      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-3">Purchase orders</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2">PO No.</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Line</th>
              <th>Ordered (kg)</th>
              <th>Received (kg)</th>
              <th>Balance (kg)</th>
              <th>PO document</th>
            </tr>
          </thead>
          <tbody>
            {pos.flatMap((po) =>
              po.lines.map((l, idx) => (
                <tr key={l.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2">{idx === 0 ? po.poNo : ""}</td>
                  <td>{idx === 0 ? formatDate(po.poDate) : ""}</td>
                  <td>{idx === 0 ? po.supplier.name : ""}</td>
                  <td>{itemLabel(l.item)}</td>
                  <td>{formatKg(l.orderedKg)}</td>
                  <td>{formatKg(l.receivedKg)}</td>
                  <td>{formatKg(Number(l.orderedKg) - Number(l.receivedKg))}</td>
                  <td>
                    {idx === 0 && (
                      <div className="flex items-center gap-2">
                        {po.documentPath ? (
                          <a href={`/api/po/${po.id}/document`} target="_blank" rel="noreferrer" className="underline">
                            View {po.documentName ?? "PO"}
                          </a>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>None</span>
                        )}
                        {canAddPo && (
                          <form action={attachPoDocumentAction} className="flex items-center gap-1">
                            <input type="hidden" name="poId" value={po.id} />
                            <input
                              name="document"
                              type="file"
                              required
                              aria-label={`PO document for ${po.poNo}`}
                              accept="application/pdf,image/png,image/jpeg,image/webp"
                              className="w-40 text-xs"
                            />
                            <button type="submit" className="text-xs underline">
                              {po.documentPath ? "Replace" : "Upload"}
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )),
            )}
            {pos.length === 0 && (
              <tr>
                <td colSpan={8} className="py-3" style={{ color: "var(--muted)" }}>
                  No purchase orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-4 overflow-x-auto">
        <h2 className="font-medium mb-3">Recent GRNs</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2">GRN No.</th>
              <th>Date</th>
              <th>PO</th>
              <th>Supplier</th>
              <th>Invoice</th>
              <th>Bundles</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            {grns.map((g) => (
              <tr key={g.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{g.grnNo}</td>
                <td>{formatDate(g.grnDate)}</td>
                <td>{g.po.poNo}</td>
                <td>{g.po.supplier.name}</td>
                <td>
                  {g.invoiceNo}
                  {g.invoiceDate ? ` (${formatDate(g.invoiceDate)})` : ""}
                </td>
                <td>
                  {g.bundles.length} ({formatKg(g.bundles.reduce((s, b) => s + Number(b.receivedKg), 0))} kg)
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    {g.receiptPath ? (
                      <a href={`/api/grn/${g.id}/receipt`} target="_blank" rel="noreferrer" className="underline">
                        View {g.receiptName ?? "receipt"}
                      </a>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>None</span>
                    )}
                    <form action={attachReceiptAction} className="flex items-center gap-1">
                      <input type="hidden" name="grnId" value={g.id} />
                      <input
                        name="receipt"
                        type="file"
                        required
                        aria-label={`Receipt file for ${g.grnNo}`}
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        className="w-44 text-xs"
                      />
                      <button type="submit" className="text-xs underline">
                        {g.receiptPath ? "Replace" : "Upload"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
