import Link from "next/link";
import { NewsletterSignup } from "./newsletter-signup";
import type { StorefrontCategory, StorefrontStore } from "@/lib/types";

/** Storefront footer. Every link goes to a page that exists; contact details come from the store's settings. */
export function StoreFooter({ store, categories, pages }: { store: StorefrontStore; categories: StorefrontCategory[]; pages: { slug: string; title: string }[] }) {
  const pay = [store.onlinePayments && (store.onlinePaymentsTest ? "Online payment (test mode)" : "UPI, cards and netbanking"), store.codEnabled && "Cash on delivery"].filter(Boolean) as string[];
  return (
    <footer className="mt-24 border-t border-border bg-surface-muted print:hidden">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <p className="font-display text-2xl">{store.name}</p>
          {store.tagline && <p className="mt-2 max-w-sm text-sm text-fg-muted">{store.tagline}</p>}
          {store.isLive && <div className="mt-8"><NewsletterSignup storeName={store.name} /></div>}
          {store.supportEmail && (
            <p className="mt-5 text-sm">
              <span className="text-fg-muted">Questions? Write to </span>
              <a className="font-medium underline underline-offset-4 hover:text-brand" href={`mailto:${store.supportEmail}`}>{store.supportEmail}</a>
            </p>
          )}
        </div>
        {store.isLive && categories.length > 0 && (
          <nav aria-labelledby="footer-shop">
            <h2 id="footer-shop" className="text-xs font-semibold tracking-[0.14em] text-fg uppercase">Shop</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-fg-muted">
              <li><Link href="/products" className="hover:text-fg">All products</Link></li>
              {categories.slice(0, 6).map((c) => <li key={c.slug}><Link href={`/products?category=${c.slug}`} className="hover:text-fg">{c.name}</Link></li>)}
            </ul>
          </nav>
        )}
        {store.isLive && pages.length > 0 && (
          <nav aria-labelledby="footer-info">
            <h2 id="footer-info" className="text-xs font-semibold tracking-[0.14em] text-fg uppercase">Help and information</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-fg-muted">
              {pages.map((p) => <li key={p.slug}><Link href={`/pages/${p.slug}`} className="hover:text-fg">{p.title}</Link></li>)}
            </ul>
          </nav>
        )}
        {store.isLive && (
          <nav aria-labelledby="footer-help">
            <h2 id="footer-help" className="text-xs font-semibold tracking-[0.14em] text-fg uppercase">Your account</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-fg-muted">
              <li><Link href="/account" className="hover:text-fg">My account</Link></li>
              <li><Link href="/account/orders" className="hover:text-fg">Your orders</Link></li>
              <li><Link href="/cart" className="hover:text-fg">Cart</Link></li>
              {store.supportEmail && <li><a href={`mailto:${store.supportEmail}`} className="hover:text-fg">Contact us</a></li>}
            </ul>
          </nav>
        )}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-fg-muted sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            {store.legalName && <p>{store.legalName}{store.gstin && ` · GSTIN ${store.gstin}`}</p>}
            {store.businessAddress && <p>{store.businessAddress}</p>}
          </div>
          <div className="flex flex-col gap-1 md:items-end">
            {store.isLive && pay.length > 0 && <p>We accept: {pay.join(" · ")}</p>}
            <p>Powered by ShopMint</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
