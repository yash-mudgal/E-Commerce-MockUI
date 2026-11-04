import type { Metadata } from "next";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { CheckoutView } from "./checkout-view";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>
      <CheckoutView />
      <DynamicMarker />
    </div>
  );
}
