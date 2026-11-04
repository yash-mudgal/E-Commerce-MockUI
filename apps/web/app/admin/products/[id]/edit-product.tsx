"use client";

import { useQuery } from "@tanstack/react-query";
import { PackageX } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProductForm, ProductFormSkeleton } from "@/components/admin/product-form";
import { Button } from "@/components/ui/button";
import { Alert, Card, EmptyState } from "@/components/ui/display";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { Product } from "@/lib/types";

export function EditProduct() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["product", id], queryFn: () => api<Product>(`/admin/products/${id}`) });

  if (q.isPending) return <ProductFormSkeleton />;
  if (q.error instanceof ApiError && q.error.status === 404)
    return (
      <Card>
        <EmptyState icon={PackageX} title="Product not found" description="It may have been deleted, or it belongs to a different store." action={<Button asChild variant="secondary"><Link href="/admin/products">Back to products</Link></Button>} />
      </Card>
    );
  if (q.isError) return <Alert tone="danger" title="Couldn't load this product">{errorMessage(q.error)}</Alert>;
  return <ProductForm product={q.data} />;
}
