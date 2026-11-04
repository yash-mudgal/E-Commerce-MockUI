import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductCard, ProductGridSkeleton } from "@/components/store/product-card";
import { ComingSoon } from "@/components/store/coming-soon";
import { getCategories, getProducts, getStore } from "@/lib/storefront";
import { cn } from "@/lib/utils";

type Params = Promise<{ host: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** Category pages are canonical; search, sort and filter variations are not indexed separately. */
export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { host } = await params;
  const sp = await searchParams;
  const category = one(sp.category);
  const categories = await getCategories(host);
  const match = categories.find((c) => c.slug === category);
  const filtered = !!(one(sp.q) || one(sp.sort) || one(sp.inStock) || (one(sp.page) && one(sp.page) !== "1"));
  return {
    title: match ? match.name : "All products",
    alternates: { canonical: match ? `/products?category=${encodeURIComponent(match.slug)}` : "/products" },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}
const PAGE_SIZE = 24;
const SORTS = [
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
] as const;

export default function ProductListing({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <Suspense fallback={<ProductGridSkeleton />}>
        <Listing params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Listing({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { host } = await params;
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const category = one(sp.category);
  const sort = SORTS.some(([v]) => v === one(sp.sort)) ? one(sp.sort) : "newest";
  const inStock = one(sp.inStock) === "true";
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const query = new URLSearchParams({ sort, page: String(page), pageSize: String(PAGE_SIZE) });
  if (q) query.set("q", q);
  if (category) query.set("category", category);
  if (inStock) query.set("inStock", "true");
  query.sort();

  const [store, categories, result] = await Promise.all([getStore(host), getCategories(host), getProducts(host, query.toString())]);
  if (!store) notFound();
  if (!store.isLive) return <ComingSoon store={store} />;
  if (!result) notFound();
  const current = categories.find((c) => c.slug === category);
  const pages = Math.ceil(result.totalCount / PAGE_SIZE);
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q, category, sort: sort === "newest" ? undefined : sort, inStock: inStock ? "true" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    return `/products${next.size ? `?${next}` : ""}`;
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{q ? `Results for “${q}”` : current?.name ?? "All products"}</h1>
        <p className="text-sm text-fg-muted">{result.totalCount} {result.totalCount === 1 ? "product" : "products"}</p>
      </div>

      {/* Plain GET form: filters work without JavaScript and stay in the URL. */}
      <form className="mt-6 flex flex-wrap items-center gap-3 border-y border-border py-3" action="/products">
        {q && <input type="hidden" name="q" value={q} />}
        <label className="sr-only" htmlFor="category">Category</label>
        <select id="category" name="category" defaultValue={category} className="h-9 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="sort">Sort by</label>
        <select id="sort" name="sort" defaultValue={sort} className="h-9 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" name="inStock" value="true" defaultChecked={inStock} className="size-4 accent-[var(--brand)]" /> In stock only
        </label>
        <button type="submit" className="h-9 rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-brand-fg hover:bg-brand-hover">Apply</button>
        {(q || category || inStock || sort !== "newest") && <Link href="/products" className="text-sm text-fg-muted underline-offset-2 hover:underline">Clear all</Link>}
      </form>

      {result.items.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <SearchX className="size-8 text-fg-subtle" aria-hidden />
          <p className="mt-3 font-medium">No products match</p>
          <p className="mt-1 text-sm text-fg-muted">Try a different search or remove a filter.</p>
          <Link href="/products" className="mt-5 text-sm font-medium text-brand hover:underline">See all products</Link>
        </div>
      ) : (
        <section aria-labelledby="results-heading">
          <h2 id="results-heading" className="sr-only">Products</h2>
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {result.items.map((p) => <ProductCard key={p.slug} p={p} />)}
          </div>
        </section>
      )}

      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-2 text-sm">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Link key={n} href={href({ page: n === 1 ? undefined : String(n) })} aria-current={n === page ? "page" : undefined}
              className={cn("grid size-9 place-items-center rounded-md border", n === page ? "border-brand bg-brand text-brand-fg" : "border-border hover:border-fg-subtle")}>
              {n}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
