import type { Metadata } from "next";
import { Suspense } from "react";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { ShopperResetForm } from "@/components/store/account-forms";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false }, referrer: "no-referrer" };

export default function Page() {
  return (
    <>
      <Suspense>
        <ShopperResetForm />
      </Suspense>
      <DynamicMarker />
    </>
  );
}
