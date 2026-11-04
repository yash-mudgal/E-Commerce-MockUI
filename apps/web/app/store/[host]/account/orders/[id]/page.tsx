import type { Metadata } from "next";
import { Suspense } from "react";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { OrderView } from "./order-view";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };

export default function OrderPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <Suspense><OrderView /></Suspense>
      <DynamicMarker />
    </div>
  );
}
