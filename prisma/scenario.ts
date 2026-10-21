/**
 * `npm run db:scenario` — drives the real service layer through the SOP end to end
 * (GRN -> IQC -> MRN issue (FIFO) -> production -> job work -> final inspection -> dispatch ->
 * customer return -> rejection disposal -> reversals) and asserts the SOP rules, including the
 * negative cases. Run it against a scratch database, e.g.:
 *   DATABASE_URL=file:./scenario.db npx prisma db push --force-reset && npm run db:seed && npm run db:scenario
 * It writes data, so do not point it at a database you care about.
 */
import { prisma } from "../src/lib/prisma";
import { createGrn } from "../src/server/services/grn";
import { enterIqcResult, approveIqc } from "../src/server/services/iqc";
import { createMrn } from "../src/server/services/mrn";
import { createIssue, returnToStores } from "../src/server/services/issue";
import { recordOperationEntry } from "../src/server/services/production";
import {
  createJwOutChallan,
  createJwInReceipt,
  jwReturnQcDecision,
  closeChallanWithShortage,
} from "../src/server/services/jobwork";
import { approveFinalInspection } from "../src/server/services/finalInspection";
import { createDispatch, createCustomerReturn } from "../src/server/services/dispatch";
import { disposeRejection } from "../src/server/services/rejection";
import { adjustBundleStock, reverseTransaction } from "../src/server/services/adjustment";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

