"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Invoice } from "@/components/orders/invoice";
import { Alert, Skeleton } from "@/components/ui/display";
import { api, errorMessage } from "@/lib/api";
import type { Order } from "@/lib/types";

export function AdminInvoice() {
  const { id } = useParams<{ id: string }>();
  const order = useQuery({ queryKey: ["order", id], queryFn: () => api<Order>(`/admin/orders/${id}`) });
  return (
    <div className="mx-auto max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-fg-muted print:hidden">
        <Link href="/admin/orders" className="hover:underline">Orders</Link> / <Link href={`/admin/orders/${id}`} className="hover:underline">#{order.data?.number ?? "…"}</Link> / Invoice
      </nav>
      {order.isError ? <Alert tone="danger">{errorMessage(order.error)}</Alert> : !order.data ? <Skeleton className="h-96" /> : <Invoice order={order.data} />}
    </div>
  );
}
