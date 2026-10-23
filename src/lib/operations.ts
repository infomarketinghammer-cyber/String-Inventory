/** URL name of a routing operation, e.g. "Heat Treatment" -> "heat-treatment" (used by the Production tabs). */
export function opSlug(opName: string): string {
  return opName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface OperationTab {
  slug: string;
  name: string;
  /** In-house or job work (from the routing masters). */
  jobWork: boolean;
}

/** Only these return addresses are accepted after a production save. */
export function safeProductionPath(p: unknown): string {
  const s = typeof p === "string" ? p : "";
  return /^\/production(\/[a-z0-9-]+)?$/.test(s) ? s : "/production";
}
