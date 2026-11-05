import type { Metadata } from "next";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { WishlistView } from "./wishlist-view";

export const metadata: Metadata = { title: "Your wishlist", robots: { index: false } };

export default function WishlistPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <WishlistView />
      <DynamicMarker />
    </div>
  );
}
