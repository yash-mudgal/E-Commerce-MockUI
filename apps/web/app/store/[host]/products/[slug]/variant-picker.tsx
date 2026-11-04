"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { cartKey } from "@/lib/shop";
import type { Cart, StorefrontProduct } from "@/lib/types";
import { cn, discountPercent, formatINR } from "@/lib/utils";

const MAX_PER_ITEM = 10;

/**
 * Option selection and add to cart. Values that no available variant offers are struck through. The cart lives on
 * the server: the API checks stock and uses its own prices, so the price shown here is never sent.
 */
export function VariantPicker({ product }: { product: StorefrontProduct }) {
  const first = product.variants.find((v) => v.available) ?? product.variants[0];
  const [selected, setSelected] = React.useState<string[]>(first?.optionValues ?? []);
  const variant = product.variants.find((v) => v.optionValues.every((val, i) => val === selected[i])) ?? null;

  const valuesFor = (axis: number) => Array.from(new Set(product.variants.map((v) => v.optionValues[axis])));
  const isOffered = (axis: number, value: string) =>
    product.variants.some((v) => v.available && v.optionValues[axis] === value && v.optionValues.every((val, i) => i === axis || val === selected[i]));

  const qc = useQueryClient();
  const [quantity, setQuantity] = React.useState(1);
  const add = useMutation({
    mutationFn: () => api<Cart>("/storefront/cart/lines", { method: "POST", body: { variantId: variant!.id, quantity } }),
    onSuccess: (cart) => qc.setQueryData(cartKey, cart),
  });
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
                  onClick={() => { add.reset(); setSelected((s) => s.map((v, i) => (i === axis ? value : v))); }}
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

      {variant?.available && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="flex h-11 items-center rounded-[var(--radius-control)] border border-border-strong" role="group" aria-label="Quantity">
            <button type="button" className="grid size-11 place-items-center text-fg-muted hover:text-fg disabled:opacity-40" aria-label="Decrease quantity"
              disabled={quantity <= 1} onClick={() => { add.reset(); setQuantity((q) => q - 1); }}><Minus className="size-4" /></button>
            <span className="w-8 text-center text-sm font-medium tabular-nums" aria-live="polite">{quantity}</span>
            <button type="button" className="grid size-11 place-items-center text-fg-muted hover:text-fg disabled:opacity-40" aria-label="Increase quantity"
              disabled={quantity >= MAX_PER_ITEM} onClick={() => { add.reset(); setQuantity((q) => q + 1); }}><Plus className="size-4" /></button>
          </div>
          <Button size="lg" className="h-11 flex-1 sm:flex-none sm:px-8" loading={add.isPending} onClick={() => add.mutate()}>
            <ShoppingBag />Add to cart
          </Button>
        </div>
      )}
      {add.isSuccess && (
        <p className="mt-3 flex items-center gap-2 text-sm text-success" role="status">
          <Check className="size-4" aria-hidden />Added to your cart.
          <Link href="/cart" className="font-medium text-fg underline underline-offset-2">View cart</Link>
        </p>
      )}
      {add.isError && <p className="mt-3 text-sm text-danger" role="alert">{errorMessage(add.error)}</p>}
    </div>
  );
}
