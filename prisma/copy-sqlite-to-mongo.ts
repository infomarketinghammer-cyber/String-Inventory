/**
 * One-off copy of every record from the old local SQLite database (prisma/dev.db, via prisma/sqlite/schema.prisma)
 * into the MongoDB database in DATABASE_URL. `npx tsx prisma/copy-sqlite-to-mongo.ts`
 *
 *  - Same ids, numbers, dates and quantities; decimals become numbers. Document-number sequences are copied too,
 *    so numbering continues without reuse.
 *  - Refuses to write into a MongoDB database that already holds data (nothing is overwritten or merged).
 *  - Afterwards compares every collection's count and the stock totals between the two databases.
 * The SQLite file is only read, never changed.
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaClient as SqliteClient } from "../node_modules/.prisma-sqlite/client";
import { createPrismaClient } from "../src/lib/prisma";

const source = new SqliteClient();
const target = createPrismaClient();
const delegate = (c: unknown, model: string) => (c as Record<string, any>)[model.charAt(0).toLowerCase() + model.slice(1)]; // eslint-disable-line @typescript-eslint/no-explicit-any
const CHUNK = 500;

function convert(model: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    // Prisma Decimal (SQLite) -> plain number (MongoDB Float)
    out[k] = v && typeof v === "object" && "toNumber" in (v as object) && typeof (v as { toNumber: unknown }).toNumber === "function" ? (v as { toNumber(): number }).toNumber() : v;
  }
  // These tokens are optional in SQLite but unique and always set in MongoDB.
  if ("clientToken" in out && !out.clientToken) out.clientToken = randomUUID();
  if (model === "JobWorker" && !out.locationId) throw new Error(`Job worker ${String(out.name)} has no location; fix it before copying.`);
  return out;
}

async function main() {
  const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
  // 1. Target must be empty.
  const nonEmpty: string[] = [];
  for (const m of models) if ((await delegate(target, m).count()) > 0) nonEmpty.push(m);
  if (nonEmpty.length) {
    console.error(`Refusing to copy: the MongoDB database already has data in ${nonEmpty.join(", ")}. Nothing was changed.`);
    process.exit(2);
  }

  // 2. Copy every model.
  const counts: Record<string, number> = {};
  for (const m of models) {
    const rows = (await delegate(source, m).findMany()) as Record<string, unknown>[];
    for (let i = 0; i < rows.length; i += CHUNK) {
      await delegate(target, m).createMany({ data: rows.slice(i, i + CHUNK).map((r) => convert(m, r)) });
    }
    counts[m] = rows.length;
    console.log(`${m.padEnd(18)} ${String(rows.length).padStart(6)} copied`);
  }

  // 3. Compare.
  let ok = true;
  for (const m of models) {
    const n = await delegate(target, m).count();
    if (n !== counts[m]) {
      ok = false;
      console.error(`MISMATCH ${m}: SQLite ${counts[m]}, MongoDB ${n}`);
    }
  }
  const sum = async (c: unknown, model: string, field: string) => {
    const r = await delegate(c, model).aggregate({ _sum: { [field]: true } });
    return Math.round(Number(r._sum[field] ?? 0) * 1000) / 1000;
  };
  for (const [model, field] of [["Bundle", "balanceKg"], ["Bundle", "receivedKg"], ["FgLot", "balanceNos"], ["ProductionLot", "qtyNos"], ["StockLedger", "qty"], ["PoLine", "receivedKg"]] as const) {
    const a = await sum(source, model, field);
    const b = await sum(target, model, field);
    if (Math.abs(a - b) > 0.001) ok = false;
    console.log(`total ${model}.${field}: SQLite ${a} | MongoDB ${b} ${Math.abs(a - b) > 0.001 ? "MISMATCH" : "ok"}`);
  }
  const seqs = await target.docSequence.findMany({ orderBy: [{ docType: "asc" }, { fiscalYear: "asc" }] });
  console.log(`document sequences carried over: ${seqs.length}`);
  console.log(ok ? "\nCopy complete: every collection and total matches." : "\nCopy finished WITH MISMATCHES (see above).");
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("copy failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.$disconnect();
    await target.$disconnect();
  });
