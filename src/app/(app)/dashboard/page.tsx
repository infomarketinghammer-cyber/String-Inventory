import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { getQcHoldAlertDays, getJwAlertDaysBefore, getAgingBuckets } from "@/server/services/settings";
import { formatDate, formatKg, formatNos } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireUser();

  const [holdCount, availableBundles, atJwLots, fgLots, openMrns, openChallans] = await Promise.all([
    prisma.bundle.count({ where: { status: "QUALITY_HOLD" } }),
    prisma.bundle.aggregate({ _sum: { balanceKg: true }, where: { status: "AVAILABLE" } }),
    prisma.productionLot.count({ where: { status: "AT_JOB_WORK" } }),
    prisma.fgLot.aggregate({ _sum: { balanceNos: true }, where: { status: "AVAILABLE" } }),
    prisma.mrn.count({ where: { status: { in: ["OPEN", "PARTIALLY_ISSUED"] } } }),
    prisma.jwOutChallan.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
      include: { vendor: true },
      orderBy: { expectedReturnDate: "asc" },
    }),
  ]);

  const qcHoldDays = await getQcHoldAlertDays();
  const jwAlertDays = await getJwAlertDaysBefore();
  const now = new Date();

  const qcHoldBundles = await prisma.bundle.findMany({
    where: { status: "QUALITY_HOLD" },
    include: { item: true },
    orderBy: { inwardDate: "asc" },
    take: 10,
  });
  const agingHoldAlerts = qcHoldBundles.filter(
    (b) => (now.getTime() - b.inwardDate.getTime()) / 86400000 > qcHoldDays,
  );

  const jwAlerts = openChallans.filter((c) => {
    const daysLeft = (c.expectedReturnDate.getTime() - now.getTime()) / 86400000;
    return daysLeft <= jwAlertDays;
  });

  // Stock older than the top aging bucket (default: over 180 days).
  const buckets = await getAgingBuckets();
  const oldestBucketDays = buckets[buckets.length - 1] ?? 180;
  const cutoff = new Date(now.getTime() - oldestBucketDays * 86400000);
  const [agedBundles, agedFgLots] = await Promise.all([
    prisma.bundle.findMany({
      where: { status: "AVAILABLE", balanceKg: { gt: 0 }, inwardDate: { lt: cutoff } },
      include: { item: true },
      orderBy: { inwardDate: "asc" },
      take: 10,
    }),
    prisma.fgLot.findMany({
      where: { status: "AVAILABLE", balanceNos: { gt: 0 }, inwardDate: { lt: cutoff } },
      include: { part: true },
      orderBy: { inwardDate: "asc" },
      take: 10,
    }),
  ]);
  const noAlerts = jwAlerts.length === 0 && agingHoldAlerts.length === 0 && agedBundles.length === 0 && agedFgLots.length === 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="RM Available (kg)" value={formatKg(availableBundles._sum.balanceKg ?? 0)} />
        <KpiCard label="Bundles in Quality Hold" value={String(holdCount)} />
        <KpiCard label="Lots At Job Worker" value={String(atJwLots)} />
        <KpiCard label="FG Available (nos)" value={formatNos(fgLots._sum.balanceNos ?? 0)} />
        <KpiCard label="Open/Partial MRNs" value={String(openMrns)} />
        <KpiCard label="Open JW Challans" value={String(openChallans.length)} />
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-3">
          Alerts {user.role === "ADMIN" ? "" : "(visible to all roles)"}
        </h2>
        <div className="space-y-2 text-sm">
          {noAlerts && <p style={{ color: "var(--muted)" }}>No active alerts.</p>}
          {agedBundles.map((b) => (
            <div key={b.id} className="flex justify-between border-b py-1" style={{ borderColor: "var(--border)" }}>
              <span>
                RM bundle {b.bundleNo} ({b.item.grade} {Number(b.item.diameterMm)}mm, {formatKg(b.balanceKg)} kg) in stock since{" "}
                {formatDate(b.inwardDate)}
              </span>
              <span className="badge badge-hold">Over {oldestBucketDays}d</span>
            </div>
          ))}
          {agedFgLots.map((f) => (
            <div key={f.id} className="flex justify-between border-b py-1" style={{ borderColor: "var(--border)" }}>
              <span>
                FG lot {f.fgLotNo} ({f.part.partNo}, {formatNos(f.balanceNos)} nos) in stock since {formatDate(f.inwardDate)}
              </span>
              <span className="badge badge-hold">Over {oldestBucketDays}d</span>
            </div>
          ))}
          {jwAlerts.map((c) => {
            const overdue = c.expectedReturnDate < now;
            return (
              <div key={c.id} className="flex justify-between border-b py-1" style={{ borderColor: "var(--border)" }}>
                <span>
                  JW Challan {c.challanNo} ({c.vendor.name}) {overdue ? "is OVERDUE" : "is due soon"} — expected{" "}
                  {formatDate(c.expectedReturnDate)}
                </span>
                <span className={overdue ? "badge badge-rejected" : "badge badge-hold"}>
                  {overdue ? "Overdue" : "Due soon"}
                </span>
              </div>
            );
          })}
          {agingHoldAlerts.map((b) => (
            <div key={b.id} className="flex justify-between border-b py-1" style={{ borderColor: "var(--border)" }}>
              <span>
                Bundle {b.bundleNo} ({b.item.grade} {Number(b.item.diameterMm)}mm) in Quality Hold since{" "}
                {formatDate(b.inwardDate)}
              </span>
              <span className="badge badge-hold">QC Hold &gt; {qcHoldDays}d</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4" style={{ borderLeft: "4px solid var(--brand)" }}>
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1" style={{ color: "var(--brand-ink)" }}>
        {value}
      </div>
    </div>
  );
}
