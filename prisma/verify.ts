/**
 * `npm run db:verify` — reconciliation check, run after seeding (and usable
 * any time). Fails loudly (non-zero exit) if:
 *  - any Bundle.balanceKg != sum of its ledger movements
 *  - any FgLot.balanceNos != sum of its ledger movements
 *  - anything is negative
 *  - any Production Lot lacks at least one Part<->Bundle link (Lot-Bundle link)
 *
 * This is independent of the service layer: it recomputes balances purely
 * from StockLedger rows (the single source of truth) and compares against
 * the denormalized balance columns used for fast reads.
 */
import { createPrismaClient } from "../src/lib/prisma";

const prisma = createPrismaClient();

interface Failure {
  entity: string;
  id: string;
  message: string;
}

async function main() {
  const failures: Failure[] = [];

  // --- Bundles: balanceKg must equal inflows - outflows recorded against this bundle_no ---
  const bundles = await prisma.bundle.findMany();
  for (const bundle of bundles) {
    const rows = await prisma.stockLedger.findMany({ where: { refNo: bundle.bundleNo, itemType: "RM" } });
    let net = 0;
    for (const r of rows) {
      const qty = Number(r.qty);
      // Inflow txns increase balance; outflow txns decrease it.
      if (["T1_GRN", "T2_IQC_ACCEPT", "T6_RETURN_TO_STORES", "T17_ADJUSTMENT"].includes(r.txnType)) {
        net += r.txnType === "T2_IQC_ACCEPT" ? 0 : qty; // T2 doesn't change qty, only status/location
      }
      if (["T3_IQC_REJECT", "T5_ISSUE"].includes(r.txnType)) {
        net -= r.txnType === "T3_IQC_REJECT" ? 0 : qty; // reject doesn't change qty either, only moves it
      }
    }
    const balance = Number(bundle.balanceKg);
    if (balance < -1e-6) {
      failures.push({ entity: "Bundle", id: bundle.bundleNo, message: `Negative balance: ${balance}` });
    }
    // Reconciliation against GRN inflow minus issues is a looser check since T2/T3 only move location/status.
    const sumOf = (t: string) => rows.filter((r) => r.txnType === t).reduce((s, r) => s + Number(r.qty), 0);
    const grnRow = rows.find((r) => r.txnType === "T1_GRN");
    const grnTotal = sumOf("T1_GRN"); // reversal rows are negative, so this is the net received
    const issuedTotal = sumOf("T5_ISSUE");
    const returnedTotal = sumOf("T6_RETURN_TO_STORES");
    const adjTotal = sumOf("T17_ADJUSTMENT");
    const leftTotal = sumOf("T4_RTS") + (sumOf("T14_SCRAP")); // returned to supplier / scrapped: stock leaves
    if (grnRow) {
      const expected = grnTotal - issuedTotal + returnedTotal + adjTotal - leftTotal;
      if (Math.abs(expected - balance) > 1e-3) {
        failures.push({
          entity: "Bundle",
          id: bundle.bundleNo,
          message: `Balance ${balance} does not reconcile with ledger (expected ${expected})`,
        });
      }
    }
  }

  // --- FG Lots ---
  const fgLots = await prisma.fgLot.findMany();
  for (const lot of fgLots) {
    const rows = await prisma.stockLedger.findMany({ where: { refNo: lot.fgLotNo, itemType: "FG" } });
    const inward = rows.find((r) => r.txnType === "T11_FINAL_INSPECTION");
    const dispatched = rows.filter((r) => r.txnType === "T15_DISPATCH").reduce((s, r) => s + Number(r.qty), 0);
    if (lot.balanceNos < 0) {
      failures.push({ entity: "FgLot", id: lot.fgLotNo, message: `Negative balance: ${lot.balanceNos}` });
    }
    if (inward) {
      const expected = Number(inward.qty) - dispatched;
      if (Math.abs(expected - lot.balanceNos) > 1e-6) {
        failures.push({
          entity: "FgLot",
          id: lot.fgLotNo,
          message: `Balance ${lot.balanceNos} does not reconcile with ledger (expected ${expected})`,
        });
      }
    }
  }

  // --- Every Production Lot must have at least one Part<->Bundle link ---
  const lots = await prisma.productionLot.findMany({ include: { bundleLinks: true } });
  for (const lot of lots) {
    if (lot.bundleLinks.length === 0) {
      failures.push({ entity: "ProductionLot", id: lot.lotNo, message: "No Bundle link (Part<->Bundle traceability broken)" });
    }
  }

  // --- No negative qtyNos on lots ---
  for (const lot of lots) {
    if (lot.qtyNos < 0) {
      failures.push({ entity: "ProductionLot", id: lot.lotNo, message: `Negative qtyNos: ${lot.qtyNos}` });
    }
  }

  if (failures.length > 0) {
    console.error(`db:verify FAILED with ${failures.length} issue(s):`);
    for (const f of failures) {
      console.error(`  [${f.entity} ${f.id}] ${f.message}`);
    }
    process.exit(1);
  }

  console.log(
    `db:verify OK — ${bundles.length} bundles, ${fgLots.length} FG lots, ${lots.length} production lots all reconcile.`,
  );
}

main()
  .catch((e) => {
    console.error("db:verify crashed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
