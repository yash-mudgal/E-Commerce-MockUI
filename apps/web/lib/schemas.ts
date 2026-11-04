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
  businessAddress: z.string().trim().max(500),
  shippingFee: money,
  freeShippingThreshold: z.union([money, z.literal("")]),
  codEnabled: z.boolean(),
  codMaxOrderValue: money.refine((v) => Number(v) >= 1, "Enter at least ₹1"),
});
export type StoreInput = z.input<typeof storeSchema>;

export const shipSchema = z.object({
  carrier: z.string().trim().min(1, "Enter the courier").max(60),
  trackingNumber: z.string().trim().min(1, "Enter the tracking number").max(60),
  trackingUrl: z.union([z.url({ protocol: /^https$/, error: "Use a full https:// link" }).max(500), z.literal("")]),
});
export type ShipInput = z.infer<typeof shipSchema>;

/** Refund amount is capped client-side for feedback; the API enforces the real refundable balance under a row lock. */
export const refundSchema = (max: number) => z.object({
  amount: money.transform(Number).refine((v) => v > 0, "Enter an amount above zero").refine((v) => v <= max, `You can refund up to ₹${max.toFixed(2)}`),
  reason: z.string().trim().min(1, "Enter a reason").max(300),
});
export type RefundInput = z.input<ReturnType<typeof refundSchema>>;
export type RefundOutput = z.output<ReturnType<typeof refundSchema>>;

export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, "Use 3–30 letters, numbers, - or _"),
  kind: z.enum(["percent", "fixed"]),
  value: money.refine((v) => Number(v) > 0, "Enter a value above zero"),
  minSubtotal: z.union([money, z.literal("")]),
  maxDiscount: z.union([money, z.literal("")]),
  startsAt: z.string(),
  endsAt: z.string(),
  usageLimit: z.union([z.string().regex(/^[1-9]\d{0,6}$/, "Enter a whole number"), z.literal("")]),
  perCustomerLimit: z.string().regex(/^([1-9]|[1-9]\d|100)$/, "Enter 1 to 100"),
  isActive: z.boolean(),
}).refine((c) => c.kind !== "percent" || Number(c.value) <= 90, { path: ["value"], message: "Percent discounts go up to 90%" })
  .refine((c) => !c.startsAt || !c.endsAt || c.endsAt > c.startsAt, { path: ["endsAt"], message: "End after the start" });
export type CouponInput = z.input<typeof couponSchema>;

export const razorpayKeysSchema = z.object({
  keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]{8,30}$/, "Key IDs look like rzp_live_… or rzp_test_…"),
  keySecret: z.string().trim().min(16, "Paste the full key secret").max(64),
  webhookSecret: z.string().trim().min(8, "Use at least 8 characters").max(128),
});
export type RazorpayKeysInput = z.infer<typeof razorpayKeysSchema>;

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

export const shopperSignupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.email("Enter a valid email address"),
  password: passwordRule,
  marketingOptIn: z.boolean(),
});
export type ShopperSignupInput = z.infer<typeof shopperSignupSchema>;

const mobile = z.string().trim().transform((v) => v.replace(/[\s-]/g, "")).pipe(z.string().regex(/^(?:\+91|0)?[6-9]\d{9}$/, "Enter a 10-digit mobile number"));

export const addressSchema = z.object({
  name: z.string().trim().min(1, "Enter the recipient's name").max(120),
  phone: mobile,
  line1: z.string().trim().min(1, "Enter the house, building and street").max(200),
  line2: z.string().trim().max(200),
  city: z.string().trim().min(1, "Enter the city").max(100),
  stateCode: z.string().regex(/^\d{2}$/, "Choose a state"),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a 6-digit PIN code"),
  isDefault: z.boolean(),
});
export type AddressInput = z.input<typeof addressSchema>;
export type AddressOutput = z.output<typeof addressSchema>;

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  phone: z.union([mobile, z.literal("")]),
  marketingOptIn: z.boolean(),
});
export type ProfileInput = z.input<typeof profileSchema>;

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/admin"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
