import { Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCategories, getStore, safeBrandColor } from "@/lib/storefront";

type Params = Promise<{ host: string }>;

export default function StoreLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <Suspense fallback={<div className="h-[105px] border-b border-border" />}>
        <StoreHeader params={params} />
      </Suspense>
      <main className="flex-1">{children}</main>
      <Suspense>
        <StoreFooter params={params} />
      </Suspense>
    </div>
  );
}

async function StoreHeader({ params }: { params: Params }) {
  const { host } = await params;
  const [store, categories] = await Promise.all([getStore(host), getCategories(host)]);
  if (!store) notFound();
  const brand = safeBrandColor(store.brandColor);
  return (
    <>
      {/* Tenant brand colour (already validated server-side for contrast) drives every --brand usage. */}
      <style>{`:root{--brand:${brand};}`}</style>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="truncate text-lg font-semibold tracking-tight text-fg">
            {store.name}
          </Link>
          <span className="flex-1" />
          {store.isLive && (<>
          <form action="/products" className="relative hidden w-72 sm:block" role="search">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input name="q" type="search" placeholder="Search products" aria-label="Search products" className="h-9 w-full rounded-full border border-border bg-surface-muted pr-4 pl-9 text-sm focus-visible:border-brand focus-visible:bg-surface focus-visible:outline-none" />
          </form>
          <Link href="/products" className="text-sm font-medium text-fg-muted hover:text-fg sm:hidden" aria-label="Search and browse products">
            <Search className="size-5" />
          </Link>
          </>)}
        </div>
        {store.isLive && categories.length > 0 && (
          <nav aria-label="Categories" className="mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6">
            <ul className="flex gap-5 pb-2.5 text-sm whitespace-nowrap">
              <li><Link href="/products" className="text-fg-muted hover:text-fg">Shop all</Link></li>
              {categories.filter((c) => c.productCount > 0).map((c) => (
                <li key={c.slug}><Link href={`/products?category=${c.slug}`} className="text-fg-muted hover:text-fg">{c.name}</Link></li>
              ))}
            </ul>
          </nav>
        )}
      </header>
    </>
  );
}

async function StoreFooter({ params }: { params: Params }) {
  const { host } = await params;
  const store = await getStore(host);
  if (!store) return null;
  return (
    <footer className="mt-16 border-t border-border bg-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-fg-muted sm:flex-row sm:justify-between sm:px-6">
        <div>
          <p className="font-medium text-fg">{store.name}</p>
          {store.legalName && <p>{store.legalName}{store.gstin && ` · GSTIN ${store.gstin}`}</p>}
          {store.supportEmail && <p>Questions? <a className="underline underline-offset-2 hover:text-fg" href={`mailto:${store.supportEmail}`}>{store.supportEmail}</a></p>}
        </div>
        <p className="sm:self-end">Powered by ShopMint</p>
      </div>
    </footer>
  );
}
