import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Banner } from "@/components/Banner";
import { Field, FIELD_INPUT } from "@/components/Field";
import { formatDate, formatKg } from "@/lib/format";
import { localDateString } from "@/server/services/grn";
import { poOcrEnabled } from "@/server/services/poOcr";
import { GrnForm } from "./GrnForm";
import { UploadOnceButton } from "./UploadOnceButton";
import { NewPoForm } from "./NewPoForm";
import { attachReceiptAction, attachPoDocumentAction } from "./actions";

export default async function GrnPage(props: {
  searchParams: Promise<{ ok?: string; err?: string; q?: string; supplierId?: string }>;
}) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const canAddPo = can(user, "masters.manage");
  const canReceive = can(user, "grn.create");
  // Filters for the Recent GRNs list
  const q = searchParams.q?.trim() || undefined;
  const supplierFilter = searchParams.supplierId || undefined;
  const grnFiltered = Boolean(q || supplierFilter);

  const [pos, items, suppliers, grns] = await Promise.all([
    prisma.po.findMany({
      include: { supplier: true, lines: { include: { item: true } } },
      orderBy: { poDate: "desc" },
    }),
    prisma.item.findMany({ where: { active: true }, orderBy: { itemCode: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.grn.findMany({
      where: {
        ...(supplierFilter ? { po: { supplierId: supplierFilter } } : {}),
        ...(q
          ? {
              OR: [
                { grnNo: { contains: q } },
                { invoiceNo: { contains: q } },
                { po: { poNo: { contains: q } } },
                { bundles: { some: { bundleNo: { contains: q } } } },
              ],
            }
          : {}),
      },
      include: { po: { include: { supplier: true } }, bundles: true },
      orderBy: { grnDate: "desc" },
      take: grnFiltered ? 200 : 20,
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
              ocrEnabled={poOcrEnabled()}
            />
            {suppliers.length === 0 && (
              <p className="text-sm mt-2 text-amber-700">No suppliers yet — add one under Masters → Suppliers first.</p>
            )}
          </div>
        </details>
      )}

      <GrnForm
        today={localDateString(new Date())}
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
                      // Uploaded once; afterwards it can only be viewed.
                      <div className="flex items-center gap-2">
                        {po.documentPath ? (
                          <a
                            href={`/api/po/${po.id}/document`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary px-3 py-1 text-xs font-medium whitespace-nowrap"
                            title={po.documentName ?? undefined}
                          >
                            View
                          </a>
                        ) : canAddPo ? (
                          <UploadOnceButton
                            action={attachPoDocumentAction}
                            hidden={{ poId: po.id }}
                            fileField="document"
                            ariaLabel={`Upload PO document for ${po.poNo}`}
                          />
                        ) : (
                          <span style={{ color: "var(--muted)" }}>Not uploaded</span>
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
        <h2 className="font-medium mb-3">{grnFiltered ? `GRNs (${grns.length} found)` : "Recent GRNs"}</h2>
        <form className="flex flex-wrap gap-3 items-end mb-4">
          <Field label="Search GRN / PO / invoice / bundle" className="w-72">
            <input name="q" defaultValue={q} placeholder="e.g. GRN-2627-0102" className={FIELD_INPUT} />
          </Field>
          <Field label="Supplier" className="w-56">
            <select name="supplierId" defaultValue={supplierFilter ?? ""} className={FIELD_INPUT}>
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="btn-secondary text-sm px-3 py-1.5">
            Apply
          </button>
          {grnFiltered && (
            <a href="/grn" className="text-sm underline self-center">
              Clear
            </a>
          )}
        </form>
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
                  {/* Uploaded once; afterwards it can only be viewed. */}
                  <div className="flex items-center gap-2">
                    {g.receiptPath ? (
                      <a
                        href={`/api/grn/${g.id}/receipt`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary px-3 py-1 text-xs font-medium whitespace-nowrap"
                        title={g.receiptName ?? undefined}
                      >
                        View
                      </a>
                    ) : canReceive ? (
                      <UploadOnceButton
                        action={attachReceiptAction}
                        hidden={{ grnId: g.id }}
                        fileField="receipt"
                        ariaLabel={`Upload receipt for ${g.grnNo}`}
                      />
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Not uploaded</span>
                    )}
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
