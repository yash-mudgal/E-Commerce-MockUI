import type { Metadata } from "next";
import { Suspense } from "react";
import { EditProduct } from "./edit-product";
import { ProductFormSkeleton } from "@/components/admin/product-form";

export const metadata: Metadata = { title: "Edit product" };

export default function EditProductPage() {
  return (
    <Suspense fallback={<ProductFormSkeleton />}>
      <EditProduct />
    </Suspense>
  );
}
