"use client";

import Image from "next/image";
import * as React from "react";
import type { StorefrontImage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductImagePlaceholder } from "./product-card";

/** Product page images: one large image and a row of thumbnails to switch between them. */
export function Gallery({ title, images }: { title: string; images: StorefrontImage[] }) {
  const [active, setActive] = React.useState(0);
  if (images.length === 0)
    return (
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
        <ProductImagePlaceholder title={title} />
      </div>
    );
  const current = images[Math.min(active, images.length - 1)];
  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-muted">
        <Image src={current.url} alt={current.altText ?? title} fill priority sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
      </div>
      {images.length > 1 && (
        <ul className="grid grid-cols-5 gap-2" aria-label="Product images">
          {images.map((img, i) => (
            <li key={img.url}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show image ${i + 1} of ${images.length}${img.altText ? `: ${img.altText}` : ""}`}
                aria-current={i === active ? "true" : undefined}
                className={cn("relative block aspect-square w-full overflow-hidden rounded-md border", i === active ? "border-brand ring-2 ring-brand/30" : "border-border hover:border-border-strong")}
              >
                <Image src={img.url} alt="" fill sizes="96px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
