import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN");
const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Money arrives from the API as decimal strings ("1299.00"). Whole rupees render without paise. */
export function formatINR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? inr0.format(n) : inr2.format(n);
}

export function formatNumber(n: number): string {
  return num.format(n);
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? date.format(new Date(iso)) : "—";
}

/** Percentage off MRP, rounded down so we never overstate a discount. */
export function discountPercent(price: string | number, mrp: string | number): number {
  const p = Number(price);
  const m = Number(mrp);
  if (!(m > 0) || !(p < m)) return 0;
  return Math.floor(((m - p) / m) * 100);
}

/** Lowercase, hyphenated, ASCII slug (mirrors the API's Slug.From for previews only; the server is authoritative). */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
