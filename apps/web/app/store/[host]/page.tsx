import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductCard, ProductGridSkeleton } from "@/components/store/product-card";
import { getCategories, getProducts, getStore } from "@/lib/storefront";

type Params = Promise<{ host: string }>;

export default function StoreHome({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-12 sm:px-6"><ProductGridSkeleton /></div>}>
      <Home params={params} />
    </Suspense>
  );
}

async function Home({ params }: { params: Params }) {
  const { host } = await params;
  const [store, categories, latest] = await Promise.all([getStore(host), getCategories(host), getProducts(host, "sort=newest&pageSize=8")]);
  if (!store || !latest) notFound();
  const shown = categories.filter((c) => c.productCount > 0);

  return (
    <>
      <section className="border-b border-border bg-bg">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-fg sm:text-5xl">{store.name}</h1>
          {store.tagline && <p className="mt-4 max-w-xl text-base text-fg-muted sm:text-lg">{store.tagline}</p>}
          <Link href="/products" className="mt-8 inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-brand px-5 text-[15px] font-medium text-brand-fg hover:bg-brand-hover">
            Shop the collection <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {shown.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6" aria-labelledby="cats">
          <h2 id="cats" className="text-lg font-semibold tracking-tight">Shop by category</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((c) => (
              <li key={c.slug}>
                <Link href={`/products?category=${c.slug}`} className="flex items-center justify-between rounded-[var(--radius-card)] border border-border px-4 py-4 text-sm font-medium hover:border-brand hover:text-brand">
                  <span className="truncate">{c.name}</span>
                  <span className="tabular text-xs text-fg-subtle">{c.productCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6" aria-labelledby="new">
        <div className="flex items-end justify-between">
          <h2 id="new" className="text-lg font-semibold tracking-tight">New arrivals</h2>
          {latest.totalCount > latest.items.length && <Link href="/products" className="text-sm font-medium text-brand hover:underline">View all</Link>}
        </div>
        {latest.items.length === 0 ? (
          <p className="mt-6 rounded-[var(--radius-card)] border border-dashed border-border px-6 py-12 text-center text-sm text-fg-muted">New products are on their way. Check back soon.</p>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {latest.items.map((p) => <ProductCard key={p.slug} p={p} />)}
          </div>
        )}
      </section>
    </>
  );
}
