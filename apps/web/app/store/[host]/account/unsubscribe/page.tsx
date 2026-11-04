import type { Metadata } from "next";
import { Suspense } from "react";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { Unsubscribe } from "./unsubscribe";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false }, referrer: "no-referrer" };

export default function UnsubscribePage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <Suspense><Unsubscribe /></Suspense>
      <DynamicMarker />
    </div>
  );
}
