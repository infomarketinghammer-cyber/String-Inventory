import { describe, it, expect } from "vitest";
import { can } from "@/server/policy";

const admin = { id: "u1", role: "ADMIN" as const };
const floor = { id: "u2", role: "FLOOR" as const };

describe("policy.can — Section 9 role/permission matrix", () => {
  it("denies everything for no user", () => {
    expect(can(null, "grn.create")).toBe(false);
    expect(can(undefined, "reports.viewAll")).toBe(false);
  });

  it.each([
    "iqc.approve",
    "issue.fifoOverride",
    "jw.closeWithShortage",
    "finalInspection.approve",
    "rejection.disposal",
    "stock.adjust",
    "transaction.reverse",
    "reports.viewAll",
    "users.manage",
    "bundleTag.reprint",
    "mrn.approve",
    "masters.manage",
  ] as const)("Admin-only action '%s': Floor is denied, Admin is allowed", (action) => {
    expect(can(floor, action)).toBe(false);
    expect(can(admin, action)).toBe(true);
  });

  it.each([
    "grn.create",
    "iqc.enter",
    "bundleTag.print",
    "mrn.create",
    "issue.create",
    "production.entry",
    "jw.challan",
    "jw.receipt",
    "dispatch.create",
    "masters.view",
    "reports.viewLimited",
  ] as const)("both roles can '%s'", (action) => {
    expect(can(floor, action)).toBe(true);
    expect(can(admin, action)).toBe(true);
  });

  it("Floor cannot reprint a bundle tag but can print one", () => {
    expect(can(floor, "bundleTag.print")).toBe(true);
    expect(can(floor, "bundleTag.reprint")).toBe(false);
  });

  it("Floor sees only limited reports, not all reports", () => {
    expect(can(floor, "reports.viewLimited")).toBe(true);
    expect(can(floor, "reports.viewAll")).toBe(false);
  });
});
