/**
 * Pieces shared by the dashboard detail page (server) and its interactive tables (client).
 * No server-only imports here, so both sides can render them.
 */
import Link from "next/link";
import { formatDate, formatKg, formatNos } from "@/lib/format";

/** A stock-ledger row reduced to plain values so it can be passed to client components. */
export interface LedgerMove {
  id: string;
  txnDate: string;
  txnType: string;
  docNo: string;
  fromStatus: string | null;
  toStatus: string | null;
  qty: number;
  uom: string;
  userName: string;
  reason: string | null;
}

export function Check({ ok, title }: { ok: boolean; title?: string }) {
  return ok ? (
    <span className="badge badge-available whitespace-nowrap" title={title}>
      ✓ Valid
    </span>
  ) : (
    <span className="badge badge-rejected whitespace-nowrap" title={title}>
      Mismatch
    </span>
  );
}

export function Ref({ no, trace }: { no: string; trace: boolean }) {
  return trace ? (
    <Link
      href={`/traceability?q=${encodeURIComponent(no)}`}
      className="font-medium underline whitespace-nowrap"
      style={{ color: "var(--brand)" }}
    >
      {no}
    </Link>
  ) : (
    <span className="font-medium whitespace-nowrap">{no}</span>
  );
}

const TXN_LABEL: Record<string, string> = {
  T1_GRN: "T1 GRN receipt",
  T2_IQC_ACCEPT: "T2 IQC accept",
  T3_IQC_REJECT: "T3 IQC reject",
  T4_RTS: "T4 Return to supplier",
  T5_ISSUE: "T5 Issue to production",
  T6_RETURN_TO_STORES: "T6 Return to stores",
  T7_OP_COMPLETE: "T7 Operation complete",
  T8_JW_SEND: "T8 Sent to job worker",
  T9_JW_RECEIVE: "T9 Received from job worker",
  T10_JW_RETURN_QC: "T10 JW return QC",
  T11_FINAL_INSPECTION: "T11 Final inspection (FG in)",
  T12_REJECTION: "T12 Rejection",
  T13_REWORK: "T13 Rework",
  T14_SCRAP: "T14 Scrap",
  T15_DISPATCH: "T15 Dispatch",
  T16_CUSTOMER_RETURN: "T16 Customer return",
  T17_ADJUSTMENT: "T17 Stock adjustment",
};

/** Full-width row under a record listing its stock-ledger movements (where the quantity came from). */
export function LedgerRow({ moves, colSpan }: { moves: LedgerMove[]; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="pb-3 pt-0">
        <details>
          <summary className="cursor-pointer text-xs" style={{ color: "var(--brand)" }}>
            Ledger movements ({moves.length})
          </summary>
          {moves.length === 0 ? (
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              No ledger movements found.
            </p>
          ) : (
            <table className="w-full text-xs mt-2">
              <thead>
                <tr className="text-left">
                  <th className="py-1">Date</th>
                  <th>Transaction</th>
                  <th>Document</th>
                  <th>Status change</th>
                  <th className="text-right">Qty</th>
                  <th className="pl-6">By</th>
                  <th className="pl-4">Reason</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="py-0.5 whitespace-nowrap">{formatDate(m.txnDate)}</td>
                    <td>{TXN_LABEL[m.txnType] ?? m.txnType}</td>
                    <td className="whitespace-nowrap">{m.docNo}</td>
                    <td>
                      {m.fromStatus ?? "–"} → {m.toStatus ?? "–"}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {m.uom === "kg" ? formatKg(m.qty) : formatNos(m.qty)} {m.uom}
                    </td>
                    <td className="pl-6">{m.userName}</td>
                    <td className="pl-4">{m.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      </td>
    </tr>
  );
}
