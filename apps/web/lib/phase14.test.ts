import { describe, expect, it } from "vitest";
import { announcement, deliveryDays, freeShippingProgress, isColourOption, storeTerms, swatchFor } from "./store-terms";

const base = { shippingFee: "79.00", freeShippingThreshold: "999.00", codEnabled: true, codMaxOrderValue: "5000.00", onlinePayments: true, onlinePaymentsTest: false, gstin: "27AAGCD4821M1Z3" };

describe("store terms", () => {
  it("states only what the store offers", () => {
    expect(storeTerms(base).map((t) => t.title)).toEqual(["Free shipping over ₹999", "Cash on delivery", "Secure online payment", "GST invoice"]);
    const bare = storeTerms({ ...base, freeShippingThreshold: null, codEnabled: false, onlinePayments: false, gstin: null });
    expect(bare).toEqual([{ key: "shipping", title: "Flat ₹79 shipping", detail: "On every order" }]);
  });

  it("calls shipping free when the fee or the threshold is zero", () => {
    expect(storeTerms({ ...base, shippingFee: "0.00" })[0].title).toBe("Free shipping");
    expect(storeTerms({ ...base, freeShippingThreshold: "0.00" })[0].title).toBe("Free shipping");
  });

  it("labels the test gateway instead of promising real online payment", () => {
    expect(storeTerms({ ...base, onlinePaymentsTest: true }).find((t) => t.key === "online")?.detail).toMatch(/test mode/i);
  });

  it("builds the announcement from shipping and COD", () => {
    expect(announcement(base)).toBe("Free shipping over ₹999 · Cash on delivery");
    expect(announcement({ ...base, codEnabled: false })).toBe("Free shipping over ₹999");
  });
});

describe("returns and delivery terms", () => {
  it("adds the return window and the delivery estimate", () => {
    const t = storeTerms({ ...base, freeShippingThreshold: null, returnWindowDays: 7, deliveryMinDays: 3, deliveryMaxDays: 5 });
    expect(t.find((x) => x.key === "returns")?.title).toBe("7-day returns");
    expect(t[0].detail).toBe("Usually delivered in 3–5 days");
    expect(storeTerms({ ...base, returnWindowDays: 0 }).some((x) => x.key === "returns")).toBe(false);
  });
  it("doesn't promise one fee everywhere when zones exist", () => {
    expect(storeTerms({ ...base, hasDeliveryZones: true })[0].detail).toMatch(/check yours/);
  });
  it("words day ranges", () => {
    expect(deliveryDays(3, 5)).toBe("3–5 days");
    expect(deliveryDays(2, 2)).toBe("2 days");
    expect(deliveryDays(null, 4)).toBeNull();
  });
});

describe("free shipping progress", () => {
  it("counts down to the threshold", () => {
    expect(freeShippingProgress("600.00", base)).toEqual({ remaining: 399, percent: 60, reached: false, threshold: 999 });
    expect(freeShippingProgress("1200.00", base)).toMatchObject({ remaining: 0, percent: 100, reached: true });
  });
  it("is absent without a threshold or when shipping is free", () => {
    expect(freeShippingProgress("10", { ...base, freeShippingThreshold: null })).toBeNull();
    expect(freeShippingProgress("10", { ...base, shippingFee: "0.00" })).toBeNull();
  });
});

describe("colour swatches", () => {
  it("knows common colour names and leaves others as text", () => {
    expect(swatchFor("Royal Blue")).toMatch(/^#/);
    expect(swatchFor(" indigo ")).toMatch(/^#/);
    expect(swatchFor("Hammered")).toBeNull();
    expect(isColourOption("Colour")).toBe(true);
    expect(isColourOption("Color")).toBe(true);
    expect(isColourOption("Size")).toBe(false);
  });
});
