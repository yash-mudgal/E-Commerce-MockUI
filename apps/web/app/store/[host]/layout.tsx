import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { CartDrawer } from "@/components/store/cart-drawer";
import { StoreFooter } from "@/components/store/footer";
import { HeaderActions, MobileMenu, SearchToggle } from "@/components/store/header-actions";
import { StoreUIProvider } from "@/components/store/store-ui";
import { getCategories, getProducts, getStore, safeBrandColor, storeOrigin } from "@/lib/storefront";
import { announcement } from "@/lib/store-terms";

type Params = Promise<{ host: string }>;

/** Store-branded titles (not "· ShopMint"); unpublished stores are kept out of search engines. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { host } = await params;
  const store = await getStore(host);
  if (!store) return { title: "Store not found", robots: { index: false } };
  return {
    metadataBase: new URL(storeOrigin(host)),
    title: { default: store.name, template: `%s · ${store.name}` },
    description: store.tagline ?? `Shop ${store.name} online.`,
    openGraph: { siteName: store.name, type: "website" },
    robots: store.isLive ? undefined : { index: false, follow: false },
  };
}

export default function StoreLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  return (
    <Providers>
      <div className="storefront flex min-h-dvh flex-col bg-bg text-fg">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
        <Suspense fallback={<div className="h-[105px] border-b border-border" />}>
          <StoreChrome params={params}>{children}</StoreChrome>
        </Suspense>
      </div>
    </Providers>
  );
}

/** Header, page and footer share the store's terms (for the mini cart's free-shipping hint). */
async function StoreChrome({ params, children }: { params: Params; children: React.ReactNode }) {
  const { host } = await params;
  const [store, categories] = await Promise.all([getStore(host), getCategories(host)]);
  if (!store) notFound();
  const brand = safeBrandColor(store.brandColor);
  const shown = categories.filter((c) => c.productCount > 0);
  const sale = store.isLive ? await getProducts(host, "onSale=true&page=1&pageSize=1") : null;
  const links = [
    { href: "/products", label: "Shop all" },
    ...shown.slice(0, 5).map((c) => ({ href: `/products?category=${c.slug}`, label: c.name })),
    ...(sale && sale.totalCount > 0 ? [{ href: "/products?onSale=true", label: "Sale" }] : []),
  ];

  return (
    <StoreUIProvider terms={{ shippingFee: store.shippingFee, freeShippingThreshold: store.freeShippingThreshold }}>
      {/* Tenant brand colour (already validated server-side for contrast) drives every --brand usage. */}
      <style>{`.storefront{--brand:${brand};}`}</style>
      {store.isLive && (
        <p className="bg-fg px-4 py-2 text-center text-xs tracking-wide text-surface print:hidden">{announcement(store)}</p>
      )}
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur print:hidden">
        <div className="relative mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:px-6 lg:h-20">
          <div className="flex items-center gap-1">
            {store.isLive && <MobileMenu storeName={store.name} links={links} />}
            {store.isLive && <div className="hidden lg:block"><SearchToggle /></div>}
          </div>
          <Link href="/" className="max-w-[52vw] truncate text-center font-display text-2xl tracking-tight text-fg sm:text-3xl">
            {store.name}
          </Link>
          <div className="flex items-center justify-end gap-0.5">
            {store.isLive && (<><div className="lg:hidden"><SearchToggle /></div><HeaderActions /></>)}
          </div>
        </div>
        {store.isLive && (
          <nav aria-label="Categories" className="hidden border-t border-border lg:block">
            <ul className="mx-auto flex h-12 max-w-7xl items-center justify-center gap-9 px-6 text-xs font-medium tracking-[0.14em] text-fg-muted uppercase">
              {links.map((l) => (
                <li key={l.href}><Link href={l.href} className="py-3 whitespace-nowrap hover:text-fg">{l.label}</Link></li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">{children}</main>
      <StoreFooter store={store} categories={shown} />
      {store.isLive && <CartDrawer />}
    </StoreUIProvider>
  );
}
