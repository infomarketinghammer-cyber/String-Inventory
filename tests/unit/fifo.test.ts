import { describe, it, expect } from "vitest";
import { fifoPick, validateFifoScan, sortFifo, type FifoPoolUnit } from "@/server/services/fifo";

/**
 * Reproduces Section 7's worked example EXACTLY:
 * MRN-2610-0008 needs 900kg of SW-C 3.0mm.
 *   RM-2609-0031, inward 2026-09-04, balance 150kg
 *   RM-2609-0047, inward 2026-09-18, balance 500kg
 *   RM-2610-0003, inward 2026-10-02, balance 500kg
 *   RM-2610-0019, inward 2026-10-09, balance 500kg
 * Expected picks: 150 + 500 + 250 = 900kg from the first three bundles;
 * RM-2610-0019 stays completely untouched.
 */
const pool: FifoPoolUnit[] = [
  { id: "b1", number: "RM-2609-0031", inwardDate: new Date("2026-09-04"), balance: 150 },
  { id: "b2", number: "RM-2609-0047", inwardDate: new Date("2026-09-18"), balance: 500 },
  { id: "b3", number: "RM-2610-0003", inwardDate: new Date("2026-10-02"), balance: 500 },
  { id: "b4", number: "RM-2610-0019", inwardDate: new Date("2026-10-09"), balance: 500 },
];

describe("fifoPick — Section 7 worked example", () => {
  it("picks 150 + 500 + 250 from the three oldest bundles and leaves RM-2610-0019 untouched", () => {
    const result = fifoPick(pool, 900);

    expect(result.fullyCovered).toBe(true);
    expect(result.totalPicked).toBe(900);
    expect(result.picks).toHaveLength(3);

    expect(result.picks[0]).toMatchObject({ number: "RM-2609-0031", qtyPicked: 150, balanceAfter: 0 });
    expect(result.picks[1]).toMatchObject({ number: "RM-2609-0047", qtyPicked: 500, balanceAfter: 0 });
    expect(result.picks[2]).toMatchObject({ number: "RM-2610-0003", qtyPicked: 250, balanceAfter: 250 });

    const touchedNumbers = result.picks.map((p) => p.number);
    expect(touchedNumbers).not.toContain("RM-2610-0019");
  });

  it("sorts oldest-first by inward date, then by number", () => {
    const sorted = sortFifo(pool);
    expect(sorted.map((u) => u.number)).toEqual([
      "RM-2609-0031",
      "RM-2609-0047",
      "RM-2610-0003",
      "RM-2610-0019",
    ]);
  });

  it("blocks scanning RM-2610-0019 first, pointing to RM-2609-0031 (inward 2026-09-04)", () => {
    const message = validateFifoScan(pool, "b4");
    expect(message).toBe("Wrong bundle. Issue RM-2609-0031 first (inward 2026-09-04).");
  });

  it("allows scanning the correct oldest bundle first", () => {
    const message = validateFifoScan(pool, "b1");
    expect(message).toBeNull();
  });

  it("a partially-used bundle keeps its original inward date for subsequent FIFO comparisons", () => {
    // After the 250kg pick from RM-2610-0003, it has 250kg left but inward date unchanged.
    const afterPick: FifoPoolUnit[] = [
      { id: "b3", number: "RM-2610-0003", inwardDate: new Date("2026-10-02"), balance: 250 },
      { id: "b4", number: "RM-2610-0019", inwardDate: new Date("2026-10-09"), balance: 500 },
    ];
    const sorted = sortFifo(afterPick);
    expect(sorted[0]!.number).toBe("RM-2610-0003"); // still oldest, still goes first
  });

  it("never exceeds pool capacity and reports partial coverage when stock runs short", () => {
    const smallPool: FifoPoolUnit[] = [{ id: "x", number: "RM-2610-9999", inwardDate: new Date(), balance: 50 }];
    const result = fifoPick(smallPool, 100);
    expect(result.fullyCovered).toBe(false);
    expect(result.totalPicked).toBe(50);
  });

  it("ignores zero/negative-balance units entirely", () => {
    const withExhausted: FifoPoolUnit[] = [
      { id: "z1", number: "RM-ZZZ-0001", inwardDate: new Date("2026-01-01"), balance: 0 },
      { id: "z2", number: "RM-ZZZ-0002", inwardDate: new Date("2026-01-02"), balance: 10 },
    ];
    const result = fifoPick(withExhausted, 10);
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]!.number).toBe("RM-ZZZ-0002");
  });
});
