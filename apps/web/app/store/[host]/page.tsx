import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ComingSoon } from "@/components/store/coming-soon";
import { ProductCard, ProductGridSkeleton } from "@/components/store/product-card";
import { TermsList } from "@/components/store/terms";
import { getCategories, getHome, getProducts, getStore } from "@/lib/storefront";
import type { HomeCollection, StorefrontCard, StorefrontCategory, StorefrontImage } from "@/lib/types";

type Params = Promise<{ host: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { host } = await params;
  const store = await getStore(host);
  if (!store) return {};
  return {
    title: { absolute: store.tagline ? `${store.name}: ${store.tagline}` : store.name },
    alternates: { canonical: "/" },
    openGraph: { title: store.name, description: store.tagline ?? undefined, url: "/" },
  };
}

export default function StoreHome({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-16 sm:px-6"><ProductGridSkeleton /></div>}>
      <Home params={params} />
    </Suspense>
  );
}

async function Home({ params }: { params: Params }) {
  const { host } = await params;
  const [store, categories, latest, sale, home] = await Promise.all([
    getStore(host), getCategories(host), getProducts(host, "sort=newest&pageSize=8"), getProducts(host, "onSale=true&pageSize=4&sort=price_asc"), getHome(host),
  ]);
  if (!store) notFound();
  if (!store.isLive) return <ComingSoon store={store} />;
  if (!latest) notFound();
  const shown = categories.filter((c) => c.productCount > 0);
  const productCount = shown.reduce((n, c) => n + c.productCount, 0);
  const pictured = latest.items.filter((p) => p.image).slice(0, 3);
  const collections = (home?.collections ?? []).filter((c) => c.productCount > 0);
  const featured = home?.featured && home.featured.productCount > 0 ? home.featured : null;
  const featuredItems = featured ? (await getProducts(host, `collection=${encodeURIComponent(featured.slug)}&pageSize=4&sort=newest`))?.items ?? [] : [];
  const show = { categories: home?.showCategories ?? true, newArrivals: home?.showNewArrivals ?? true, sale: home?.showSale ?? true };

  return (
    <>
      {/* Hero: the store's own words and, when it has photos, its newest products. */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-20">
          <div>
            <p className="text-xs font-medium tracking-[0.2em] text-fg-muted uppercase">Welcome to {store.name}</p>
            <h1 className="mt-5 font-display text-4xl leading-[1.08] tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {home?.heroHeading ?? store.tagline ?? store.name}
            </h1>
            {home?.heroText ? (
              <p className="mt-6 max-w-md text-base text-fg-muted">{home.heroText}</p>
            ) : productCount > 0 && (
              <p className="mt-6 max-w-md text-base text-fg-muted">
                {productCount} {productCount === 1 ? "product" : "products"} across {shown.length} {shown.length === 1 ? "collection" : "collections"}.
              </p>
            )}
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/products" className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-control)] bg-fg px-7 text-sm font-medium tracking-wide text-surface hover:bg-fg/90">
                Shop all <ArrowRight className="size-4" aria-hidden />
              </Link>
              {shown[0] && (
                <Link href={`/products?category=${shown[0].slug}`} className="inline-flex h-12 items-center rounded-[var(--radius-control)] border border-fg px-7 text-sm font-medium tracking-wide hover:bg-fg hover:text-surface">
                  {shown[0].name}
                </Link>
              )}
            </div>
          </div>
          {home?.heroImage
            ? <HeroImageLink image={home.heroImage} slug={home.heroProductSlug} />
            : <HeroVisual name={store.name} products={pictured} />}
        </div>
      </section>

      <section aria-label="Shopping with us" className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><TermsList store={store} /></div>
      </section>

      {featured && featuredItems.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6" aria-labelledby="featured">
          <SectionHeading id="featured" eyebrow="Featured collection" title={featured.title} href={`/products?collection=${featured.slug}`} linkLabel={`View all ${featured.productCount}`} />
          {featured.description && <p className="mt-3 max-w-2xl text-fg-muted">{featured.description}</p>}
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
            {featuredItems.map((p) => <ProductCard key={p.slug} p={p} />)}
          </div>
        </section>
      )}

      {show.categories && shown.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6" aria-labelledby="cats">
          <SectionHeading id="cats" eyebrow="Collections" title="Shop by category" />
          <ul className="-mx-4 mt-8 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4 lg:gap-6">
            {shown.slice(0, 8).map((c) => <CategoryTile key={c.slug} c={c} />)}
          </ul>
        </section>
      )}

      {collections.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6" aria-labelledby="collections">
          <SectionHeading id="collections" eyebrow="Curated" title="Collections" />
          <ul className="-mx-4 mt-8 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 lg:gap-6">
            {collections.slice(0, 6).map((c) => <CollectionTile key={c.slug} c={c} />)}
          </ul>
        </section>
      )}

      {show.newArrivals && (
      <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6" aria-labelledby="new">
        <SectionHeading id="new" eyebrow="Just in" title="New arrivals" href={latest.totalCount > latest.items.length ? "/products" : undefined} linkLabel="View all" />
        {latest.items.length === 0 ? (
          <p className="mt-8 rounded-[var(--radius-card)] border border-dashed border-border-strong px-6 py-14 text-center text-sm text-fg-muted">New products are on their way. Check back soon.</p>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
            {latest.items.map((p, i) => <ProductCard key={p.slug} p={p} priority={i < 4} />)}
          </div>
        )}
      </section>
      )}

      {show.sale && sale && sale.items.some((p) => !latest.items.some((l) => l.slug === p.slug)) && (
        <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6" aria-labelledby="sale">
          <SectionHeading id="sale" eyebrow="Offers" title="On sale" href="/products?onSale=true" linkLabel={`View all ${sale.totalCount}`} />
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
            {sale.items.map((p) => <ProductCard key={p.slug} p={p} />)}
          </div>
        </section>
      )}

      {store.tagline && (
        <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6" aria-label={`About ${store.name}`}>
          <div className="rounded-[var(--radius-card)] bg-brand-soft px-6 py-16 text-center sm:px-12">
            <p className="text-xs font-medium tracking-[0.2em] text-fg-muted uppercase">{store.name}</p>
            <p className="mx-auto mt-5 max-w-2xl font-display text-3xl leading-tight text-balance sm:text-4xl">{store.tagline}</p>
            <Link href="/products" className="mt-8 inline-flex items-center gap-2 border-b border-fg pb-1 text-sm font-medium hover:border-brand hover:text-brand">
              Explore the collection <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      )}
    </>
  );
}

