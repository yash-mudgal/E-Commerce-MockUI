import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ShopperSignupForm } from "@/components/store/account-forms";
import { getStore } from "@/lib/storefront";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

type Params = Promise<{ host: string }>;

export default function Page({ params }: { params: Params }) {
  return (
    <Suspense>
      <Signup params={params} />
    </Suspense>
  );
}

async function Signup({ params }: { params: Params }) {
  const { host } = await params;
  const store = await getStore(host);
  if (!store) notFound();
  return <ShopperSignupForm storeName={store.name} />;
}
