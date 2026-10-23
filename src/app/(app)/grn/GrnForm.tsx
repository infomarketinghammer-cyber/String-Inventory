"use client";

import { useMemo, useState } from "react";
import { UPLOAD_ACCEPT, UPLOAD_HINT } from "@/lib/uploads";
import { createGrnAction } from "./actions";

interface PoLine {
  itemId: string;
  itemLabel: string;
  grade: string;
  diameterMm: number;
  orderedKg: number;
  receivedKg: number;
}
interface Po {
  id: string;
  poNo: string;
  supplier: string;
  lines: PoLine[];
}

const field = "w-full rounded border px-2 py-1.5 bg-transparent";
const label = "block text-sm font-medium mb-1";

export function GrnForm({ pos, today }: { pos: Po[]; today: string }) {
  const [poId, setPoId] = useState("");
  const [rows, setRows] = useState([{ key: 0 }]);
  const [nextKey, setNextKey] = useState(1);
  const po = useMemo(() => pos.find((p) => p.id === poId), [pos, poId]);

  return (
    <form action={createGrnAction} className="card p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <label htmlFor="grn-poId" className={label}>
            Purchase Order <span className="text-red-600">*</span>
          </label>
          <select id="grn-poId" name="poId" required value={poId} onChange={(e) => setPoId(e.target.value)} className={field}>
            <option value="">Select open PO...</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.poNo} — {p.supplier}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="grn-invoiceNo" className={label}>
            Supplier Invoice No. <span className="text-red-600">*</span>
          </label>
          <input id="grn-invoiceNo" name="invoiceNo" required className={field} />
        </div>
        <div>
          <label htmlFor="grn-invoiceDate" className={label}>
            Invoice Date <span className="text-red-600">*</span>
          </label>
          {/* Compulsory; no post-dated invoices (the server checks both too). */}
          <input id="grn-invoiceDate" name="invoiceDate" type="date" max={today} required className={field} />
        </div>
        <div>
          <label htmlFor="grn-vehicleNo" className={label}>
            Vehicle No. <span className="text-red-600">*</span>
          </label>
          <input id="grn-vehicleNo" name="vehicleNo" required placeholder="e.g. MH12AB1234" className={field} />
        </div>
        <div className="md:col-span-3">
          <label htmlFor="grn-receipt" className={label}>
            Upload receipt (supplier invoice / delivery challan)
          </label>
          <input
            id="grn-receipt"
            name="receipt"
            type="file"
            accept={UPLOAD_ACCEPT}
            className="block w-full text-sm"
          />
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {UPLOAD_HINT}
          </p>
        </div>
      </div>

      {po && (
        <div className="rounded border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
          <div className="font-medium mb-2">
            {po.poNo} — PO lines. Enter the quantity received on each line you are receiving (limited to balance + the PO
            tolerance); it must equal the bundle weights entered below.
          </div>
          <div className="hidden md:grid grid-cols-12 gap-2 text-xs mb-1" style={{ color: "var(--muted)" }}>
            <div className="col-span-4">Wire item</div>
            <div className="col-span-2">Ordered (kg)</div>
            <div className="col-span-2">Received so far (kg)</div>
            <div className="col-span-2">Balance (kg)</div>
            <div className="col-span-2">Received now (kg)</div>
          </div>
          <div className="space-y-2">
            {po.lines.map((l) => (
              <div key={l.itemId} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center">
                <div className="col-span-2 md:col-span-4">{l.itemLabel}</div>
                <div className="md:col-span-2">{l.orderedKg.toFixed(2)}</div>
                <div className="md:col-span-2">{l.receivedKg.toFixed(2)}</div>
                <div className="md:col-span-2 font-medium">{(l.orderedKg - l.receivedKg).toFixed(2)}</div>
                <div className="col-span-2 md:col-span-2">
                  <label htmlFor={`lq-${l.itemId}`} className="md:hidden text-xs">
                    Received now (kg)
                  </label>
                  <input id={`lq-${l.itemId}`} name={`lineQty[${l.itemId}]`} type="number" step="0.01" min="0" className={field} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium text-sm">Bundles received</h3>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              setRows((r) => [...r, { key: nextKey }]);
              setNextKey((k) => k + 1);
            }}
          >
            + Add bundle
          </button>
        </div>
        <div className="hidden md:grid grid-cols-12 gap-2 text-xs mb-1" style={{ color: "var(--muted)" }}>
          <div className="col-span-3">Wire item *</div>
          <div className="col-span-1">Grade</div>
          <div className="col-span-1">Dia. (mm)</div>
          <div className="col-span-2">Heat No. *</div>
          <div className="col-span-2">Test certificate ref.</div>
          <div className="col-span-2">Weight (kg) *</div>
        </div>
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <BundleRow
              key={row.key}
              rowKey={row.key}
              idx={idx}
              po={po}
              canRemove={rows.length > 1}
              onRemove={() => setRows((r) => r.filter((x) => x.key !== row.key))}
            />
          ))}
        </div>
      </div>

      <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
        Save GRN
      </button>
    </form>
  );
}

/** One bundle: choosing the wire item fills in its grade and diameter (read-only, from the item master). */
function BundleRow({
  rowKey,
  idx,
  po,
  canRemove,
  onRemove,
}: {
  rowKey: number;
  idx: number;
  po: Po | undefined;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const [itemId, setItemId] = useState("");
  const line = po?.lines.find((l) => l.itemId === itemId);
  const ro = `${field} opacity-80`;
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
      <div className="md:col-span-3">
        <label htmlFor={`b${rowKey}-item`} className="md:hidden text-xs">
          Wire item *
        </label>
        <select
          id={`b${rowKey}-item`}
          name={`bundles[${idx}][itemId]`}
          required
          className={field}
          value={line ? itemId : ""}
          onChange={(e) => setItemId(e.target.value)}
        >
          <option value="">{po ? "Choose a PO item..." : "Select a PO first..."}</option>
          {(po?.lines ?? []).map((l) => (
            <option key={l.itemId} value={l.itemId}>
              {l.itemLabel}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-1">
        <label htmlFor={`b${rowKey}-grade`} className="md:hidden text-xs">
          Grade
        </label>
        <input id={`b${rowKey}-grade`} readOnly tabIndex={-1} value={line?.grade ?? ""} className={ro} />
      </div>
      <div className="md:col-span-1">
        <label htmlFor={`b${rowKey}-dia`} className="md:hidden text-xs">
          Diameter (mm)
        </label>
        <input id={`b${rowKey}-dia`} readOnly tabIndex={-1} value={line ? line.diameterMm : ""} className={ro} />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`b${rowKey}-heat`} className="md:hidden text-xs">
          Heat No. *
        </label>
        <input id={`b${rowKey}-heat`} name={`bundles[${idx}][heatNo]`} required className={field} />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`b${rowKey}-tc`} className="md:hidden text-xs">
          Test certificate ref.
        </label>
        <input id={`b${rowKey}-tc`} name={`bundles[${idx}][tcRef]`} className={field} />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`b${rowKey}-kg`} className="md:hidden text-xs">
          Weight (kg) *
        </label>
        <input id={`b${rowKey}-kg`} name={`bundles[${idx}][weightKg]`} type="number" step="0.01" min="0.01" required className={field} />
      </div>
      <div className="md:col-span-1">
        {canRemove && (
          <button type="button" className="text-xs underline" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
