/**
 * `npm run db:sop-check` — SOP 4.2–4.10 data-flow and role checks against the real services.
 * Each step runs as the role the SOP names (QC inspector / store keeper / supervisor = Floor,
 * Quality Admin = Admin) and the permission matrix (Section 9) is checked for every action used.
 * Writes data: run it on a scratch database (see README "Testing").
 */
import { prisma } from "../src/lib/prisma";
import { can, type Action } from "../src/server/policy";
import { createGrn } from "../src/server/services/grn";
import { enterIqcResult, enterIqcForGrn, approveIqc } from "../src/server/services/iqc";
import { createMrn, proposedKg } from "../src/server/services/mrn";
import { createJwOutChallan } from "../src/server/services/jobwork";
import { recordFinalInspection, approveRecordedFinalInspection } from "../src/server/services/finalInspection";
import { createDispatch } from "../src/server/services/dispatch";
import { disposeRejection } from "../src/server/services/rejection";

let failed = 0;
const check = (name: string, ok: boolean, d = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${!ok && d ? ` (${d})` : ""}`);
};
async function rejects(name: string, part: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(name, m.toLowerCase().includes(part.toLowerCase()), m);
  }
}

async function main() {
  const floor = await prisma.user.findUniqueOrThrow({ where: { email: "qc.inspector@demo.local" } });
  const storekeeper = await prisma.user.findUniqueOrThrow({ where: { email: "storekeeper@demo.local" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "quality.admin@demo.local" } });
  const F = { id: floor.id, role: "FLOOR" as const };
  const A = { id: admin.id, role: "ADMIN" as const };
  const loc = async (name: string) => (await prisma.location.findUniqueOrThrow({ where: { name } })).id;

  console.log("\n[Section 9] Permission matrix for the actions in 4.2–4.10");
  const matrix: Array<[Action, boolean, boolean, string]> = [
    ["iqc.enter", true, true, "IQC result entry: Admin C / Floor C"],
    ["iqc.approve", true, false, "IQC approval: Admin A / Floor —"],
    ["bundleTag.print", true, true, "Bundle tag print: Admin C / Floor C"],
    ["bundleTag.reprint", true, false, "Bundle tag reprint: Admin C / Floor —"],
    ["mrn.create", true, true, "MRN: Admin C / Floor C"],
    ["issue.create", true, true, "Material issue: Admin C / Floor C"],
    ["issue.fifoOverride", true, false, "FIFO override: Admin A / Floor —"],
    ["production.entry", true, true, "Production entry: Admin C / Floor C"],
    ["jw.challan", true, true, "JW out challan: Admin C / Floor C"],
    ["jw.receipt", true, true, "JW in receipt: Admin C / Floor C"],
    ["jw.closeWithShortage", true, false, "JW close with shortage: Admin A / Floor —"],
    ["finalInspection.enter", true, true, "FQI result entry (QC inspector, 4.8)"],
    ["finalInspection.approve", true, false, "FQI approval: Admin A / Floor —"],
    ["dispatch.create", true, true, "Dispatch: Admin C / Floor C"],
    ["rejection.disposal", true, false, "Rejection disposal: Admin A / Floor —"],
  ];
  for (const [action, adminOk, floorOk, label] of matrix) {
    check(label, can(A, action) === adminOk && can(F, action) === floorOk);
  }

  // ------------------------------------------------------------------ 4.2 / 4.3
  console.log("\n[4.2] IQC — pick a bundle or the full GRN; stock moves only on Quality Admin approval");
  const pl = (await prisma.poLine.findMany({ include: { item: true } })).find((l) => Number(l.orderedKg) - Number(l.receivedKg) >= 400)!;
  const grnA = await createGrn({
    poId: pl.poId,
    invoiceNo: "SOP-A",
    bundles: [
      { itemId: pl.itemId, heatNo: "HA-1", weightKg: 100 },
      { itemId: pl.itemId, heatNo: "HA-2", weightKg: 110 },
    ],
    userId: storekeeper.id,
  });
  const grnB = await createGrn({ poId: pl.poId, invoiceNo: "SOP-B", bundles: [{ itemId: pl.itemId, heatNo: "HB-1", weightKg: 90 }], userId: storekeeper.id });
  const results = { diameter: "3.01", tensile: "1650", surface: "OK", certificate: "Matches" };
  const recsA = await enterIqcForGrn({ grnId: grnA.grn.id, results, decision: "ACCEPT", userId: floor.id });
  check("full-GRN entry creates one IQC per bundle", recsA.length === 2);
  check("results record diameter, tensile, surface and certificate check", JSON.stringify(recsA[0]!.results).includes("certificate"));
  check("entering a result does NOT move stock (still Quality Hold)",
    (await prisma.bundle.findMany({ where: { grnId: grnA.grn.id } })).every((b) => b.status === "QUALITY_HOLD"));
  await rejects("a bundle already inspected cannot be entered again", "already been entered", () =>
    enterIqcResult({ bundleId: grnA.bundles[0]!.id, results, decision: "ACCEPT", userId: floor.id }),
  );
  const iqcReason = await prisma.reasonCode.findFirstOrThrow({ where: { stage: "IQC" } });
  await rejects("reject needs a reason code", "reason code", () =>
    enterIqcResult({ bundleId: grnB.bundles[0]!.id, results, decision: "REJECT", userId: floor.id }),
  );
  const recB = await enterIqcResult({ bundleId: grnB.bundles[0]!.id, results: { ...results, surface: "Not OK" }, decision: "REJECT", reasonCodeId: iqcReason.id, userId: floor.id });
  for (const r of recsA) await approveIqc({ iqcId: r.id, approverId: admin.id });
  await approveIqc({ iqcId: recB.id, approverId: admin.id });
  const aBundles = await prisma.bundle.findMany({ where: { grnId: grnA.grn.id } });
  check("on approval, accepted bundles are Available in RM Stores", aBundles.every((b) => b.status === "AVAILABLE") && aBundles.every(async (b) => b.locationId === (await loc("RM Stores"))));
  check("...located in RM Stores", aBundles.every((b) => b.locationId) && (await loc("RM Stores")) === aBundles[0]!.locationId);
  const bBundle = await prisma.bundle.findUniqueOrThrow({ where: { id: grnB.bundles[0]!.id } });
  check("on approval, a rejected bundle is in Rejected – RM / Rejection area", bBundle.status === "REJECTED" && bBundle.locationId === (await loc("Rejection area - RM")));
  const rtsList = await prisma.rejection.findFirst({ where: { stage: "IQC", refId: bBundle.id, disposal: "PENDING" } });
  check("...and it appears on the Return-to-Supplier list (pending IQC rejection)", !!rtsList);
  check("whole-bundle decision: the rejected bundle keeps its full weight (no partial acceptance)", Number(bBundle.balanceKg) === 90);

  console.log("\n[4.3] Bundle numbering");
  const nos = [...grnA.bundles, ...grnB.bundles].map((b) => b.bundleNo);
  check("bundle numbers are system generated as RM-YYMM-####", nos.every((n) => /^RM-\d{4}-\d{4}$/.test(n)));
  check("bundle numbers are unique", new Set(nos).size === nos.length && (await prisma.bundle.count({ where: { bundleNo: { in: nos } } })) === nos.length);
  check("tag not printed yet (first print is tracked, reprint is Admin-only)", aBundles.every((b) => b.tagPrintedAt === null));

  // ------------------------------------------------------------------ 4.4
  console.log("\n[4.4] MRN — BOM proposal, edit within limits, no stock movement");
  const part = await prisma.part.findFirstOrThrow({ where: { bomLines: { some: { itemId: { not: null } } } } });
  const expected = proposedKg(1000, Number(part.netWtPerPcKg), Number(part.scrapAllowancePct));
  const stockBefore = await prisma.stockLedger.count();
  const m1 = await createMrn({ partId: part.id, plannedQtyNos: 1000, userId: floor.id });
  check(`required kg = springs × net wt × (1 + scrap%) = ${expected}`, Number(m1.requiredKg) === expected);
  check("MRN status is Open", m1.status === "OPEN");
  check("creating an MRN does not move stock (no ledger rows)", (await prisma.stockLedger.count()) === stockBefore);
  const m2 = await createMrn({ partId: part.id, plannedQtyNos: 1000, requiredKg: expected * 1.05, userId: floor.id });
  check("supervisor may edit the kg within the limit (+5%)", Math.abs(Number(m2.requiredKg) - expected * 1.05) < 0.01);
  await rejects("editing beyond the limit is refused (+25%)", "within", () =>
    createMrn({ partId: part.id, plannedQtyNos: 1000, requiredKg: expected * 1.25, userId: floor.id }),
  );

  // ------------------------------------------------------------------ 4.7
  console.log("\n[4.7] JW out challan with several lots (assumption 6)");
  const jwPart = await prisma.part.findFirstOrThrow({ where: { bomLines: { some: { opType: "JOB_WORK" } } }, include: { bomLines: true } });
  const jwOp = jwPart.bomLines.filter((b) => b.opType === "JOB_WORK").sort((a, b) => a.opSeq - b.opSeq)[0]!;
  const mrnJw = await createMrn({ partId: jwPart.id, plannedQtyNos: 100, userId: floor.id });
  const wip = await loc("Production floor (WIP)");
  const anyBundle = await prisma.bundle.findFirstOrThrow({ where: { status: "AVAILABLE" } });
  const mkLot = async (no: string, start: string) => {
    const l = await prisma.productionLot.create({
      data: { lotNo: no, partId: jwPart.id, mrnId: mrnJw.id, currentOpSeq: jwOp.opSeq, qtyNos: 50, status: "IN_HOUSE", locationId: wip, startDate: new Date(start) },
    });
    await prisma.lotBundleLink.create({ data: { lotId: l.id, bundleId: anyBundle.id, kgConsumed: 0 } });
    return l;
  };
  const older = await mkLot("PL-SOP-0001", "2000-01-01");
  const newer = await mkLot("PL-SOP-0002", "2000-01-02");
  const vendor = await prisma.jobWorker.findUniqueOrThrow({ where: { id: jwOp.defaultVendorId! } });
  await rejects("FIFO inside one challan: the newer lot cannot go before the older one", "Send PL-SOP-0001 first", () =>
    createJwOutChallan({ vendorId: vendor.id, lines: [{ lotId: newer.id, qtyNos: 50, qtyKg: 5 }], userId: storekeeper.id }),
  );
  const ch = await createJwOutChallan({
    vendorId: vendor.id,
    lines: [
      { lotId: older.id, qtyNos: 50, qtyKg: 5 },
      { lotId: newer.id, qtyNos: 50, qtyKg: 5 },
    ],
    userId: storekeeper.id,
  });
  const chLines = await prisma.jwChallanLine.count({ where: { challanId: ch.id } });
  check("one challan carries both lots", chLines === 2);
  const atVendor = await prisma.productionLot.findMany({ where: { id: { in: [older.id, newer.id] } } });
  check("both lots are At Job Work at the vendor's location", atVendor.every((l) => l.status === "AT_JOB_WORK" && l.locationId === vendor.locationId));

  // ------------------------------------------------------------------ 4.8
  console.log("\n[4.8] Final inspection — QC inspector records, Quality Admin approves");
  const maxOp = Math.max(...jwPart.bomLines.map((b) => b.opSeq));
  const fqiLot = await prisma.productionLot.create({
    data: { lotNo: "PL-SOP-0003", partId: jwPart.id, mrnId: mrnJw.id, currentOpSeq: maxOp + 1, qtyNos: 120, status: "IN_HOUSE", locationId: wip, startDate: new Date() },
  });
  await prisma.lotBundleLink.create({ data: { lotId: fqiLot.id, bundleId: anyBundle.id, kgConsumed: 0 } });
  const fqiReason = await prisma.reasonCode.findFirstOrThrow({ where: { stage: "FQI" } });
  await rejects("the inspector must cover the whole lot", "must equal", () =>
    recordFinalInspection({ lotId: fqiLot.id, acceptedNos: 100, rejectedNos: 0, userId: floor.id }),
  );
  const rec = await recordFinalInspection({ lotId: fqiLot.id, acceptedNos: 115, rejectedNos: 5, reasonCodeId: fqiReason.id, results: "load OK", userId: floor.id });
  check("recording a result creates NO FG lot yet", (await prisma.fgLot.count({ where: { sourceLotId: fqiLot.id } })) === 0);
  await rejects("a second result for the same lot is refused while one awaits approval", "awaiting", () =>
    recordFinalInspection({ lotId: fqiLot.id, acceptedNos: 120, rejectedNos: 0, userId: floor.id }),
  );
  const fg = await approveRecordedFinalInspection({ fqiId: rec.id, approverId: admin.id });
  check("approval creates the FG lot with the accepted quantity", !!fg && fg.qtyNos === 115 && fg.sourceLotId === fqiLot.id);
  const today = new Date().toISOString().slice(0, 10);
  check("FG inward date = approval date", fg!.inwardDate.toISOString().slice(0, 10) === today);
  check("FG lot links back to the production lot (traceability)", fg!.sourceLotId === fqiLot.id);
  check("rejected pieces go to Rejected – FG", !!(await prisma.rejection.findFirst({ where: { stage: "FQI", refId: fqiLot.id } })));
  check("production lot closes", (await prisma.productionLot.findUniqueOrThrow({ where: { id: fqiLot.id } })).status === "CLOSED");
  await rejects("a recorded inspection cannot be approved twice", "already been approved", () =>
    approveRecordedFinalInspection({ fqiId: rec.id, approverId: admin.id }),
  );

  // ------------------------------------------------------------------ 4.9
  console.log("\n[4.9] Dispatch — packing details, FIFO, schedule status");
  const sched = await prisma.customerSchedule.create({ data: { customerId: jwPart.customerId, partId: jwPart.id, dueDate: new Date(), qtyNos: 100 } });
  const dn = await createDispatch({ scheduleId: sched.id, qtyNos: 60, invoiceNo: "SOP-INV", packingDetails: "6 boxes × 10", userId: storekeeper.id });
  const dnRow = await prisma.dispatch.findUniqueOrThrow({ where: { id: dn.id } });
  check("packing details are stored on the dispatch note", dnRow.packingDetails === "6 boxes × 10");
  const s2 = await prisma.customerSchedule.findUniqueOrThrow({ where: { id: sched.id } });
  check("schedule line is now Partially Dispatched (60 of 100)", s2.dispatchedNos === 60 && s2.dispatchedNos < s2.qtyNos);

  // ------------------------------------------------------------------ 4.10
  console.log("\n[4.10] Rejected – RM: accept under deviation");
  await rejects("deviation is only for IQC rejections", "only to IQC", async () => {
    const wipRej = await prisma.rejection.findFirstOrThrow({ where: { stage: "FQI", disposal: "PENDING" } });
    await disposeRejection({ rejectionId: wipRej.id, disposal: "DEVIATION", reason: "x", adminId: admin.id });
  });
  await disposeRejection({ rejectionId: rtsList!.id, disposal: "DEVIATION", reason: "surface marks acceptable per customer", adminId: admin.id });
  const dev = await prisma.bundle.findUniqueOrThrow({ where: { id: bBundle.id } });
  check("bundle accepted under deviation is Available in RM Stores", dev.status === "AVAILABLE" && dev.locationId === (await loc("RM Stores")));
  check("...keeping its original inward date (FIFO position)", dev.inwardDate.getTime() === bBundle.inwardDate.getTime());
  check("...and the ledger records it with the reason", !!(await prisma.stockLedger.findFirst({ where: { refNo: dev.bundleNo, txnType: "T2_IQC_ACCEPT", reason: { contains: "deviation" } } })));

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll SOP 4.2–4.10 checks passed.");
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
