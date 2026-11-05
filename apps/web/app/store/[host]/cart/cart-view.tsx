"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/display";
import { api, errorMessage } from "@/lib/api";
import { cartKey, useCart, useShopper } from "@/lib/shop";
import { freeShippingProgress } from "@/lib/store-terms";
import { useStoreUI } from "@/components/store/store-ui";
import type { Cart, CartLine } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";

export function CartView() {
  const cart = useCart();
  const shopper = useShopper();
  const { terms } = useStoreUI();

  if (cart.isPending) return <div className="mt-6 space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;
  if (cart.isError) return <Alert tone="danger" className="mt-6" title="Couldn't load your cart">{errorMessage(cart.error)}</Alert>;
  const c = cart.data;
  if (c.lines.length === 0)
    return (
      <div className="mt-10 flex flex-col items-center py-12 text-center">
        <ShoppingBag className="size-10 text-fg-subtle" aria-hidden />
        <p className="mt-4 font-display text-2xl">Your cart is empty</p>
        <p className="mt-1 text-sm text-fg-muted">{shopper.data ? "Items you add on any device appear here." : "Sign in to see items you saved on another device."}</p>
        <div className="mt-6 flex gap-3">
          <Button asChild><Link href="/products">Browse products</Link></Button>
          {!shopper.data && <Button asChild variant="secondary"><Link href="/account/login?next=/cart">Sign in</Link></Button>}
        </div>
      </div>
    );

  const progress = terms ? freeShippingProgress(c.subtotal, terms) : null;
  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_24rem]">
      <section aria-label="Items">
        {c.hasIssues && <Alert tone="warning" className="mb-4">Some items changed since you added them. Review the notes below.</Alert>}
        <ul className="divide-y divide-border border-y border-border">
          {c.lines.map((l) => <Line key={l.id} line={l} />)}
        </ul>
        {!shopper.data && (
          <p className="mt-4 text-sm text-fg-muted">
            <Link href="/account/login?next=/cart" className="font-medium text-fg underline underline-offset-2">Sign in</Link> to keep your cart on all your devices.
          </p>
        )}
      </section>
      <aside className="h-fit rounded-[var(--radius-card)] border border-border bg-surface p-6 lg:sticky lg:top-28" aria-label="Order summary">
        <h2 className="font-display text-2xl">Summary</h2>
        {progress && (
          <div className="mt-4 rounded-[var(--radius-control)] bg-surface-muted p-3" role="status">
            <p className="text-sm">{progress.reached ? <>Your order qualifies for <strong>free shipping</strong>.</> : <>Add <strong className="tabular">{formatINR(progress.remaining)}</strong> more for free shipping.</>}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden><div className="h-full rounded-full bg-brand" style={{ width: `${progress.percent}%` }} /></div>
            <p className="mt-2 text-xs text-fg-muted">Checked at checkout on the total after any coupon.</p>
          </div>
        )}
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-fg-muted">Items ({c.itemCount})</dt><dd className="tabular">{formatINR(c.subtotal)}</dd></div>
          {Number(c.savings) > 0 && <div className="flex justify-between text-success"><dt>You save</dt><dd className="tabular">{formatINR(c.savings)}</dd></div>}
          <div className="flex justify-between border-t border-border pt-3 text-base font-semibold"><dt>Subtotal</dt><dd className="tabular">{formatINR(c.subtotal)}</dd></div>
        </dl>
        <p className="mt-1 text-xs text-fg-muted">Prices include GST. Shipping is added at checkout.</p>
        {shopper.data ? (
          <Button asChild size="lg" className="mt-5 w-full"><Link href="/checkout">Check out</Link></Button>
        ) : (
          <>
            <Button asChild size="lg" className="mt-5 w-full"><Link href="/account/login?next=/checkout">Sign in to check out</Link></Button>
            <p className="mt-2 text-center text-xs text-fg-muted">New here? <Link href="/account/signup?next=/checkout" className="font-medium text-fg underline underline-offset-2">Create an account</Link> in a minute.</p>
          </>
        )}
      </aside>
    </div>
  );
}

function Line({ line }: { line: CartLine }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (quantity: number) =>
      quantity === 0 ? api<Cart>(`/storefront/cart/lines/${line.id}`, { method: "DELETE" }) : api<Cart>(`/storefront/cart/lines/${line.id}`, { method: "PATCH", body: { quantity } }),
    onSuccess: (cart) => qc.setQueryData(cartKey, cart),
  });
  const buyable = line.status === "ok" || line.status === "limited";
  const label = `${line.productTitle}${line.optionValues.length ? ` (${line.optionValues.join(" / ")})` : ""}`;
  return (
    <li className="flex gap-5 py-6">
      <Link href={`/products/${line.productSlug}`} className="relative h-28 w-[5.5rem] shrink-0 overflow-hidden rounded-[var(--radius-card)] bg-surface-muted sm:h-32 sm:w-24">
        {line.imageUrl ? <Image src={line.imageUrl} alt="" fill sizes="96px" className="object-cover" /> : <span className="grid size-full place-items-center font-display text-2xl text-fg-subtle" aria-hidden>{line.productTitle[0]}</span>}
        <span className="sr-only">{line.productTitle}</span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/products/${line.productSlug}`} className="font-medium hover:underline">{line.productTitle}</Link>
            {line.optionValues.length > 0 && (
              <p className="text-sm text-fg-muted">{line.optionNames.map((n, i) => `${n}: ${line.optionValues[i]}`).join(" · ")}</p>
            )}
            <p className="tabular mt-0.5 text-sm text-fg-muted">
              {formatINR(line.unitPrice)} each
              {Number(line.mrp) > Number(line.unitPrice) && <span className="ml-2 text-fg-subtle line-through">{formatINR(line.mrp)}</span>}
            </p>
          </div>
          <p className={cn("tabular shrink-0 font-semibold", !buyable && "text-fg-subtle")}>{formatINR(line.lineTotal)}</p>
        </div>
        {line.message && <p className={cn("mt-1 text-sm", line.status === "limited" ? "text-warning" : "text-danger")}>{line.message}</p>}
        <div className="mt-3 flex items-center gap-3">
          {buyable && (
            <div className="flex h-9 items-center rounded-md border border-border-strong" role="group" aria-label={`Quantity of ${label}`}>
              <button type="button" className="grid size-9 place-items-center text-fg-muted hover:text-fg disabled:opacity-40" aria-label="Decrease quantity"
                disabled={update.isPending || line.quantity <= 1} onClick={() => update.mutate(line.quantity - 1)}><Minus className="size-4" /></button>
              <span className="w-7 text-center text-sm font-medium tabular-nums">{line.quantity}</span>
              <button type="button" className="grid size-9 place-items-center text-fg-muted hover:text-fg disabled:opacity-40" aria-label="Increase quantity"
                disabled={update.isPending || line.quantity >= line.maxQuantity} onClick={() => update.mutate(line.quantity + 1)}><Plus className="size-4" /></button>
            </div>
          )}
          {line.status === "limited" && (
            <Button variant="secondary" size="sm" loading={update.isPending} onClick={() => update.mutate(line.maxQuantity)}>Update to {line.maxQuantity}</Button>
          )}
          <Button variant="ghost" size="sm" loading={update.isPending && update.variables === 0} onClick={() => update.mutate(0)}>
            <Trash2 />Remove<span className="sr-only"> {label}</span>
          </Button>
        </div>
        {update.isError && <p className="mt-2 text-sm text-danger" role="alert">{errorMessage(update.error)}</p>}
      </div>
    </li>
  );
}
