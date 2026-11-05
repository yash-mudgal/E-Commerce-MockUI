"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { useShopper, useWishlist, wishlistKey } from "@/lib/shop";
import { cn } from "@/lib/utils";

const noop = () => () => {};

/** Save/unsave a product. Guests are taken to sign in and come back here. */
export function WishlistButton({ slug, title, variant = "overlay", className }: { slug: string; title: string; variant?: "overlay" | "inline"; className?: string }) {
  const hydrated = React.useSyncExternalStore(noop, () => true, () => false);
  const shopper = useShopper();
  const signedIn = hydrated && !!shopper.data;
  const list = useWishlist(signedIn);
  const saved = signedIn && !!list.data?.some((p) => p.slug === slug);
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const toggle = useMutation({
    mutationFn: () => api(`/storefront/account/wishlist/${encodeURIComponent(slug)}`, { method: saved ? "DELETE" : "PUT" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: wishlistKey }),
  });
  const label = saved ? `Remove ${title} from your wishlist` : `Save ${title} to your wishlist`;
  return (
    <>
      <button
        type="button"
        aria-pressed={saved}
        aria-label={label}
        title={toggle.isError ? errorMessage(toggle.error) : undefined}
        // Until we know whether the shopper is signed in, a click would wrongly send them to sign in.
        disabled={toggle.isPending || !hydrated || shopper.isPending}
        onClick={(e) => {
          e.preventDefault();
          if (!signedIn) { router.push(`/account/login?next=${encodeURIComponent(pathname)}`); return; }
          toggle.mutate();
        }}
        className={cn(
          "inline-flex items-center justify-center transition-colors disabled:opacity-60",
          variant === "overlay"
            ? "size-9 rounded-full bg-surface/90 text-fg shadow-sm backdrop-blur hover:bg-surface"
            : "h-12 gap-2 rounded-[var(--radius-control)] border border-border-strong bg-surface px-4 text-sm hover:border-fg",
          className,
        )}
      >
        <Heart className={cn("size-[18px]", saved && "fill-current text-danger")} strokeWidth={1.75} aria-hidden />
        {variant === "inline" && <span>{saved ? "Saved" : "Save"}</span>}
      </button>
      {toggle.isError && variant === "inline" && <p className="mt-2 text-sm text-danger" role="alert">{errorMessage(toggle.error)}</p>}
    </>
  );
}
