import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductsList } from "./products-list";
import { Skeleton } from "@/components/ui/display";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ProductsList />
    </Suspense>
  );
}
