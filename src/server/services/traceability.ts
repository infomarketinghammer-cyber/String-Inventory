/**
 * Traceability Explorer — any Bundle No./Lot/FG Lot/Dispatch No. -> full
 * forward+backward chain: PO -> GRN -> Bundle(Heat No.) -> Issue ->
 * Production Lot(Part No.) -> JW Challans -> FG Lot -> Dispatch -> Customer.
 */
import { prisma } from "@/lib/prisma";

export interface TraceChain {
  query: string;
  po?: { poNo: string; supplier: string };
  grn?: { grnNo: string; grnDate: Date };
  bundles: { bundleNo: string; heatNo: string; inwardDate: Date; status: string }[];
  productionLots: { lotNo: string; partNo: string; status: string; currentOpSeq: number }[];
  jwChallans: { challanNo: string; vendor: string; status: string }[];
  fgLots: { fgLotNo: string; partNo: string; status: string; inwardDate: Date }[];
  dispatches: { dispatchNo: string; date: Date; customer: string; qtyNos: number }[];
}

export async function traceChain(query: string): Promise<TraceChain | null> {
  const q = query.trim();
  if (!q) return null;

  const bundle = await prisma.bundle.findUnique({ where: { bundleNo: q }, include: { grn: { include: { po: { include: { supplier: true } } } } } });
  const lot = await prisma.productionLot.findUnique({ where: { lotNo: q }, include: { part: true } });
  const fgLot = await prisma.fgLot.findUnique({ where: { fgLotNo: q }, include: { part: true } });
  const dispatch = await prisma.dispatch.findUnique({ where: { dispatchNo: q }, include: { customer: true, lines: { include: { fgLot: true } } } });

  const result: TraceChain = { query: q, bundles: [], productionLots: [], jwChallans: [], fgLots: [], dispatches: [] };

  let bundleIds: string[] = [];
  let lotIds: string[] = [];
  let fgLotIds: string[] = [];

  if (bundle) {
    bundleIds = [bundle.id];
    result.po = { poNo: bundle.grn.po.poNo, supplier: bundle.grn.po.supplier.name };
    result.grn = { grnNo: bundle.grn.grnNo, grnDate: bundle.grn.grnDate };
  }
  if (lot) lotIds = [lot.id];
  if (fgLot) fgLotIds = [fgLot.id];
  if (dispatch) fgLotIds = dispatch.lines.map((l) => l.fgLotId);

  // Expand bundle -> lots (forward)
  if (bundleIds.length > 0) {
    const links = await prisma.lotBundleLink.findMany({ where: { bundleId: { in: bundleIds } } });
    lotIds = [...new Set([...lotIds, ...links.map((l) => l.lotId)])];
  }
  // Expand lot -> bundles (backward) and -> FG lots (forward)
  if (lotIds.length > 0) {
    const links = await prisma.lotBundleLink.findMany({ where: { lotId: { in: lotIds } } });
    bundleIds = [...new Set([...bundleIds, ...links.map((l) => l.bundleId)])];
    const fgFromLots = await prisma.fgLot.findMany({ where: { sourceLotId: { in: lotIds } } });
    fgLotIds = [...new Set([...fgLotIds, ...fgFromLots.map((f) => f.id)])];
  }
  // Expand FG lot -> source lot (backward)
  if (fgLotIds.length > 0) {
    const fgRows = await prisma.fgLot.findMany({ where: { id: { in: fgLotIds } } });
    lotIds = [...new Set([...lotIds, ...fgRows.map((f) => f.sourceLotId)])];
    // and re-expand those lots to bundles
    const links = await prisma.lotBundleLink.findMany({ where: { lotId: { in: lotIds } } });
    bundleIds = [...new Set([...bundleIds, ...links.map((l) => l.bundleId)])];
  }

  const [bundleRows, lotRows, fgLotRows, jwLines, dispatchLines] = await Promise.all([
    prisma.bundle.findMany({ where: { id: { in: bundleIds } } }),
    prisma.productionLot.findMany({ where: { id: { in: lotIds } }, include: { part: true } }),
    prisma.fgLot.findMany({ where: { id: { in: fgLotIds } }, include: { part: true } }),
    prisma.jwChallanLine.findMany({ where: { lotId: { in: lotIds } }, include: { challan: { include: { vendor: true } } } }),
    prisma.dispatchLine.findMany({ where: { fgLotId: { in: fgLotIds } }, include: { dispatch: { include: { customer: true } } } }),
  ]);

  result.bundles = bundleRows.map((b) => ({ bundleNo: b.bundleNo, heatNo: b.heatNo, inwardDate: b.inwardDate, status: b.status }));
  result.productionLots = lotRows.map((l) => ({ lotNo: l.lotNo, partNo: l.part.partNo, status: l.status, currentOpSeq: l.currentOpSeq }));
  result.jwChallans = [...new Map(jwLines.map((j) => [j.challan.challanNo, j])).values()].map((j) => ({
    challanNo: j.challan.challanNo,
    vendor: j.challan.vendor.name,
    status: j.challan.status,
  }));
  result.fgLots = fgLotRows.map((f) => ({ fgLotNo: f.fgLotNo, partNo: f.part.partNo, status: f.status, inwardDate: f.inwardDate }));
  result.dispatches = [...new Map(dispatchLines.map((d) => [d.dispatch.dispatchNo, d])).values()].map((d) => ({
    dispatchNo: d.dispatch.dispatchNo,
    date: d.dispatch.date,
    customer: d.dispatch.customer.name,
    qtyNos: d.qtyNos,
  }));

  if (
    !bundle &&
    !lot &&
    !fgLot &&
    !dispatch &&
    result.bundles.length === 0 &&
    result.productionLots.length === 0 &&
    result.fgLots.length === 0
  ) {
    return null;
  }

  return result;
}
