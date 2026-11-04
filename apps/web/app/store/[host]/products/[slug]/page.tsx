import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { VariantPicker } from "./variant-picker";
import { Gallery } from "@/components/store/gallery";
import { ComingSoon } from "@/components/store/coming-soon";
import { getProduct, getStore, jsonLd, storeOrigin } from "@/lib/storefront";
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
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Suspense fallback={<div className="grid gap-10 md:grid-cols-2"><div className="aspect-[4/5] animate-pulse rounded-[var(--radius-card)] bg-surface-muted" /><div className="h-64 animate-pulse rounded bg-surface-muted" /></div>}>
        <Product params={params} />
      </Suspense>
    </div>
  );
}

async function Product({ params }: { params: Params }) {
  const { host, slug } = await params;
  const [product, store] = await Promise.all([getProduct(host, slug), getStore(host)]);
  if (!store) notFound();
  if (!store.isLive) return <ComingSoon store={store} />;
  if (!product) notFound();

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-fg-muted">
        <Link href={product.categorySlug ? `/products?category=${product.categorySlug}` : "/products"} className="inline-flex items-center gap-1 hover:text-fg">
          <ChevronLeft className="size-4" />
          {product.categoryName ?? "All products"}
        </Link>
      </nav>
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        {/* Structured data so search engines can show price and availability. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(productLd(host, store.name, product)) }} />
        <Gallery title={product.title} images={product.images} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.title}</h1>
          <VariantPicker product={product} />
          {product.description && (
            <section className="mt-8 border-t border-border pt-6" aria-labelledby="desc">
              <h2 id="desc" className="text-sm font-semibold">Description</h2>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-fg-muted">{product.description}</p>
            </section>
          )}
        </div>
      </div>
    </>
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
