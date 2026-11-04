import type { Metadata } from "next";
import { Suspense } from "react";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { ShopperLoginForm } from "@/components/store/account-forms";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function Page() {
  return (
    <>
      <Suspense>
        <ShopperLoginForm />
      </Suspense>
      <DynamicMarker />
    </>
  );
}
