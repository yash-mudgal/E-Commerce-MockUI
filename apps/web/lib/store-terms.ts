import type { StorefrontStore } from "./types";
import { formatINR } from "./utils";

/** Product listing sort options (shared by the server page and the client sort menu). */
export const LISTING_SORTS = [
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
] as const;

export type TermKey = "shipping" | "cod" | "online" | "invoice";
export type Term = { key: TermKey; title: string; detail: string };

type Terms = Pick<StorefrontStore, "shippingFee" | "freeShippingThreshold" | "codEnabled" | "codMaxOrderValue" | "onlinePayments" | "onlinePaymentsTest" | "gstin">;

/**
 * The store's real shopping terms, worded for shoppers. Everything comes from the store's settings (the same values
 * checkout applies), so the storefront never claims a service the store doesn't offer.
 */
export function storeTerms(s: Terms): Term[] {
  const fee = Number(s.shippingFee);
  const free = s.freeShippingThreshold === null ? null : Number(s.freeShippingThreshold);
  const terms: Term[] = [];
  if (fee === 0 || free === 0) terms.push({ key: "shipping", title: "Free shipping", detail: "On every order" });
  else if (free !== null) terms.push({ key: "shipping", title: `Free shipping over ${formatINR(free)}`, detail: `${formatINR(fee)} on smaller orders` });
  else terms.push({ key: "shipping", title: `Flat ${formatINR(fee)} shipping`, detail: "On every order" });
  if (s.codEnabled) terms.push({ key: "cod", title: "Cash on delivery", detail: `On orders up to ${formatINR(s.codMaxOrderValue)}` });
  if (s.onlinePayments)
    terms.push(s.onlinePaymentsTest
      ? { key: "online", title: "Online payment", detail: "Test mode: no real money is taken" }
      : { key: "online", title: "Secure online payment", detail: "UPI, cards and netbanking" });
  if (s.gstin) terms.push({ key: "invoice", title: "GST invoice", detail: "With every order" });
  return terms;
}

/** One line for the announcement bar: the most useful shipping and payment terms. */
export function announcement(s: Terms): string {
  const [shipping, ...rest] = storeTerms(s);
  const cod = rest.find((t) => t.key === "cod");
  return [shipping.title, cod?.title].filter(Boolean).join(" · ");
}

/**
 * How far a bag is from free shipping. Checkout compares the total after any coupon, so this is a hint based on the
 * bag's subtotal. Null when the store has no threshold or shipping is always free.
 */
export function freeShippingProgress(subtotal: string | number, s: Pick<StorefrontStore, "shippingFee" | "freeShippingThreshold">) {
  const free = s.freeShippingThreshold === null ? null : Number(s.freeShippingThreshold);
  if (free === null || free === 0 || Number(s.shippingFee) === 0) return null;
  const amount = Number(subtotal);
  const remaining = Math.max(0, Math.round((free - amount) * 100) / 100);
  return { remaining, percent: Math.min(100, Math.round((amount / free) * 100)), reached: remaining === 0, threshold: free };
}

const SWATCHES: Record<string, string> = {
  black: "#111111", white: "#ffffff", ivory: "#f6f1e5", cream: "#f3e9d2", natural: "#e8dcc4", beige: "#d9c7a7",
  grey: "#8a8a8a", gray: "#8a8a8a", silver: "#c0c0c0", gold: "#c9a227", mustard: "#d1a21c", yellow: "#f2c94c",
  orange: "#e07a2e", rust: "#b5532a", red: "#c0392b", maroon: "#7a1f2b", wine: "#6d1a36", pink: "#e8a0b4", rose: "#d87a8b",
  purple: "#6d3b8f", lavender: "#b9a3d9", indigo: "#2f3e8f", navy: "#1f2a52", "royal blue": "#2546b0", blue: "#2f6fd1",
  "sky blue": "#8ec5ea", teal: "#1d7a74", green: "#2e7d4f", olive: "#6b7a3a", mint: "#a8dcc5", brown: "#7a5232", tan: "#c19a6b",
  copper: "#b87333", brass: "#b5a642",
};

/** A swatch colour for a colour option value, or null when the name isn't a known colour (shown as text only). */
export function swatchFor(value: string): string | null {
  return SWATCHES[value.trim().toLowerCase()] ?? null;
}

export const isColourOption = (name: string) => /^colou?r$/i.test(name.trim());