/** Expect `fn` to throw a ValidationError whose message contains `part`. */
async function rejects(name: string, part: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "expected a validation error but it succeeded");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(name, msg.toLowerCase().includes(part.toLowerCase()), `got: ${msg}`);
  }
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "storekeeper@demo.local" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "stores.admin@demo.local" } });

  // ---------------- SOP 4.5 / 7: FIFO worked example ----------------
  console.log("\n[4.5/7] FIFO issue — worked example MRN-2610-0008");
  const mrn = await prisma.mrn.findUniqueOrThrow({ where: { mrnNo: "MRN-2610-0008" } });
  const b = async (no: string) => prisma.bundle.findUniqueOrThrow({ where: { bundleNo: no } });
  const [b31, b47, b03, b19] = await Promise.all(
    ["RM-2609-0031", "RM-2609-0047", "RM-2610-0003", "RM-2610-0019"].map(b),
  );
  await rejects("scanning the newest bundle first is blocked and names the oldest", "Issue RM-2609-0031 first", () =>
    createIssue({ mrnId: mrn.id, scannedLines: [{ bundleId: b19!.id, kgIssued: 500 }], userId: user.id, isAdmin: false }),
  );
  await rejects("Floor user cannot override FIFO even with a reason", "Wrong bundle", () =>
    createIssue({
      mrnId: mrn.id,
      scannedLines: [{ bundleId: b19!.id, kgIssued: 500 }],
      userId: user.id,
      isAdmin: false,
      overrideReason: "trying",
    }),
  );
  await rejects("issuing more than the MRN needs is blocked", "exceeds what this MRN still needs", () =>
    createIssue({
      mrnId: mrn.id,
      scannedLines: [
        { bundleId: b31!.id, kgIssued: 150 },
        { bundleId: b47!.id, kgIssued: 500 },
        { bundleId: b03!.id, kgIssued: 500 },
      ],
      userId: user.id,
      isAdmin: false,
    }),
  );
  await rejects("skipping a bundle inside one multi-line issue is blocked", "Issue RM-2609-0031 first", () =>
    createIssue({
      mrnId: mrn.id,
      scannedLines: [
        { bundleId: b47!.id, kgIssued: 500 },
        { bundleId: b31!.id, kgIssued: 150 },
      ],
      userId: user.id,
      isAdmin: false,
    }),
  );
  const { lot, issue } = await createIssue({
    mrnId: mrn.id,
    scannedLines: [
      { bundleId: b31!.id, kgIssued: 150 },
      { bundleId: b47!.id, kgIssued: 500 },
      { bundleId: b03!.id, kgIssued: 250 },
    ],
    userId: user.id,
    isAdmin: false,
  });
  const after = await Promise.all([b31, b47, b03, b19].map((x) => prisma.bundle.findUniqueOrThrow({ where: { id: x!.id } })));
  check("150 + 500 + 250 kg picked; 0031 and 0047 closed", Number(after[0]!.balanceKg) === 0 && after[0]!.status === "CONSUMED" && Number(after[1]!.balanceKg) === 0);
  check("RM-2610-0003 stays Available with 250 kg and its original inward date", Number(after[2]!.balanceKg) === 250 && after[2]!.status === "AVAILABLE" && after[2]!.inwardDate.getTime() === b03!.inwardDate.getTime());
  check("RM-2610-0019 untouched (500 kg)", Number(after[3]!.balanceKg) === 500);
  const links = await prisma.lotBundleLink.findMany({ where: { lotId: lot.id } });
  check("production lot is linked to the 3 bundles (Part <-> Bundle)", links.length === 3);
  check("MRN closes once fully issued", (await prisma.mrn.findUniqueOrThrow({ where: { id: mrn.id } })).status === "CLOSED");
  await rejects("cannot issue against a closed MRN", "closed", () =>
    createIssue({ mrnId: mrn.id, scannedLines: [{ bundleId: b19!.id, kgIssued: 10 }], userId: user.id, isAdmin: false }),
  );

  // ---------------- 4.5: return to stores ----------------
  console.log("\n[4.5] Return to stores");
  await rejects("cannot return more than the lot drew from that bundle", "Cannot return", () =>
    returnToStores({ bundleId: b03!.id, lotId: lot.id, kg: 300, userId: user.id }),
  );
  await returnToStores({ bundleId: b03!.id, lotId: lot.id, kg: 50, userId: user.id });
  const b03b = await prisma.bundle.findUniqueOrThrow({ where: { id: b03!.id } });
  check("returned wire restores the SAME bundle (300 kg) with original inward date", Number(b03b.balanceKg) === 300 && b03b.inwardDate.getTime() === b03!.inwardDate.getTime());
  check("MRN re-opens to Partially Issued after a return", (await prisma.mrn.findUniqueOrThrow({ where: { id: mrn.id } })).status === "PARTIALLY_ISSUED");
  // issue the 50 kg again so the lot has all its wire
  await createIssue({ mrnId: mrn.id, scannedLines: [{ bundleId: b03!.id, kgIssued: 50 }], userId: user.id, isAdmin: false });
  // the second issue created its own lot; use the first lot (850 kg of wire) from here on.
  const lot1 = await prisma.productionLot.findUniqueOrThrow({ where: { id: lot.id }, include: { part: { include: { bomLines: { orderBy: { opSeq: "asc" } } } } } });
  const ops = lot1.part.bomLines;
  console.log(`      part ${lot1.part.partNo}: routing ${ops.map((o) => `${o.opSeq}:${o.opName}(${o.opType === "JOB_WORK" ? "JW" : "in"})`).join(" ")}`);

  // ---------------- 4.6: production ----------------
  console.log("\n[4.6] Production");
  const netWt = Number(lot1.part.netWtPerPcKg);
  const kgIn = links.reduce((s, l) => s + Number(l.kgConsumed), 0) - 50; // 850 after the return
  const maxNos = Math.floor(kgIn / netWt + 1e-6);
  await rejects("coiling cannot make more springs than the wire allows", "exceeds what the issued wire can make", () =>
    recordOperationEntry({ lotId: lot.id, opSeq: 1, goodNos: maxNos + 1, rejectedNos: 0, userId: user.id }),
  );
  const reason = await prisma.reasonCode.findFirstOrThrow({ where: { stage: "WIP" } });
  await rejects("rejected quantity needs a reason code", "Reason code", () =>
    recordOperationEntry({ lotId: lot.id, opSeq: 1, goodNos: 100, rejectedNos: 5, userId: user.id }),
  );
  await rejects("operations must follow the routing sequence", "routing sequence", () =>
    recordOperationEntry({ lotId: lot.id, opSeq: 3, goodNos: 10, rejectedNos: 0, userId: user.id }),
  );
  const goodCoil = maxNos - 20;
  await recordOperationEntry({ lotId: lot.id, opSeq: 1, goodNos: goodCoil, rejectedNos: 15, reasonCodeId: reason.id, userId: user.id });
  const l1 = await prisma.productionLot.findUniqueOrThrow({ where: { id: lot.id } });
  check("lot moves to op 2 with the good quantity", l1.currentOpSeq === 2 && l1.qtyNos === goodCoil);
  check("in-process rejection is logged as Rejected – WIP", (await prisma.rejection.count({ where: { stage: "WIP", refId: lot.id } })) === 1);
  await rejects("an in-house screen cannot process a Job Work op", "Job Work", () =>
    recordOperationEntry({ lotId: lot.id, opSeq: 2, goodNos: 1, rejectedNos: 0, userId: user.id }),
  );
  await rejects("an in-house op is not a job-work send", "Production screen", async () => {
    // op 3 is in-house; force the lot there to prove the JW screen refuses it
    const v = await prisma.jobWorker.findFirstOrThrow();
    const probe = await prisma.productionLot.create({
      data: { lotNo: "PL-TEST-0001", partId: lot1.partId, mrnId: mrn.id, currentOpSeq: 3, qtyNos: 5, status: "IN_HOUSE", locationId: l1.locationId },
    });
    await prisma.lotBundleLink.create({ data: { lotId: probe.id, bundleId: b31!.id, kgConsumed: 0 } });
    await createJwOutChallan({ vendorId: v.id, lines: [{ lotId: probe.id, qtyNos: 5, qtyKg: 1 }], userId: user.id });
  });

  // ---------------- 4.7: job work ----------------
  console.log("\n[4.7] Job work out / in");
  const jwOp = ops.find((o) => o.opSeq === 2)!;
  const vendor = await prisma.jobWorker.findUniqueOrThrow({ where: { id: jwOp.defaultVendorId! } });
  await rejects("cannot send more than the lot holds / partial lot send", "whole lot", () =>
    createJwOutChallan({ vendorId: vendor.id, lines: [{ lotId: lot.id, qtyNos: goodCoil - 1, qtyKg: 100 }], userId: user.id }),
  );
  await rejects("expected return beyond the vendor's maximum is blocked", "maximum return period", () =>
    createJwOutChallan({
      vendorId: vendor.id,
      lines: [{ lotId: lot.id, qtyNos: goodCoil, qtyKg: 100 }],
      userId: user.id,
      expectedReturnDate: new Date(Date.now() + (vendor.maxReturnDays + 30) * 86400000),
    }),
  );
  const challan = await createJwOutChallan({ vendorId: vendor.id, lines: [{ lotId: lot.id, qtyNos: goodCoil, qtyKg: 100 }], userId: user.id });
  const cl = await prisma.jwOutChallan.findUniqueOrThrow({ where: { id: challan.id }, include: { lines: true } });
  const days = Math.round((cl.expectedReturnDate.getTime() - cl.date.getTime()) / 86400000);
  check(`expected return = challan date + lead time (${jwOp.jwLeadDays ?? vendor.maxReturnDays} d)`, days === (jwOp.jwLeadDays ?? vendor.maxReturnDays), `got ${days}`);
  check("lot is At Job Work and cannot be issued/sent elsewhere", (await prisma.productionLot.findUniqueOrThrow({ where: { id: lot.id } })).status === "AT_JOB_WORK");
  await rejects("a lot at the job worker cannot be sent again", "not in-house", () =>
    createJwOutChallan({ vendorId: vendor.id, lines: [{ lotId: lot.id, qtyNos: goodCoil, qtyKg: 100 }], userId: user.id }),
  );
  const line = cl.lines[0]!;
  await rejects("receipt above the pending quantity is blocked", "exceeds challan pending", () =>
    createJwInReceipt({ challanId: challan.id, lines: [{ challanLineId: line.id, receivedNos: goodCoil + 1, rejectedNos: 0, shortNos: 0 }], userId: user.id }),
  );
  await rejects("vendor-rejected quantity needs a reason code", "Reason code", () =>
    createJwInReceipt({ challanId: challan.id, lines: [{ challanLineId: line.id, receivedNos: 0, rejectedNos: 3, shortNos: 0 }], userId: user.id }),
  );
  const jwReason = await prisma.reasonCode.findFirstOrThrow({ where: { stage: "JW" } });
  await createJwInReceipt({ challanId: challan.id, lines: [{ challanLineId: line.id, receivedNos: 100, rejectedNos: 3, shortNos: 0, reasonCodeId: jwReason.id }], userId: user.id });
  const mid = await prisma.jwOutChallan.findUniqueOrThrow({ where: { id: challan.id } });
  check("partial receipt keeps the challan open (Partially Received)", mid.status === "PARTIALLY_RECEIVED");
  check("partial receipt keeps the lot at the vendor", (await prisma.productionLot.findUniqueOrThrow({ where: { id: lot.id } })).status === "AT_JOB_WORK");
  check("vendor-rejected quantity is logged as Rejected – WIP (JW return)", (await prisma.rejection.count({ where: { stage: "JW_RETURN", refId: lot.id } })) === 1);
  const rest = goodCoil - 103;
  // Admin closes with shortage: the 10 still outstanding is written off as short.
  await rejects("Floor reason is mandatory to close with shortage", "Reason", () =>
    closeChallanWithShortage({ challanId: challan.id, reason: " ", adminId: admin.id }),
  );
  await createJwInReceipt({ challanId: challan.id, lines: [{ challanLineId: line.id, receivedNos: rest - 10, rejectedNos: 0, shortNos: 0 }], userId: user.id });
  await closeChallanWithShortage({ challanId: challan.id, reason: "10 pcs lost at vendor", adminId: admin.id });
  const closed = await prisma.jwOutChallan.findUniqueOrThrow({ where: { id: challan.id }, include: { lines: true } });
  check("challan closes with the shortage recorded (sent = received + rejected + short)", closed.status === "CLOSED" && closed.lines[0]!.shortNos === 10 && closed.lines[0]!.receivedNos + closed.lines[0]!.rejectedNos + closed.lines[0]!.shortNos === goodCoil);
  const recv = goodCoil - 3 - 10;
  const lq = await prisma.productionLot.findUniqueOrThrow({ where: { id: lot.id } });
  check("lot moves to JW Return QC with the good quantity received", lq.status === "JW_RETURN_QC" && lq.qtyNos === recv, `status ${lq.status} qty ${lq.qtyNos} expected ${recv}`);
  await rejects("QC must decide the whole received quantity", "must equal", () =>
    jwReturnQcDecision({ lotId: lot.id, acceptedNos: recv - 5, rejectedNos: 0, userId: user.id }),
  );
  await jwReturnQcDecision({ lotId: lot.id, acceptedNos: recv - 4, rejectedNos: 4, reasonCodeId: jwReason.id, userId: user.id });
  let cur = await prisma.productionLot.findUniqueOrThrow({ where: { id: lot.id } });
  check("QC accept returns the lot to in-house at the next operation", cur.status === "IN_HOUSE" && cur.currentOpSeq === 3 && cur.qtyNos === recv - 4);

  // remaining routing: in-house op 3 and job-work op 4 (generic loop for any routing)
  console.log("\n[4.6/4.7] Remaining routing");
  for (let guard = 0; guard < 10; guard++) {
    cur = await prisma.productionLot.findUniqueOrThrow({ where: { id: lot.id } });
    const op = ops.find((o) => o.opSeq === cur.currentOpSeq);
    if (!op) break;
    if (op.opType === "IN_HOUSE") {
      await rejects(`op ${op.opSeq}: good + rejected above available is blocked`, "exceeds quantity available", () =>
        recordOperationEntry({ lotId: lot.id, opSeq: op.opSeq, goodNos: cur.qtyNos, rejectedNos: 1, reasonCodeId: reason.id, userId: user.id }),
      );
      await recordOperationEntry({ lotId: lot.id, opSeq: op.opSeq, goodNos: cur.qtyNos - 2, rejectedNos: 2, reasonCodeId: reason.id, userId: user.id });
    } else {
      const v = await prisma.jobWorker.findUniqueOrThrow({ where: { id: op.defaultVendorId! } });
      const ch = await createJwOutChallan({ vendorId: v.id, lines: [{ lotId: lot.id, qtyNos: cur.qtyNos, qtyKg: 50 }], userId: user.id });
      const ln = (await prisma.jwChallanLine.findFirstOrThrow({ where: { challanId: ch.id } }));
      await createJwInReceipt({ challanId: ch.id, lines: [{ challanLineId: ln.id, receivedNos: cur.qtyNos, rejectedNos: 0, shortNos: 0 }], userId: user.id });
      await jwReturnQcDecision({ lotId: lot.id, acceptedNos: cur.qtyNos, rejectedNos: 0, userId: user.id });
    }
  }
  cur = await prisma.productionLot.findUniqueOrThrow({ where: { id: lot.id } });
  check("after the last op the lot is flagged complete (ready for final inspection)", cur.currentOpSeq > Math.max(...ops.map((o) => o.opSeq)) && cur.status === "IN_HOUSE");

  // ---------------- 4.8: final inspection ----------------
  console.log("\n[4.8] Final inspection");
  const fqiReason = await prisma.reasonCode.findFirstOrThrow({ where: { stage: "FQI" } });
  const early = await prisma.productionLot.create({
    data: { lotNo: "PL-TEST-0002", partId: lot1.partId, mrnId: mrn.id, currentOpSeq: ops[ops.length - 1]!.opSeq, qtyNos: 50, status: "IN_HOUSE", locationId: cur.locationId },
  });
  await prisma.lotBundleLink.create({ data: { lotId: early.id, bundleId: b31!.id, kgConsumed: 0 } });
  await rejects("a lot that has not yet performed its last operation cannot be inspected", "not completed", () =>
    approveFinalInspection({ lotId: early.id, acceptedNos: 50, rejectedNos: 0, approverId: admin.id }),
  );
  await rejects("accepted + rejected must equal the whole lot", "must equal the lot quantity", () =>
    approveFinalInspection({ lotId: lot.id, acceptedNos: cur.qtyNos - 5, rejectedNos: 0, approverId: admin.id }),
  );
  const fg = await approveFinalInspection({ lotId: lot.id, acceptedNos: cur.qtyNos - 5, rejectedNos: 5, reasonCodeId: fqiReason.id, approverId: admin.id });
  check("FG lot created with the accepted quantity, dated at approval", !!fg && fg.qtyNos === cur.qtyNos - 5 && fg.balanceNos === fg.qtyNos);
  check("production lot closes after inspection", (await prisma.productionLot.findUniqueOrThrow({ where: { id: lot.id } })).status === "CLOSED");
  const fqiRej = await prisma.rejection.findFirstOrThrow({ where: { stage: "FQI", refId: lot.id } });

  // ---------------- 4.9: dispatch ----------------
  console.log("\n[4.9] Dispatch");
  const sched = await prisma.customerSchedule.create({
    data: { customerId: lot1.part.customerId, partId: lot1.partId, dueDate: new Date(Date.now() + 5 * 86400000), qtyNos: 100, dispatchedNos: 0 },
  });
  await rejects("dispatch above the schedule balance needs Admin approval", "Admin approval", () =>
    createDispatch({ scheduleId: sched.id, qtyNos: 150, invoiceNo: "INV-X", userId: user.id }),
  );
  const d1 = await createDispatch({ scheduleId: sched.id, qtyNos: 60, invoiceNo: "INV-1", userId: user.id });
  const fgAfter = await prisma.fgLot.findUniqueOrThrow({ where: { id: fg!.id } });
  check("dispatch reduces FG by FIFO and updates the schedule", fgAfter.balanceNos === fg!.qtyNos - 60 && (await prisma.customerSchedule.findUniqueOrThrow({ where: { id: sched.id } })).dispatchedNos === 60);
  const over = await createDispatch({ scheduleId: sched.id, qtyNos: 55, invoiceNo: "INV-2", userId: admin.id, adminOverride: true });
  check("Admin may over-dispatch with explicit approval", !!over);
  await rejects("dispatch cannot exceed the FG available", "exceeds FG available", () =>
    createDispatch({ scheduleId: sched.id, qtyNos: 10_000_000, invoiceNo: "INV-3", userId: admin.id, adminOverride: true }),
  );

  // ---------------- 4.10: customer return + rejections ----------------
  console.log("\n[4.10] Customer return and rejection disposal");
  const custReason = await prisma.reasonCode.findFirstOrThrow({ where: { stage: "Customer" } });
  await rejects("a return cannot exceed what was dispatched on the note", "exceeds what was dispatched", () =>
    createCustomerReturn({ dispatchNo: d1.dispatchNo, fgLotNo: fg!.fgLotNo, qtyNos: 61, reasonCodeId: custReason.id, userId: user.id }),
  );
  await rejects("a return must reference a dispatch that carried that FG lot", "not found", () =>
    createCustomerReturn({ dispatchNo: "DN-NOPE", fgLotNo: fg!.fgLotNo, qtyNos: 1, reasonCodeId: custReason.id, userId: user.id }),
  );
  const ret = await createCustomerReturn({ dispatchNo: d1.dispatchNo, fgLotNo: fg!.fgLotNo, qtyNos: 4, reasonCodeId: custReason.id, userId: user.id });
  check("customer return lands in Rejected – FG (pending disposal)", ret.stage === "CUSTOMER_RETURN" && ret.disposal === "PENDING");
  await rejects("rework needs a target operation", "operation", () =>
    disposeRejection({ rejectionId: fqiRej.id, disposal: "REWORK", reason: "rework", adminId: admin.id }),
  );
  await disposeRejection({ rejectionId: fqiRej.id, disposal: "REWORK", targetOpSeq: ops[0]!.opSeq, reason: "re-coil", adminId: admin.id });
  const rework = await prisma.productionLot.findFirstOrThrow({ where: { qtyNos: 5, currentOpSeq: ops[0]!.opSeq, lotNo: { not: "PL-TEST-0002" } }, include: { bundleLinks: true } });
  check("rework creates a new in-house lot at the chosen op, still linked to the bundles", rework.status === "IN_HOUSE" && rework.bundleLinks.length > 0);
  await disposeRejection({ rejectionId: ret.id, disposal: "SCRAP", reason: "unrepairable", adminId: admin.id });
  const iqcRej = await prisma.rejection.findFirstOrThrow({ where: { stage: "IQC", disposal: "PENDING" } });
  const rejBundleBefore = await prisma.bundle.findUniqueOrThrow({ where: { id: iqcRej.refId } });
  const wipRej = await prisma.rejection.findFirstOrThrow({ where: { stage: "WIP", disposal: "PENDING" } });
  await rejects("only IQC rejections can be returned to supplier", "IQC", () =>
    disposeRejection({ rejectionId: wipRej.id, disposal: "RTS", reason: "x", adminId: admin.id }),
  );
  await rejects("a rejection can only be disposed once", "already disposed", () =>
    disposeRejection({ rejectionId: fqiRej.id, disposal: "SCRAP", reason: "x", adminId: admin.id }),
  );
  await disposeRejection({ rejectionId: iqcRej.id, disposal: "RTS", reason: "debit note DN-77", adminId: admin.id });
  const rejBundleAfter = await prisma.bundle.findUniqueOrThrow({ where: { id: iqcRej.refId } });
  check("return-to-supplier takes the rejected bundle to zero stock", Number(rejBundleBefore.balanceKg) > 0 && Number(rejBundleAfter.balanceKg) === 0);

  // ---------------- 4.1 / 4.2 / 4.3: GRN + IQC ----------------
  console.log("\n[4.1-4.3] GRN and IQC");
  const allLines = await prisma.poLine.findMany({ include: { po: true } });
  const pl = allLines.find((l) => Number(l.orderedKg) - Number(l.receivedKg) >= 250);
  if (!pl) throw new Error("scenario needs a PO line with >= 250 kg balance (re-seed a fresh database)");
  const po = pl.po;
  const balance = Number(pl.orderedKg) - Number(pl.receivedKg);
  await rejects("GRN above PO balance + tolerance is blocked", "exceeds PO balance", () =>
    createGrn({ poId: po.id, invoiceNo: "S-1", bundles: [{ itemId: pl.itemId, heatNo: "H1", weightKg: balance * 1.5 + 10 }], userId: user.id }),
  );
  const g = await createGrn({ poId: po.id, invoiceNo: "S-2", bundles: [{ itemId: pl.itemId, heatNo: "H-NEW", weightKg: 100 }, { itemId: pl.itemId, heatNo: "H-NEW2", weightKg: 80 }], userId: user.id });
  check("each bundle gets a system number and starts in Quality Hold", g.bundles.length === 2 && g.bundles.every((x) => x.status === "QUALITY_HOLD" && /^RM-\d{4}-\d{4}$/.test(x.bundleNo)));
  await rejects("Quality Hold stock cannot be issued", "not Available", async () => {
    const part = await prisma.part.findFirstOrThrow({ where: { bomLines: { some: { itemId: pl.itemId } } } });
    const open = await createMrn({ partId: part.id, plannedQtyNos: 100000, userId: user.id });
    await createIssue({ mrnId: open.id, scannedLines: [{ bundleId: g.bundles[0]!.id, kgIssued: 10 }], userId: user.id, isAdmin: false });
  });
  const iq = await enterIqcResult({ bundleId: g.bundles[0]!.id, results: { dia: "ok" }, decision: "ACCEPT", userId: user.id });
  await rejects("only one IQC result per bundle", "already been entered", () =>
    enterIqcResult({ bundleId: g.bundles[0]!.id, results: {}, decision: "ACCEPT", userId: user.id }),
  );
  await rejects("rejecting a bundle needs a reason code", "Reason code", () =>
    enterIqcResult({ bundleId: g.bundles[1]!.id, results: {}, decision: "REJECT", userId: user.id }),
  );
  const approved = await approveIqc({ iqcId: iq.id, approverId: admin.id });
  check("IQC approval makes the bundle Available in RM Stores", approved?.bundle.status === "AVAILABLE");
  await rejects("an IQC cannot be approved twice", "already been approved", () => approveIqc({ iqcId: iq.id, approverId: admin.id }));

  // ---------------- 9: reversals / adjustments ----------------
  console.log("\n[9] Adjustments and reversals");
  await rejects("adjustment cannot drive a bundle negative", "negative", () =>
    adjustBundleStock({ bundleId: g.bundles[0]!.id, deltaKg: -1000, reason: "x", adminId: admin.id }),
  );
  await adjustBundleStock({ bundleId: g.bundles[0]!.id, deltaKg: -5, reason: "count", adminId: admin.id });
  const adjRow = await prisma.stockLedger.findFirstOrThrow({ where: { txnType: "T17_ADJUSTMENT", refNo: g.bundles[0]!.bundleNo } });
  check("adjustment document numbers are system generated (ADJ-FY-####)", /^ADJ-\d{4}-\d{4}$/.test(adjRow.docNo), adjRow.docNo);
  await reverseTransaction({ ledgerId: adjRow.id, reason: "recount", adminId: admin.id });
  check("reversing the adjustment restores the balance", Number((await prisma.bundle.findUniqueOrThrow({ where: { id: g.bundles[0]!.id } })).balanceKg) === 100);
  await rejects("a transaction cannot be reversed twice", "already been reversed", () =>
    reverseTransaction({ ledgerId: adjRow.id, reason: "again", adminId: admin.id }),
  );
  const iqcLedger = await prisma.stockLedger.findFirstOrThrow({ where: { txnType: "T2_IQC_ACCEPT", refNo: g.bundles[0]!.bundleNo } });
  await rejects("status-only moves (IQC accept) are not reversible as a stock change", "cannot be reversed", () =>
    reverseTransaction({ ledgerId: iqcLedger.id, reason: "x", adminId: admin.id }),
  );
  const grnLedger = await prisma.stockLedger.findFirstOrThrow({ where: { txnType: "T1_GRN", refNo: g.bundles[1]!.bundleNo } });
  await reverseTransaction({ ledgerId: grnLedger.id, reason: "wrong bundle keyed", adminId: admin.id });
  check("an untouched GRN bundle can be reversed (balance 0, PO balance restored)", Number((await prisma.bundle.findUniqueOrThrow({ where: { id: g.bundles[1]!.id } })).balanceKg) === 0);
  const issueRow = await prisma.stockLedger.findFirstOrThrow({ where: { txnType: "T5_ISSUE", docNo: issue.issueNo, refNo: "RM-2609-0031" } });
  await rejects("an issue whose lot already has production activity cannot be reversed", "production activity", () =>
    reverseTransaction({ ledgerId: issueRow.id, reason: "x", adminId: admin.id }),
  );

  console.log(`\nScenario finished: ${passed} checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.error("\nFAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("scenario crashed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
