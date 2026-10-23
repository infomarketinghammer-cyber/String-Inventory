/**
 * The check scripts (db:scenario, db:receipt-check, db:sop-check) write test data. They only run when
 * DATABASE_URL is set explicitly in the environment to a scratch database (not the .env working DB), e.g. (PowerShell):
 *   $env:DATABASE_URL="file:./scenario.db"; npx prisma db push --force-reset --skip-generate; npm run db:seed
 */
const url = process.env.DATABASE_URL ?? "";
// Prisma falls back to .env when the variable is not set in the environment, which is the working database.
if (!url || /(^|[/\\:])dev\.db$/.test(url) || process.env.NODE_ENV === "production") {
  console.error(
    `Refusing to run: these checks write test data. Set DATABASE_URL to a scratch database first ` +
      `(current: ${url || "not set, so .env / the working database would be used"}).\n` +
      'Example: $env:DATABASE_URL="file:./scenario.db" (see README "Testing").',
  );
  process.exit(2);
}
export {};
