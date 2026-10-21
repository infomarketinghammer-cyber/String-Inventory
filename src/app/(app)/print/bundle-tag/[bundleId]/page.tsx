import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/policy";
import { formatDate, formatKg } from "@/lib/format";

/** Printable Bundle Tag: Bundle No., grade, diameter, weight, Heat No., inward date, QR code. */
export default async function BundleTagPage(props: { params: Promise<{ bundleId: string }> }) {
  const params = await props.params;
  const user = await requireUser();
  const bundle = await prisma.bundle.findUnique({ where: { id: params.bundleId }, include: { item: true } });
  if (!bundle) notFound();

  // SOP 4.3: the tag is printed at IQC acceptance, so a bundle still in Quality Hold has no tag yet.
  if (bundle.status === "QUALITY_HOLD") {
    return <p className="p-6 text-amber-700">The tag is printed after IQC acceptance; this bundle is still in Quality Hold.</p>;
  }
  // Section 9: Floor may print a tag once; any further print is a reprint, which is Admin-only.
  // Decided from the stored first-print time (not a URL flag), so it cannot be bypassed.
  const isReprint = !!bundle.tagPrintedAt;
  if (isReprint && !can(user, "bundleTag.reprint")) {
    return (
      <p className="p-6 text-red-700">
        403 Forbidden: this tag was already printed on {formatDate(bundle.tagPrintedAt)}. Only an Admin may reprint it.
      </p>
    );
  }
  await prisma.auditLog.create({
    data: { userId: user.id, action: isReprint ? "BUNDLE_TAG_REPRINT" : "BUNDLE_TAG_PRINT", entity: "Bundle", entityId: bundle.id },
  });
  if (!isReprint) await prisma.bundle.update({ where: { id: bundle.id }, data: { tagPrintedAt: new Date() } });

  const qrDataUrl = await QRCode.toDataURL(bundle.bundleNo, { margin: 1, width: 180 });

  return (
    <div className="max-w-sm mx-auto card p-6 print:border-0">
      <div className="flex justify-between items-start no-print mb-4">
        <h1 className="text-lg font-semibold">Bundle Tag</h1>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Use your browser&apos;s Print (Ctrl/Cmd+P)
        </span>
      </div>
      <div className="text-center space-y-1">
        <div className="text-2xl font-bold">{bundle.bundleNo}</div>
        <div className="text-sm">
          {bundle.item.grade} · {Number(bundle.item.diameterMm)}mm
        </div>
        <div className="text-sm">Weight: {formatKg(bundle.receivedKg)} kg</div>
        <div className="text-sm">Heat No.: {bundle.heatNo}</div>
        <div className="text-sm">Inward: {formatDate(bundle.inwardDate)}</div>
        <img src={qrDataUrl} alt="QR code" className="mx-auto mt-3" width={140} height={140} />
      </div>
    </div>
  );
}
