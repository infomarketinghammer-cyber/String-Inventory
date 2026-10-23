"use client";

import { useState } from "react";
import { FIELD_LABEL } from "@/components/Field";

const NEW = "__new__";
const field = "rounded border px-2 py-1.5 bg-transparent text-sm w-full";

/**
 * Job worker dropdown for the JW Out Challan. Admins also get "Add new job worker", which shows the new
 * vendor's details; the vendor is registered together with the challan (all or nothing).
 */
export function JobWorkerSelect({
  vendors,
  defaultVendorId,
  canAdd,
}: {
  vendors: { id: string; name: string; maxReturnDays: number }[];
  defaultVendorId: string;
  canAdd: boolean;
}) {
  const [value, setValue] = useState(defaultVendorId);
  return (
    <>
      <label className="text-sm font-medium">
        Job worker <span className="text-red-600">*</span>
        <select name="vendorId" required value={value} onChange={(e) => setValue(e.target.value)} className={field}>
          <option value="">Select job worker...</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} (max {v.maxReturnDays} d)
            </option>
          ))}
          {canAdd && <option value={NEW}>+ Add new job worker…</option>}
        </select>
      </label>
      {value === NEW && (
        // Spans the whole row, after the other fields.
        <div className="md:col-span-5 order-last rounded border p-3 grid grid-cols-1 md:grid-cols-4 gap-3" style={{ borderColor: "var(--border)" }}>
          <div className="md:col-span-4 text-sm font-medium">New job worker (registered with this challan)</div>
          <div>
            <label htmlFor="nv-name" className={FIELD_LABEL}>
              Name <span className="text-red-600">*</span>
            </label>
            <input id="nv-name" name="newVendorName" required className={field} />
          </div>
          <div>
            <label htmlFor="nv-days" className={FIELD_LABEL}>
              Maximum return days <span className="text-red-600">*</span>
            </label>
            <input id="nv-days" name="newVendorMaxReturnDays" type="number" min={1} max={365} step={1} required defaultValue={30} className={field} />
          </div>
          <div>
            <label htmlFor="nv-gstin" className={FIELD_LABEL}>
              GSTIN
            </label>
            <input id="nv-gstin" name="newVendorGstin" className={field} />
          </div>
          <div>
            <label htmlFor="nv-address" className={FIELD_LABEL}>
              Address
            </label>
            <input id="nv-address" name="newVendorAddress" className={field} />
          </div>
          <p className="md:col-span-4 text-xs" style={{ color: "var(--muted)" }}>
            The job worker gets its own “At Job Worker” stock location and appears in the list and in Masters afterwards.
          </p>
        </div>
      )}
    </>
  );
}
