import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { StatusBadge } from "@/components/StatusBadge";
import { formatKg, formatNos } from "@/lib/format";

export default async function IssueListPage() {
  await requireUser();
  const mrns = await prisma.mrn.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_ISSUED"] } },
    include: { part: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Material Issue to Production (FIFO)</h1>
      <div className="card p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2">MRN No.</th>
              <th>Part</th>
              <th>Planned (nos)</th>
              <th>Required (kg)</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mrns.map((m) => (
              <tr key={m.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{m.mrnNo}</td>
                <td>{m.part.partNo}</td>
                <td>{formatNos(m.plannedQtyNos)}</td>
                <td>{formatKg(m.requiredKg)}</td>
                <td>
                  <StatusBadge status={m.status} />
                </td>
                <td>
                  <Link href={`/issue/${m.id}`} className="text-sm underline">
                    Issue against this MRN
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
