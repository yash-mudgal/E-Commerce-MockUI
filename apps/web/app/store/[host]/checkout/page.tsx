import type { Metadata } from "next";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { CheckoutView } from "./checkout-view";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Checkout</h1>
      <CheckoutView />
      <DynamicMarker />
    </div>
  );
}
