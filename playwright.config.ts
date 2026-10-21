import { defineConfig, devices } from "@playwright/test";

/**
 * NOTE: these e2e specs were authored against the running app but could not
 * be executed inside this build sandbox (no browser binaries / no network to
 * install them, and the Next.js app itself cannot start here without a
 * generated Prisma Client — see README "Known limitations"). They are
 * written to run with `npm run test:e2e` against `docker compose up` on a
 * normal machine.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
