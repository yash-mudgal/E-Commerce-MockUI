import { describe, expect, it } from "vitest";
import { countMax } from "@/components/admin/bar-chart";
import { emailHealth, funnelSteps, metricsRange, paymentHealth } from "./platform-metrics";
import { feedbackSchema } from "./schemas";

describe("platform metrics helpers", () => {
  it("builds ranges of whole Indian days ending today", () => {
    // 20:00 UTC on 3 Nov is already 4 Nov in India.
    const now = new Date("2026-11-03T20:00:00Z");
    expect(metricsRange("28d", now)).toEqual({ from: "2026-10-08", to: "2026-11-04" });
    expect(metricsRange("365d", now)).toEqual({ from: "2025-11-05", to: "2026-11-04" });
  });

  it("gives each funnel stage its share of sign-ups and of the previous stage", () => {
    const steps = funnelSteps({ signedUp: 40, emailConfirmed: 30, addedProduct: 20, launched: 10, firstOrder: 5, onPaidPlan: 2 });
    expect(steps[0]).toMatchObject({ label: "Signed up", count: 40, ofStart: null, ofPrevious: null });
    expect(steps[3]).toMatchObject({ label: "Launched the store", count: 10, ofStart: 25, ofPrevious: 50 });
    expect(steps[5]).toMatchObject({ count: 2, ofStart: 5, ofPrevious: null }); // paying isn't a step after the first order
  });

  it("doesn't divide by zero for an empty cohort", () => {
    expect(funnelSteps({ signedUp: 0, emailConfirmed: 0, addedProduct: 0, launched: 0, firstOrder: 0, onPaidPlan: 0 }).every((s) => s.ofStart === null)).toBe(true);
  });

  it("only judges payment success with enough payments", () => {
    expect(paymentHealth(null, 0)).toEqual({ tone: "neutral", label: "No online payments yet" });
    expect(paymentHealth("50.0", 10).tone).toBe("neutral");
    expect(paymentHealth("96.5", 200).tone).toBe("success");
    expect(paymentHealth("85.0", 200).tone).toBe("warning");
    expect(paymentHealth("60.0", 200).tone).toBe("danger");
  });

  it("flags stuck and failed email", () => {
    expect(emailHealth({ sent: 10, failed: 0, stuckPending: 2 })).toMatchObject({ tone: "danger" });
    expect(emailHealth({ sent: 10, failed: 1, stuckPending: 0 })).toMatchObject({ tone: "warning" });
    expect(emailHealth({ sent: 10, failed: 0, stuckPending: 0 })).toMatchObject({ tone: "success" });
  });

  it("rounds count axes up to even steps so the midline is whole", () => {
    expect([0, 1, 3, 7, 12, 45, 101].map(countMax)).toEqual([2, 2, 4, 8, 20, 60, 200]);
  });
});

describe("feedback form", () => {
  it("needs a category and a real message", () => {
    expect(feedbackSchema.safeParse({ category: "Idea", message: "Bulk edit prices please", mayContact: true }).success).toBe(true);
    expect(feedbackSchema.safeParse({ category: undefined, message: "Bulk edit prices please", mayContact: false }).success).toBe(false);
    expect(feedbackSchema.safeParse({ category: "Complaint", message: "Bulk edit prices please", mayContact: false }).success).toBe(false);
    expect(feedbackSchema.safeParse({ category: "Idea", message: "   short   ", mayContact: false }).success).toBe(false);
    expect(feedbackSchema.safeParse({ category: "Idea", message: "x".repeat(2001), mayContact: false }).success).toBe(false);
  });
});
