import { z } from "zod";

/**
 * Client-side schemas give instant feedback on format. The API re-validates everything and stays
 * authoritative; its field errors are mapped back onto these forms (see ApiError.fieldErrors).
 */
const money = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter an amount like 1299 or 1299.50");

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Mirrors the API's password rule (PasswordRules.StrongPassword). */
export const passwordRule = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters")
  .refine((p) => new Set(p).size >= 4, "Choose a less predictable password");

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.email("Enter a valid email address"),
  password: passwordRule,
  storeName: z.string().trim().min(2, "Store name must be at least 2 characters").max(80),
  subdomain: z
    .string()
    .trim()
    .min(3, "At least 3 characters")
    .max(30, "At most 30 characters")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and single hyphens only"),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const GST_RATES = ["0", "0.25", "3", "5", "12", "18", "28"] as const;

export const variantSchema = z
  .object({
    id: z.string().optional(),
    sku: z.string().trim().min(1, "Required").max(64).regex(/^[A-Za-z0-9._/-]+$/, "Letters, numbers and . _ / - only"),
    optionValues: z.array(z.string().trim().min(1, "Required").max(40)),
    price: money.refine((v) => Number(v) > 0, "Must be more than 0"),
    mrp: money,
    cost: z.union([money, z.literal("")]),
    stockOnHand: z.coerce.number<string>().int("Whole units only").min(0, "Can't be negative").max(1_000_000),
    isActive: z.boolean(),
  })
  .refine((v) => Number(v.mrp) >= Number(v.price), { path: ["mrp"], message: "MRP must be at least the price" });

export const productSchema = z.object({
  title: z.string().trim().min(1, "Give the product a title").max(200),
  description: z.string().max(10_000),
  categoryId: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  hsnCode: z.union([z.string().regex(/^\d{4}(\d{2}){0,2}$/, "4, 6 or 8 digits"), z.literal("")]),
  gstRate: z.enum(GST_RATES),
  optionNames: z.array(z.string().trim().min(1, "Name the option").max(30)).max(3),
  tags: z.string(),
  variants: z.array(variantSchema).min(1, "Add at least one variant").max(100),
});
export type ProductInput = z.input<typeof productSchema>;
export type ProductOutput = z.output<typeof productSchema>;

export const storeSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  legalName: z.string().max(160),
  gstin: z.union([z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN"), z.literal("")]),
  tagline: z.string().max(200),
  supportEmail: z.union([z.email("Enter a valid email"), z.literal("")]),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #4f46e5"),
  lowStockThreshold: z.coerce.number<string>().int().min(0).max(10_000),
});
export type StoreInput = z.input<typeof storeSchema>;

export const forgotSchema = z.object({ email: z.email("Enter a valid email address") });
export type ForgotInput = z.infer<typeof forgotSchema>;

const newPasswordPair = z
  .object({ password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export const resetSchema = newPasswordPair;
export type ResetInput = z.infer<typeof resetSchema>;

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: passwordRule, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Choose a password you haven't used for this account" });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const inviteSchema = z.object({
  email: z.email("Enter a valid email address"),
  role: z.enum(["Staff", "Manager"]),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z
  .object({ name: z.string().trim().min(1, "Enter your name").max(120), password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/admin"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
