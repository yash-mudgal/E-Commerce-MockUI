import type { AuditEntry } from "./types";

/** Activity areas the API can filter by (AuditEndpoints.Areas). */
export const AUDIT_AREAS = [
  { value: "", label: "All activity" },
  { value: "product", label: "Products" },
  { value: "category", label: "Categories" },
  { value: "staff", label: "Team" },
  { value: "store", label: "Store settings" },
  { value: "auth", label: "Sign-ins and passwords" },
  { value: "tenant", label: "Account status" },
] as const;

/** Case-insensitive lookup: audit payloads mix property casings ("Title" from C# members, "email" from named fields). */
function field(data: AuditEntry["data"], name: string): string | undefined {
  if (!data) return undefined;
  const key = Object.keys(data).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key === undefined ? undefined : data[key];
  return v === null || v === undefined ? undefined : String(v);
}

const quoted = (s: string | undefined) => (s ? `“${s}”` : "");
const article = (role: string | undefined) => (role === "Manager" ? "a Manager" : role === "Staff" ? "Staff" : (role ?? "a member"));

/** One readable sentence per audit entry. Unknown actions fall back to the raw action name. */
export function describeAudit(e: AuditEntry): string {
  const d = e.data;
  switch (e.action) {
    case "tenant.created": return "Created the store";
    case "tenant.suspended": return "Store suspended by ShopMint";
    case "tenant.reactivated": return "Store reactivated by ShopMint";
    case "auth.login": return "Signed in";
    case "auth.password_changed": return "Changed their password";
    case "store.settings_updated": return "Updated store settings";
    case "store.launched": return "Launched the storefront";
    case "product.created": return `Created product ${quoted(field(d, "title"))}`.trim();
    case "product.updated": return `Updated product ${quoted(field(d, "title"))}`.trim();
    case "product.archived": return "Archived a product";
    case "product.deleted": return `Deleted product ${quoted(field(d, "title"))}`.trim();
    case "category.created": return `Created category ${quoted(field(d, "name"))}`.trim();
    case "category.updated": return `Updated category ${quoted(field(d, "name"))}`.trim();
    case "category.deleted": return `Deleted category ${quoted(field(d, "name"))}`.trim();
    case "staff.invited": return `Invited ${field(d, "email") ?? "someone"} as ${article(field(d, "role"))}`;
    case "staff.invitation_resent": return `Resent the invitation to ${field(d, "email") ?? "someone"}`;
    case "staff.invitation_revoked": return `Revoked the invitation to ${field(d, "email") ?? "someone"}`;
    case "staff.invitation_accepted": return `Joined the store as ${article(field(d, "role"))}`;
    case "staff.role_changed": {
      const who = field(d, "email");
      return `Changed ${who ? `${who}'s` : "a team member's"} role from ${field(d, "from") ?? "?"} to ${field(d, "to") ?? "?"}`;
    }
    case "staff.removed": return `Removed ${field(d, "email") ?? "a team member"} from the team`;
    default: return e.action;
  }
}

/** Link to the affected record when it still has a page. */
export function auditHref(e: AuditEntry): string | null {
  if (e.entityType === "product" && e.entityId && e.action !== "product.deleted") return `/admin/products/${e.entityId}`;
  if (e.action.startsWith("store.")) return "/admin/settings";
  if (e.action.startsWith("staff.")) return "/admin/staff";
  return null;
}
