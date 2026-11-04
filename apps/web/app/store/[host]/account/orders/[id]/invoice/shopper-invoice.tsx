"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Invoice } from "@/components/orders/invoice";
import { Alert, Skeleton } from "@/components/ui/display";
import { api, errorMessage } from "@/lib/api";
import type { Order } from "@/lib/types";

export function ShopperInvoice() {
  const { id } = useParams<{ id: string }>();
  const order = useQuery({ queryKey: ["shopper-order", id], queryFn: () => api<Order>(`/storefront/account/orders/${id}`) });
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-fg-muted print:hidden">
        <Link href="/account/orders" className="hover:underline">Your orders</Link> / <Link href={`/account/orders/${id}`} className="hover:underline">Order{order.data ? ` #${order.data.number}` : ""}</Link> / Invoice
      </nav>
      {order.isError ? <Alert tone="danger">{errorMessage(order.error)}</Alert> : !order.data ? <Skeleton className="h-96" /> : <Invoice order={order.data} />}
    </>
  );
}
