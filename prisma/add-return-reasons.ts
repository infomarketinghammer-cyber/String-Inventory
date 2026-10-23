/**
 * One-off, idempotent: adds the "Return" stage reason codes (why wire comes back to stores) to an
 * existing database. New databases get them from the seed. `npx tsx prisma/add-return-reasons.ts`
 */
import { createPrismaClient } from "../src/lib/prisma";

const prisma = createPrismaClient();

const CODES = [
  ["RTN-EXCESS", "Return", "Excess wire issued / not needed"],
  ["RTN-PLAN", "Return", "Production plan changed / MRN reduced"],
  ["RTN-WRONG", "Return", "Wrong grade or bundle issued"],
  ["RTN-QUALITY", "Return", "Quality concern found on the floor"],
] as const;

async function main() {
  for (const [code, stage, description] of CODES) {
    await prisma.reasonCode.upsert({ where: { code }, update: {}, create: { code, stage, description } });
  }
  console.log(`Return reason codes present: ${CODES.map((c) => c[0]).join(", ")}`);
}

main().finally(() => prisma.$disconnect());
