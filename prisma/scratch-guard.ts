/**
 * The check scripts (db:scenario, db:receipt-check, db:sop-check) write test data. They only run when
 * DATABASE_URL is set explicitly in the environment to a scratch database: a MongoDB database whose name ends in
 * "_test" (e.g. spring_inventory_test on the same cluster), or a local file database. Never the working database.
 * Example (PowerShell), see README "Testing":
 *   $env:DATABASE_URL = "<same as .env DATABASE_URL, with /spring_inventory_test? instead of /spring_inventory?>"
 */
const url = process.env.DATABASE_URL ?? "";
const dbName = /^mongodb(\+srv)?:\/\/[^/]+\/([^?]*)/.exec(url)?.[2] ?? "";
const scratchMongo = /^mongodb/.test(url) && /_test$/.test(dbName);
const scratchFile = /^file:/.test(url) && !/(^|[/\\:])dev\.db$/.test(url);
if (!(scratchMongo || scratchFile) || process.env.NODE_ENV === "production") {
  console.error(
    "Refusing to run: these checks write test data. Set DATABASE_URL to a scratch database first " +
      `(a MongoDB database whose name ends in "_test"; current: ${url ? (dbName ? `database "${dbName}"` : "not a scratch database") : "not set"}).`,
  );
  process.exit(2);
}
export {};
