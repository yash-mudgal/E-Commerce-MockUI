"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw, Search, ShoppingCart } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/orders/order-parts";
import { Button } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import type { OrderSummary, Paged } from "@/lib/types";
import { cn, formatDate, formatINR } from "@/lib/utils";

const PAGE_SIZE = 25;
const TABS = [
  { value: "", label: "All" },
  { value: "open", label: "To fulfil" },
  { value: "PendingPayment", label: "Awaiting payment" },
  { value: "Shipped", label: "Shipped" },
  { value: "Delivered", label: "Delivered" },
  { value: "Cancelled", label: "Cancelled" },
] as const;

export default function OrdersPage() {
  const me = useMe();
  const allowed = can(me.data, "orders.read");
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({
    queryKey: ["orders", status, search, page],
    queryFn: () => api<Paged<OrderSummary>>(`/admin/orders?page=${page}&pageSize=${PAGE_SIZE}${status ? `&status=${status}` : ""}${search ? `&q=${encodeURIComponent(search)}` : ""}`),
    enabled: allowed,
    placeholderData: keepPreviousData,
  });

  if (me.data && !allowed) return <><PageHeader title="Orders" /><Alert tone="info">You don&apos;t have access to orders.</Alert></>;
  return (
    <>
      <PageHeader title="Orders" description="Orders from your storefront. Confirmed orders are ready to pack and ship." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Filter orders" className="flex flex-wrap gap-1 rounded-md bg-surface-muted p-1">
          {TABS.map((t) => (
            <button key={t.value} role="tab" aria-selected={status === t.value} onClick={() => { setStatus(t.value); setPage(1); }}
              className={cn("rounded px-3 py-1.5 text-sm font-medium", status === t.value ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order #, name, email or mobile" aria-label="Search orders" className="pl-9" />
        </div>
      </div>
      <Card>
        {list.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : list.isError ? (
          <div className="p-5"><Alert tone="danger" title="Couldn't load orders" action={<Button variant="secondary" size="sm" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={ShoppingCart} title={search || status ? "No matching orders" : "No orders yet"}
            description={search || status ? "Try a different filter or search." : "When shoppers check out on your storefront, their orders appear here."} />
        ) : (
          <>
            <Table aria-busy={list.isFetching}>
              <thead>
                <tr><Th>Order</Th><Th>Customer</Th><Th className="hidden md:table-cell">Status</Th><Th className="hidden lg:table-cell">Payment</Th><Th className="text-right">Total</Th></tr>
              </thead>
              <tbody>
                {list.data.items.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-muted/60">
                    <Td>
                      <Link href={`/admin/orders/${o.id}`} className="font-medium text-brand hover:underline">#{o.number}</Link>
                      <p className="text-[13px] text-fg-muted">{formatDate(o.placedAt)} · {o.itemCount} {o.itemCount === 1 ? "item" : "items"}</p>
                      <div className="mt-1 md:hidden"><OrderStatusBadge status={o.status} /></div>
                    </Td>
                    <Td><p className="font-medium">{o.customerName}</p><p className="text-[13px] break-all text-fg-muted">{o.email}</p></Td>
                    <Td className="hidden md:table-cell"><OrderStatusBadge status={o.status} /></Td>
                    <Td className="hidden lg:table-cell"><PaymentStatusBadge status={o.paymentStatus} /></Td>
                    <Td className="tabular text-right font-medium">{formatINR(o.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.totalCount} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
