import { test, expect } from "@playwright/test";

/**
 * Acceptance test #4: reproduces Section 7's worked example end-to-end
 * against the seeded data (MRN-2610-0008, 900kg of SW-C 3.0mm).
 * See tests/unit/fifo.test.ts for the pure-logic version of this same
 * scenario, which does run in this build (no browser/DB needed there).
 */
test.describe("FIFO worked example (Section 7)", () => {
  test("scanning the newest bundle (RM-2610-0019) first is blocked with the exact message", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "storekeeper@demo.local");
    await page.fill("#password", "Demo@1234");
    await page.click("button[type=submit]");

    await page.goto("/issue");
    await page.click("text=MRN-2610-0008");

    const scanInput = page.locator("input[placeholder*='Scan or type Bundle No']");
    await scanInput.fill("RM-2610-0019");
    await scanInput.press("Enter");

    await expect(page.locator("text=Wrong bundle. Issue RM-2609-0031 first (inward 2026-09-04).")).toBeVisible();
  });

  test("scanning the three oldest bundles in order is accepted and totals 900kg", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "storekeeper@demo.local");
    await page.fill("#password", "Demo@1234");
    await page.click("button[type=submit]");

    await page.goto("/issue");
    await page.click("text=MRN-2610-0008");

    const scanInput = page.locator("input[placeholder*='Scan or type Bundle No']");
    for (const bundleNo of ["RM-2609-0031", "RM-2609-0047", "RM-2610-0003"]) {
      await scanInput.fill(bundleNo);
      await scanInput.press("Enter");
    }

    await expect(page.locator("text=900.00 / 900.00 kg required")).toBeVisible();
  });
});
