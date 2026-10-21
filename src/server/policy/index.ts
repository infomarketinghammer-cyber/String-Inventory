/**
 * Central permission policy — Section 9 role/permission matrix.
 * One entry per matrix row. Enforced server-side in every server action/route.
 * UI hides buttons too, but this module is the actual gate (403 on violation).
 */
// Deliberately NOT importing Role from "@prisma/client" here: this module
// must stay dependency-free and unit-testable without a generated Prisma
// Client or a live database.
export type Role = "ADMIN" | "FLOOR";

export type Action =
  | "masters.view"
  | "masters.manage"
  | "grn.create"
  | "grn.view"
  | "iqc.enter"
  | "iqc.approve"
  | "bundleTag.print"
  | "bundleTag.reprint"
  | "mrn.create"
  | "mrn.approve"
  | "issue.create"
  | "issue.fifoOverride"
  | "production.entry"
  | "jw.challan"
  | "jw.receipt"
  | "jw.closeWithShortage"
  | "finalInspection.enter"
  | "finalInspection.approve"
  | "dispatch.create"
  | "rejection.disposal"
  | "stock.adjust"
  | "transaction.reverse"
  | "reports.viewAll"
  | "reports.viewLimited"
  | "users.manage";

export interface PolicyUser {
  id: string;
  role: Role;
}

const ADMIN_ONLY: ReadonlySet<Action> = new Set([
  "masters.manage",
  "iqc.approve",
  "bundleTag.reprint",
  "mrn.approve",
  "issue.fifoOverride",
  "jw.closeWithShortage",
  "finalInspection.approve",
  "rejection.disposal",
  "stock.adjust",
  "transaction.reverse",
  "reports.viewAll",
  "users.manage",
]);

// Actions both roles may perform (Floor = Create-only variants)
const BOTH_ROLES: ReadonlySet<Action> = new Set([
  "masters.view",
  "grn.create",
  "grn.view",
  "iqc.enter",
  "bundleTag.print",
  "mrn.create",
  "issue.create",
  "production.entry",
  "finalInspection.enter", // SOP 4.8: QC inspector (Floor) records results; Admin approves
  "jw.challan",
  "jw.receipt",
  "dispatch.create",
  "reports.viewLimited",
]);

/**
 * can() - authoritative check used by every server action / route handler.
 * Returns false (never throws) so callers decide how to respond (403).
 */
export function can(user: PolicyUser | null | undefined, action: Action): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") {
    // Admin can do everything Floor can, plus admin-only actions.
    return ADMIN_ONLY.has(action) || BOTH_ROLES.has(action);
  }
  // FLOOR
  if (ADMIN_ONLY.has(action)) return false;
  return BOTH_ROLES.has(action);
}

export function assertCan(user: PolicyUser | null | undefined, action: Action): void {
  if (!can(user, action)) {
    throw new PolicyError(`Forbidden: ${user?.role ?? "anonymous"} may not perform "${action}"`);
  }
}

export class PolicyError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}
