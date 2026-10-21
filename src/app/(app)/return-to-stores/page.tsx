import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { formatKg } from "@/lib/format";
import { returnToStoresAction } from "./actions";

export default async function ReturnToStoresPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  await requireUser();
  // Only lots that still hold wire from a bundle (and haven't progressed past coiling) can return it.
  const links = await prisma.lotBundleLink.findMany({
    where: { kgConsumed: { gt: 0 }, lot: { status: "IN_HOUSE", opEntries: { none: {} } } },
    include: { lot: { include: { part: true } }, bundle: true },
    orderBy: { lot: { startDate: "desc" } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Return to Stores</h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Unused wire from the floor is returned against the same bundle. The bundle keeps its original inward date, so it
        keeps its FIFO place. Only lots that have not started production can return wire.
      </p>
      <div className="card p-4 space-y-2">
        {links.map((l) => (
          <form
            key={l.id}
            action={returnToStoresAction}
            className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border-b pb-2"
            style={{ borderColor: "var(--border)" }}
          >
            <input type="hidden" name="lotId" value={l.lotId} />
            <input type="hidden" name="bundleId" value={l.bundleId} />
            <div className="text-sm">
              <div className="font-medium">
                {l.lot.lotNo} ← {l.bundle.bundleNo}
              </div>
              <div style={{ color: "var(--muted)" }}>
                {l.lot.part.partNo} · holds {formatKg(l.kgConsumed)} kg from this bundle
              </div>
            </div>
            <input aria-label="Return (kg)"
              name="kg"
              type="number"
              step="0.01"
              min="0.01"
              max={Number(l.kgConsumed)}
              required
              placeholder="Return (kg)"
              className="rounded border px-2 py-1.5 bg-transparent text-sm"
            />
            <span />
            <button type="submit" className="text-sm btn-primary px-3 py-1.5 min-h-11">
              Return to stores
            </button>
          </form>
        ))}
        {links.length === 0 && <p style={{ color: "var(--muted)" }}>No lots hold returnable wire.</p>}
      </div>
    </div>
  );
}
