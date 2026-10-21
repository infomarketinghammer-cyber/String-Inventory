"use client";

import { useMemo, useState } from "react";
import { createMrnAction } from "./actions";

export interface MrnPart {
  id: string;
  label: string;
  netWtPerPcKg: number;
  scrapAllowancePct: number;
  wire: { grade: string; diameterMm: number; itemCode: string } | null;
}

const field = "w-full rounded border px-2 py-1.5 bg-transparent";
const label = "block text-sm font-medium mb-1";

/** SOP 4.4: pick Part + planned springs; the BOM proposal (wire, kg) is shown and the kg may be edited within limits. */
export function MrnForm({ parts, editPct }: { parts: MrnPart[]; editPct: number }) {
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("");
  const [kg, setKg] = useState("");
  const part = parts.find((p) => p.id === partId);
  const proposal = useMemo(() => {
    const n = Number(qty);
    if (!part || !(n > 0)) return null;
    return Math.round(n * part.netWtPerPcKg * (1 + part.scrapAllowancePct / 100) * 100) / 100;
  }, [part, qty]);
  const min = proposal !== null ? proposal * (1 - editPct / 100) : 0;
  const max = proposal !== null ? proposal * (1 + editPct / 100) : 0;

  return (
    <form action={createMrnAction} className="card p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-2">
          <label htmlFor="mrn-part" className={label}>
            Part No. <span className="text-red-600">*</span>
          </label>
          <select
            id="mrn-part"
            name="partId"
            required
            className={field}
            value={partId}
            onChange={(e) => {
              setPartId(e.target.value);
              setKg("");
            }}
          >
            <option value="">Select Part...</option>
            {parts.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.wire}>
                {p.label}
                {!p.wire ? " (no wire in BOM)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="mrn-qty" className={label}>
            Planned qty (springs) <span className="text-red-600">*</span>
          </label>
          <input
            id="mrn-qty"
            name="plannedQtyNos"
            type="number"
            min="1"
            step="1"
            required
            value={qty}
            onChange={(e) => {
              setQty(e.target.value);
              setKg("");
            }}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="mrn-kg" className={label}>
            Required kg
          </label>
          <input
            id="mrn-kg"
            name="requiredKg"
            type="number"
            step="0.01"
            min={proposal !== null ? min.toFixed(2) : undefined}
            max={proposal !== null ? max.toFixed(2) : undefined}
            placeholder={proposal !== null ? proposal.toFixed(2) : "auto from BOM"}
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            className={field}
          />
        </div>
      </div>

      {part && (
        <div className="rounded-md p-3 text-sm" style={{ background: "var(--brand-soft)" }}>
          <div className="font-medium mb-1">BOM proposal</div>
          {part.wire ? (
            <div>
              Wire grade <b>{part.wire.grade}</b>, diameter <b>{part.wire.diameterMm} mm</b> ({part.wire.itemCode}) ·{" "}
              {part.netWtPerPcKg} kg/spring · scrap allowance {part.scrapAllowancePct}%
              {proposal !== null && (
                <>
                  {" "}
                  → <b>{proposal.toFixed(2)} kg</b> required. You may edit it between {min.toFixed(2)} and {max.toFixed(2)} kg
                  (±{editPct}%); leave blank to use the proposal.
                </>
              )}
            </div>
          ) : (
            <div className="text-amber-700">This Part has no wire item in its BOM.</div>
          )}
        </div>
      )}

      <button type="submit" className="btn-primary px-4 py-2 text-sm min-h-11">
        Create MRN
      </button>
    </form>
  );
}
