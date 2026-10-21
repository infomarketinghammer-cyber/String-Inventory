/**
 * FIFO engine (Section 7) — the single reusable picking algorithm used by
 * Material Issue (T5), JW Send (T8) and Dispatch (T15).
 *
 * Rules implemented:
 *  - Sort oldest-first by inwardDate, then by number (tie-break).
 *  - Never pick Quality Hold / Rejected / At Job Worker stock (pool passed in
 *    by the caller must already be filtered to eligible status/location).
 *  - Partially-used unit keeps its original inward date (caller's job: FIFO
 *    here never mutates anything, it only decides what to take).
 *  - If the oldest unit doesn't cover the need, take it fully and move to
 *    the next until the requirement is met.
 */

export interface FifoPoolUnit {
  /** Stable identifier, e.g. bundle.id */
  id: string;
  /** Human-readable number, e.g. bundle_no — used for messages & tie-break */
  number: string;
  inwardDate: Date;
  /** Available quantity on this unit right now */
  balance: number;
}

export interface FifoPick {
  id: string;
  number: string;
  inwardDate: Date;
  qtyPicked: number;
  balanceAfter: number;
}

export interface FifoResult {
  picks: FifoPick[];
  totalPicked: number;
  fullyCovered: boolean;
}

/** Sort a pool oldest-first: inward_date, then number (lexical, stable for same date). */
export function sortFifo(pool: FifoPoolUnit[]): FifoPoolUnit[] {
  return [...pool].sort((a, b) => {
    const d = a.inwardDate.getTime() - b.inwardDate.getTime();
    if (d !== 0) return d;
    return a.number.localeCompare(b.number);
  });
}

/**
 * Pick oldest-first units from `pool` until `requiredQty` is satisfied (or
 * the pool is exhausted). Pure function — no I/O, no db access — so it is
 * trivially unit-testable and reusable by issue/JW-send/dispatch services,
 * which perform the actual balance mutation + ledger write inside a
 * serializable transaction.
 */
export function fifoPick(pool: FifoPoolUnit[], requiredQty: number): FifoResult {
  if (requiredQty <= 0) {
    return { picks: [], totalPicked: 0, fullyCovered: true };
  }
  const sorted = sortFifo(pool);
  const picks: FifoPick[] = [];
  let remaining = requiredQty;

  for (const unit of sorted) {
    if (remaining <= 0) break;
    if (unit.balance <= 0) continue;
    const take = Math.min(unit.balance, remaining);
    picks.push({
      id: unit.id,
      number: unit.number,
      inwardDate: unit.inwardDate,
      qtyPicked: take,
      balanceAfter: unit.balance - take,
    });
    remaining -= take;
  }

  const totalPicked = picks.reduce((s, p) => s + p.qtyPicked, 0);
  return { picks, totalPicked, fullyCovered: remaining <= 1e-9 };
}

/**
 * Validate that a manually-scanned unit is the correct FIFO choice.
 * Returns null if valid, or an error message in the exact UI format
 * ("Wrong bundle. Issue RM-2609-0031 first (inward 2026-09-04).") if not.
 */
export function validateFifoScan(
  pool: FifoPoolUnit[],
  scannedId: string,
): string | null {
  const sorted = sortFifo(pool.filter((u) => u.balance > 0));
  if (sorted.length === 0) return null;
  const oldest = sorted[0]!;
  if (oldest.id === scannedId) return null;
  const dateStr = formatDateDMY(oldest.inwardDate);
  return `Wrong bundle. Issue ${oldest.number} first (inward ${dateStr}).`;
}

function formatDateDMY(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}
