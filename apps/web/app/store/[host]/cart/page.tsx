import type { Metadata } from "next";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { CartView } from "./cart-view";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default function CartPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Your cart</h1>
      <CartView />
      <DynamicMarker />
    </div>
  );
}
