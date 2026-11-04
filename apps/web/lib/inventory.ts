import { z } from "zod";
import type { AdjustmentReason } from "./types";

/** Reasons a person can record (InventoryRules.ParseManualReason in the API), with the direction each allows. */
export const ADJUSTMENT_REASONS: { value: AdjustmentReason; label: string; direction: "in" | "out" | "any" }[] = [
  { value: "receipt", label: "Received from supplier", direction: "in" },
  { value: "return", label: "Customer return", direction: "in" },
  { value: "correction", label: "Stock count correction", direction: "any" },
  { value: "damaged", label: "Damaged", direction: "out" },
  { value: "lost", label: "Lost or stolen", direction: "out" },
];

const MOVEMENT_LABELS: Record<string, string> = {
  Initial: "Opening stock",
  Adjustment: "Edited on product page",
  Sale: "Sold",
  Return: "Customer return",
  Receipt: "Received",
  Correction: "Count correction",
  Damaged: "Damaged",
  Lost: "Lost or stolen",
  TransferOut: "Moved out",
  TransferIn: "Moved in",
};

export const movementLabel = (reason: string) => MOVEMENT_LABELS[reason] ?? reason;

/**
 * The change an adjustment makes. In "change" mode the quantity is added (receipts, returns), removed (damage,
 * loss) or used as typed with its sign (corrections). In "count" mode it is the counted total.
 */
export function adjustmentDelta(mode: "change" | "count", reason: AdjustmentReason, quantity: number, current: number): number {
  if (mode === "count") return quantity - current;
  const dir = ADJUSTMENT_REASONS.find((r) => r.value === reason)!.direction;
  return dir === "out" ? -Math.abs(quantity) : dir === "in" ? Math.abs(quantity) : quantity;
}

export const adjustmentSchema = z
  .object({
    locationId: z.string().min(1, "Choose a location"),
    reason: z.enum(["receipt", "return", "correction", "damaged", "lost"]),
    mode: z.enum(["change", "count"]),
    quantity: z.string().trim().regex(/^-?\d{1,7}$/, "Enter a whole number"),
    note: z.string().max(500),
  })
  .superRefine((v, ctx) => {
    const n = Number(v.quantity);
    if (v.mode === "count" && n < 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "A count can't be negative" });
    if (v.mode === "change" && n === 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter a quantity other than 0" });
    if (v.mode === "change" && v.reason !== "correction" && n < 0)
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter how many units, without a minus sign" });
  });
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const locationSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  code: z.string().trim().min(1, "Enter a short code").max(16).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
  stateCode: z.union([z.string().regex(/^\d{2}$/, "Use the 2-digit GST state code, e.g. 27"), z.literal("")]),
  isDefault: z.boolean(),
});
export type LocationInput = z.infer<typeof locationSchema>;
