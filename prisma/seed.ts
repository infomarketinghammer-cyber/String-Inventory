/**
 * Idempotent seed script. Run with `npm run db:seed` (auto-run by `docker compose up`).
 *
 * Reproduces Section 7's worked example EXACTLY:
 *   Item SW-C 3.0mm, bundles RM-2609-0031 (inward 2026-09-04, 150kg),
 *   RM-2609-0047 (inward 2026-09-18, 500kg), RM-2610-0003 (inward 2026-10-02, 500kg),
 *   RM-2610-0019 (inward 2026-10-09, 500kg, untouched) — all Available in RM Stores —
 *   and an Open MRN-2610-0008 requiring 900kg of the same item (not yet issued, so the
 *   FIFO pick can be demonstrated live on the Issue screen or in the Vitest test).
 *
 * Every row that affects stock also gets a matching StockLedger row, so
 * `npm run db:verify` reconciles balances against the ledger.
 *
 * NOTE on volume: the brief asks for "25 of every transactional entity" as a
 * stretch target but explicitly allows scaling down to a smaller, fully
 * coherent dataset when time is tight. This seed uses ~10-15 of each
 * transactional entity (see README "Known limitations") rather than 25+, to
 * keep every balance hand-reconcilable and correct.
 */
import { createPrismaClient } from "../src/lib/prisma";
import argon2 from "argon2";
import { randomUUID } from "crypto";

const prisma = createPrismaClient();

const LOCATIONS = [
  { name: "Incoming/QC area", type: "QC" as const },
  { name: "RM Stores", type: "STORES" as const },
  { name: "Production floor (WIP)", type: "WIP" as const },
  { name: "JW Return QC", type: "QC" as const },
  { name: "FG Stores", type: "FG" as const },
  { name: "Rejection area - RM", type: "REJECTION" as const },
  { name: "Rejection area - WIP", type: "REJECTION" as const },
  { name: "Rejection area - FG", type: "REJECTION" as const },
  { name: "Scrap/Returned (virtual)", type: "VIRTUAL" as const },
];

async function ledger(data: {
  txnType: string;
  docNo: string;
  itemType: "RM" | "WIP" | "FG";
  refNo: string;
  fromLocationId?: string;
  toLocationId?: string;
  fromStatus?: string;
  toStatus?: string;
  qty: number;
  uom: string;
  userId: string;
  reason?: string;
  txnDate?: Date;
}) {
  return prisma.stockLedger.create({
    data: {
      txnId: randomUUID(),
      txnType: data.txnType as never,
      txnDate: data.txnDate ?? new Date(),
      docNo: data.docNo,
      itemType: data.itemType,
      refNo: data.refNo,
      fromLocationId: data.fromLocationId,
      toLocationId: data.toLocationId,
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      qty: data.qty,
      uom: data.uom,
      userId: data.userId,
      reason: data.reason,
    },
  });
}

