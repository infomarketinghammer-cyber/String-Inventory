import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { Banner } from "@/components/Banner";
import { suggestFifoForMrn, netIssuedKg } from "@/server/services/issue";
import { formatDate, formatKg } from "@/lib/format";
import { ScanPanel } from "./ScanPanel";

export default async function IssueDetailPage(props: {
  params: Promise<{ mrnId: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const mrn = await prisma.mrn.findUniqueOrThrow({ where: { id: params.mrnId }, include: { part: true } });
  const { item, suggestion } = await suggestFifoForMrn(mrn.id);

  const availableBundles = await prisma.bundle.findMany({
    where: { itemId: item.id, status: "AVAILABLE" },
    orderBy: [{ inwardDate: "asc" }, { bundleNo: "asc" }],
  });

  const remainingKg = Math.max(0, Number(mrn.requiredKg) - (await netIssuedKg(prisma, mrn.id)));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        Issue against {mrn.mrnNo} — {mrn.part.partNo}
      </h1>
      <Banner ok={searchParams.ok} err={searchParams.err} />

      <div className="card p-4">
        <h2 className="font-medium mb-2">
          FIFO suggestion for {item.grade} {Number(item.diameterMm)}mm ({formatKg(remainingKg)} kg required)
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-1">Bundle</th>
              <th>Inward date</th>
              <th>Suggested pick (kg)</th>
            </tr>
          </thead>
          <tbody>
            {suggestion.picks.map((p) => (
              <tr key={p.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-1">{p.number}</td>
                <td>{formatDate(p.inwardDate)}</td>
                <td>{formatKg(p.qtyPicked)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!suggestion.fullyCovered && (
          <p className="mt-2 text-sm text-amber-700">
            Available stock does not fully cover the requirement ({formatKg(suggestion.totalPicked)} kg available).
          </p>
        )}
      </div>

      <ScanPanel
        mrnId={mrn.id}
        isAdmin={user.role === "ADMIN"}
        remainingKg={remainingKg}
        pool={availableBundles.map((b) => ({
          id: b.id,
          bundleNo: b.bundleNo,
          inwardDate: b.inwardDate.toISOString(),
          balanceKg: Number(b.balanceKg),
        }))}
      />
    </div>
  );
}
