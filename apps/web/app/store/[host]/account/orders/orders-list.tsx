"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Package } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { OrderStatusBadge } from "@/components/orders/order-parts";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/display";
import { Pagination } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { useShopper } from "@/lib/shop";
import type { OrderSummary, Paged } from "@/lib/types";
import { formatDate, formatINR } from "@/lib/utils";

export function OrdersList() {
  const router = useRouter();
  const shopper = useShopper();
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    if (shopper.isSuccess && !shopper.data) router.replace("/account/login?next=/account/orders");
  }, [shopper.isSuccess, shopper.data, router]);
  const list = useQuery({
    queryKey: ["shopper-orders", page],
    queryFn: () => api<Paged<OrderSummary>>(`/storefront/account/orders?page=${page}`),
    enabled: !!shopper.data,
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted"><Link href="/account" className="hover:underline">Your account</Link> / Orders</nav>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Your orders</h1>
      {list.isError ? <Alert tone="danger" className="mt-6">{errorMessage(list.error)}</Alert>
        : !list.data ? <div className="mt-6 space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        : list.data.items.length === 0 ? (
          <div className="mt-10 flex flex-col items-center py-10 text-center">
            <Package className="size-10 text-fg-subtle" aria-hidden />
            <p className="mt-4 text-lg font-medium">No orders yet</p>
            <p className="mt-1 text-sm text-fg-muted">When you place an order, it shows up here.</p>
            <Button asChild className="mt-6"><Link href="/products">Browse products</Link></Button>
          </div>
        ) : (
          <>
            <ul className="mt-6 divide-y divide-border rounded-[var(--radius-card)] border border-border">
              {list.data.items.map((o) => (
                <li key={o.id}>
                  <Link href={`/account/orders/${o.id}`} className="flex items-center gap-4 p-4 hover:bg-surface-muted">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">Order #{o.number}<OrderStatusBadge status={o.status} /></p>
                      <p className="mt-0.5 text-sm text-fg-muted">{formatDate(o.placedAt)} · {o.itemCount} {o.itemCount === 1 ? "item" : "items"} · {o.paymentMethod === "Cod" ? "Cash on delivery" : "Paid online"}</p>
                    </div>
                    <p className="tabular font-semibold">{formatINR(o.total)}</p>
                    <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.totalCount} onPage={setPage} />
          </>
        )}
    </>
  );
}
