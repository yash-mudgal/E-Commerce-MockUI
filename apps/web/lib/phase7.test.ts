import { afterEach, describe, expect, it, vi } from "vitest";
import { addressSchema, profileSchema, shopperSignupSchema } from "./schemas";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
const { jsonLd, storeOrigin } = await import("./storefront");

describe("jsonLd", () => {
  it("can't be used to close the script tag or inject markup", () => {
    const out = jsonLd({ name: "</script><script>alert(1)</script> & co" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script> & co");
  });
});

describe("storeOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("defaults to https on the store host", () => expect(storeOrigin("desithreads.shopmint.in")).toBe("https://desithreads.shopmint.in"));
  it("follows the configured template", () => {
    vi.stubEnv("STOREFRONT_URL_TEMPLATE", "http://{host}:3000/");
    expect(storeOrigin("a.localhost")).toBe("http://a.localhost:3000");
  });
});

describe("address and profile schemas", () => {
  const valid = { name: "Ananya Rao", phone: "+91 98450-12345", line1: "14 2nd Cross", line2: "", city: "Bengaluru", stateCode: "29", pincode: "560038", isDefault: false };
  it("accepts an Indian address and normalises the phone", () => {
    const r = addressSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data?.phone).toBe("+919845012345");
  });
  it("rejects bad PIN codes, states and phone numbers", () => {
    expect(addressSchema.safeParse({ ...valid, pincode: "012345" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...valid, pincode: "56003" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...valid, stateCode: "" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...valid, phone: "5123456789" }).success).toBe(false);
  });
  it("lets the profile phone be empty", () => {
    expect(profileSchema.safeParse({ name: "A", phone: "", marketingOptIn: false }).success).toBe(true);
    expect(profileSchema.safeParse({ name: "A", phone: "12", marketingOptIn: false }).success).toBe(false);
  });
  it("requires a strong password at signup and leaves marketing unticked by default", () => {
    expect(shopperSignupSchema.safeParse({ name: "A", email: "a@b.in", password: "short", marketingOptIn: false }).success).toBe(false);
    expect(shopperSignupSchema.safeParse({ name: "A", email: "a@b.in", password: "Correct-Horse-9", marketingOptIn: false }).success).toBe(true);
  });
});
