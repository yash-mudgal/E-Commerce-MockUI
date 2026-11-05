"use client";

import Image from "next/image";
import * as React from "react";
import type { StorefrontImage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductImagePlaceholder } from "./product-card";

/**
 * Product images. Desktop: thumbnails beside one large image. Mobile: a swipeable strip with position dots.
 */
export function Gallery({ title, images }: { title: string; images: StorefrontImage[] }) {
  const [active, setActive] = React.useState(0);
  const strip = React.useRef<HTMLDivElement>(null);
  if (images.length === 0)
    return <div className="overflow-hidden rounded-[var(--radius-card)]"><ProductImagePlaceholder title={title} /></div>;
  const current = images[Math.min(active, images.length - 1)];
  const onScroll = () => {
    const el = strip.current;
    if (el) setActive(Math.round(el.scrollLeft / el.clientWidth));
  };
  return (
    <div>
      {/* Mobile: swipe between images. */}
      <div className="md:hidden">
        <div ref={strip} onScroll={onScroll} className="-mx-4 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]" aria-label="Product images" role="region" tabIndex={0}>
          {images.map((img, i) => (
            <div key={img.url} className="relative aspect-[4/5] w-full shrink-0 snap-center bg-surface-muted">
              <Image src={img.url} alt={img.altText ?? `${title}, image ${i + 1}`} fill priority={i === 0} sizes="100vw" className="object-cover" />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
            {images.map((img, i) => <span key={img.url} className={cn("h-1.5 rounded-full transition-all", i === active ? "w-5 bg-fg" : "w-1.5 bg-border-strong")} />)}
          </div>
        )}
      </div>

      {/* Desktop: thumbnails on the left. */}
      <div className={cn("hidden gap-4 md:grid", images.length > 1 ? "grid-cols-[72px_1fr]" : "grid-cols-1")}>
        {images.length > 1 && (
          <ul className="flex flex-col gap-3" aria-label="Product images">
            {images.map((img, i) => (
              <li key={img.url}>
                <button type="button" onClick={() => setActive(i)}
                  aria-label={`Show image ${i + 1} of ${images.length}${img.altText ? `: ${img.altText}` : ""}`}
                  aria-current={i === active ? "true" : undefined}
                  className={cn("relative block aspect-[4/5] w-full overflow-hidden rounded-[2px] bg-surface-muted transition-opacity", i === active ? "ring-1 ring-fg ring-offset-2" : "opacity-70 hover:opacity-100")}>
                  <Image src={img.url} alt="" fill sizes="72px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-surface-muted">
          <Image src={current.url} alt={current.altText ?? title} fill priority sizes="(min-width: 1024px) 50vw, 60vw" className="object-cover" />
        </div>
      </div>
    </div>
  );
}
