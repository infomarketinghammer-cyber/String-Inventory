import { describe, it, expect } from "vitest";
import { fiscalYearLabel, yymmLabel } from "@/server/services/docNumber";

describe("document number period labels (Section 9 #13 - system-generated, sequential per FY)", () => {
  it("fiscalYearLabel: April starts a new financial year", () => {
    expect(fiscalYearLabel(new Date("2026-04-01T00:00:00Z"))).toBe("2627");
    expect(fiscalYearLabel(new Date("2026-10-21T00:00:00Z"))).toBe("2627");
    expect(fiscalYearLabel(new Date("2027-03-31T00:00:00Z"))).toBe("2627");
    expect(fiscalYearLabel(new Date("2027-04-01T00:00:00Z"))).toBe("2728");
  });

  it("yymmLabel: calendar year-month used for Bundle/Lot/FG numbering", () => {
    expect(yymmLabel(new Date("2026-09-04T00:00:00Z"))).toBe("2609");
    expect(yymmLabel(new Date("2026-10-09T00:00:00Z"))).toBe("2610");
  });
});
