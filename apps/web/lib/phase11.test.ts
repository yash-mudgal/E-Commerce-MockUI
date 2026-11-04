import { describe, expect, it } from "vitest";
import { isMfaRequired } from "@/components/platform-mfa";
import { ApiError } from "./api";

describe("platform pages behind two-step verification", () => {
  it("recognises the API's mfa-required problem", () => {
    expect(isMfaRequired(new ApiError(403, { type: "https://docs.shopmint.in/errors/mfa-required", status: 403 }))).toBe(true);
  });
  it("doesn't treat other refusals as an MFA prompt", () => {
    expect(isMfaRequired(new ApiError(403, { type: "https://docs.shopmint.in/errors/forbidden", status: 403 }))).toBe(false);
    expect(isMfaRequired(new ApiError(403, { status: 403 }))).toBe(false);
    expect(isMfaRequired(new Error("mfa-required"))).toBe(false);
    expect(isMfaRequired(undefined)).toBe(false);
  });
});
