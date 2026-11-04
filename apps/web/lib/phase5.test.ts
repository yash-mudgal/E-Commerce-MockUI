import { describe, expect, it } from "vitest";
import { auditHref, describeAudit } from "./audit";
import { acceptInviteSchema, changePasswordSchema, inviteSchema, passwordRule, resetSchema } from "./schemas";
import type { AuditEntry } from "./types";

const entry = (action: string, data: AuditEntry["data"] = null, extra: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "1", at: "2026-11-04T10:00:00Z", action, entityType: null, entityId: null, actor: null, data, ip: null, ...extra,
});

describe("describeAudit", () => {
  it("reads payload fields regardless of casing", () => {
    expect(describeAudit(entry("product.created", { Title: "Silk Saree", variants: 2 }))).toBe("Created product “Silk Saree”");
    expect(describeAudit(entry("category.deleted", { name: "Kurtas" }))).toBe("Deleted category “Kurtas”");
  });

  it("describes team changes", () => {
    expect(describeAudit(entry("staff.invited", { email: "a@b.in", role: "Manager" }))).toBe("Invited a@b.in as a Manager");
    expect(describeAudit(entry("staff.role_changed", { from: "Staff", to: "Manager" }))).toBe("Changed a team member's role from Staff to Manager");
    expect(describeAudit(entry("staff.role_changed", { email: "a@b.in", from: "Staff", to: "Manager" }))).toBe("Changed a@b.in's role from Staff to Manager");
    expect(describeAudit(entry("staff.invitation_accepted", { email: "a@b.in", role: "Staff" }))).toBe("Joined the store as Staff");
  });

  it("falls back to the raw action for unknown events and tolerates missing data", () => {
    expect(describeAudit(entry("orders.something_new"))).toBe("orders.something_new");
    expect(describeAudit(entry("product.updated"))).toBe("Updated product");
  });

  it("links to records that still exist", () => {
    expect(auditHref(entry("product.updated", null, { entityType: "product", entityId: "p1" }))).toBe("/admin/products/p1");
    expect(auditHref(entry("product.deleted", null, { entityType: "product", entityId: "p1" }))).toBeNull();
    expect(auditHref(entry("staff.removed"))).toBe("/admin/staff");
    expect(auditHref(entry("auth.login"))).toBeNull();
  });
});

describe("password and invitation schemas", () => {
  it("mirrors the API password rule", () => {
    expect(passwordRule.safeParse("short").success).toBe(false);
    expect(passwordRule.safeParse("aaaaaaaaaaaa").success).toBe(false); // too predictable
    expect(passwordRule.safeParse("Correct-Horse-9").success).toBe(true);
  });

  it("requires matching confirmation", () => {
    const r = resetSchema.safeParse({ password: "Correct-Horse-9", confirm: "Correct-Horse-8" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["confirm"]);
    expect(acceptInviteSchema.safeParse({ name: "Asha", password: "Correct-Horse-9", confirm: "Correct-Horse-9" }).success).toBe(true);
  });

  it("rejects reusing the current password", () => {
    const r = changePasswordSchema.safeParse({ currentPassword: "Correct-Horse-9", newPassword: "Correct-Horse-9", confirm: "Correct-Horse-9" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === "newPassword")).toBe(true);
  });

  it("only offers assignable roles", () => {
    expect(inviteSchema.safeParse({ email: "a@b.in", role: "Owner" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@b.in", role: "Staff" }).success).toBe(true);
  });
});
