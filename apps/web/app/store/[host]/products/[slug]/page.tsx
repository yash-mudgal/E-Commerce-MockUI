import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { VariantPicker } from "./variant-picker";
import { ProductImagePlaceholder } from "@/components/store/product-card";
import { getProduct, getStore } from "@/lib/storefront";

type Params = Promise<{ host: string; slug: string }>;

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
  if (!product || !store) notFound();

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-fg-muted">
        <Link href={product.categorySlug ? `/products?category=${product.categorySlug}` : "/products"} className="inline-flex items-center gap-1 hover:text-fg">
          <ChevronLeft className="size-4" />
          {product.categoryName ?? "All products"}
        </Link>
      </nav>
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
          <ProductImagePlaceholder title={product.title} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.title}</h1>
          <VariantPicker product={product} supportEmail={store.supportEmail} />
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
