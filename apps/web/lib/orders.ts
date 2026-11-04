import type { Tone } from "@/components/ui/display";
import type { OrderStatus, PaymentStatus } from "./types";

/** Labels and badge tones shared by shopper and admin order screens. */
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  PendingPayment: { label: "Awaiting payment", tone: "warning" },
  Confirmed: { label: "Confirmed", tone: "info" },
  Packed: { label: "Packed", tone: "info" },
  Shipped: { label: "Shipped", tone: "info" },
  Delivered: { label: "Delivered", tone: "success" },
  Cancelled: { label: "Cancelled", tone: "neutral" },
  Expired: { label: "Payment not completed", tone: "neutral" },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  Pending: { label: "Payment pending", tone: "warning" },
  Paid: { label: "Paid", tone: "success" },
  Failed: { label: "Payment failed", tone: "danger" },
  CodDue: { label: "Cash on delivery", tone: "neutral" },
  PartiallyRefunded: { label: "Partly refunded", tone: "warning" },
  Refunded: { label: "Refunded", tone: "neutral" },
  Voided: { label: "Not charged", tone: "neutral" },
};

/** Progress steps shown to shoppers; cancelled and expired orders show their end state instead. */
export const ORDER_STEPS: OrderStatus[] = ["Confirmed", "Packed", "Shipped", "Delivered"];

export function stepIndex(status: OrderStatus): number {
  return ORDER_STEPS.indexOf(status);
}

/** A new idempotency key per checkout attempt (the API returns the same order for a retried key). */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
  "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}

/** Whole number in Indian words (crore, lakh, thousand), e.g. 125000 → "One Lakh Twenty Five Thousand". */
export function numberToIndianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** "₹1,234.50" → "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only" (as printed on GST invoices). */
export function amountInWords(amount: string | number): string {
  const paiseTotal = Math.round(Number(amount) * 100);
  const rupees = Math.floor(paiseTotal / 100), paise = paiseTotal % 100;
  return `Rupees ${numberToIndianWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}
