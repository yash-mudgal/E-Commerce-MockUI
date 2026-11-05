"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { api } from "@/lib/api";
import type { Paged, StorefrontCard } from "@/lib/types";
import { ProductCard } from "./product-card";

const KEY = "shopmint:recently-viewed";
const MAX = 12;

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{1,200}$/.test(s)).slice(0, MAX) : [];
  } catch { return []; }
}

/**
 * Products this browser looked at recently (kept on the device only, per store). Records the current product, then
 * shows the others. Nothing is sent to the server except the slugs needed to draw the cards.
 */
export function RecentlyViewed({ current }: { current?: string }) {
  const [slugs, setSlugs] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    const list = read();
    const others = list.filter((s) => s !== current);
    if (current) {
      try { localStorage.setItem(KEY, JSON.stringify([current, ...others].slice(0, MAX))); } catch { /* private mode: fine */ }
    }
    // Reading the device's history is a one-off sync from an external store at mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlugs(others.slice(0, 8));
  }, [current]);
  const cards = useQuery({
    queryKey: ["recently-viewed", slugs],
    queryFn: () => api<Paged<StorefrontCard>>(`/storefront/products?pageSize=24&slugs=${encodeURIComponent(slugs!.join(","))}`),
    enabled: !!slugs && slugs.length > 0,
    staleTime: 60_000,
  });
  if (!slugs || slugs.length === 0 || !cards.data) return null;
  const bySlug = new Map(cards.data.items.map((c) => [c.slug, c]));
  const items = slugs.map((s) => bySlug.get(s)).filter((c): c is StorefrontCard => !!c).slice(0, 4);
  if (items.length === 0) return null;
  return (
    <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6" aria-labelledby="recent">
      <p className="text-xs font-medium tracking-[0.2em] text-fg-muted uppercase">Your browsing</p>
      <h2 id="recent" className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">Recently viewed</h2>
      <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-4 lg:gap-x-6">
        {items.map((p) => <ProductCard key={p.slug} p={p} />)}
      </div>
    </section>
  );
}
