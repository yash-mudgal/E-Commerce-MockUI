import Image from "next/image";
import Link from "next/link";
import type { StorefrontCard } from "@/lib/types";
import { Stars } from "./stars";
import { WishlistButton } from "./wishlist-button";
import { cn, discountPercent, formatINR } from "@/lib/utils";

/**
 * Placeholder for products without photos: the product's name on a soft tinted panel. It never imitates a photo,
 * and screen readers hear that there is no image yet.
 */
export function ProductImagePlaceholder({ title, className }: { title: string; className?: string }) {
  return (
    <div className={cn("relative grid aspect-[4/5] place-items-center overflow-hidden bg-brand-soft p-6", className)} role="img" aria-label={`${title}: no photo yet`}>
      <div aria-hidden className="absolute inset-3 rounded-[2px] border border-brand/15" />
      <div aria-hidden className="text-center">
        <p className="font-display text-lg leading-snug text-fg/80 sm:text-xl">{title}</p>
        <p className="mt-3 text-[10px] font-medium tracking-[0.2em] text-fg-muted uppercase">Photo coming soon</p>
      </div>
    </div>
  );
}

const SIZES = "(min-width: 1280px) 22vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";

export function ProductCard({ p, priority }: { p: StorefrontCard; priority?: boolean }) {
  const off = discountPercent(p.price, p.mrp);
  return (
    <div className="group relative">
    <Link href={`/products/${p.slug}`} className="flex flex-col">
      <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-surface-muted">
        {p.image ? (
          <div className="relative aspect-[4/5]">
            <Image src={p.image.url} alt={p.image.altText ?? p.title} fill sizes={SIZES} priority={priority}
              className={cn("object-cover transition duration-500 ease-out group-hover:scale-[1.03]", p.hoverImage && "group-hover:opacity-0")} />
            {p.hoverImage && (
              <Image src={p.hoverImage.url} alt="" fill sizes={SIZES} aria-hidden
                className="object-cover opacity-0 transition duration-500 ease-out group-hover:scale-[1.03] group-hover:opacity-100" />
            )}
          </div>
        ) : (
          <ProductImagePlaceholder title={p.title} className="transition-transform duration-500 group-hover:scale-[1.02]" />
        )}
        <div className="absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5">
          {!p.inStock && <span className="rounded-[2px] bg-surface px-2 py-1 text-[11px] font-medium tracking-wide text-fg uppercase">Sold out</span>}
          {p.inStock && off > 0 && <span className="rounded-[2px] bg-fg px-2 py-1 text-[11px] font-medium tracking-wide text-surface">{off}% off</span>}
        </div>
      </div>
      <div className="mt-3.5 flex flex-col gap-1">
        {p.categoryName && <p className="text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">{p.categoryName}</p>}
        <h3 className="line-clamp-2 text-[15px] leading-snug text-fg underline-offset-4 group-hover:underline">{p.title}</h3>
        {p.reviewCount > 0 && p.rating && (
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Stars value={Number(p.rating)} /><span className="tabular">{p.rating} ({p.reviewCount})</span>
          </p>
        )}
        <p className="tabular flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold text-fg">{formatINR(p.price)}</span>
          {off > 0 && <span className="text-fg-subtle line-through">{formatINR(p.mrp)}</span>}
        </p>
      </div>
    </Link>
    {/* Outside the link: a button can't sit inside an anchor. */}
    <WishlistButton slug={p.slug} title={p.title} className="absolute top-2.5 right-2.5" />
    </div>
  );
}

export function ProductGridSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="aspect-[4/5] animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
          <div className="mt-3.5 h-3 w-1/3 animate-pulse rounded bg-surface-muted" />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-surface-muted" />
          <div className="mt-2 h-4 w-1/4 animate-pulse rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}
