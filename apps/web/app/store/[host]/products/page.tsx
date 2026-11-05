import { ChevronLeft, ChevronRight, SearchX, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ComingSoon } from "@/components/store/coming-soon";
import { MobileFilters, SortSelect } from "@/components/store/listing-controls";
import { LISTING_SORTS as SORTS } from "@/lib/store-terms";
import { ProductCard, ProductGridSkeleton } from "@/components/store/product-card";
import { getCategories, getProducts, getStore } from "@/lib/storefront";
import type { StorefrontCategory } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";

type Params = Promise<{ host: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const price = (v: string) => (/^\d{1,7}$/.test(v) ? v : "");

/** Category pages are canonical; search, sort and filter variations are not indexed separately. */
export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { host } = await params;
  const sp = await searchParams;
  const category = one(sp.category);
  const categories = await getCategories(host);
  const match = categories.find((c) => c.slug === category);
  const filtered = !!(one(sp.q) || one(sp.sort) || one(sp.inStock) || one(sp.onSale) || one(sp.minPrice) || one(sp.maxPrice) || (one(sp.page) && one(sp.page) !== "1"));
  return {
    title: match ? match.name : one(sp.onSale) === "true" ? "On sale" : "All products",
    alternates: { canonical: match ? `/products?category=${encodeURIComponent(match.slug)}` : "/products" },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

const PAGE_SIZE = 24;

export default function ProductListing({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <Suspense fallback={<ProductGridSkeleton />}>
        <Listing params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type State = { q: string; category: string; sort: string; inStock: boolean; onSale: boolean; minPrice: string; maxPrice: string; page: number };

async function Listing({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { host } = await params;
  const sp = await searchParams;
  const s: State = {
    q: one(sp.q).slice(0, 100),
    category: one(sp.category),
    sort: SORTS.some(([v]) => v === one(sp.sort)) ? one(sp.sort) : "newest",
    inStock: one(sp.inStock) === "true",
    onSale: one(sp.onSale) === "true",
    minPrice: price(one(sp.minPrice)),
    maxPrice: price(one(sp.maxPrice)),
    page: Math.max(1, Number(one(sp.page)) || 1),
  };

  const query = new URLSearchParams({ sort: s.sort, page: String(s.page), pageSize: String(PAGE_SIZE) });
  if (s.q) query.set("q", s.q);
  if (s.category) query.set("category", s.category);
  if (s.inStock) query.set("inStock", "true");
  if (s.onSale) query.set("onSale", "true");
  if (s.minPrice) query.set("minPrice", s.minPrice);
  if (s.maxPrice) query.set("maxPrice", s.maxPrice);
  query.sort();

  const [store, categories, result] = await Promise.all([getStore(host), getCategories(host), getProducts(host, query.toString())]);
  if (!store) notFound();
  if (!store.isLive) return <ComingSoon store={store} />;
  if (!result) notFound();
  const current = categories.find((c) => c.slug === s.category);
  const pages = Math.ceil(result.totalCount / PAGE_SIZE);
  const href = (patch: Partial<Record<keyof State, string | undefined>>) => {
    const merged: Record<string, string | undefined> = {
      q: s.q, category: s.category, sort: s.sort === "newest" ? undefined : s.sort, inStock: s.inStock ? "true" : undefined,
      onSale: s.onSale ? "true" : undefined, minPrice: s.minPrice, maxPrice: s.maxPrice, ...patch,
    };
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    return `/products${next.size ? `?${next}` : ""}`;
  };
  const title = s.q ? `Results for “${s.q}”` : current?.name ?? (s.onSale ? "On sale" : "All products");

  // Active filters as removable chips.
  const chips: { label: string; href: string }[] = [];
  if (s.q) chips.push({ label: `“${s.q}”`, href: href({ q: undefined }) });
  if (current) chips.push({ label: current.name, href: href({ category: undefined }) });
  if (s.inStock) chips.push({ label: "In stock", href: href({ inStock: undefined }) });
  if (s.onSale) chips.push({ label: "On sale", href: href({ onSale: undefined }) });
  if (s.minPrice || s.maxPrice)
    chips.push({ label: s.minPrice && s.maxPrice ? `${formatINR(s.minPrice)} – ${formatINR(s.maxPrice)}` : s.minPrice ? `From ${formatINR(s.minPrice)}` : `Up to ${formatINR(s.maxPrice)}`, href: href({ minPrice: undefined, maxPrice: undefined }) });

  const filters = (id: string) => <FilterForm s={s} categories={categories} id={id} />;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
        <ol className="flex items-center gap-1.5">
          <li><Link href="/" className="hover:text-fg">Home</Link></li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-fg">{current?.name ?? (s.onSale ? "On sale" : "All products")}</li>
        </ol>
      </nav>
      <div className="mt-4 flex flex-col gap-1">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">{title}</h1>
        <p className="text-sm text-fg-muted">{result.totalCount} {result.totalCount === 1 ? "product" : "products"}</p>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[15rem_1fr]">
        <aside className="hidden lg:block" aria-label="Filters">{filters("side")}</aside>

        <div>
          {/* Plain GET form: sort and filters work without JavaScript and stay in the URL. */}
          <form action="/products" className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <MobileFilters count={chips.length}>{filters("sheet")}</MobileFilters>
            {Object.entries({ q: s.q, category: s.category, inStock: s.inStock ? "true" : "", onSale: s.onSale ? "true" : "", minPrice: s.minPrice, maxPrice: s.maxPrice })
              .filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <div className="ml-auto flex items-center gap-2">
              <SortSelect value={s.sort} />
              <noscript><button type="submit" className="h-10 rounded-[var(--radius-control)] bg-fg px-4 text-sm text-surface">Apply</button></noscript>
            </div>
          </form>

          {chips.length > 0 && (
            <ul className="mt-4 flex flex-wrap items-center gap-2" aria-label="Active filters">
              {chips.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 text-xs hover:border-fg">
                    {c.label}<X className="size-3.5" aria-hidden /><span className="sr-only">Remove filter</span>
                  </Link>
                </li>
              ))}
              <li><Link href={s.sort === "newest" ? "/products" : `/products?sort=${s.sort}`} className="text-xs text-fg-muted underline underline-offset-4 hover:text-fg">Clear all</Link></li>
            </ul>
          )}

          {result.items.length === 0 ? (
            <div className="flex flex-col items-center py-24 text-center">
              <SearchX className="size-8 text-fg-subtle" aria-hidden />
              <p className="mt-4 font-display text-2xl">No products match</p>
              <p className="mt-1 text-sm text-fg-muted">Try a different search or remove a filter.</p>
              <Link href="/products" className="mt-6 border-b border-fg pb-0.5 text-sm font-medium">See all products</Link>
            </div>
          ) : (
            <section aria-labelledby="results-heading">
              <h2 id="results-heading" className="sr-only">Products</h2>
              <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:gap-x-6">
                {result.items.map((p, i) => <ProductCard key={p.slug} p={p} priority={i < 3} />)}
              </div>
            </section>
          )}

          {pages > 1 && (
            <nav aria-label="Pagination" className="mt-16 flex items-center justify-center gap-1.5 text-sm">
              {s.page > 1 && <Link href={href({ page: s.page === 2 ? undefined : String(s.page - 1) })} className="grid size-10 place-items-center rounded-full hover:bg-surface-muted" aria-label="Previous page"><ChevronLeft className="size-4" /></Link>}
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <Link key={n} href={href({ page: n === 1 ? undefined : String(n) })} aria-current={n === s.page ? "page" : undefined}
                  className={cn("grid size-10 place-items-center rounded-full", n === s.page ? "bg-fg text-surface" : "hover:bg-surface-muted")}>
                  {n}
                </Link>
              ))}
              {s.page < pages && <Link href={href({ page: String(s.page + 1) })} className="grid size-10 place-items-center rounded-full hover:bg-surface-muted" aria-label="Next page"><ChevronRight className="size-4" /></Link>}
            </nav>
          )}
        </div>
      </div>
    </>
  );
}

