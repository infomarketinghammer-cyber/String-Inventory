/**
 * `npm run db:demo` — loads a realistic client-demo data set ON TOP OF the seed.
 *
 * Everything goes through the real service layer (the same code the screens call), as the person
 * the SOP names for each step, so every rule, FIFO pick, document number and ledger row is genuine
 * and `npm run db:verify` still reconciles. Only dates are moved afterwards (receipts / challans /
 * FG lots backdated) so the aging and job-work reports have a believable spread.
 *
 * It never touches SW-C 3.0 mm wire, so the SOP section 7 worked example (MRN-2610-0008 and
 * bundles RM-2609-0031 / RM-2609-0047 / RM-2610-0003 / RM-2610-0019) stays exactly as specified.
 *
 * Run once after `npm run db:seed` (it refuses to run twice).
 */
import { prisma } from "../src/lib/prisma";
import { createPo } from "../src/server/services/po";
import { createGrn } from "../src/server/services/grn";
import { enterIqcResult, enterIqcForGrn, approveIqc } from "../src/server/services/iqc";
import { createMrn } from "../src/server/services/mrn";
import { createIssue, returnToStores, recomputeMrnStatus, suggestFifoForMrn } from "../src/server/services/issue";
import { operationProgress, recordOperationEntry } from "../src/server/services/production";
import {
  createJwOutChallan,
  createJwInReceipt,
  jwReturnQcDecision,
  closeChallanWithShortage,
} from "../src/server/services/jobwork";
import { recordFinalInspection, approveRecordedFinalInspection } from "../src/server/services/finalInspection";
import { createDispatch, createCustomerReturn } from "../src/server/services/dispatch";
import { disposeRejection } from "../src/server/services/rejection";
import { adjustBundleStock } from "../src/server/services/adjustment";
import { nextDocNumber, yymmLabel } from "../src/server/services/docNumber";

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const step = (s: string) => console.log(`  · ${s}`);

