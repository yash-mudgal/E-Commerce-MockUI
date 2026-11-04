import type { Metadata } from "next";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { CartView } from "./cart-view";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default function CartPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Your cart</h1>
      <CartView />
      <DynamicMarker />
    </div>
  );
}
