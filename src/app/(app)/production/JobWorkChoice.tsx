"use client";

import { useState } from "react";
import { skipJobWorkAction } from "./actions";

/**
 * At a Job Work routing step: two buttons — send the lot for job work, or skip the step.
 * Skipping asks for a short reason (required, kept on the record) before it is confirmed.
 */
export function JobWorkChoice({ lotId, opSeq, nextLabel, back }: { lotId: string; opSeq: number; nextLabel: string; back?: string }) {
  const [skipping, setSkipping] = useState(false);

  if (skipping) {
    return (
      <form action={skipJobWorkAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="lotId" value={lotId} />
        <input type="hidden" name="opSeq" value={opSeq} />
        <input type="hidden" name="back" value={back ?? "/production"} />
        <input
          name="reason"
          required
          autoFocus
          aria-label="Reason for skipping job work"
          placeholder="Reason for skipping job work"
          className="min-w-64 flex-1 rounded border px-3 py-2 bg-transparent text-sm"
        />
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium">
          Confirm skip
        </button>
        <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={() => setSkipping(false)}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href="/jobwork/out" className="btn-primary px-4 py-2 text-sm font-medium">
        Send to Job Work
      </a>
      <button type="button" className="btn-secondary px-4 py-2 text-sm font-medium" onClick={() => setSkipping(true)}>
        Skip Job Work → {nextLabel}
      </button>
    </div>
  );
}
