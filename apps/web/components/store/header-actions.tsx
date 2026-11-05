"use client";

import { Heart, Menu, Search, ShoppingBag, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useCart, useShopper } from "@/lib/shop";
import { Sheet } from "./sheet";
import { useStoreUI } from "./store-ui";

const noop = () => () => {};
/** Closes a panel when the page (or its query) changes: state is adjusted during render, as React recommends. */
function useCloseOnChange(key: string, open: boolean, setOpen: (open: boolean) => void) {
  const [seen, setSeen] = React.useState(key);
  if (seen !== key) {
    setSeen(key);
    if (open) setOpen(false);
  }
}

/** The header hydrates after the page; render the server's view during hydration, then live data. */
const useHydrated = () => React.useSyncExternalStore(noop, () => true, () => false);

/** Account and cart in the storefront header. The cart opens the mini cart; without JavaScript it is a link to /cart. */
export function HeaderActions() {
  const cart = useCart();
  const shopper = useShopper();
  const { setCartOpen } = useStoreUI();
  const hydrated = useHydrated();
  const count = hydrated ? (cart.data?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0) : 0;
  const signedIn = hydrated ? shopper.data : null;
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link href={signedIn ? "/account" : "/account/login"} className="inline-flex h-10 items-center gap-1.5 rounded-full px-2.5 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg">
        <User className="size-5" aria-hidden />
        <span className="hidden lg:inline">{signedIn ? signedIn.name.split(" ")[0] : "Sign in"}</span>
        <span className="sr-only lg:hidden">{signedIn ? "Your account" : "Sign in"}</span>
      </Link>
      {signedIn && (
        <Link href="/account/wishlist" className="hidden size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg sm:inline-flex" aria-label="Wishlist">
          <Heart className="size-5" aria-hidden />
        </Link>
      )}
      <Link
        href="/cart"
        onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); setCartOpen(true); }}
        className="relative inline-flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg"
        aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}
      >
        <ShoppingBag className="size-5" aria-hidden />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 grid min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[10px] leading-[18px] font-semibold text-brand-fg tabular-nums" aria-hidden>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </div>
  );
}

/** Search: an icon that expands a full-width search row under the header. Submits a plain GET to /products. */
export function SearchToggle() {
  const [open, setOpen] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  useCloseOnChange(usePathname(), open, setOpen);
  React.useEffect(() => { if (open) input.current?.focus(); }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="store-search"
        className="inline-flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg" aria-label={open ? "Close search" : "Search"}>
        {open ? <X className="size-5" /> : <Search className="size-5" />}
      </button>
      {open && (
        <div id="store-search" className="absolute inset-x-0 top-full border-b border-border bg-surface shadow-sm">
          <form action="/products" role="search" className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6"
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
            <Search className="size-5 shrink-0 text-fg-subtle" aria-hidden />
            <input ref={input} name="q" type="search" placeholder="Search for products" aria-label="Search products" maxLength={100}
              className="h-11 flex-1 bg-transparent font-display text-xl placeholder:text-fg-subtle focus:outline-none" />
            <button type="submit" className="h-10 rounded-[var(--radius-control)] bg-fg px-4 text-sm font-medium text-surface hover:bg-fg/90">Search</button>
          </form>
        </div>
      )}
    </>
  );
}

/** Mobile navigation: categories and account links in a panel from the left. */
export function MobileMenu({ storeName, links }: { storeName: string; links: { href: string; label: string }[] }) {
  const [open, setOpen] = React.useState(false);
  useCloseOnChange(usePathname(), open, setOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg lg:hidden" aria-label="Menu">
        <Menu className="size-5" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} side="left" title={storeName} description="Shop by category">
        <nav aria-label="Shop" className="px-5 py-4">
          <ul className="divide-y divide-border">
            {links.map((l) => (
              <li key={l.href}><Link href={l.href} onClick={() => setOpen(false)} className="block py-3.5 font-display text-lg hover:text-brand">{l.label}</Link></li>
            ))}
          </ul>
          <ul className="mt-6 space-y-3 text-sm text-fg-muted">
            <li><Link href="/account" onClick={() => setOpen(false)} className="hover:text-fg">Your account</Link></li>
            <li><Link href="/account/orders" onClick={() => setOpen(false)} className="hover:text-fg">Your orders</Link></li>
            <li><Link href="/account/wishlist" onClick={() => setOpen(false)} className="hover:text-fg">Wishlist</Link></li>
            <li><Link href="/cart" onClick={() => setOpen(false)} className="hover:text-fg">Cart</Link></li>
          </ul>
        </nav>
      </Sheet>
    </>
  );
}
