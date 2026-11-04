import type { Metadata } from "next";
import { Suspense } from "react";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { ShopperInvoice } from "./shopper-invoice";

export const metadata: Metadata = { title: "Invoice", robots: { index: false } };

export default function InvoicePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:p-0">
      <Suspense><ShopperInvoice /></Suspense>
      <DynamicMarker />
    </div>
  );
}
