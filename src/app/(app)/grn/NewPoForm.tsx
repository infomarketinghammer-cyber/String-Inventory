"use client";

import { useState } from "react";
import { createPoAction } from "./actions";

interface Opt {
  id: string;
  label: string;
}

const field = "w-full rounded border px-2 py-1.5 bg-transparent";
const label = "block text-sm font-medium mb-1";

/** Record a new PO with one or more wire lines (reference data for GRN). */
export function NewPoForm({ suppliers, items }: { suppliers: Opt[]; items: Opt[] }) {
  const [supplier, setSupplier] = useState("");
  const [rows, setRows] = useState([{ key: 0 }]);
  const [nextKey, setNextKey] = useState(1);

  return (
    <form action={createPoAction} className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label htmlFor="po-poNo" className={label}>
            PO No. <span className="text-red-600">*</span>
          </label>
          <input id="po-poNo" name="poNo" required className={field} />
        </div>
        <div>
          <label htmlFor="po-supplier" className={label}>
            Supplier <span className="text-red-600">*</span>
          </label>
          <select
            id="po-supplier"
            name="supplierId"
            required
            className={field}
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value="">Select supplier...</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="__new__">Add new supplier (not registered yet)...</option>
          </select>
        </div>
        <div>
          <label htmlFor="po-date" className={label}>
            PO Date
          </label>
          <input id="po-date" name="poDate" type="date" className={field} />
        </div>
      </div>

      {supplier === "__new__" && (
        <div className="rounded border p-3 grid grid-cols-1 md:grid-cols-2 gap-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <label htmlFor="po-newSupplierName" className={label}>
              New supplier name <span className="text-red-600">*</span>
            </label>
            <input id="po-newSupplierName" name="newSupplierName" required className={field} />
          </div>
          <div>
            <label htmlFor="po-newSupplierGstin" className={label}>
              GSTIN
            </label>
            <input id="po-newSupplierGstin" name="newSupplierGstin" className={field} />
          </div>
          <p className="md:col-span-2 text-xs" style={{ color: "var(--muted)" }}>
            The supplier is registered together with this PO and appears in the supplier list afterwards.
          </p>
        </div>
      )}

      <div>
        <label htmlFor="po-document" className={label}>
          Upload PO (scanned copy)
        </label>
        <input
          id="po-document"
          name="document"
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="block w-full text-sm"
        />
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          PDF, PNG, JPG or WEBP, up to 5 MB. Optional; it can also be attached later from the PO list.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-medium text-sm">PO lines</h3>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              setRows((r) => [...r, { key: nextKey }]);
              setNextKey((k) => k + 1);
            }}
          >
            + Add line
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={row.key} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
              <div className="md:col-span-7">
                <label htmlFor={`pl${row.key}-item`} className="text-xs">
                  Wire item (grade / diameter) *
                </label>
                <select id={`pl${row.key}-item`} name={`lines[${idx}][itemId]`} required className={field} defaultValue="">
                  <option value="">Select wire item...</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-4">
                <label htmlFor={`pl${row.key}-kg`} className="text-xs">
                  Ordered quantity (kg) *
                </label>
                <input id={`pl${row.key}-kg`} name={`lines[${idx}][orderedKg]`} type="number" step="0.01" min="0.01" required className={field} />
              </div>
              <div className="md:col-span-1">
                {rows.length > 1 && (
                  <button type="button" className="text-xs underline" onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
        Save PO
      </button>
    </form>
  );
}
