import type { Metadata } from "next";
import { Suspense } from "react";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { ShopperForgotForm } from "@/components/store/account-forms";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function Page() {
  return (
    <>
      <Suspense>
        <ShopperForgotForm />
      </Suspense>
      <DynamicMarker />
    </>
  );
}
