import { describe, expect, it } from "vitest";
import { defaultGroup, periodLabel, presetRange } from "./reports";

describe("report ranges (Indian dates, financial year from April)", () => {
  const at = (iso: string) => new Date(iso);
  it("uses the Indian date, not UTC", () => {
    // 20:00 UTC on 31 Oct is 01:30 on 1 Nov in India.
    expect(presetRange("7d", at("2026-10-31T20:00:00Z"))).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });
  it("covers months and financial years", () => {
    expect(presetRange("this-month", at("2026-11-04T06:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-04" });
    expect(presetRange("last-month", at("2026-03-15T06:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("this-fy", at("2026-11-04T06:00:00Z"))).toEqual({ from: "2026-04-01", to: "2026-11-04" });
    expect(presetRange("this-fy", at("2027-02-10T06:00:00Z"))).toEqual({ from: "2026-04-01", to: "2027-02-10" });
    expect(presetRange("last-fy", at("2026-11-04T06:00:00Z"))).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });
  it("picks a grouping that keeps charts readable", () => {
    expect(defaultGroup("2026-10-01", "2026-10-31")).toBe("day");
    expect(defaultGroup("2026-04-01", "2026-08-31")).toBe("week");
    expect(defaultGroup("2025-04-01", "2026-03-31")).toBe("month");
  });
  it("labels periods", () => {
    expect(periodLabel("2026-11-02", "week")).toBe("Week of 2 Nov");
    expect(periodLabel("2026-11-01", "month")).toBe("Nov 2026");
  });
});
