import { describe, expect, it } from "vitest";
import { ApiError, toFormPath } from "./api";
import { contrastWithWhite } from "./color";
import { productSchema, safeNext, signupSchema, storeSchema } from "./schemas";
import { discountPercent, formatINR, slugify } from "./utils";

describe("formatINR", () => {
  it("uses Indian digit grouping and hides .00", () => {
    expect(formatINR("124999.00")).toBe("₹1,24,999");
    expect(formatINR(1299)).toBe("₹1,299");
  });
  it("keeps paise when present", () => expect(formatINR("1299.50")).toBe("₹1,299.50"));
  it("renders a dash for missing values", () => {
    expect(formatINR(null)).toBe("—");
    expect(formatINR("abc")).toBe("—");
  });
});

describe("discountPercent", () => {
  it("rounds down so a discount is never overstated", () => expect(discountPercent("1299", "2499")).toBe(48));
  it("is zero when price >= MRP or MRP missing", () => {
    expect(discountPercent(100, 100)).toBe(0);
    expect(discountPercent(100, 0)).toBe(0);
  });
});

describe("slugify", () => {
  it("matches the API's slug rules for previews", () => {
    expect(slugify("Jaipuri Cotton Anarkali Kurta")).toBe("jaipuri-cotton-anarkali-kurta");
    expect(slugify("  Café — Crème  ")).toBe("cafe-creme");
  });
});

describe("ApiError", () => {
  it("maps API field paths to react-hook-form paths", () => {
    expect(toFormPath("variants[0].mrp")).toBe("variants.0.mrp");
    expect(toFormPath("variants[12].optionValues[1]")).toBe("variants.12.optionValues.1");
  });
  it("exposes the problem code and first message per field", () => {
    const e = new ApiError(400, { type: "https://docs.shopmint.in/errors/validation", errors: { "variants[0].price": ["Too low", "Other"] } });
    expect(e.code).toBe("validation");
    expect(e.fieldErrors).toEqual({ "variants.0.price": "Too low" });
  });
  it("prefers detail over title for the message", () => {
    expect(new ApiError(409, { title: "Conflict", detail: "SKU taken" }).message).toBe("SKU taken");
  });
});

describe("safeNext (open-redirect guard)", () => {
  it.each([
    ["/admin/products", "/admin/products"],
    ["https://evil.example", "/admin"],
    ["//evil.example", "/admin"],
    ["/\\evil.example", "/admin"],
    [null, "/admin"],
  ])("%s → %s", (input, expected) => expect(safeNext(input)).toBe(expected));
});

describe("schemas", () => {
  const variant = { sku: "SKU-1", optionValues: [], price: "100", mrp: "150", cost: "", stockOnHand: "3", isActive: true };
  const product = { title: "Tee", description: "", categoryId: "", status: "active", hsnCode: "", gstRate: "12", optionNames: [], tags: "", variants: [variant] };

  it("accepts a valid product and coerces stock to a number", () => {
    const r = productSchema.parse(product);
    expect(r.variants[0].stockOnHand).toBe(3);
  });
  it("rejects MRP below price on the mrp field", () => {
    const r = productSchema.safeParse({ ...product, variants: [{ ...variant, mrp: "50" }] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["variants", 0, "mrp"]);
  });
  it("rejects malformed money and HSN", () => {
    expect(productSchema.safeParse({ ...product, variants: [{ ...variant, price: "12.345" }] }).success).toBe(false);
    expect(productSchema.safeParse({ ...product, hsnCode: "12345" }).success).toBe(false);
  });
  it("validates subdomains like the API", () => {
    const base = { name: "A", email: "a@b.co", password: "long-enough-1", storeName: "Shop" };
    expect(signupSchema.safeParse({ ...base, subdomain: "desi-threads" }).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, subdomain: "Desi_Threads" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, subdomain: "-bad" }).success).toBe(false);
  });
  it("normalises GSTIN to upper case", () => {
    const r = storeSchema.parse({ name: "S", legalName: "", gstin: "27aagcd4821m1z3", tagline: "", supportEmail: "", brandColor: "#4f46e5", lowStockThreshold: "10",
      businessAddress: "", shippingFee: "49", freeShippingThreshold: "", codEnabled: true, codMaxOrderValue: "5000", abandonedCartEmails: false });
    expect(r.gstin).toBe("27AAGCD4821M1Z3");
  });
});

describe("contrastWithWhite", () => {
  it("agrees with the API's 4.5:1 rule", () => {
    expect(contrastWithWhite("#4f46e5")).toBeGreaterThan(4.5);
    expect(contrastWithWhite("#fbbf24")).toBeLessThan(4.5);
    expect(contrastWithWhite("nope")).toBe(0);
  });
});
