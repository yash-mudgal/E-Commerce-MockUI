import type { Metadata } from "next";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { OrdersList } from "./orders-list";

export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

export default function OrdersPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <OrdersList />
      <DynamicMarker />
    </div>
  );
}
