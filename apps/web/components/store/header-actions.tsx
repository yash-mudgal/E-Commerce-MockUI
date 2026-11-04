"use client";

import { ShoppingBag, User } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useCart, useShopper } from "@/lib/shop";

const noop = () => () => {};

/** Account and cart links in the storefront header. Counts come from the server-side cart. */
export function HeaderActions() {
  const cart = useCart();
  const shopper = useShopper();
  // The header hydrates after the page (it streams in its own Suspense boundary), by which time the page may already
  // have loaded the cart. Render the server's view during hydration, then the live data.
  const hydrated = React.useSyncExternalStore(noop, () => true, () => false);
  const count = hydrated ? (cart.data?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0) : 0;
  const signedIn = hydrated ? shopper.data : null;
  return (
    <div className="flex items-center gap-1">
      <Link href={signedIn ? "/account" : "/account/login"} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-muted hover:bg-surface-muted hover:text-fg">
        <User className="size-5" aria-hidden />
        <span className="hidden md:inline">{signedIn ? signedIn.name.split(" ")[0] : "Sign in"}</span>
        <span className="sr-only md:hidden">{signedIn ? "Your account" : "Sign in"}</span>
      </Link>
      <Link href="/cart" className="relative inline-flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg" aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}>
        <ShoppingBag className="size-5" aria-hidden />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] leading-5 font-semibold text-brand-fg tabular-nums" aria-hidden>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </div>
  );
}
