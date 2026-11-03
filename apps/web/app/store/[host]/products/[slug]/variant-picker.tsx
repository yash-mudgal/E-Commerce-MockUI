"use client";

import { Info } from "lucide-react";
import * as React from "react";
import type { StorefrontProduct } from "@/lib/types";
import { cn, discountPercent, formatINR } from "@/lib/utils";

/**
 * Option selection for a product. Values that no available variant offers are shown struck through.
 * Ordering is not built yet (Phase 7/8), so there is deliberately no add-to-cart button. Shoppers see an
 * honest notice instead.
 */
export function VariantPicker({ product, supportEmail }: { product: StorefrontProduct; supportEmail: string | null }) {
  const first = product.variants.find((v) => v.available) ?? product.variants[0];
  const [selected, setSelected] = React.useState<string[]>(first?.optionValues ?? []);
  const variant = product.variants.find((v) => v.optionValues.every((val, i) => val === selected[i])) ?? null;

  const valuesFor = (axis: number) => Array.from(new Set(product.variants.map((v) => v.optionValues[axis])));
  const isOffered = (axis: number, value: string) =>
    product.variants.some((v) => v.available && v.optionValues[axis] === value && v.optionValues.every((val, i) => i === axis || val === selected[i]));

  const price = variant?.price ?? first?.price;
  const mrp = variant?.mrp ?? first?.mrp;
  const off = price && mrp ? discountPercent(price, mrp) : 0;

  return (
    <div>
      <p className="tabular mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold">{formatINR(price)}</span>
        {off > 0 && (
          <>
            <span className="text-fg-subtle line-through">MRP {formatINR(mrp)}</span>
            <span className="text-sm font-medium text-success">{off}% off</span>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-fg-muted">Inclusive of all taxes</p>

      {product.optionNames.map((name, axis) => (
        <fieldset key={name} className="mt-6">
          <legend className="text-sm font-medium">
            {name}: <span className="font-normal text-fg-muted">{selected[axis]}</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {valuesFor(axis).map((value) => {
              const active = selected[axis] === value;
              const offered = isOffered(axis, value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelected((s) => s.map((v, i) => (i === axis ? value : v)))}
                  className={cn(
                    "min-w-11 rounded-[var(--radius-control)] border px-3 py-2 text-sm transition-colors",
                    active ? "border-fg bg-fg text-surface" : "border-border-strong hover:border-fg",
                    !offered && !active && "text-fg-subtle line-through",
                  )}
                >
                  {value}
                  {!offered && <span className="sr-only"> (unavailable)</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <p className={cn("mt-6 text-sm font-medium", !variant || !variant.available ? "text-danger" : variant.lowStock ? "text-warning" : "text-success")} role="status">
        {!variant ? "This combination isn't available" : !variant.available ? "Out of stock" : variant.lowStock ? "Only a few left" : "In stock"}
      </p>

      <div className="mt-6 flex gap-3 rounded-[var(--radius-card)] border border-border bg-bg p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
        <p className="text-fg-muted">
          Online ordering for this store is opening soon.
          {supportEmail && (
            <> To order now, email <a className="font-medium text-fg underline underline-offset-2" href={`mailto:${supportEmail}?subject=${encodeURIComponent(`Order: ${product.title}${selected.length ? ` (${selected.join(" / ")})` : ""}`)}`}>{supportEmail}</a>.</>
          )}
        </p>
      </div>
    </div>
  );
}