/** Filters as a plain GET form (works without JavaScript). Category links keep the other filters. */
function FilterForm({ s, categories, id }: { s: State; categories: StorefrontCategory[]; id: string }) {
  const shown = categories.filter((c) => c.productCount > 0);
  return (
    <form action="/products" className="space-y-8">
      {s.q && <input type="hidden" name="q" value={s.q} />}
      {s.sort !== "newest" && <input type="hidden" name="sort" value={s.sort} />}
      <fieldset>
        <legend className="text-xs font-semibold tracking-[0.14em] uppercase">Category</legend>
        <div className="mt-3 space-y-1 text-sm">
          <label className="flex cursor-pointer items-center gap-2.5 py-1">
            <input type="radio" name="category" value="" defaultChecked={!s.category} className="size-4 accent-[var(--fg)]" />
            <span>All categories</span>
          </label>
          {shown.map((c) => (
            <label key={c.slug} className="flex cursor-pointer items-center gap-2.5 py-1">
              <input type="radio" name="category" value={c.slug} defaultChecked={s.category === c.slug} className="size-4 accent-[var(--fg)]" />
              <span className="flex-1">{c.name}</span>
              <span className="tabular text-xs text-fg-subtle">{c.productCount}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-xs font-semibold tracking-[0.14em] uppercase">Availability</legend>
        <div className="mt-3 space-y-1 text-sm">
          <label className="flex cursor-pointer items-center gap-2.5 py-1">
            <input type="checkbox" name="inStock" value="true" defaultChecked={s.inStock} className="size-4 accent-[var(--fg)]" /> In stock only
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 py-1">
            <input type="checkbox" name="onSale" value="true" defaultChecked={s.onSale} className="size-4 accent-[var(--fg)]" /> On sale
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-xs font-semibold tracking-[0.14em] uppercase">Price (₹)</legend>
        <div className="mt-3 flex items-center gap-2">
          <label className="sr-only" htmlFor={`${id}-min`}>Minimum price</label>
          <input id={`${id}-min`} name="minPrice" inputMode="numeric" pattern="[0-9]*" maxLength={7} defaultValue={s.minPrice} placeholder="Min"
            className="h-10 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm" />
          <span className="text-fg-subtle" aria-hidden>–</span>
          <label className="sr-only" htmlFor={`${id}-max`}>Maximum price</label>
          <input id={`${id}-max`} name="maxPrice" inputMode="numeric" pattern="[0-9]*" maxLength={7} defaultValue={s.maxPrice} placeholder="Max"
            className="h-10 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm" />
        </div>
      </fieldset>
      <button type="submit" className="h-11 w-full rounded-[var(--radius-control)] bg-fg text-sm font-medium text-surface hover:bg-fg/90">Apply filters</button>
    </form>
  );
}
