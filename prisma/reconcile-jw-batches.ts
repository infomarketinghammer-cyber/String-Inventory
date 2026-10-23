/**
 * One-off, idempotent reconciliation for batch-wise JW Return QC (`npx tsx prisma/reconcile-jw-batches.ts`,
 * add `--apply` to write; without it this is a dry run).
 *
 * Before batch tracking, a partial return stayed inside the lot at the vendor until the whole challan line came
 * back. For every challan line still at the vendor, each receipt line that brought good pieces back but was never
 * given a QC lot becomes a QC batch now: a lot holding exactly that receipt's pieces in JW Return QC.
 *  - Evidence the pieces physically arrived: the saved JW In Receipt and its T9 ledger row. Without a matching
 *    T9 row the receipt is only reported for manual reconciliation.
 *  - Nothing historical is invented or changed: no new receipt, no new ledger receipt row, no change to dispatched,
 *    received, rejected or short quantities. The receipt's own number and date stay the batch's number and date.
 *  - The lot at the vendor keeps only what is still outstanding. An audit record is written for each batch.
 * Lots already in JW Return QC from before batch tracking are linked to their receipt when it is unambiguous.
 */
import { createPrismaClient } from "../src/lib/prisma";
import { genLotNo } from "../src/server/services/docNumber";

const prisma = createPrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const qcLoc = await prisma.location.findUniqueOrThrow({ where: { name: "JW Return QC" } });
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  const flags: string[] = [];
  let made = 0;

  // 1. Received pieces still sitting inside a lot at the vendor.
  const lines = await prisma.jwChallanLine.findMany({
    where: { lot: { status: "AT_JOB_WORK" } },
    include: { challan: true, lot: { include: { bundleLinks: true } }, JwReceiptLine: { include: { receipt: true } } },
  });
  for (const cl of lines) {
    const outstanding = cl.qtyNos - cl.receivedNos - cl.rejectedNos - cl.shortNos;
    for (const rl of cl.JwReceiptLine) {
      if (rl.receivedNos <= 0 || rl.qcLotId || rl.splitLotId) continue;
      const t9 = await prisma.stockLedger.findMany({
        where: { txnType: "T9_JW_RECEIVE", docNo: rl.receipt.receiptNo, refNo: cl.lot.lotNo },
      });
      const t9Qty = t9.reduce((s, r) => s + Number(r.qty), 0);
      if (t9Qty !== rl.receivedNos) {
        flags.push(`${cl.challan.challanNo} / ${rl.receipt.receiptNo}: receipt says ${rl.receivedNos} pcs but the ledger shows ${t9Qty}; not changed, reconcile manually.`);
        continue;
      }
      console.log(
        `${cl.challan.challanNo} / ${rl.receipt.receiptNo} (${rl.receipt.date.toISOString().slice(0, 10)}): ${rl.receivedNos} pcs physically received (T9 ledger row present) -> QC batch; ${outstanding} pcs stay with the vendor.`,
      );
      if (!APPLY) continue;
      await prisma.$transaction(async (tx) => {
        const batchLot = await tx.productionLot.create({
          data: {
            lotNo: await genLotNo(tx, new Date()),
            partId: cl.lot.partId,
            mrnId: cl.lot.mrnId,
            currentOpSeq: cl.lot.currentOpSeq,
            qtyNos: rl.receivedNos,
            status: "JW_RETURN_QC",
            locationId: qcLoc.id,
            startDate: cl.lot.startDate,
            parentLotId: cl.lot.id,
          },
        });
        for (const link of cl.lot.bundleLinks) {
          await tx.lotBundleLink.create({ data: { lotId: batchLot.id, bundleId: link.bundleId, kgConsumed: 0 } });
        }
        await tx.jwReceiptLine.update({ where: { id: rl.id }, data: { splitLotId: batchLot.id, qcLotId: batchLot.id } });
        await tx.productionLot.update({ where: { id: cl.lot.id }, data: { qtyNos: Math.max(0, outstanding) } });
        await tx.auditLog.create({
          data: {
            userId: admin?.id,
            action: "JW_BATCH_RECONCILED",
            entity: "JwReceiptLine",
            entityId: rl.id,
            oldValue: { lotNo: cl.lot.lotNo, lotQty: cl.lot.qtyNos },
            newValue: { receiptNo: rl.receipt.receiptNo, qcLotNo: batchLot.lotNo, pcsForQc: rl.receivedNos, stillWithVendor: outstanding },
            message: "Received pieces from before batch tracking given their own QC batch; no receipt or ledger row added.",
          },
        });
        console.log(`   created QC lot ${batchLot.lotNo}`);
      });
      made++;
    }
  }

  // 2. Lots already in JW Return QC from before batch tracking: link them to their receipt when unambiguous.
  const qcLots = await prisma.productionLot.findMany({ where: { status: "JW_RETURN_QC" } });
  for (const lot of qcLots) {
    if (await prisma.jwReceiptLine.findFirst({ where: { qcLotId: lot.id } })) continue;
    const candidates = await prisma.jwReceiptLine.findMany({
      where: { lotId: lot.id, receivedNos: { gt: 0 }, qcLotId: null, splitLotId: null },
      include: { receipt: true },
      orderBy: { receipt: { date: "desc" } },
    });
    const latestLine = candidates[0];
    const sameLine = latestLine ? candidates.filter((c) => c.challanLineId === latestLine.challanLineId) : [];
    if (sameLine.length === 1 && sameLine[0]!.receivedNos === lot.qtyNos) {
      console.log(`${lot.lotNo}: in JW Return QC with ${lot.qtyNos} pcs = receipt ${sameLine[0]!.receipt.receiptNo}; linked as its batch.`);
      if (APPLY) await prisma.jwReceiptLine.update({ where: { id: sameLine[0]!.id }, data: { qcLotId: lot.id } });
    } else if (candidates.length > 0) {
      flags.push(`${lot.lotNo}: ${lot.qtyNos} pcs in JW Return QC came from several receipts; QC it from the JW In page (not linked to one batch).`);
    }
  }

  console.log(APPLY ? `\nDone: ${made} QC batch(es) created.` : "\nDry run only. Re-run with --apply to write.");
  if (flags.length) console.log("\nFor manual reconciliation:\n  " + flags.join("\n  "));
}

main().finally(() => prisma.$disconnect());
