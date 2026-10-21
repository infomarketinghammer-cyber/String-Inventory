"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { createIssueAction } from "./actions";

export interface EligibleBundle {
  id: string;
  bundleNo: string;
  inwardDate: string; // ISO
  balanceKg: number;
}

interface FormValues {
  lines: { bundleId: string; bundleNo: string; kgIssued: number }[];
  overrideReason: string;
}

/** Oldest-first eligible pool, mirrors src/server/services/fifo.ts sortFifo(). */
function sortFifo(pool: EligibleBundle[]) {
  return [...pool].sort((a, b) => {
    const d = new Date(a.inwardDate).getTime() - new Date(b.inwardDate).getTime();
    if (d !== 0) return d;
    return a.bundleNo.localeCompare(b.bundleNo);
  });
}

export function ScanPanel({
  mrnId,
  pool,
  isAdmin,
  remainingKg,
}: {
  mrnId: string;
  pool: EligibleBundle[];
  isAdmin: boolean;
  remainingKg: number;
}) {
  const [scan, setScan] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { register, control, watch } = useForm<FormValues>({
    defaultValues: { lines: [], overrideReason: "" },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = watch("lines");
  const totalIssued = lines.reduce((s, l) => s + Number(l.kgIssued || 0), 0);

  const remainingPool = useMemo(() => {
    const consumed = new Map<string, number>();
    for (const l of lines) consumed.set(l.bundleId, (consumed.get(l.bundleId) ?? 0) + Number(l.kgIssued || 0));
    return pool
      .map((b) => ({ ...b, balanceKg: b.balanceKg - (consumed.get(b.id) ?? 0) }))
      .filter((b) => b.balanceKg > 1e-6);
  }, [pool, lines]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [fields.length]);

  /** Add every FIFO-suggested bundle (oldest first) until the MRN requirement is covered. */
  function addSuggested() {
    let needed = Math.max(0, remainingKg - totalIssued);
    if (needed <= 0.005) {
      setScanError("The MRN requirement is already covered.");
      return;
    }
    const picks: { bundleId: string; bundleNo: string; kgIssued: number }[] = [];
    for (const b of sortFifo(remainingPool)) {
      if (needed <= 0.005) break;
      const kg = Math.round(Math.min(b.balanceKg, needed) * 100) / 100;
      picks.push({ bundleId: b.id, bundleNo: b.bundleNo, kgIssued: kg });
      needed -= kg;
    }
    if (picks.length === 0) {
      setScanError("No Available stock of this wire to add.");
      return;
    }
    setScanError(null);
    append(picks);
  }

  function handleScanSubmit(typed: string = scan) {
    const bundle = pool.find((b) => b.bundleNo.toLowerCase() === typed.trim().toLowerCase());
    if (!bundle) {
      setScanError(`Bundle "${typed}" not found in Available RM stock for this item.`);
      return;
    }
    const left = remainingPool.find((b) => b.id === bundle.id);
    if (!left) {
      setScanError(`Bundle ${bundle.bundleNo} is already fully scanned on this issue.`);
      return;
    }
    const sorted = sortFifo(remainingPool);
    const oldest = sorted[0];
    if (oldest && oldest.id !== bundle.id && !override) {
      setScanError(
        `Wrong bundle. Issue ${oldest.bundleNo} first (inward ${oldest.inwardDate.slice(0, 10)}).`,
      );
      return;
    }
    const stillNeeded = Math.max(0, remainingKg - totalIssued);
    if (stillNeeded <= 0.005) {
      setScanError("The MRN requirement is already covered; remove a line to scan a different bundle.");
      return;
    }
    setScanError(null);
    // Default to what the MRN still needs, capped at the bundle's balance (the last bundle is usually partial).
    const kg = Math.round(Math.min(left.balanceKg, stillNeeded) * 100) / 100;
    append({ bundleId: bundle.id, bundleNo: bundle.bundleNo, kgIssued: kg });
    setScan("");
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <label htmlFor="scan-bundle" className="block text-sm font-medium mb-1">
          Scan bundle tag, or type the Bundle No.
        </label>
        <div className="flex gap-2">
          <input
            id="scan-bundle"
            ref={inputRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleScanSubmit();
              }
            }}
            placeholder="Scan or type Bundle No. and press Enter"
            className="flex-1 rounded border px-3 py-3 text-lg bg-transparent"
            autoFocus
          />
          <button
            type="button"
            onClick={() => handleScanSubmit()}
            className="btn-secondary px-4 text-sm min-h-11"
          >
            Add
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="pick-bundle" className="block text-xs mb-1" style={{ color: "var(--muted)" }}>
              Or choose from available bundles (oldest first)
            </label>
            <select
              id="pick-bundle"
              value=""
              onChange={(e) => e.target.value && handleScanSubmit(e.target.value)}
              className="rounded border px-2 py-2 text-sm bg-transparent"
            >
              <option value="">Select bundle...</option>
              {sortFifo(remainingPool).map((b) => (
                <option key={b.id} value={b.bundleNo}>
                  {b.bundleNo} — {b.balanceKg.toFixed(2)} kg — inward {b.inwardDate.slice(0, 10)}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={addSuggested} className="btn-secondary px-4 py-2 text-sm">
            Add all FIFO-suggested bundles
          </button>
        </div>
        {scanError && <p className="mt-2 text-sm text-red-700">{scanError}</p>}
        {isAdmin && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Admin override FIFO ordering
          </label>
        )}
      </div>

      {/* Plain server-action form: RHF's handleSubmit would preventDefault and stop the action from running. */}
      <form action={createIssueAction} className="card p-4 space-y-3">
        <input type="hidden" name="mrnId" value={mrnId} />
        {override && <input type="hidden" name="overrideReasonFlag" value="1" />}
        <h3 className="font-medium text-sm">
          Scanned bundles ({formatKg(totalIssued)} / {formatKg(remainingKg)} kg required)
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-1">Bundle</th>
              <th>Qty issued (kg)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, idx) => (
              <tr key={field.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-1">
                  {field.bundleNo}
                  <input type="hidden" name={`lines[${idx}][bundleId]`} value={field.bundleId} readOnly />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="w-28 rounded border px-2 py-1 bg-transparent"
                    {...register(`lines.${idx}.kgIssued`, { valueAsNumber: true })}
                    name={`lines[${idx}][kgIssued]`}
                  />
                </td>
                <td>
                  <button type="button" className="text-xs underline" onClick={() => remove(idx)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {override && (
          <div>
            <label className="block text-sm font-medium mb-1">Override reason (mandatory, logged)</label>
            <input name="overrideReason" required className="w-full rounded border px-2 py-1.5 bg-transparent" />
          </div>
        )}
        <button
          type="submit"
          disabled={fields.length === 0}
          className="btn-primary px-4 py-2 text-sm font-medium min-h-11"
        >
          Confirm &amp; save issue
        </button>
        {fields.length === 0 && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Add at least one bundle above (scan it, type its number and press Add, pick it from the list, or use &quot;Add
            all FIFO-suggested bundles&quot;) to enable saving.
          </p>
        )}
      </form>
    </div>
  );
}

function formatKg(n: number) {
  return n.toFixed(2);
}
