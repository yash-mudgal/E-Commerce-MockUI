import { describe, expect, it } from "vitest";
import { planSchema } from "./schemas";

const base = { name: "Basic", monthlyPrice: "999", maxProducts: "500", maxStaff: "2", maxLocations: "1", isPublic: true, razorpayPlanId: "plan_basic0000001" };

describe("platform plan form", () => {
  it("turns empty limits into unlimited (null) and keeps numbers", () => {
    expect(planSchema.parse({ ...base, maxProducts: "", maxStaff: "0" })).toMatchObject({ monthlyPrice: 999, maxProducts: null, maxStaff: 0, maxLocations: 1 });
  });
  it("needs real Razorpay plan IDs, or none", () => {
    expect(planSchema.parse({ ...base, razorpayPlanId: "" }).razorpayPlanId).toBeNull();
    expect(planSchema.safeParse({ ...base, razorpayPlanId: "price_123" }).success).toBe(false);
  });
  it("refuses zero products or locations and malformed prices", () => {
    expect(planSchema.safeParse({ ...base, maxProducts: "0" }).success).toBe(false);
    expect(planSchema.safeParse({ ...base, maxLocations: "0" }).success).toBe(false);
    expect(planSchema.safeParse({ ...base, monthlyPrice: "-5" }).success).toBe(false);
    expect(planSchema.safeParse({ ...base, maxStaff: "two" }).success).toBe(false);
  });
});
