"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { cartKey, useCart, useShopper } from "@/lib/shop";
import { freeShippingProgress } from "@/lib/store-terms";
import type { Cart, CartLine } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";
import { Sheet } from "./sheet";
import { useStoreUI } from "./store-ui";

/** Mini cart: opens from the header and after adding an item. The full cart page stays the no-JavaScript path. */
export function CartDrawer() {
  const { cartOpen, setCartOpen, terms } = useStoreUI();
  const cart = useCart();
  const shopper = useShopper();
  const c = cart.data;
  const close = () => setCartOpen(false);
  const progress = c && terms ? freeShippingProgress(c.subtotal, terms) : null;

  return (
    <Sheet
      open={cartOpen}
      onOpenChange={setCartOpen}
      title={c && c.itemCount > 0 ? `Your cart (${c.itemCount})` : "Your cart"}
      description="Items in your cart"
      footer={c && c.lines.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-fg-muted">Subtotal</span>
            <span className="tabular text-lg font-semibold">{formatINR(c.subtotal)}</span>
          </div>
          <p className="text-xs text-fg-muted">Prices include GST. Shipping and coupons are applied at checkout.</p>
          <Button asChild size="lg" className="w-full">
            <Link href={shopper.data ? "/checkout" : "/account/login?next=/checkout"} onClick={close}>{shopper.data ? "Check out" : "Sign in to check out"}</Link>
          </Button>
          <Button asChild variant="secondary" size="lg" className="w-full"><Link href="/cart" onClick={close}>View cart</Link></Button>
        </div>
      ) : undefined}
    >
      {cart.isPending ? (
        <div className="space-y-4 p-5">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded bg-surface-muted" />)}</div>
      ) : !c || c.lines.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <ShoppingBag className="size-10 text-fg-subtle" aria-hidden />
          <p className="mt-4 font-display text-xl">Your cart is empty</p>
          <p className="mt-1 text-sm text-fg-muted">Find something you love.</p>
          <Button asChild className="mt-6"><Link href="/products" onClick={close}>Shop all products</Link></Button>
        </div>
      ) : (
        <>
          {progress && (
            <div className="border-b border-border px-5 py-4" role="status">
              <p className="text-sm">
                {progress.reached ? <>You&apos;ve unlocked <strong>free shipping</strong>.</> : <>Add <strong className="tabular">{formatINR(progress.remaining)}</strong> more for free shipping.</>}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
          <ul className="divide-y divide-border px-5">
            {c.lines.map((l) => <DrawerLine key={l.id} line={l} onNavigate={close} />)}
          </ul>
        </>
      )}
    </Sheet>
  );
}

function DrawerLine({ line, onNavigate }: { line: CartLine; onNavigate: () => void }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (quantity: number) =>
      quantity === 0 ? api<Cart>(`/storefront/cart/lines/${line.id}`, { method: "DELETE" }) : api<Cart>(`/storefront/cart/lines/${line.id}`, { method: "PATCH", body: { quantity } }),
    onSuccess: (cart) => qc.setQueryData(cartKey, cart),
  });
  const buyable = line.status === "ok" || line.status === "limited";
  return (
    <li className="flex gap-4 py-4">
      <Link href={`/products/${line.productSlug}`} onClick={onNavigate} className="relative h-24 w-20 shrink-0 overflow-hidden rounded-[var(--radius-card)] bg-surface-muted">
        {line.imageUrl ? <Image src={line.imageUrl} alt="" fill sizes="80px" className="object-cover" /> : <span className="grid size-full place-items-center font-display text-xl text-fg-subtle" aria-hidden>{line.productTitle[0]}</span>}
        <span className="sr-only">{line.productTitle}</span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-3">
          <Link href={`/products/${line.productSlug}`} onClick={onNavigate} className="line-clamp-2 text-sm font-medium hover:underline">{line.productTitle}</Link>
          <span className={cn("tabular shrink-0 text-sm font-semibold", !buyable && "text-fg-subtle")}>{formatINR(line.lineTotal)}</span>
        </div>
        {line.optionValues.length > 0 && <p className="mt-0.5 text-xs text-fg-muted">{line.optionValues.join(" · ")}</p>}
        {line.message && <p className={cn("mt-1 text-xs", line.status === "limited" ? "text-warning" : "text-danger")}>{line.message}</p>}
        <div className="mt-2 flex items-center gap-2">
          {buyable && (
            <div className="flex h-8 items-center rounded-[var(--radius-control)] border border-border-strong" role="group" aria-label={`Quantity of ${line.productTitle}`}>
              <button type="button" className="grid size-8 place-items-center text-fg-muted hover:text-fg disabled:opacity-40" aria-label="Decrease quantity"
                disabled={update.isPending || line.quantity <= 1} onClick={() => update.mutate(line.quantity - 1)}><Minus className="size-3.5" /></button>
              <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
              <button type="button" className="grid size-8 place-items-center text-fg-muted hover:text-fg disabled:opacity-40" aria-label="Increase quantity"
                disabled={update.isPending || line.quantity >= line.maxQuantity} onClick={() => update.mutate(line.quantity + 1)}><Plus className="size-3.5" /></button>
            </div>
          )}
          <button type="button" onClick={() => update.mutate(0)} disabled={update.isPending}
            className="inline-flex h-8 items-center gap-1 rounded px-2 text-xs text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40">
            <Trash2 className="size-3.5" aria-hidden />Remove<span className="sr-only"> {line.productTitle}</span>
          </button>
        </div>
        {update.isError && <p className="mt-1 text-xs text-danger" role="alert">{errorMessage(update.error)}</p>}
      </div>
    </li>
  );
}