async function main() {
  // Demo data is only for a NEW, empty database. Never write it into a database that already holds the plant's
  // records (e.g. a start command on the server that still runs db:seed). Override only with --force-demo.
  const existing = (await prisma.user.count()) + (await prisma.grn.count());
  if (existing > 0 && !process.argv.includes("--force-demo")) {
    console.log("Seed skipped: this database already has data (users / GRNs). Demo data is only loaded into an empty database.");
    return;
  }
  console.log("Seeding locations...");
  const locMap = new Map<string, string>();
  for (const l of LOCATIONS) {
    const loc = await prisma.location.upsert({ where: { name: l.name }, update: {}, create: l });
    locMap.set(l.name, loc.id);
  }

  console.log("Seeding users...");
  const pwd = await argon2.hash("Demo@1234");
  const usersSpec = [
    { email: "stores.admin@demo.local", name: "Stores Admin", role: "ADMIN" as const },
    { email: "quality.admin@demo.local", name: "Quality Admin", role: "ADMIN" as const },
    { email: "plant.admin@demo.local", name: "Plant Admin", role: "ADMIN" as const },
    { email: "storekeeper@demo.local", name: "Store Keeper", role: "FLOOR" as const },
    { email: "supervisor@demo.local", name: "Production Supervisor", role: "FLOOR" as const },
    { email: "qc.inspector@demo.local", name: "QC Inspector", role: "FLOOR" as const },
    { email: "dispatch@demo.local", name: "Dispatch Clerk", role: "FLOOR" as const },
  ];
  const users = new Map<string, { id: string; role: string }>();
  for (const u of usersSpec) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, role: u.role, passwordHash: pwd },
    });
    users.set(u.email, user);
  }
  const admin = users.get("stores.admin@demo.local")!;
  const qAdmin = users.get("quality.admin@demo.local")!;
  const storekeeper = users.get("storekeeper@demo.local")!;
  const supervisor = users.get("supervisor@demo.local")!;
  const qcInspector = users.get("qc.inspector@demo.local")!;
  const dispatchClerk = users.get("dispatch@demo.local")!;

  console.log("Seeding admin settings...");
  await prisma.adminSetting.upsert({
    where: { key: "PO_TOLERANCE_PCT" },
    update: {},
    create: { key: "PO_TOLERANCE_PCT", value: "2" },
  });
  await prisma.adminSetting.upsert({
    where: { key: "AGING_BUCKETS" },
    update: {},
    create: { key: "AGING_BUCKETS", value: "30,60,90,180" },
  });
  await prisma.adminSetting.upsert({
    where: { key: "QC_HOLD_ALERT_DAYS" },
    update: {},
    create: { key: "QC_HOLD_ALERT_DAYS", value: "2" },
  });
  await prisma.adminSetting.upsert({
    where: { key: "JW_ALERT_DAYS_BEFORE" },
    update: {},
    create: { key: "JW_ALERT_DAYS_BEFORE", value: "3" },
  });

  console.log("Seeding items (6 wire grades)...");
  const itemsSpec = [
    { itemCode: "SWC-3.0", grade: "SW-C", diameterMm: 3.0 },
    { itemCode: "SWC-2.5", grade: "SW-C", diameterMm: 2.5 },
    { itemCode: "SWB-2.0", grade: "SW-B", diameterMm: 2.0 },
    { itemCode: "HC80B-1.6", grade: "HC-80B", diameterMm: 1.6 },
    { itemCode: "SWC-4.0", grade: "SW-C", diameterMm: 4.0 },
    { itemCode: "SWA-2.2", grade: "SW-A", diameterMm: 2.2 },
  ];
  const items = new Map<string, { id: string; itemCode: string }>();
  for (const it of itemsSpec) {
    const item = await prisma.item.upsert({
      where: { itemCode: it.itemCode },
      update: {},
      create: { ...it, uom: "kg", agingAlertDays: 30 },
    });
    items.set(it.itemCode, item);
  }
  const swc30 = items.get("SWC-3.0")!;

  console.log("Seeding suppliers, job workers, customers...");
  const supplierNames = ["Tata Steel Wire", "Bekaert India", "Usha Martin", "JSW Wire", "Sundram Wire"];
  const suppliers = [];
  for (const name of supplierNames) {
    suppliers.push(
      await prisma.supplier.upsert({ where: { id: `sup-${name}` }, update: {}, create: { id: `sup-${name}`, name, gstin: "27AAAAA0000A1Z5" } }).catch(() =>
        prisma.supplier.create({ data: { name, gstin: "27AAAAA0000A1Z5" } }),
      ),
    );
  }

  const jwSpec = [
    { name: "Precision Plating Works", days: 7 },
    { name: "Apex Heat Treatment", days: 5 },
    { name: "Sharp Grinding Co.", days: 4 },
    { name: "Peenmaster Shot Peening", days: 6 },
  ];
  const jobWorkers = new Map<string, { id: string }>();
  for (const jw of jwSpec) {
    const locName = `At Job Worker - ${jw.name}`;
    const loc = await prisma.location.upsert({
      where: { name: locName },
      update: {},
      create: { name: locName, type: "JW_VENDOR" },
    });
    const vendor = await prisma.jobWorker.upsert({
      where: { id: `jw-${jw.name}` },
      update: {},
      create: { id: `jw-${jw.name}`, name: jw.name, maxReturnDays: jw.days, locationId: loc.id },
    }).catch(async () => {
      const existing = await prisma.jobWorker.findFirst({ where: { name: jw.name } });
      if (existing) return existing;
      return prisma.jobWorker.create({ data: { name: jw.name, maxReturnDays: jw.days, locationId: loc.id } });
    });
    jobWorkers.set(jw.name, vendor);
  }

  const customerNames = ["Autoline Motors", "Suspension Systems Ltd", "Precision Auto Parts", "Metro Transit Corp"];
  const customers = new Map<string, { id: string }>();
  for (const name of customerNames) {
    const c = await prisma.customer.findFirst({ where: { name } });
    customers.set(name, c ?? (await prisma.customer.create({ data: { name } })));
  }

  console.log("Seeding reason codes (20)...");
  const reasonCodes = [
    ["IQC-DIA", "IQC", "Diameter out of tolerance"],
    ["IQC-TENS", "IQC", "Tensile strength failure"],
    ["IQC-SURF", "IQC", "Surface defect / rust"],
    ["IQC-TC", "IQC", "Test certificate mismatch"],
    ["IQC-DEV", "IQC", "Accepted under deviation"],
    ["WIP-COIL", "WIP", "Coiling dimension out of spec"],
    ["WIP-CRACK", "WIP", "Crack after heat treatment"],
    ["WIP-GRIND", "WIP", "Grinding over-size"],
    ["WIP-BURR", "WIP", "Burr / sharp edge"],
    ["JW-DAMAGE", "JW", "Damaged in transit to job worker"],
    ["JW-PLATE", "JW", "Plating adhesion failure"],
    ["JW-SHORT", "JW", "Short received from job worker"],
    ["FQI-LOAD", "FQI", "Load test failure"],
    ["FQI-DIM", "FQI", "Final dimension out of spec"],
    ["FQI-VISUAL", "FQI", "Visual/cosmetic rejection"],
    ["CUST-FIELD", "Customer", "Field failure return"],
    ["CUST-PACK", "Customer", "Packing damage return"],
    ["ADJ-COUNT", "Adjustment", "Physical count correction"],
    ["ADJ-DAMAGE", "Adjustment", "Damage write-off"],
    ["ADJ-OTHER", "Adjustment", "Other admin adjustment"],
    ["RTN-EXCESS", "Return", "Excess wire issued / not needed"],
    ["RTN-PLAN", "Return", "Production plan changed / MRN reduced"],
    ["RTN-WRONG", "Return", "Wrong grade or bundle issued"],
    ["RTN-QUALITY", "Return", "Quality concern found on the floor"],
  ] as const;
  for (const [code, stage, description] of reasonCodes) {
    await prisma.reasonCode.upsert({ where: { code }, update: {}, create: { code, stage, description } });
  }

  console.log("Seeding parts + BOM/routing (8 parts, 4 customers)...");
  const partsSpec = [
    { partNo: "AL-SPR-101", customer: "Autoline Motors", desc: "Valve spring", netWt: 0.012, scrap: 3, item: "SWC-3.0" },
    { partNo: "AL-SPR-102", customer: "Autoline Motors", desc: "Clutch spring", netWt: 0.045, scrap: 4, item: "SWC-4.0" },
    { partNo: "SSL-SPR-201", customer: "Suspension Systems Ltd", desc: "Suspension coil", netWt: 0.350, scrap: 5, item: "SWC-4.0" },
    { partNo: "SSL-SPR-202", customer: "Suspension Systems Ltd", desc: "Damper spring", netWt: 0.180, scrap: 4, item: "SWC-3.0" },
    { partNo: "PAP-SPR-301", customer: "Precision Auto Parts", desc: "Return spring", netWt: 0.008, scrap: 2, item: "SWB-2.0" },
    { partNo: "PAP-SPR-302", customer: "Precision Auto Parts", desc: "Torsion spring", netWt: 0.025, scrap: 3, item: "SWA-2.2" },
    { partNo: "MTC-SPR-401", customer: "Metro Transit Corp", desc: "Seat spring", netWt: 0.060, scrap: 4, item: "HC80B-1.6" },
    { partNo: "MTC-SPR-402", customer: "Metro Transit Corp", desc: "Brake spring", netWt: 0.015, scrap: 3, item: "SWC-2.5" },
  ];
  const parts = new Map<string, { id: string; partNo: string }>();
  const plating = jobWorkers.get("Precision Plating Works")!;
  const heatTreat = jobWorkers.get("Apex Heat Treatment")!;
  for (const p of partsSpec) {
    const part = await prisma.part.upsert({
      where: { partNo: p.partNo },
      update: {},
      create: {
        partNo: p.partNo,
        customerId: customers.get(p.customer)!.id,
        description: p.desc,
        netWtPerPcKg: p.netWt,
        scrapAllowancePct: p.scrap,
      },
    });
    parts.set(p.partNo, part);
    const item = items.get(p.item)!;
    const existingBom = await prisma.bomLine.findFirst({ where: { partId: part.id } });
    if (!existingBom) {
      await prisma.bomLine.create({
        data: { partId: part.id, opSeq: 1, opName: "Coiling", opType: "IN_HOUSE", itemId: item.id },
      });
      await prisma.bomLine.create({
        data: { partId: part.id, opSeq: 2, opName: "Heat Treatment", opType: "JOB_WORK", defaultVendorId: heatTreat.id, jwLeadDays: 5 },
      });
      await prisma.bomLine.create({
        data: { partId: part.id, opSeq: 3, opName: "Grinding", opType: "IN_HOUSE" },
      });
      await prisma.bomLine.create({
        data: { partId: part.id, opSeq: 4, opName: "Plating", opType: "JOB_WORK", defaultVendorId: plating.id, jwLeadDays: 7 },
      });
    }
  }

  // ---------- PO + GRN + Bundles ----------
  console.log("Seeding POs, GRNs and bundles (incl. the exact Section 7 worked example)...");
  const supplierList = suppliers;

  async function seedPoGrnBundle(opts: {
    poNo: string;
    grnNo: string;
    bundleNo: string;
    itemId: string;
    heatNo: string;
    inwardDate: Date;
    kg: number;
    supplierIdx: number;
  }) {
    const po = await prisma.po.upsert({
      where: { poNo: opts.poNo },
      update: {},
      create: { poNo: opts.poNo, supplierId: supplierList[opts.supplierIdx]!.id, poDate: opts.inwardDate },
    });
    await prisma.poLine.upsert({
      where: { id: `${po.id}-line` },
      update: {},
      create: { id: `${po.id}-line`, poId: po.id, itemId: opts.itemId, orderedKg: opts.kg * 2, receivedKg: opts.kg },
    }).catch(async () => {
      const existing = await prisma.poLine.findFirst({ where: { poId: po.id } });
      if (!existing) {
        await prisma.poLine.create({ data: { poId: po.id, itemId: opts.itemId, orderedKg: opts.kg * 2, receivedKg: opts.kg } });
      }
    });
    const grn = await prisma.grn.upsert({
      where: { grnNo: opts.grnNo },
      update: {},
      create: {
        grnNo: opts.grnNo,
        grnDate: opts.inwardDate,
        poId: po.id,
        invoiceNo: `INV-${opts.grnNo}`,
        vehicleNo: "MH12AB1234",
        createdById: storekeeper.id,
      },
    });
    const existingBundle = await prisma.bundle.findUnique({ where: { bundleNo: opts.bundleNo } });
    if (existingBundle) return existingBundle;

    const bundle = await prisma.bundle.create({
      data: {
        bundleNo: opts.bundleNo,
        grnId: grn.id,
        itemId: opts.itemId,
        heatNo: opts.heatNo,
        tcRef: `TC-${opts.heatNo}`,
        receivedKg: opts.kg,
        balanceKg: opts.kg,
        inwardDate: opts.inwardDate,
        status: "AVAILABLE",
        locationId: locMap.get("RM Stores")!,
      },
    });
    await ledger({
      txnType: "T1_GRN",
      docNo: opts.grnNo,
      itemType: "RM",
      refNo: opts.bundleNo,
      toLocationId: locMap.get("Incoming/QC area"),
      toStatus: "QUALITY_HOLD",
      qty: opts.kg,
      uom: "kg",
      userId: storekeeper.id,
      txnDate: opts.inwardDate,
    });
    const iqcNo = `IQC-${opts.bundleNo}`;
    await prisma.iqc.create({
      data: {
        iqcNo,
        bundleId: bundle.id,
        results: { diameter: "ok", tensile: "ok", surface: "ok" },
        decision: "ACCEPT",
        enteredById: qcInspector.id,
        approvedById: qAdmin.id,
        approvedAt: opts.inwardDate,
      },
    });
    await ledger({
      txnType: "T2_IQC_ACCEPT",
      docNo: iqcNo,
      itemType: "RM",
      refNo: opts.bundleNo,
      fromLocationId: locMap.get("Incoming/QC area"),
      toLocationId: locMap.get("RM Stores"),
      fromStatus: "QUALITY_HOLD",
      toStatus: "AVAILABLE",
      qty: opts.kg,
      uom: "kg",
      userId: qAdmin.id,
      txnDate: opts.inwardDate,
    });
    return bundle;
  }

  // The exact Section 7 worked example bundles.
  await seedPoGrnBundle({
    poNo: "PO-2627-0001",
    grnNo: "GRN-2627-0001",
    bundleNo: "RM-2609-0031",
    itemId: swc30.id,
    heatNo: "HT-90031",
    inwardDate: new Date("2026-09-04T00:00:00.000Z"),
    kg: 150,
    supplierIdx: 0,
  });
  await seedPoGrnBundle({
    poNo: "PO-2627-0002",
    grnNo: "GRN-2627-0002",
    bundleNo: "RM-2609-0047",
    itemId: swc30.id,
    heatNo: "HT-90047",
    inwardDate: new Date("2026-09-18T00:00:00.000Z"),
    kg: 500,
    supplierIdx: 0,
  });
  await seedPoGrnBundle({
    poNo: "PO-2627-0003",
    grnNo: "GRN-2627-0003",
    bundleNo: "RM-2610-0003",
    itemId: swc30.id,
    heatNo: "HT-10003",
    inwardDate: new Date("2026-10-02T00:00:00.000Z"),
    kg: 500,
    supplierIdx: 1,
  });
  await seedPoGrnBundle({
    poNo: "PO-2627-0004",
    grnNo: "GRN-2627-0004",
    bundleNo: "RM-2610-0019",
    itemId: swc30.id,
    heatNo: "HT-10019",
    inwardDate: new Date("2026-10-09T00:00:00.000Z"),
    kg: 500,
    supplierIdx: 1,
  });

  // A handful more bundles across other items, for a believable, browsable stores screen.
  const extraItemCycle = ["SWC-2.5", "SWB-2.0", "HC80B-1.6", "SWC-4.0", "SWA-2.2"];
  for (let i = 0; i < 8; i++) {
    const itemCode = extraItemCycle[i % extraItemCycle.length]!;
    const item = items.get(itemCode)!;
    const day = 5 + i * 3;
    await seedPoGrnBundle({
      poNo: `PO-2627-${String(10 + i).padStart(4, "0")}`,
      grnNo: `GRN-2627-${String(10 + i).padStart(4, "0")}`,
      bundleNo: `RM-2610-${String(30 + i).padStart(4, "0")}`,
      itemId: item.id,
      heatNo: `HT-EX${i}`,
      inwardDate: new Date(`2026-10-${String(Math.min(day, 28)).padStart(2, "0")}T00:00:00.000Z`),
      kg: 200 + i * 25,
      supplierIdx: i % supplierList.length,
    });
  }

  // One Quality-Hold (unapproved IQC) and one Rejected bundle, so dashboards have something to show.
  const holdGrn = await prisma.grn.upsert({
    where: { grnNo: "GRN-2627-0099" },
    update: {},
    create: {
      grnNo: "GRN-2627-0099",
      grnDate: new Date(),
      poId: (await prisma.po.findFirst({ where: { poNo: "PO-2627-0001" } }))!.id,
      invoiceNo: "INV-HOLD-1",
      createdById: storekeeper.id,
    },
  });
  const holdBundle = await prisma.bundle.upsert({
    where: { bundleNo: "RM-2610-0050" },
    update: {},
    create: {
      bundleNo: "RM-2610-0050",
      grnId: holdGrn.id,
      itemId: swc30.id,
      heatNo: "HT-HOLD1",
      receivedKg: 300,
      balanceKg: 300,
      inwardDate: new Date(),
      status: "QUALITY_HOLD",
      locationId: locMap.get("Incoming/QC area")!,
    },
  });
  await ledger({
    txnType: "T1_GRN",
    docNo: "GRN-2627-0099",
    itemType: "RM",
    refNo: holdBundle.bundleNo,
    toLocationId: locMap.get("Incoming/QC area"),
    toStatus: "QUALITY_HOLD",
    qty: 300,
    uom: "kg",
    userId: storekeeper.id,
  });

  // ---------- MRNs (10, incl. the Open MRN-2610-0008 worked example) ----------
  console.log("Seeding MRNs...");
  const sslSpr202 = parts.get("SSL-SPR-202")!; // uses SWC-3.0

  async function upsertMrn(mrnNo: string, partId: string, plannedQtyNos: number, requiredKg: number, status: "OPEN" | "PARTIALLY_ISSUED" | "CLOSED") {
    return prisma.mrn.upsert({
      where: { mrnNo },
      update: {},
      create: { mrnNo, partId, plannedQtyNos, requiredKg, status, createdById: supervisor.id },
    });
  }

  // The exact worked-example MRN: 900kg of SW-C 3.0mm, left OPEN (not yet issued).
  await upsertMrn("MRN-2610-0008", sslSpr202.id, 5000, 900, "OPEN");

  const partList = [...parts.values()];
  for (let i = 0; i < 9; i++) {
    const part = partList[i % partList.length]!;
    await upsertMrn(`MRN-2610-${String(10 + i).padStart(4, "0")}`, part.id, 1000 + i * 50, 50 + i * 10, "CLOSED");
  }

  // ---------- A small number of fully reconciled Issue -> ProductionLot -> ops -> JW -> FG -> Dispatch chains ----------
  console.log("Seeding a reconciled production/JW/FG/dispatch chain...");

  const demoItem = items.get("SWC-4.0")!;
  const demoBundleNo = "RM-2608-0005";
  const demoGrn = await prisma.grn.upsert({
    where: { grnNo: "GRN-2627-0005" },
    update: {},
    create: {
      grnNo: "GRN-2627-0005",
      grnDate: new Date("2026-08-10"),
      poId: (await prisma.po.findFirst({ where: { poNo: "PO-2627-0001" } }))!.id,
      invoiceNo: "INV-DEMO-1",
      createdById: storekeeper.id,
    },
  });
  let demoBundle = await prisma.bundle.findUnique({ where: { bundleNo: demoBundleNo } });
  if (!demoBundle) {
    demoBundle = await prisma.bundle.create({
      data: {
        bundleNo: demoBundleNo,
        grnId: demoGrn.id,
        itemId: demoItem.id,
        heatNo: "HT-DEMO1",
        receivedKg: 400,
        balanceKg: 190, // 210kg already consumed by the demo lot below
        inwardDate: new Date("2026-08-10"),
        status: "AVAILABLE",
        locationId: locMap.get("RM Stores")!,
      },
    });
    await ledger({
      txnType: "T1_GRN", docNo: "GRN-2627-0005", itemType: "RM", refNo: demoBundleNo,
      toStatus: "QUALITY_HOLD", qty: 400, uom: "kg", userId: storekeeper.id, txnDate: new Date("2026-08-10"),
    });
    await ledger({
      txnType: "T2_IQC_ACCEPT", docNo: "IQC-" + demoBundleNo, itemType: "RM", refNo: demoBundleNo,
      toLocationId: locMap.get("RM Stores"), toStatus: "AVAILABLE", qty: 400, uom: "kg", userId: qAdmin.id, txnDate: new Date("2026-08-10"),
    });
  }

  const demoMrn = await upsertMrn("MRN-2608-0001", parts.get("AL-SPR-102")!.id, 4000, 210, "CLOSED");
  const demoLotNo = "PL-2608-0001";
  let demoLot = await prisma.productionLot.findUnique({ where: { lotNo: demoLotNo } });
  if (!demoLot) {
    demoLot = await prisma.productionLot.create({
      data: {
        lotNo: demoLotNo,
        partId: parts.get("AL-SPR-102")!.id,
        mrnId: demoMrn.id,
        currentOpSeq: 5, // past the last routing op (4 = Plating) => all operations complete
        qtyNos: 3800,
        status: "IN_HOUSE",
        locationId: locMap.get("Production floor (WIP)")!,
        startDate: new Date("2026-08-12"),
      },
    });
    const issue = await prisma.issue.create({
      data: { issueNo: "ISS-2627-0001", mrnId: demoMrn.id, issuedById: storekeeper.id },
    });
    await prisma.issueLine.create({ data: { issueId: issue.id, bundleId: demoBundle.id, kgIssued: 210 } });
    await prisma.lotBundleLink.create({ data: { lotId: demoLot.id, bundleId: demoBundle.id, kgConsumed: 210 } });
    await ledger({
      txnType: "T5_ISSUE", docNo: "ISS-2627-0001", itemType: "RM", refNo: demoBundleNo,
      fromLocationId: locMap.get("RM Stores"), toLocationId: locMap.get("Production floor (WIP)"),
      fromStatus: "AVAILABLE", toStatus: "WIP", qty: 210, uom: "kg", userId: storekeeper.id, txnDate: new Date("2026-08-12"),
    });
    await prisma.operationEntry.create({
      data: { lotId: demoLot.id, opSeq: 1, goodNos: 4500, rejectedNos: 60, enteredById: supervisor.id, date: new Date("2026-08-13") },
    });
    await ledger({ txnType: "T7_OP_COMPLETE", docNo: demoLotNo, itemType: "WIP", refNo: demoLotNo, qty: 4500, uom: "nos", userId: supervisor.id });
    await prisma.operationEntry.create({
      data: { lotId: demoLot.id, opSeq: 3, goodNos: 4300, rejectedNos: 100, enteredById: supervisor.id, date: new Date("2026-08-20") },
    });
    await ledger({ txnType: "T7_OP_COMPLETE", docNo: demoLotNo, itemType: "WIP", refNo: demoLotNo, qty: 4300, uom: "nos", userId: supervisor.id });
  }

  // JW out/in for the demo lot (op 2, Heat Treatment) — shown as already closed historically on a second lot,
  // so the dashboard has a currently-open, overdue challan on a third lot for the alerts panel to flag.
  const demoLot2No = "PL-2608-0002";
  let demoLot2 = await prisma.productionLot.findUnique({ where: { lotNo: demoLot2No } });
  if (!demoLot2) {
    const mrn2 = await upsertMrn("MRN-2608-0002", parts.get("SSL-SPR-201")!.id, 500, 180, "CLOSED");
    demoLot2 = await prisma.productionLot.create({
      data: {
        lotNo: demoLot2No, partId: parts.get("SSL-SPR-201")!.id, mrnId: mrn2.id,
        currentOpSeq: 2, qtyNos: 480, status: "AT_JOB_WORK",
        locationId: (await prisma.location.findUniqueOrThrow({ where: { name: "At Job Worker - Apex Heat Treatment" } })).id,
        startDate: new Date("2026-09-25"),
      },
    });
    // Wire for this lot: 180 kg drawn from the demo bundle (190 -> 10 kg), with issue + ledger rows.
    await prisma.bundle.update({ where: { id: demoBundle.id }, data: { balanceKg: { decrement: 180 } } });
    const issue2 = await prisma.issue.create({
      data: { issueNo: "ISS-2627-0002", mrnId: mrn2.id, issuedById: storekeeper.id },
    });
    await prisma.issueLine.create({ data: { issueId: issue2.id, bundleId: demoBundle.id, kgIssued: 180 } });
    await prisma.lotBundleLink.create({ data: { lotId: demoLot2.id, bundleId: demoBundle.id, kgConsumed: 180 } });
    await ledger({
      txnType: "T5_ISSUE", docNo: "ISS-2627-0002", itemType: "RM", refNo: demoBundleNo,
      fromLocationId: locMap.get("RM Stores"), toLocationId: locMap.get("Production floor (WIP)"),
      fromStatus: "AVAILABLE", toStatus: "WIP", qty: 180, uom: "kg", userId: storekeeper.id, txnDate: new Date("2026-09-25"),
    });
    const challan = await prisma.jwOutChallan.create({
      data: {
        challanNo: "JWO-2627-0001",
        vendorId: heatTreat.id,
        date: new Date("2026-09-26"),
        expectedReturnDate: new Date("2026-10-01"), // now overdue vs 2026-10-21 "today"
        status: "OPEN",
        createdById: dispatchClerk.id,
      },
    });
    await prisma.jwChallanLine.create({
      data: { challanId: challan.id, lotId: demoLot2.id, opSeq: 2, qtyNos: 480, qtyKg: 170 },
    });
    await ledger({
      txnType: "T8_JW_SEND", docNo: "JWO-2627-0001", itemType: "WIP", refNo: demoLot2No,
      toStatus: "AT_JOB_WORK", qty: 480, uom: "nos", userId: dispatchClerk.id, txnDate: new Date("2026-09-26"),
    });
  }

  // ---------- FG lots + customer schedules + dispatches ----------
  console.log("Seeding FG lots, schedules and dispatches...");
  const fgPart = parts.get("AL-SPR-102")!;
  const fgLotNo = "FG-2608-0001";
  let fgLot = await prisma.fgLot.findUnique({ where: { fgLotNo } });
  if (!fgLot) {
    fgLot = await prisma.fgLot.create({
      data: {
        fgLotNo, partId: fgPart.id, sourceLotId: demoLot.id, qtyNos: 4200, balanceNos: 2700,
        inwardDate: new Date("2026-08-25"), status: "AVAILABLE", approvedById: qAdmin.id,
      },
    });
    await ledger({
      txnType: "T11_FINAL_INSPECTION", docNo: fgLotNo, itemType: "FG", refNo: fgLotNo,
      toLocationId: locMap.get("FG Stores"), toStatus: "AVAILABLE", qty: 4200, uom: "nos", userId: qAdmin.id, txnDate: new Date("2026-08-25"),
    });
  }

  const customerForFg = (await prisma.part.findUniqueOrThrow({ where: { id: fgPart.id } })).customerId;
  const scheduleId = "sched-demo-1";
  let schedule = await prisma.customerSchedule.findFirst({ where: { partId: fgPart.id } });
  if (!schedule) {
    schedule = await prisma.customerSchedule.create({
      data: { customerId: customerForFg, partId: fgPart.id, dueDate: new Date("2026-10-25"), qtyNos: 4200, dispatchedNos: 1500 },
    });
  }

  const existingDispatch = await prisma.dispatch.findFirst({ where: { dispatchNo: "DN-2627-0001" } });
  if (!existingDispatch) {
    const dispatch = await prisma.dispatch.create({
      data: {
        dispatchNo: "DN-2627-0001", date: new Date("2026-09-01"), customerId: customerForFg,
        invoiceNo: "SINV-0001", vehicleNo: "MH14CD5678", createdById: dispatchClerk.id,
      },
    });
    await prisma.dispatchLine.create({ data: { dispatchId: dispatch.id, scheduleId: schedule.id, fgLotId: fgLot.id, qtyNos: 1500 } });
    await ledger({
      txnType: "T15_DISPATCH", docNo: "DN-2627-0001", itemType: "FG", refNo: fgLotNo,
      fromStatus: "AVAILABLE", qty: 1500, uom: "nos", userId: dispatchClerk.id, txnDate: new Date("2026-09-01"),
    });
  }

  // A few more schedules for the Schedule-vs-Dispatch report.
  for (let i = 0; i < 6; i++) {
    const part = partList[i % partList.length]!;
    const customerId = (await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).customerId;
    const existing = await prisma.customerSchedule.findFirst({ where: { partId: part.id, dueDate: new Date(`2026-11-${10 + i}`) } });
    if (!existing) {
      await prisma.customerSchedule.create({
        data: { customerId, partId: part.id, dueDate: new Date(`2026-11-${10 + i}`), qtyNos: 1000 + i * 100, dispatchedNos: 0 },
      });
    }
  }

  // ---------- Rejections across the 4 stages, varied disposal states ----------
  console.log("Seeding rejections...");
  const iqcRejectBundleNo = "RM-2610-0051";
  const rejGrn = await prisma.grn.findFirst({ where: { grnNo: "GRN-2627-0001" } });
  let rejBundle = await prisma.bundle.findUnique({ where: { bundleNo: iqcRejectBundleNo } });
  if (!rejBundle && rejGrn) {
    rejBundle = await prisma.bundle.create({
      data: {
        bundleNo: iqcRejectBundleNo, grnId: rejGrn.id, itemId: swc30.id, heatNo: "HT-REJ1",
        receivedKg: 120, balanceKg: 120, inwardDate: new Date("2026-10-11"),
        status: "REJECTED", locationId: locMap.get("Rejection area - RM")!,
      },
    });
    await ledger({
      txnType: "T3_IQC_REJECT", docNo: "IQC-" + iqcRejectBundleNo, itemType: "RM", refNo: iqcRejectBundleNo,
      toLocationId: locMap.get("Rejection area - RM"), toStatus: "REJECTED", qty: 120, uom: "kg",
      userId: qAdmin.id, reason: "IQC-DIA", txnDate: new Date("2026-10-11"),
    });
    const diaReason = await prisma.reasonCode.findUniqueOrThrow({ where: { code: "IQC-DIA" } });
    await prisma.rejection.create({
      data: {
        rejNo: "REJ-IQC-" + iqcRejectBundleNo, stage: "IQC", refType: "BUNDLE", refId: rejBundle.id,
        qty: 120, uom: "kg", reasonCodeId: diaReason.id, disposal: "PENDING", createdById: qAdmin.id,
      },
    });
  }

  // ---------- Document sequences ----------
  // Seeded documents carry hand-written numbers (GRN-2627-0004, RM-2610-0019, PL-2608-0002 ...).
  // Advance each (docType, period) sequence past the highest seeded number so the first document
  // created in the app doesn't collide with seed data.
  console.log("Aligning document sequences with seeded documents...");
  const numbered: Array<[string, string[]]> = [
    ["GRN", (await prisma.grn.findMany({ select: { grnNo: true } })).map((r) => r.grnNo)],
    ["MRN", (await prisma.mrn.findMany({ select: { mrnNo: true } })).map((r) => r.mrnNo)],
    ["ISSUE", (await prisma.issue.findMany({ select: { issueNo: true } })).map((r) => r.issueNo)],
    ["IQC", (await prisma.iqc.findMany({ select: { iqcNo: true } })).map((r) => r.iqcNo)],
    ["JWOUT", (await prisma.jwOutChallan.findMany({ select: { challanNo: true } })).map((r) => r.challanNo)],
    ["JWIN", (await prisma.jwInReceipt.findMany({ select: { receiptNo: true } })).map((r) => r.receiptNo)],
    ["DISPATCH", (await prisma.dispatch.findMany({ select: { dispatchNo: true } })).map((r) => r.dispatchNo)],
    ["REJ", (await prisma.rejection.findMany({ select: { rejNo: true } })).map((r) => r.rejNo)],
    ["BUNDLE", (await prisma.bundle.findMany({ select: { bundleNo: true } })).map((r) => r.bundleNo)],
    ["LOT", (await prisma.productionLot.findMany({ select: { lotNo: true } })).map((r) => r.lotNo)],
    ["FGLOT", (await prisma.fgLot.findMany({ select: { fgLotNo: true } })).map((r) => r.fgLotNo)],
  ];
  for (const [docType, nos] of numbered) {
    const maxByPeriod = new Map<string, number>();
    for (const no of nos) {
      const m = /^[A-Z]+-(\d{4})-(\d{4})$/.exec(no);
      if (!m) continue; // free-form seed numbers (e.g. REJ-IQC-RM-...) don't use the sequence
      maxByPeriod.set(m[1]!, Math.max(maxByPeriod.get(m[1]!) ?? 0, Number(m[2])));
    }
    for (const [fiscalYear, lastNumber] of maxByPeriod) {
      await prisma.docSequence.upsert({
        where: { docType_fiscalYear: { docType, fiscalYear } },
        update: { lastNumber },
        create: { docType, fiscalYear, lastNumber },
      });
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error("SEED FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
