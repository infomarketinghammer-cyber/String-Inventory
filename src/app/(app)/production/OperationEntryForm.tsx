"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { FIELD_INPUT, FIELD_LABEL } from "@/components/Field";
import { formatNos } from "@/lib/format";
import { recordOperationAction } from "./actions";

interface Props {
  lotId: string;
  opSeq: number;
  planned: number;
  processed: number;
  pending: number;
  /** One per page render: the server ignores a second submit of the same form (double click). */
  clientToken: string;
  reasonCodes: { id: string; code: string }[];
  /** Shown under "Planned" (e.g. where the coiling plan comes from). */
  plannedNote?: string;
}

/** Whole number >= 0 typed so far, or null when the box is empty / not a valid whole number. */
const toQty = (s: string) => (s.trim() === "" ? 0 : /^\d+$/.test(s.trim()) ? Number(s) : null);

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="btn-primary px-4 py-2 text-sm font-medium min-h-11 disabled:opacity-50 disabled:cursor-not-allowed">
      {pending ? "Saving…" : "Save entry"}
    </button>
  );
}

/**
 * Production entry for the lot's current in-house operation. Partial entries are allowed: each save adds to the
 * processed quantity, and the lot moves to the next operation only when good + rejected reaches the plan.
 * The same limits are enforced again on the server.
 */
export function OperationEntryForm({ lotId, opSeq, planned, processed, pending, clientToken, reasonCodes, plannedNote }: Props) {
  const [good, setGood] = useState("");
  const [rejected, setRejected] = useState("");
  const [reasonId, setReasonId] = useState("");

  const g = toQty(good);
  const r = toQty(rejected);
  const entered = (g ?? 0) + (r ?? 0);
  let error = "";
  if (g === null || r === null) error = "Enter whole numbers of 0 or more.";
  else if (entered > pending) error = `Entered quantity exceeds the remaining quantity of ${formatNos(pending)} units.`;
  else if ((r ?? 0) > 0 && !reasonId) error = "Select a rejection reason for the rejected quantity.";
  const canSave = !error && entered > 0;
  const after = pending - entered;

  if (pending <= 0) {
    return (
      <p className="text-sm text-green-700">
        {planned > 0 ? "Production completed. No pending quantity remains." : "No quantity to process: no wire is held by this lot."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <div className={FIELD_LABEL} style={{ color: "var(--muted)" }}>
            Planned
          </div>
          <div className="font-semibold">{formatNos(planned)} nos</div>
          {plannedNote && (
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {plannedNote}
            </div>
          )}
        </div>
        <div>
          <div className={FIELD_LABEL} style={{ color: "var(--muted)" }}>
            Processed so far
          </div>
          <div className="font-semibold">{formatNos(processed)} nos</div>
        </div>
        <div>
          <div className={FIELD_LABEL} style={{ color: "var(--muted)" }}>
            Pending
          </div>
          <div className="font-semibold" style={{ color: "var(--brand-ink)" }}>
            {formatNos(pending)} nos
          </div>
        </div>
      </div>

      <form action={recordOperationAction} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <input type="hidden" name="lotId" value={lotId} />
        <input type="hidden" name="opSeq" value={opSeq} />
        <input type="hidden" name="clientToken" value={clientToken} />
        <div>
          <label htmlFor={`good-${lotId}`} className={FIELD_LABEL}>
            Good (nos)
          </label>
          <input
            id={`good-${lotId}`}
            name="goodNos"
            type="number"
            min={0}
            step={1}
            max={pending}
            placeholder={`Up to ${pending}`}
            value={good}
            onChange={(e) => setGood(e.target.value)}
            className={FIELD_INPUT}
          />
        </div>
        <div>
          <label htmlFor={`rej-${lotId}`} className={FIELD_LABEL}>
            Rejected (nos)
          </label>
          <input
            id={`rej-${lotId}`}
            name="rejectedNos"
            type="number"
            min={0}
            step={1}
            max={pending}
            placeholder="0"
            value={rejected}
            onChange={(e) => setRejected(e.target.value)}
            className={FIELD_INPUT}
          />
        </div>
        <div>
          <label htmlFor={`reason-${lotId}`} className={FIELD_LABEL}>
            Rejection reason{(r ?? 0) > 0 ? " *" : ""}
          </label>
          <select
            id={`reason-${lotId}`}
            name="reasonCodeId"
            value={reasonId}
            onChange={(e) => setReasonId(e.target.value)}
            required={(r ?? 0) > 0}
            disabled={(r ?? 0) === 0}
            className={`${FIELD_INPUT} disabled:opacity-60`}
          >
            <option value="">{(r ?? 0) > 0 ? "Select reason…" : "Only if rejected"}</option>
            {reasonCodes.map((rc) => (
              <option key={rc.id} value={rc.id}>
                {rc.code}
              </option>
            ))}
          </select>
        </div>
        <SaveButton disabled={!canSave} />
        <div className="text-xs md:col-span-1 self-center" style={{ color: error ? "#b91c1c" : "var(--muted)" }} aria-live="polite">
          {error || (entered > 0 ? `After this entry: ${formatNos(after)} pending${after === 0 ? " — operation complete" : ""}.` : "")}
        </div>
      </form>
    </div>
  );
}
