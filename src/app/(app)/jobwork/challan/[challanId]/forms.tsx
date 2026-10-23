"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { FIELD_INPUT, FIELD_LABEL } from "@/components/Field";
import { formatNos } from "@/lib/format";
import { createJwInAction, jwReturnQcAction } from "../../in/actions";

type Reason = { id: string; code: string; description: string };

const toQty = (s: string) => (s.trim() === "" ? 0 : /^\d+$/.test(s.trim()) ? Number(s) : null);

function Submit({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="btn-primary px-4 py-2 text-sm font-medium min-h-11 disabled:opacity-50 disabled:cursor-not-allowed">
      {pending ? "Saving…" : label}
    </button>
  );
}

function Hint({ error, text }: { error: string; text: string }) {
  return (
    <p className="text-xs" style={{ color: error ? "#b91c1c" : "var(--muted)" }} aria-live="polite">
      {error || text}
    </p>
  );
}

/** "Record Partial Return": a new return batch against one challan line. The server re-checks everything. */
export function RecordReturnForm(props: {
  challanId: string;
  line: { id: string; lotNo: string; outstanding: number };
  challanDate: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  clientToken: string;
  reasons: Reason[];
}) {
  const { line } = props;
  const [open, setOpen] = useState(false);
  const [good, setGood] = useState("");
  const [rej, setRej] = useState("");
  const [short, setShort] = useState("");
  const [reason, setReason] = useState("");
  const g = toQty(good), r = toQty(rej), s = toQty(short);
  const total = (g ?? 0) + (r ?? 0) + (s ?? 0);
  let error = "";
  if (g === null || r === null || s === null) error = "Enter whole numbers of 0 or more.";
  else if (total > line.outstanding) error = `This batch (${formatNos(total)}) exceeds the ${formatNos(line.outstanding)} pcs still with the vendor.`;
  else if ((r ?? 0) > 0 && !reason) error = "Select why the vendor rejected the pieces.";

  if (!open) {
    return (
      <button type="button" className="btn-primary px-4 py-2 text-sm font-medium" onClick={() => setOpen(true)}>
        Record Partial Return
      </button>
    );
  }
  const id = (k: string) => `${k}-${line.id}`;
  return (
    <form action={createJwInAction} className="rounded border p-3 space-y-3" style={{ borderColor: "var(--border)" }}>
      <input type="hidden" name="challanId" value={props.challanId} />
      <input type="hidden" name="challanLineId" value={line.id} />
      <input type="hidden" name="backChallanId" value={props.challanId} />
      <input type="hidden" name="clientToken" value={props.clientToken} />
      <div className="text-sm font-medium">
        New return batch for {line.lotNo} · {formatNos(line.outstanding)} pcs still with the vendor
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label htmlFor={id("good")} className={FIELD_LABEL}>Received good (pcs)</label>
          <input id={id("good")} name="receivedNos" type="number" min={0} step={1} max={line.outstanding} value={good} onChange={(e) => setGood(e.target.value)} placeholder={`Up to ${line.outstanding}`} className={FIELD_INPUT} />
        </div>
        <div>
          <label htmlFor={id("rej")} className={FIELD_LABEL}>Rejected by vendor (pcs)</label>
          <input id={id("rej")} name="rejectedNos" type="number" min={0} step={1} value={rej} onChange={(e) => setRej(e.target.value)} placeholder="0" className={FIELD_INPUT} />
        </div>
        <div>
          <label htmlFor={id("short")} className={FIELD_LABEL}>Short / lost (pcs)</label>
          <input id={id("short")} name="shortNos" type="number" min={0} step={1} value={short} onChange={(e) => setShort(e.target.value)} placeholder="0" className={FIELD_INPUT} />
        </div>
        <div>
          <label htmlFor={id("reason")} className={FIELD_LABEL}>Vendor rejection reason{(r ?? 0) > 0 ? " *" : ""}</label>
          <select id={id("reason")} name="reasonCodeId" value={reason} onChange={(e) => setReason(e.target.value)} disabled={(r ?? 0) === 0} required={(r ?? 0) > 0} className={`${FIELD_INPUT} disabled:opacity-60`}>
            <option value="">{(r ?? 0) > 0 ? "Select reason…" : "Only if rejected"}</option>
            {props.reasons.map((x) => (
              <option key={x.id} value={x.id}>{x.code} — {x.description}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id("date")} className={FIELD_LABEL}>Receipt date</label>
          <input id={id("date")} name="receiptDate" type="date" defaultValue={props.today} min={props.challanDate} max={props.today} required className={FIELD_INPUT} />
        </div>
        <div>
          <label htmlFor={id("dc")} className={FIELD_LABEL}>Vendor DC / document no.</label>
          <input id={id("dc")} name="vendorDcNo" placeholder="Optional" className={FIELD_INPUT} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={id("rem")} className={FIELD_LABEL}>Remarks</label>
          <input id={id("rem")} name="remarks" placeholder="Optional" className={FIELD_INPUT} />
        </div>
      </div>
      <Hint error={error} text={total > 0 ? `After this batch: ${formatNos(line.outstanding - total)} pcs still with the vendor.` : ""} />
      <div className="flex gap-2">
        <Submit label="Save return batch" disabled={!!error || total === 0} />
        <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** "Start QC" / "Continue QC" for one return batch. Partial inspection leaves the rest pending. */
export function BatchQcForm(props: {
  challanId: string;
  batchNo: string;
  qcLotId: string;
  pending: number;
  started: boolean;
  clientToken: string;
  reasons: Reason[];
}) {
  const [open, setOpen] = useState(false);
  const [acc, setAcc] = useState("");
  const [rej, setRej] = useState("");
  const [reason, setReason] = useState("");
  const a = toQty(acc), r = toQty(rej);
  const total = (a ?? 0) + (r ?? 0);
  let error = "";
  if (a === null || r === null) error = "Enter whole numbers of 0 or more.";
  else if (total > props.pending) error = `Only ${formatNos(props.pending)} pcs of this batch are waiting for QC.`;
  else if ((r ?? 0) > 0 && !reason) error = "Select a rejection reason.";

  if (!open) {
    return (
      <button type="button" className="btn-primary px-3 py-1.5 text-sm font-medium whitespace-nowrap" onClick={() => setOpen(true)}>
        {props.started ? "Continue QC" : "Start QC"}
      </button>
    );
  }
  const id = (k: string) => `${k}-${props.qcLotId}`;
  return (
    <form action={jwReturnQcAction} className="rounded border p-3 space-y-3 min-w-[18rem]" style={{ borderColor: "var(--border)" }}>
      <input type="hidden" name="lotId" value={props.qcLotId} />
      <input type="hidden" name="backChallanId" value={props.challanId} />
      <input type="hidden" name="clientToken" value={props.clientToken} />
      <div className="text-sm font-medium">QC of batch {props.batchNo} · {formatNos(props.pending)} pcs waiting</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={id("acc")} className={FIELD_LABEL}>QC passed (pcs)</label>
          <input id={id("acc")} name="acceptedNos" type="number" min={0} step={1} max={props.pending} value={acc} onChange={(e) => setAcc(e.target.value)} placeholder={`Up to ${props.pending}`} className={FIELD_INPUT} />
        </div>
        <div>
          <label htmlFor={id("rej")} className={FIELD_LABEL}>QC rejected (pcs)</label>
          <input id={id("rej")} name="rejectedNos" type="number" min={0} step={1} value={rej} onChange={(e) => setRej(e.target.value)} placeholder="0" className={FIELD_INPUT} />
        </div>
        <div className="col-span-2">
          <label htmlFor={id("reason")} className={FIELD_LABEL}>Rejection reason{(r ?? 0) > 0 ? " *" : ""}</label>
          <select id={id("reason")} name="reasonCodeId" value={reason} onChange={(e) => setReason(e.target.value)} disabled={(r ?? 0) === 0} required={(r ?? 0) > 0} className={`${FIELD_INPUT} disabled:opacity-60`}>
            <option value="">{(r ?? 0) > 0 ? "Select reason…" : "Only if rejected"}</option>
            {props.reasons.map((x) => (
              <option key={x.id} value={x.id}>{x.code} — {x.description}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor={id("rem")} className={FIELD_LABEL}>Inspection remarks</label>
          <input id={id("rem")} name="remarks" placeholder="Optional" className={FIELD_INPUT} />
        </div>
      </div>
      <Hint error={error} text={total > 0 ? `After this QC: ${formatNos(props.pending - total)} pcs still pending QC in this batch.` : ""} />
      <div className="flex gap-2">
        <Submit label="Save QC" disabled={!!error || total === 0} />
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
