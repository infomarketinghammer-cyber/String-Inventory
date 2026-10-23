import { Field } from "@/components/Field";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { Forbidden } from "@/components/Forbidden";
import { Banner } from "@/components/Banner";
import { formatKg } from "@/lib/format";
import { adjustStockAction } from "./actions";

export default async function AdjustmentsPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!can(user, "stock.adjust")) return <Forbidden what="Stock Adjustment" />;
  const bundles = await prisma.bundle.findMany({
    where: { status: { in: ["AVAILABLE", "QUALITY_HOLD"] } },
    include: { item: true },
    orderBy: { bundleNo: "asc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Stock Adjustment (Admin only)</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        T17 in the ledger. A reason code is mandatory and the adjustment is rejected outright if it would cause
        negative stock.
      </p>
      <form action={adjustStockAction} className="card p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <Field label="Bundle" className="md:col-span-2">
          <select name="bundleId" required className="w-full rounded border px-2 py-1.5 bg-transparent">
            <option value="">Bundle...</option>
            {bundles.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bundleNo} ({b.item.grade} {Number(b.item.diameterMm)}mm, balance {formatKg(b.balanceKg)} kg)
              </option>
            ))}
          </select>
        </Field>
        <Field label="+/- kg">
          <input name="deltaKg" type="number" step="0.01" required placeholder="+/- kg" className="w-full rounded border px-2 py-1.5 bg-transparent" />
        </Field>
        <Field label="Reason (mandatory)">
          <input name="reason" required placeholder="Reason (mandatory)" className="w-full rounded border px-2 py-1.5 bg-transparent" />
        </Field>
        <button type="submit" className="btn-primary px-4 py-2 text-sm font-medium min-h-11">
          Save adjustment
        </button>
      </form>
    </div>
  );
}
