import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Forbidden } from "@/components/Forbidden";
import { Banner } from "@/components/Banner";
import { formatDate, formatKg } from "@/lib/format";
import { reverseTransactionAction } from "./actions";

export default async function ReversalsPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "transaction.reverse")) return <Forbidden what="Transaction Reversal" />;
  const rows = await prisma.stockLedger.findMany({ orderBy: { txnDate: "desc" }, take: 40 });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Transaction Reversal (Admin only)</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Saved transactions are immutable. A reversal writes a new, opposite-signed ledger row and restores the
        balance; a reversal that would cause negative stock is refused.
      </p>
      <div className="card p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2">Txn date</th>
              <th>Type</th>
              <th>Doc No.</th>
              <th>Ref</th>
              <th>Qty</th>
              <th>Reverse</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{formatDate(r.txnDate)}</td>
                <td>{r.txnType}</td>
                <td>{r.docNo}</td>
                <td>{r.refNo}</td>
                <td>
                  {formatKg(r.qty)} {r.uom}
                </td>
                <td>
                  <form action={reverseTransactionAction} className="flex gap-1 items-center">
                    <input type="hidden" name="ledgerId" value={r.id} />
                    <input aria-label="Reason" name="reason" placeholder="Reason" required className="w-28 rounded border px-1 py-1 bg-transparent text-xs" />
                    <button type="submit" className="text-xs underline">
                      Reverse
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
