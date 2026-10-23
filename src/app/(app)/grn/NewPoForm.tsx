"use client";

import { useRef, useState } from "react";
import { formatDate } from "@/lib/format";
import { UPLOAD_ACCEPT, UPLOAD_HINT } from "@/lib/uploads";
import { createPoAction } from "./actions";

interface Opt {
  id: string;
  label: string;
}

/** What /api/po/ocr returns (see src/server/services/poOcr.ts). */
interface PoProposal {
  poNo: string;
  documentDate: string | null;
  supplierId: string;
  newSupplierName: string;
  newSupplierGstin: string;
  lines: { itemId: string; orderedKg: string; readAs: string }[];
  warnings: string[];
}

interface Row {
  key: number;
  itemId: string;
  orderedKg: string;
  /** What the AI read for this line (shown under the line so it can be checked). */
  readAs?: string;
}

const field = "w-full rounded border px-2 py-1.5 bg-transparent";
const label = "block text-sm font-medium mb-1";

/** Record a new PO with one or more wire lines (reference data for GRN), optionally pre-filled by AI from the PO document. */
export function NewPoForm({ suppliers, items, ocrEnabled }: { suppliers: Opt[]; items: Opt[]; ocrEnabled: boolean }) {
  const [poNo, setPoNo] = useState("");
  const [supplier, setSupplier] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierGstin, setNewSupplierGstin] = useState("");
  const [rows, setRows] = useState<Row[]>([{ key: 0, itemId: "", orderedKg: "" }]);
  const [nextKey, setNextKey] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [proposal, setProposal] = useState<PoProposal | null>(null);

  const updateRow = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function readWithAi() {
    const file = fileRef.current?.files?.[0];
    setOcrError("");
    if (!file) {
      setOcrError("Choose the PO file above first.");
      return;
    }
    setReading(true);
    try {
      const body = new FormData();
      body.set("document", file);
      const res = await fetch("/api/po/ocr", { method: "POST", body });
      // Only messages written for users are shown; anything else becomes a plain sentence.
      const reply = (await res.json().catch(() => ({}))) as Partial<PoProposal> & { error?: string };
      if (!res.ok || !Array.isArray(reply.lines)) {
        setOcrError(reply.error || "The document could not be read. Please enter the PO manually.");
        return;
      }
      const data = reply as PoProposal;
      // Fill the form; every field stays editable.
      setPoNo(data.poNo);
      setSupplier(data.supplierId);
      setNewSupplierName(data.newSupplierName);
      setNewSupplierGstin(data.newSupplierGstin);
      setRows(data.lines.map((l, i) => ({ key: nextKey + i, itemId: l.itemId, orderedKg: l.orderedKg, readAs: l.readAs })));
      setNextKey((k) => k + data.lines.length);
      setProposal(data);
    } catch {
      // Network failure etc.: never show the browser's technical message.
      setOcrError("Could not reach the server. Check the connection and try again, or enter the PO manually.");
    } finally {
      setReading(false);
    }
  }

  return (
    <form action={createPoAction} className="space-y-3">
      <div>
        <label htmlFor="po-document" className={label}>
          Upload PO (scanned copy)
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            id="po-document"
            name="document"
            type="file"
            accept={UPLOAD_ACCEPT}
            className="block text-sm"
            onChange={() => setOcrError("")}
          />
          {ocrEnabled && (
            <button type="button" className="btn-secondary text-sm px-3 py-1.5" onClick={readWithAi} disabled={reading}>
              {reading ? "Reading PO…" : "Read PO with AI"}
            </button>
          )}
        </div>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          {UPLOAD_HINT} Optional; it can also be attached later from the PO list.
          {ocrEnabled
            ? " “Read PO with AI” fills the form from the document for you to check."
            : " (AI reading is not set up: an administrator can enable it with an ANTHROPIC_API_KEY.)"}
        </p>
        {ocrError && <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{ocrError}</p>}
      </div>

      {proposal && (
        <div className="rounded border px-3 py-3 text-sm space-y-2" style={{ borderColor: "#f59e0b", background: "#fffbeb" }} role="status">
          <div className="font-medium">Read by AI: please check every field below before saving</div>
          {proposal.documentDate && (
            <div>
              Date on the document: {formatDate(proposal.documentDate)}. The PO is recorded with today&apos;s date (POs
              cannot be back-dated or post-dated).
            </div>
          )}
          {proposal.warnings.length > 0 && (
            <ul className="list-disc pl-5">
              {proposal.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="aiConfirmed" required /> I have checked the values read by AI and they are correct
          </label>
          <button type="button" className="text-xs underline" onClick={() => setProposal(null)}>
            Discard AI values and enter manually
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label htmlFor="po-poNo" className={label}>
            PO No. <span className="text-red-600">*</span>
          </label>
          <input id="po-poNo" name="poNo" required className={field} value={poNo} onChange={(e) => setPoNo(e.target.value)} />
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
          {/* Always today: POs cannot be post-dated or back-dated. The server sets the date itself. */}
          <input id="po-date" value={formatDate(new Date())} readOnly disabled className={`${field} opacity-70`} />
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Set automatically to today.
          </p>
        </div>
      </div>

      {supplier === "__new__" && (
        <div className="rounded border p-3 grid grid-cols-1 md:grid-cols-2 gap-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <label htmlFor="po-newSupplierName" className={label}>
              New supplier name <span className="text-red-600">*</span>
            </label>
            <input
              id="po-newSupplierName"
              name="newSupplierName"
              required
              className={field}
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="po-newSupplierGstin" className={label}>
              GSTIN
            </label>
            <input
              id="po-newSupplierGstin"
              name="newSupplierGstin"
              className={field}
              value={newSupplierGstin}
              onChange={(e) => setNewSupplierGstin(e.target.value)}
            />
          </div>
          <p className="md:col-span-2 text-xs" style={{ color: "var(--muted)" }}>
            The supplier is registered together with this PO and appears in the supplier list afterwards.
          </p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-medium text-sm">PO lines</h3>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              setRows((r) => [...r, { key: nextKey, itemId: "", orderedKg: "" }]);
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
                <select
                  id={`pl${row.key}-item`}
                  name={`lines[${idx}][itemId]`}
                  required
                  className={field}
                  value={row.itemId}
                  onChange={(e) => updateRow(row.key, { itemId: e.target.value })}
                >
                  <option value="">Select wire item...</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
                {row.readAs && (
                  <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                    AI read: {row.readAs}
                  </div>
                )}
              </div>
              <div className="md:col-span-4">
                <label htmlFor={`pl${row.key}-kg`} className="text-xs">
                  Ordered quantity (kg) *
                </label>
                <input
                  id={`pl${row.key}-kg`}
                  name={`lines[${idx}][orderedKg]`}
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className={field}
                  value={row.orderedKg}
                  onChange={(e) => updateRow(row.key, { orderedKg: e.target.value })}
                />
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
        {proposal ? "Confirm & save PO" : "Save PO"}
      </button>
    </form>
  );
}