function SectionHeading({ id, eyebrow, title, href, linkLabel }: { id: string; eyebrow: string; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="text-xs font-medium tracking-[0.2em] text-fg-muted uppercase">{eyebrow}</p>
        <h2 id={id} className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="shrink-0 border-b border-fg pb-0.5 text-sm font-medium hover:border-brand hover:text-brand">{linkLabel}</Link>
      )}
    </div>
  );
}

function CollectionTile({ c }: { c: HomeCollection }) {
  return (
    <li className="w-[78vw] shrink-0 snap-start sm:w-auto">
      <Link href={`/products?collection=${c.slug}`} className="group relative block aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] bg-surface-muted">
        {c.cover ? (
          <>
            <Image src={c.cover.url} alt="" fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 78vw" className="object-cover transition duration-700 group-hover:scale-[1.04]" />
            <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-stone-950/65 via-stone-950/15 to-transparent" />
          </>
        ) : <span aria-hidden className="absolute inset-3 rounded-[2px] border border-border-strong" />}
        <span className={`absolute inset-x-0 bottom-0 p-6 ${c.cover ? "text-white" : "text-fg"}`}>
          <span className="block font-display text-2xl sm:text-3xl">{c.title}</span>
          {c.description && <span className={`mt-1 line-clamp-2 block text-sm ${c.cover ? "text-white/90" : "text-fg-muted"}`}>{c.description}</span>}
          <span className={`mt-2 inline-flex items-center gap-1.5 text-xs tracking-wide ${c.cover ? "text-white/90" : "text-fg-muted"}`}>
            Shop {c.productCount} {c.productCount === 1 ? "product" : "products"} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The merchant's chosen hero photo (one of their own product images), linking to that product. */
function HeroImageLink({ image, slug }: { image: StorefrontImage; slug: string | null }) {
  const img = <Image src={image.url} alt={image.altText ?? ""} fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover transition duration-700 group-hover:scale-[1.02]" />;
  return slug
    ? <Link href={`/products/${slug}`} className="group relative block aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-surface-muted sm:aspect-[5/4] lg:aspect-[4/5]">{img}</Link>
    : <div className="group relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-surface-muted">{img}</div>;
}

function CategoryTile({ c }: { c: StorefrontCategory }) {
  return (
    <li className="w-[70vw] shrink-0 snap-start sm:w-auto">
      <Link href={`/products?category=${c.slug}`} className="group relative block aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-brand-soft">
        {c.cover ? (
          <>
            <Image src={c.cover.url} alt="" fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 70vw" className="object-cover transition duration-700 group-hover:scale-[1.04]" />
            <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-stone-950/60 via-stone-950/10 to-transparent" />
          </>
        ) : (
          <span aria-hidden className="absolute inset-3 rounded-[2px] border border-brand/15" />
        )}
        <span className={`absolute inset-x-0 bottom-0 p-5 ${c.cover ? "text-white" : "text-fg"}`}>
          <span className="block font-display text-2xl">{c.name}</span>
          <span className={`mt-1 inline-flex items-center gap-1.5 text-xs tracking-wide ${c.cover ? "text-white/90" : "text-fg-muted"}`}>
            {c.productCount} {c.productCount === 1 ? "product" : "products"} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Up to three of the newest product photos; without photos, a quiet framed monogram (decorative only). */
function HeroVisual({ name, products }: { name: string; products: StorefrontCard[] }) {
  if (products.length === 0)
    return (
      <div aria-hidden className="relative hidden aspect-[5/4] overflow-hidden rounded-[var(--radius-card)] bg-brand-soft lg:block">
        <div className="absolute inset-5 rounded-[2px] border border-brand/20" />
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-[9rem] leading-none text-brand/25">{name.trim()[0]?.toUpperCase()}</span>
        </div>
      </div>
    );
  const [main, ...rest] = products;
  return (
    <div className={`grid gap-4 ${rest.length ? "grid-cols-[1.4fr_1fr]" : "grid-cols-1"}`}>
      <HeroImage p={main} className="aspect-[4/5]" priority />
      {rest.length > 0 && (
        <div className="grid gap-4">
          {rest.map((p) => <HeroImage key={p.slug} p={p} className={rest.length === 1 ? "aspect-[4/5] self-end" : "aspect-square"} />)}
        </div>
      )}
    </div>
  );
}

function HeroImage({ p, className, priority }: { p: StorefrontCard; className: string; priority?: boolean }) {
  return (
    <Link href={`/products/${p.slug}`} className={`group relative block overflow-hidden rounded-[var(--radius-card)] bg-surface-muted ${className}`}>
      <Image src={p.image!.url} alt={p.image!.altText ?? p.title} fill priority={priority} sizes="(min-width: 1024px) 30vw, 60vw" className="object-cover transition duration-700 group-hover:scale-[1.03]" />
    </Link>
  );
}