async function main() {
  if (await prisma.adminSetting.findUnique({ where: { key: "DEMO_DATA_LOADED" } })) {
    console.log("Demo data is already loaded (reset with: npx prisma db push --force-reset && npm run db:seed && npm run db:demo).");
    return;
  }

  const user = async (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
  const storekeeper = await user("storekeeper@demo.local");
  const supervisor = await user("supervisor@demo.local");
  const qc = await user("qc.inspector@demo.local");
  const clerk = await user("dispatch@demo.local");
  const qAdmin = await user("quality.admin@demo.local");
  const sAdmin = await user("stores.admin@demo.local");
  const pAdmin = await user("plant.admin@demo.local");

  const item = async (code: string) => prisma.item.findUniqueOrThrow({ where: { itemCode: code } });
  const part = async (no: string) => prisma.part.findUniqueOrThrow({ where: { partNo: no }, include: { bomLines: true } });
  const supplier = async (name: string) => prisma.supplier.findFirstOrThrow({ where: { name } });
  const reason = async (code: string) => (await prisma.reasonCode.findUniqueOrThrow({ where: { code } })).id;
  const OK = { diameter: "within tol.", tensile: "1620 MPa", surface: "OK", certificate: "Matches" };

  const swb20 = await item("SWB-2.0");
  const hc16 = await item("HC80B-1.6");
  const swc40 = await item("SWC-4.0");
  const swa22 = await item("SWA-2.2");
  const swc25 = await item("SWC-2.5");

  // Seed MRNs were marked CLOSED without any issue; re-derive their real status (Open) from what was issued.
  for (const m of await prisma.mrn.findMany()) await recomputeMrnStatus(prisma, m.id);

  // ------------------------------------------------------------------ POs (reference data)
  // Live POs are always dated today; demo history is created normally and then given its historic date.
  const historicPo = async (p: Parameters<typeof createPo>[0], date: Date) => {
    const po = await createPo(p);
    return prisma.po.update({ where: { id: po.id }, data: { poDate: date }, include: { lines: true } });
  };
  console.log("Purchase orders");
  const po1 = await historicPo({ poNo: "PO-2627-0101", supplierId: (await supplier("Tata Steel Wire")).id, lines: [{ itemId: swb20.id, orderedKg: 1500 }, { itemId: hc16.id, orderedKg: 1200 }] }, daysAgo(210));
  const po2 = await historicPo({ poNo: "PO-2627-0102", supplierId: (await supplier("Bekaert India")).id, lines: [{ itemId: swc40.id, orderedKg: 2000 }, { itemId: swc25.id, orderedKg: 800 }] }, daysAgo(205));
  const po3 = await historicPo({ poNo: "PO-2627-0103", supplierId: (await supplier("JSW Wire")).id, lines: [{ itemId: swa22.id, orderedKg: 1000 }] }, daysAgo(12));
  await historicPo({ poNo: "PO-2627-0104", supplierId: (await supplier("Sundram Wire")).id, lines: [{ itemId: swc25.id, orderedKg: 600 }] }, daysAgo(3));
  step("4 POs (one still fully open)");

  // ------------------------------------------------------------------ GRN + IQC (4.1–4.3)
  console.log("Receipts and IQC");
  const grn = async (poId: string, inv: string, veh: string, itemId: string, kgs: number[]) =>
    createGrn({
      poId,
      invoiceNo: inv,
      invoiceDate: new Date(),
      vehicleNo: veh,
      bundles: kgs.map((kg, i) => ({ itemId, heatNo: `${inv.slice(-4)}-H${i + 1}`, tcRef: `TC/${inv.slice(-4)}/${i + 1}`, weightKg: kg })),
      lineQtys: { [itemId]: kgs.reduce((s, k) => s + k, 0) },
      userId: storekeeper.id,
    });
  /**
   * Move a receipt into the past (for the aging report). Bundle numbers carry the receipt month
   * (RM-YYMM-####), so backdated bundles are renumbered in their real month, and their ledger
   * rows follow. Must run before any of the bundles is issued.
   */
  async function backdateGrn(grnId: string, days: number) {
    const d = daysAgo(days);
    const bundles = await prisma.bundle.findMany({ where: { grnId }, orderBy: { bundleNo: "asc" } });
    await prisma.grn.update({ where: { id: grnId }, data: { grnDate: d, invoiceDate: d } });
    for (const b of bundles) {
      const bundleNo = yymmLabel(d) === yymmLabel(b.inwardDate) ? b.bundleNo : await nextDocNumber(prisma, "BUNDLE", yymmLabel(d), "RM");
      await prisma.bundle.update({ where: { id: b.id }, data: { inwardDate: d, bundleNo } });
      await prisma.stockLedger.updateMany({
        where: { refNo: b.bundleNo, itemType: "RM", txnType: { in: ["T1_GRN", "T2_IQC_ACCEPT", "T3_IQC_REJECT"] } },
        data: { txnDate: d, refNo: bundleNo },
      });
      await prisma.stockLedger.updateMany({ where: { refNo: b.bundleNo, itemType: "RM" }, data: { refNo: bundleNo } });
    }
    await prisma.iqc.updateMany({ where: { bundleId: { in: bundles.map((b) => b.id) }, approvedAt: { not: null } }, data: { approvedAt: d, createdAt: d } });
  }
  async function acceptAll(grnId: string) {
    const recs = await enterIqcForGrn({ grnId, results: OK, decision: "ACCEPT", userId: qc.id });
    for (const r of recs) await approveIqc({ iqcId: r.id, approverId: qAdmin.id });
  }

  const g0 = await grn(po2.id, "BEK/INV/7710", "MH14GH2210", swc25.id, [350]);
  await acceptAll(g0.grn.id);
  await backdateGrn(g0.grn.id, 200); // ages past the top bucket -> dashboard alert
  const g6 = await grn(po1.id, "TSW/INV/4402", "MH12KL0912", hc16.id, [400]);
  await acceptAll(g6.grn.id);
  await backdateGrn(g6.grn.id, 100);
  const g1 = await grn(po1.id, "TSW/INV/4519", "MH12KL4471", swb20.id, [300, 320, 280]);
  await acceptAll(g1.grn.id); // "pick the full GRN"
  await backdateGrn(g1.grn.id, 65);
  const g2 = await grn(po1.id, "TSW/INV/4630", "MH12KL5530", hc16.id, [250, 260]);
  for (const b of g2.bundles) {
    const r = await enterIqcResult({ bundleId: b.id, results: OK, decision: "ACCEPT", userId: qc.id });
    await approveIqc({ iqcId: r.id, approverId: qAdmin.id });
  }
  await backdateGrn(g2.grn.id, 35);
  // SWC-4.0: one accepted, three rejected (-> deviation, -> return to supplier, -> still pending RTS)
  const g5 = await grn(po2.id, "BEK/INV/8021", "MH14GH7781", swc40.id, [400, 250, 200, 180]);
  const g5Results = [
    { decision: "ACCEPT" as const, res: OK },
    { decision: "REJECT" as const, res: { ...OK, surface: "Not OK" }, reason: "IQC-SURF" },
    { decision: "REJECT" as const, res: { ...OK, tensile: "1390 MPa" }, reason: "IQC-TENS" },
    { decision: "REJECT" as const, res: { ...OK, certificate: "Mismatch" }, reason: "IQC-TC" },
  ];
  for (let i = 0; i < g5.bundles.length; i++) {
    const s = g5Results[i]!;
    const r = await enterIqcResult({ bundleId: g5.bundles[i]!.id, results: s.res, decision: s.decision, reasonCodeId: s.reason ? await reason(s.reason) : undefined, userId: qc.id });
    await approveIqc({ iqcId: r.id, approverId: qAdmin.id });
  }
  await backdateGrn(g5.grn.id, 20);
  const rejOf = async (bundleId: string) => prisma.rejection.findFirstOrThrow({ where: { refId: bundleId, stage: "IQC" } });
  await disposeRejection({ rejectionId: (await rejOf(g5.bundles[1]!.id)).id, disposal: "DEVIATION", reason: "Light surface marks, acceptable for clutch springs — deviation approved by Quality head", adminId: qAdmin.id });
  await disposeRejection({ rejectionId: (await rejOf(g5.bundles[3]!.id)).id, disposal: "RTS", reason: "Debit note DN/BEK/0142 raised; test certificate mismatch", adminId: qAdmin.id });
  // g5.bundles[2] stays Rejected – RM, pending return to supplier
  // Waiting for Quality Admin approval (IQC entered by the inspector, full GRN)
  const g3 = await grn(po3.id, "JSW/INV/1187", "MH04AB3390", swa22.id, [300, 310]);
  await enterIqcForGrn({ grnId: g3.grn.id, results: OK, decision: "ACCEPT", userId: qc.id });
  await backdateGrn(g3.grn.id, 1);
  // Just arrived, not inspected yet (Quality Hold > 2 days -> alert)
  const g4 = await grn(po2.id, "BEK/INV/8102", "MH14GH9014", swc25.id, [200, 210]);
  await backdateGrn(g4.grn.id, 3);
  // Bundle tags printed for accepted coils
  await prisma.bundle.updateMany({ where: { id: { in: [...g0.bundles, ...g6.bundles, ...g1.bundles, g2.bundles[0]!, g5.bundles[0]!].map((b) => b.id) } }, data: { tagPrintedAt: new Date() } });
  step("7 GRNs / 14 bundles: accepted, rejected → deviation / RTS / pending RTS, awaiting approval, pending inspection");

  // ------------------------------------------------------------------ MRN + Issue (4.4–4.5)
  console.log("MRNs and FIFO issues");
  const issue = async (mrnId: string, maxKg?: number) => {
    const { suggestion } = await suggestFifoForMrn(mrnId);
    let left = maxKg ?? Infinity;
    const lines = [];
    for (const p of suggestion.picks) {
      if (left <= 0.005) break;
      const kg = Math.round(Math.min(p.qtyPicked, left) * 100) / 100;
      lines.push({ bundleId: p.id, kgIssued: kg });
      left -= kg;
    }
    return createIssue({ mrnId, scannedLines: lines, userId: storekeeper.id, isAdmin: false });
  };
  const pap301 = await part("PAP-SPR-301");
  const mtc401 = await part("MTC-SPR-401");
  const al102 = await part("AL-SPR-102");
  const ssl201 = await part("SSL-SPR-201");
  const pap302 = await part("PAP-SPR-302");
  const mtc402 = await part("MTC-SPR-402");

  const m1 = await createMrn({ partId: pap301.id, plannedQtyNos: 20000, userId: supervisor.id });
  const m2 = await createMrn({ partId: mtc401.id, plannedQtyNos: 3000, userId: supervisor.id });
  const m3 = await createMrn({ partId: al102.id, plannedQtyNos: 4000, userId: supervisor.id });
  const m5 = await createMrn({ partId: ssl201.id, plannedQtyNos: 300, userId: supervisor.id });
  const m6 = await createMrn({ partId: al102.id, plannedQtyNos: 2000, userId: supervisor.id });
  await createMrn({ partId: pap302.id, plannedQtyNos: 8000, userId: supervisor.id }); // open: its wire is still in IQC approval
  // Part-issued, not yet coiled: shows on Return to Stores; the balance can be issued live in the demo.
  const m7 = await createMrn({ partId: mtc402.id, plannedQtyNos: 5000, userId: supervisor.id });

  const { lot: l1 } = await issue(m1.id);
  const l1Link = await prisma.lotBundleLink.findFirstOrThrow({ where: { lotId: l1.id } });
  await returnToStores({ bundleId: l1Link.bundleId, lotId: l1.id, kg: 3.2, reasonCodeId: await reason("RTN-EXCESS"), userId: storekeeper.id }); // 4.5 return to stores
  const { lot: l2 } = await issue(m2.id, 120); // partial issue -> MRN Partially Issued
  const { lot: l3 } = await issue(m3.id);
  const { lot: l5 } = await issue(m5.id);
  const { lot: l6 } = await issue(m6.id);
  await issue(m7.id, 40);
  step("7 MRNs (open / partially issued / closed), 6 FIFO issues, 1 return to stores");

  // ------------------------------------------------------------------ Production + job work (4.6–4.7)
  console.log("Production and job work");
  const lotNow = async (id: string) => prisma.productionLot.findUniqueOrThrow({ where: { id }, include: { part: { include: { bomLines: true } } } });
  // Completes the lot's current operation in one entry: `good` pieces (capped to what is pending), the rest of the
  // pending quantity is recorded as rejected (at least `rej`), so good + rejected = the operation's planned quantity.
  const op = async (lotId: string, good: number, rej: number, why = "WIP-COIL") => {
    const l = await lotNow(lotId);
    const { pending } = await operationProgress(prisma, l);
    const g = Math.max(0, Math.min(good, pending - Math.min(rej, pending)));
    const r = pending - g;
    return recordOperationEntry({ lotId, opSeq: l.currentOpSeq, goodNos: g, rejectedNos: r, reasonCodeId: r ? await reason(why) : undefined, userId: supervisor.id });
  };
  const send = async (lotId: string) => {
    const l = await lotNow(lotId);
    const o = l.part.bomLines.find((b) => b.opSeq === l.currentOpSeq)!;
    return createJwOutChallan({
      vendorId: o.defaultVendorId!,
      lines: [{ lotId, qtyNos: l.qtyNos, qtyKg: Math.round(l.qtyNos * Number(l.part.netWtPerPcKg) * 100) / 100 }],
      userId: clerk.id,
    });
  };
  // `good` is capped to what is still pending on the line; a negative `good` means "everything except |good| pieces".
  const receive = async (challanId: string, good: number, rej = 0, short = 0, why = "JW-DAMAGE") => {
    const line = await prisma.jwChallanLine.findFirstOrThrow({ where: { challanId } });
    const pending = line.qtyNos - line.receivedNos - line.rejectedNos - line.shortNos;
    const g = good < 0 ? pending + good - rej - short : Math.min(good, pending - rej - short);
    return createJwInReceipt({ challanId, lines: [{ challanLineId: line.id, receivedNos: g, rejectedNos: rej, shortNos: short, reasonCodeId: rej ? await reason(why) : undefined }], userId: storekeeper.id });
  };
  const lotQty = async (lotId: string) => (await lotNow(lotId)).qtyNos;
  const qcAccept = async (lotId: string, rej = 0, why = "JW-PLATE") => {
    const l = await lotNow(lotId);
    return jwReturnQcDecision({ lotId, acceptedNos: l.qtyNos - rej, rejectedNos: rej, reasonCodeId: rej ? await reason(why) : undefined, userId: qc.id });
  };
  async function backdateChallan(challanId: string, sentDaysAgo: number, expectedDaysAgo: number) {
    const c = await prisma.jwOutChallan.update({ where: { id: challanId }, data: { date: daysAgo(sentDaysAgo), expectedReturnDate: daysAgo(expectedDaysAgo) } });
    await prisma.stockLedger.updateMany({ where: { docNo: c.challanNo, txnType: "T8_JW_SEND" }, data: { txnDate: daysAgo(sentDaysAgo) } });
  }

  // L1 PAP-SPR-301: coiled, waiting to be sent for heat treatment; its coiling rejects are scrapped
  await op(l1.id, 19600, 250);
  // L2 MTC-SPR-401: coiled -> heat treatment -> 50 lost at vendor, Admin closed with shortage -> back in-house at grinding
  await op(l2.id, 1950, 30, "WIP-CRACK");
  const c2 = await send(l2.id);
  await receive(c2.id, -50); // all but 50, which the vendor lost
  await closeChallanWithShortage({ challanId: c2.id, reason: "50 pcs lost in transit; vendor issued shortage note", adminId: pAdmin.id });
  // The pieces that came back went to JW Return QC as their own lot (partial return); QC passes them back in-house.
  const l2back = await prisma.productionLot.findFirstOrThrow({ where: { parentLotId: l2.id } });
  await qcAccept(l2back.id, 10, "WIP-CRACK");
  await backdateChallan(c2.id, 14, 9);
  // L3 AL-SPR-102: coiled -> at heat treatment, partly received, now overdue
  await op(l3.id, 4100, 40, "WIP-COIL");
  const c3 = await send(l3.id);
  await receive(c3.id, 2500, 20, 0, "JW-DAMAGE");
  await backdateChallan(c3.id, 9, 4);
  // L5 SSL-SPR-201: full routing done; QC inspector has recorded FQI, awaiting Quality Admin
  await op(l5.id, 310, 4, "WIP-COIL");
  const c5a = await send(l5.id);
  await receive(c5a.id, 308, 2, 0, "JW-DAMAGE");
  await qcAccept(l5.id, 2, "WIP-CRACK");
  await op(l5.id, 300, 6, "WIP-GRIND");
  const c5b = await send(l5.id);
  await receive(c5b.id, 300);
  await qcAccept(l5.id);
  await recordFinalInspection({ lotId: l5.id, acceptedNos: (await lotQty(l5.id)) - 4, rejectedNos: 4, reasonCodeId: await reason("FQI-LOAD"), results: "Load at 50 mm: 4 pcs below spec; free length OK", userId: qc.id });
  // L6 AL-SPR-102: full routing, FQI approved -> FG lot
  await op(l6.id, 2050, 20, "WIP-COIL");
  const c6a = await send(l6.id);
  await receive(c6a.id, 2050);
  await qcAccept(l6.id);
  await op(l6.id, 2040, 10, "WIP-GRIND");
  const c6b = await send(l6.id);
  await receive(c6b.id, 2040);
  await qcAccept(l6.id, 5, "JW-PLATE");
  const fqi6 = await recordFinalInspection({ lotId: l6.id, acceptedNos: (await lotQty(l6.id)) - 10, rejectedNos: 10, reasonCodeId: await reason("FQI-DIM"), results: "Visual OK; 10 pcs outer dia over-size", userId: qc.id });
  const fg6 = await approveRecordedFinalInspection({ fqiId: fqi6.id, approverId: qAdmin.id });
  for (const [id, d] of [[c5a.id, 18], [c5b.id, 8], [c6a.id, 30], [c6b.id, 20]] as const) {
    const c = await prisma.jwOutChallan.findUniqueOrThrow({ where: { id } });
    await prisma.jwOutChallan.update({ where: { id }, data: { date: daysAgo(d), expectedReturnDate: daysAgo(d - 5) } });
    await prisma.stockLedger.updateMany({ where: { docNo: c.challanNo, txnType: "T8_JW_SEND" }, data: { txnDate: daysAgo(d) } });
  }
  if (fg6) {
    await prisma.fgLot.update({ where: { id: fg6.id }, data: { inwardDate: daysAgo(12) } });
    await prisma.stockLedger.updateMany({ where: { refNo: fg6.fgLotNo, txnType: "T11_FINAL_INSPECTION" }, data: { txnDate: daysAgo(12) } });
  }
  step("6 lots: waiting for JW, at JW (partly received, overdue), back in-house after shortage, FQI awaiting approval, converted to FG");

  // ------------------------------------------------------------------ Dispatch + customer return (4.9–4.10)
  console.log("Dispatch and returns");
  const sched = await prisma.customerSchedule.findFirstOrThrow({ where: { partId: al102.id }, orderBy: { dueDate: "asc" } });
  const d1 = await createDispatch({ scheduleId: sched.id, qtyNos: 1200, invoiceNo: "SINV/26-27/0412", vehicleNo: "MH12PQ7781", packingDetails: "12 cartons × 100 nos, on 1 pallet", userId: clerk.id });
  const s2 = await prisma.customerSchedule.create({ data: { customerId: al102.customerId, partId: al102.id, dueDate: daysAgo(-6), qtyNos: 1000 } });
  await createDispatch({ scheduleId: s2.id, qtyNos: 1000, invoiceNo: "SINV/26-27/0420", vehicleNo: "MH12PQ8102", packingDetails: "10 cartons × 100 nos", userId: clerk.id });
  await prisma.customerSchedule.create({ data: { customerId: al102.customerId, partId: al102.id, dueDate: daysAgo(-20), qtyNos: 2500 } });
  await prisma.customerSchedule.create({ data: { customerId: ssl201.customerId, partId: ssl201.id, dueDate: daysAgo(-4), qtyNos: 290 } });
  const d1Line = await prisma.dispatchLine.findFirstOrThrow({ where: { dispatchId: d1.id }, include: { fgLot: true } });
  await createCustomerReturn({ dispatchNo: d1.dispatchNo, fgLotNo: d1Line.fgLot.fgLotNo, qtyNos: 30, reasonCodeId: await reason("CUST-FIELD"), userId: clerk.id });
  const ret2 = await createCustomerReturn({ dispatchNo: d1.dispatchNo, fgLotNo: d1Line.fgLot.fgLotNo, qtyNos: 12, reasonCodeId: await reason("CUST-PACK"), userId: clerk.id });
  step("2 dispatches (partial + full), 2 open schedules, 2 customer returns");

  // ------------------------------------------------------------------ Rejection disposals + adjustment
  console.log("Rejection disposals and adjustment");
  const wipRej = await prisma.rejection.findMany({ where: { stage: "WIP", disposal: "PENDING", refId: { in: [l1.id, l6.id] } }, orderBy: { createdAt: "asc" } });
  const l1Rej = wipRej.find((r) => r.refId === l1.id)!;
  await disposeRejection({ rejectionId: l1Rej.id, disposal: "SCRAP", reason: "Coiling scrap, not reworkable", adminId: qAdmin.id });
  const l6Rej = wipRej.find((r) => r.refId === l6.id)!;
  await disposeRejection({ rejectionId: l6Rej.id, disposal: "REWORK", targetOpSeq: 3, reason: "Re-grind to size", adminId: qAdmin.id });
  await disposeRejection({ rejectionId: ret2.id, disposal: "SCRAP", reason: "Crushed in transit, scrap", adminId: qAdmin.id });
  const swbBundle = await prisma.bundle.findFirstOrThrow({ where: { itemId: swb20.id, status: "AVAILABLE" }, orderBy: { inwardDate: "desc" } });
  await adjustBundleStock({ bundleId: swbBundle.id, deltaKg: -2.5, reason: "ADJ-COUNT: physical count 2.5 kg short", adminId: sAdmin.id });
  step("scrap ×2, rework ×1, stock adjustment ×1 (other rejections left pending for the demo)");

  await prisma.adminSetting.create({ data: { key: "DEMO_DATA_LOADED", value: new Date().toISOString() } });

  const counts = {
    POs: await prisma.po.count(),
    GRNs: await prisma.grn.count(),
    bundles: await prisma.bundle.count(),
    MRNs: await prisma.mrn.count(),
    lots: await prisma.productionLot.count(),
    challans: await prisma.jwOutChallan.count(),
    "FG lots": await prisma.fgLot.count(),
    dispatches: await prisma.dispatch.count(),
    rejections: await prisma.rejection.count(),
    "ledger rows": await prisma.stockLedger.count(),
  };
  console.log("\nDemo data loaded:", Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", "));
}

main()
  .catch((e) => {
    console.error("demo-data FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
