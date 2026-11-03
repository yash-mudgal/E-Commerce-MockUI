import Link from "next/link";
import type { StorefrontCard } from "@/lib/types";
import { cn, discountPercent, formatINR } from "@/lib/utils";

/** Neutral placeholder until product media ships (Phase 6). It never suggests a real product photo. */
export function ProductImagePlaceholder({ title, className }: { title: string; className?: string }) {
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className={cn("grid aspect-[4/5] place-items-center bg-brand-soft", className)} role="img" aria-label={`${title}: no image yet`}>
      <span className="text-3xl font-semibold tracking-tight text-brand/70">{initials}</span>
    </div>
  );
}

export function ProductCard({ p }: { p: StorefrontCard }) {
  const off = discountPercent(p.price, p.mrp);
  return (
    <Link href={`/products/${p.slug}`} className="group flex flex-col">
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-border">
        <ProductImagePlaceholder title={p.title} className="transition-transform duration-300 group-hover:scale-[1.02]" />
        {!p.inStock && <span className="absolute top-2 left-2 rounded-full bg-surface/95 px-2 py-0.5 text-xs font-medium text-fg-muted">Sold out</span>}
      </div>
      <div className="mt-3 flex flex-col gap-0.5">
        {p.categoryName && <p className="text-xs text-fg-muted">{p.categoryName}</p>}
        <h3 className="line-clamp-2 text-sm font-medium text-fg group-hover:underline group-hover:underline-offset-2">{p.title}</h3>
        <p className="tabular mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold text-fg">{formatINR(p.price)}</span>
          {off > 0 && (
            <>
              <span className="text-fg-subtle line-through">{formatINR(p.mrp)}</span>
              <span className="text-xs font-medium text-success">{off}% off</span>
            </>
          )}
        </p>
      </div>
    </Link>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="aspect-[4/5] animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
          <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-surface-muted" />
          <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}
