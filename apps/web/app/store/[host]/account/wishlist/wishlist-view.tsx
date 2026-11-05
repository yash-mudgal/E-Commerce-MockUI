"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ProductCard, ProductGridSkeleton } from "@/components/store/product-card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/display";
import { errorMessage } from "@/lib/api";
import { useShopper, useWishlist } from "@/lib/shop";

export function WishlistView() {
  const shopper = useShopper();
  const router = useRouter();
  const list = useWishlist(!!shopper.data);
  React.useEffect(() => {
    if (shopper.isSuccess && !shopper.data) router.replace("/account/login?next=/account/wishlist");
  }, [shopper.isSuccess, shopper.data, router]);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
        <Link href="/account" className="hover:text-fg">Your account</Link> <span aria-hidden>/</span> <span className="text-fg">Wishlist</span>
      </nav>
      <h1 className="mt-4 font-display text-4xl tracking-tight sm:text-5xl">Your wishlist</h1>
      {list.isError ? (
        <Alert tone="danger" className="mt-8" title="Couldn't load your wishlist">{errorMessage(list.error)}</Alert>
      ) : !list.data ? (
        <ProductGridSkeleton count={4} className="mt-10" />
      ) : list.data.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center">
          <Heart className="size-9 text-fg-subtle" strokeWidth={1.5} aria-hidden />
          <p className="mt-4 font-display text-2xl">Nothing saved yet</p>
          <p className="mt-1 text-sm text-fg-muted">Tap the heart on any product to keep it here.</p>
          <Button asChild className="mt-6"><Link href="/products">Browse products</Link></Button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-fg-muted">{list.data.length} saved {list.data.length === 1 ? "product" : "products"}</p>
          <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
            {list.data.map((p) => <ProductCard key={p.slug} p={p} />)}
          </div>
        </>
      )}
    </>
  );
}
