import { describe, expect, it } from "vitest";
import { adjustmentDelta, adjustmentSchema, locationSchema, movementLabel } from "./inventory";
import { checkImageFile, MAX_IMAGE_BYTES, move } from "./upload";

describe("adjustmentDelta", () => {
  it("adds received and returned units, removes damaged and lost ones", () => {
    expect(adjustmentDelta("change", "receipt", 5, 10)).toBe(5);
    expect(adjustmentDelta("change", "return", 2, 10)).toBe(2);
    expect(adjustmentDelta("change", "damaged", 3, 10)).toBe(-3);
    expect(adjustmentDelta("change", "lost", 1, 10)).toBe(-1);
  });
  it("uses the sign as typed for corrections", () => {
    expect(adjustmentDelta("change", "correction", -4, 10)).toBe(-4);
    expect(adjustmentDelta("change", "correction", 4, 10)).toBe(4);
  });
  it("turns a counted total into the difference from what's on hand", () => {
    expect(adjustmentDelta("count", "correction", 7, 10)).toBe(-3);
    expect(adjustmentDelta("count", "receipt", 12, 10)).toBe(2);
  });
});

describe("adjustmentSchema", () => {
  const base = { locationId: "l1", reason: "receipt" as const, mode: "change" as const, quantity: "5", note: "" };
  it("accepts a normal receipt", () => expect(adjustmentSchema.safeParse(base).success).toBe(true));
  it("rejects zero, fractions and minus signs where the reason sets direction", () => {
    expect(adjustmentSchema.safeParse({ ...base, quantity: "0" }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ ...base, quantity: "1.5" }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ ...base, quantity: "-2" }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ ...base, reason: "correction", quantity: "-2" }).success).toBe(true);
  });
  it("rejects negative counts", () => expect(adjustmentSchema.safeParse({ ...base, mode: "count", quantity: "-1" }).success).toBe(false));
});

describe("locationSchema", () => {
  it("validates code and GST state code", () => {
    expect(locationSchema.safeParse({ name: "Pune", code: "PUNE-1", stateCode: "27", isDefault: false }).success).toBe(true);
    expect(locationSchema.safeParse({ name: "Pune", code: "has space", stateCode: "", isDefault: false }).success).toBe(false);
    expect(locationSchema.safeParse({ name: "Pune", code: "P", stateCode: "Maharashtra", isDefault: false }).success).toBe(false);
  });
});

describe("image uploads", () => {
  it("accepts JPEG, PNG and WebP up to 5 MB", () => {
    expect(checkImageFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(checkImageFile({ type: "image/webp", size: MAX_IMAGE_BYTES })).toBeNull();
  });
  it("refuses other types, empty and oversized files", () => {
    expect(checkImageFile({ type: "image/svg+xml", size: 1000 })).toMatch(/JPEG, PNG or WebP/);
    expect(checkImageFile({ type: "image/gif", size: 1000 })).not.toBeNull();
    expect(checkImageFile({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(checkImageFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toMatch(/5 MB/);
  });
  it("moves items for reordering and ignores out-of-range moves", () => {
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(move(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
  it("labels ledger reasons for people", () => {
    expect(movementLabel("TransferIn")).toBe("Moved in");
    expect(movementLabel("Something")).toBe("Something");
  });
});
