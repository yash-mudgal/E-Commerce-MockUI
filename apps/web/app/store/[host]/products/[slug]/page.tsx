import { ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { VariantPicker } from "./variant-picker";
import { Gallery } from "@/components/store/gallery";
import { ComingSoon } from "@/components/store/coming-soon";
import { ProductCard } from "@/components/store/product-card";
import { DeliveryCheck } from "@/components/store/delivery-check";
import { RecentlyViewed } from "@/components/store/recently-viewed";
import { ReviewsSection } from "@/components/store/reviews";
import { Stars } from "@/components/store/stars";
import { TermsList } from "@/components/store/terms";
import { WishlistButton } from "@/components/store/wishlist-button";
import { getProduct, getProducts, getReviews, getStore, jsonLd, storeOrigin } from "@/lib/storefront";
import { storeTerms } from "@/lib/store-terms";
import type { StorefrontProduct } from "@/lib/types";

type Params = Promise<{ host: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { host, slug } = await params;
  const product = await getProduct(host, slug);
  if (!product) return { title: "Product not found", robots: { index: false } };
  const description = (product.description || product.title).replace(/\s+/g, " ").slice(0, 160);
  return {
    title: product.title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      type: "website",
      title: product.title,
      description,
      url: `/products/${product.slug}`,
      images: product.images.slice(0, 4).map((i) => ({ url: i.url, alt: i.altText ?? product.title })),
    },
  };
}

export default function ProductPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <Suspense fallback={<div className="grid gap-10 md:grid-cols-2"><div className="aspect-[4/5] animate-pulse rounded-[var(--radius-card)] bg-surface-muted" /><div className="h-64 animate-pulse rounded bg-surface-muted" /></div>}>
        <Product params={params} />
      </Suspense>
    </div>
  );
}

async function Product({ params }: { params: Params }) {
  const { host, slug } = await params;
  const [product, store, reviews] = await Promise.all([getProduct(host, slug), getStore(host), getReviews(host, slug)]);
  if (!store) notFound();
  if (!store.isLive) return <ComingSoon store={store} />;
  if (!product) notFound();

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-6 text-xs text-fg-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="hover:text-fg">Home</Link></li>
          <li aria-hidden>/</li>
          <li><Link href={product.categorySlug ? `/products?category=${product.categorySlug}` : "/products"} className="hover:text-fg">{product.categoryName ?? "All products"}</Link></li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="line-clamp-1 text-fg">{product.title}</li>
        </ol>
      </nav>
      <div className="grid gap-8 md:grid-cols-[1.15fr_1fr] md:gap-12 lg:gap-16">
        {/* Structured data so search engines can show price and availability. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(productLd(host, store.name, product)) }} />
        <Gallery title={product.title} images={product.images} />
        <div className="md:sticky md:top-28 md:self-start">
          {product.categoryName && <p className="text-xs font-medium tracking-[0.2em] text-fg-muted uppercase">{product.categoryName}</p>}
          <h1 className="mt-3 font-display text-3xl leading-tight tracking-tight sm:text-4xl">{product.title}</h1>
          {product.ratings.count > 0 && product.ratings.average && (
            <a href="#reviews" className="mt-3 inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg">
              <Stars value={Number(product.ratings.average)} size="md" />
              <span className="tabular">{product.ratings.average}</span>
              <span className="underline underline-offset-4">{product.ratings.count} {product.ratings.count === 1 ? "review" : "reviews"}</span>
            </a>
          )}
          <VariantPicker product={product} />
          <WishlistButton slug={product.slug} title={product.title} variant="inline" className="mt-3 w-full" />
          <div className="mt-8 rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <p className="text-xs font-semibold tracking-[0.14em] uppercase">Delivery</p>
            <div className="mt-3"><DeliveryCheck /></div>
            <TermsList store={store} layout="list" className="mt-5 border-t border-border pt-5" />
          </div>
          <div className="mt-8 divide-y divide-border border-y border-border">
            {product.description && (
              <details open className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold tracking-[0.14em] uppercase">
                  Description<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-fg-muted">{product.description}</p>
              </details>
            )}
            <details className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold tracking-[0.14em] uppercase">
                Shipping and payment<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <ul className="mt-3 space-y-1.5 text-sm text-fg-muted">
                {storeTerms(store).map((t) => <li key={t.key}>{t.title}: {t.detail.charAt(0).toLowerCase() + t.detail.slice(1)}.</li>)}
                <li>Prices include GST ({Number(product.gstRate)}%).</li>
              </ul>
            </details>
          </div>
        </div>
      </div>
      {reviews && <ReviewsSection slug={product.slug} page={reviews} />}
      <Suspense>
        <Related host={host} slug={product.slug} categorySlug={product.categorySlug} />
      </Suspense>
      <div className="-mx-4 sm:-mx-6"><RecentlyViewed current={product.slug} /></div>
    </>
  );
}

/** More from the same category (newest first), falling back to the newest products in the store. */
async function Related({ host, slug, categorySlug }: { host: string; slug: string; categorySlug: string | null }) {
  const sameCategory = categorySlug ? (await getProducts(host, new URLSearchParams({ category: categorySlug, exclude: slug, pageSize: "4", sort: "newest" }).toString()))?.items ?? [] : [];
  const newest = sameCategory.length < 4 ? (await getProducts(host, new URLSearchParams({ exclude: slug, pageSize: "8", sort: "newest" }).toString()))?.items ?? [] : [];
  const items = [...sameCategory, ...newest.filter((p) => !sameCategory.some((s) => s.slug === p.slug))].slice(0, 4);
  if (items.length === 0) return null;
  return (
    <section className="mt-24" aria-labelledby="related">
      <p className="text-xs font-medium tracking-[0.2em] text-fg-muted uppercase">{sameCategory.length === items.length ? "From the same collection" : sameCategory.length ? "From this collection and new arrivals" : "New arrivals"}</p>
      <h2 id="related" className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">You may also like</h2>
      <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-4 lg:gap-x-6">
        {items.map((p) => <ProductCard key={p.slug} p={p} />)}
      </div>
    </section>
  );
}

function productLd(host: string, storeName: string, p: StorefrontProduct) {
  const url = `${storeOrigin(host)}/products/${p.slug}`;
  const prices = p.variants.map((v) => Number(v.price));
  const available = p.variants.some((v) => v.available);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    description: p.description || undefined,
    image: p.images.map((i) => i.url),
    url,
    brand: { "@type": "Brand", name: storeName },
    aggregateRating: p.ratings.count > 0 && p.ratings.average
      ? { "@type": "AggregateRating", ratingValue: p.ratings.average, reviewCount: p.ratings.count, bestRating: 5, worstRating: 1 }
      : undefined,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "INR",
      lowPrice: Math.min(...prices).toFixed(2),
      highPrice: Math.max(...prices).toFixed(2),
      offerCount: p.variants.length,
      availability: available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: storeName },
    },
  };
}
