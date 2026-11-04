import { afterEach, describe, expect, it, vi } from "vitest";
import { fillDays, niceMax } from "@/components/admin/sales-card";
import { api } from "./api";
import { amountInWords, newIdempotencyKey, numberToIndianWords, ORDER_STATUS, PAYMENT_STATUS, stepIndex } from "./orders";
import { couponSchema, razorpayKeysSchema, refundSchema, shipSchema, storeSchema } from "./schemas";

describe("amount in words (GST invoices)", () => {
  it.each([
    [0, "Zero"], [7, "Seven"], [19, "Nineteen"], [40, "Forty"], [105, "One Hundred Five"], [1000, "One Thousand"],
    [125000, "One Lakh Twenty Five Thousand"], [99_99_999, "Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine"],
    [12_34_56_789, "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine"],
  ])("%i → %s", (n, words) => expect(numberToIndianWords(n)).toBe(words));
  it("adds paise and avoids float drift", () => {
    expect(amountInWords("1234.50")).toBe("Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only");
    expect(amountInWords("0.29")).toBe("Rupees Zero and Twenty Nine Paise Only");
    expect(amountInWords(1.005 * 100 / 100)).toBe("Rupees One Only");
    expect(amountInWords("548")).toBe("Rupees Five Hundred Forty Eight Only");
  });
});

describe("order labels", () => {
  it("covers every status the API can send", () => {
    expect(Object.keys(ORDER_STATUS)).toEqual(["PendingPayment", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled", "Expired"]);
    expect(Object.keys(PAYMENT_STATUS)).toEqual(["Pending", "Paid", "Failed", "CodDue", "PartiallyRefunded", "Refunded", "Voided"]);
  });
  it("orders progress steps", () => {
    expect(stepIndex("Confirmed")).toBe(0);
    expect(stepIndex("Delivered")).toBe(3);
    expect(stepIndex("Cancelled")).toBe(-1);
  });
  it("makes distinct idempotency keys of a length the API accepts", () => {
    const a = newIdempotencyKey(), b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(100);
  });
});

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends extra headers such as Idempotency-Key, but never lets them drop the CSRF header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/storefront/checkout/orders", { method: "POST", body: {}, headers: { "Idempotency-Key": "key-12345", "X-ShopMint-Csrf": "0" } });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("key-12345");
    expect(headers["X-ShopMint-Csrf"]).toBe("1");
  });
});

describe("Phase 8 schemas", () => {
  const store = { name: "S", legalName: "", gstin: "", tagline: "", supportEmail: "", brandColor: "#4f46e5", lowStockThreshold: "5",
    businessAddress: "", shippingFee: "49", freeShippingThreshold: "", codEnabled: true, codMaxOrderValue: "5000" };
  it("store delivery and COD fields", () => {
    expect(storeSchema.safeParse(store).success).toBe(true);
    expect(storeSchema.safeParse({ ...store, shippingFee: "-1" }).success).toBe(false);
    expect(storeSchema.safeParse({ ...store, codMaxOrderValue: "0" }).success).toBe(false);
    expect(storeSchema.safeParse({ ...store, freeShippingThreshold: "499.50" }).success).toBe(true);
  });
  it("shipping needs https tracking links", () => {
    expect(shipSchema.safeParse({ carrier: "Delhivery", trackingNumber: "123", trackingUrl: "" }).success).toBe(true);
    expect(shipSchema.safeParse({ carrier: "Delhivery", trackingNumber: "123", trackingUrl: "https://t.example/123" }).success).toBe(true);
    expect(shipSchema.safeParse({ carrier: "Delhivery", trackingNumber: "123", trackingUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(shipSchema.safeParse({ carrier: "Delhivery", trackingNumber: "123", trackingUrl: "http://t.example" }).success).toBe(false);
  });
  it("refunds are positive and capped at the refundable balance", () => {
    const s = refundSchema(500);
    expect(s.parse({ amount: "500", reason: "Damaged" })).toEqual({ amount: 500, reason: "Damaged" });
    expect(s.safeParse({ amount: "500.01", reason: "x" }).success).toBe(false);
    expect(s.safeParse({ amount: "0", reason: "x" }).success).toBe(false);
    expect(s.safeParse({ amount: "10", reason: " " }).success).toBe(false);
  });
  const coupon = { code: "welcome10", kind: "percent" as const, value: "10", minSubtotal: "", maxDiscount: "", startsAt: "", endsAt: "", usageLimit: "", perCustomerLimit: "1", isActive: true };
  it("coupons", () => {
    expect(couponSchema.parse(coupon).code).toBe("WELCOME10");
    expect(couponSchema.safeParse({ ...coupon, value: "95" }).success).toBe(false);
    expect(couponSchema.safeParse({ ...coupon, kind: "fixed", value: "95" }).success).toBe(true);
    expect(couponSchema.safeParse({ ...coupon, code: "no spaces" }).success).toBe(false);
    expect(couponSchema.safeParse({ ...coupon, startsAt: "2026-12-10", endsAt: "2026-12-01" }).success).toBe(false);
    expect(couponSchema.safeParse({ ...coupon, perCustomerLimit: "0" }).success).toBe(false);
  });
  it("Razorpay keys", () => {
    expect(razorpayKeysSchema.safeParse({ keyId: "rzp_live_ABCDEFGH1234", keySecret: "s".repeat(24), webhookSecret: "whsec_123" }).success).toBe(true);
    expect(razorpayKeysSchema.safeParse({ keyId: "pk_live_123", keySecret: "s".repeat(24), webhookSecret: "whsec_123" }).success).toBe(false);
  });
});

describe("sales chart helpers", () => {
  it("fills every day of the window in Indian time, ending today", () => {
    const days = fillDays({ days: 3, orders: 2, revenue: "300", averageOrderValue: "150", toFulfil: 0, awaitingPayment: 0,
      daily: [{ date: "2026-11-04", orders: 2, revenue: "300.00" }] }, new Date("2026-11-04T20:00:00Z")); // 01:30 on 5 Nov in India
    expect(days.map((d) => d.date)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(days[1]).toEqual({ date: "2026-11-04", orders: 2, revenue: 300 });
    expect(days[2].revenue).toBe(0);
  });
  it("rounds the axis to a clean maximum", () => {
    expect(niceMax(0)).toBe(1000);
    expect(niceMax(1234)).toBe(2000);
    expect(niceMax(2100)).toBe(2500);
    expect(niceMax(4999)).toBe(5000);
    expect(niceMax(50000)).toBe(50000);
  });
});
