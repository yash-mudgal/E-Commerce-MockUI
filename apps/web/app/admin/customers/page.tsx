"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw, Search, UserRound } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import type { AdminCustomer, Paged } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 25;

export default function CustomersPage() {
  const me = useMe();
  const allowed = can(me.data, "orders.read");
  const [q, setQ] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({
    queryKey: ["customers", search, page],
    queryFn: () => api<Paged<AdminCustomer>>(`/admin/customers?page=${page}&pageSize=${PAGE_SIZE}${search ? `&q=${encodeURIComponent(search)}` : ""}`),
    enabled: allowed,
    placeholderData: keepPreviousData,
  });

  if (!allowed) return <><PageHeader title="Customers" /><Alert tone="info">You don&apos;t have access to customer details.</Alert></>;
  return (
    <>
      <PageHeader title="Customers" description="Shoppers who created an account on your storefront. Marketing email goes only to those who opted in." />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email or mobile" aria-label="Search customers" className="pl-9" />
      </div>
      <Card>
        {list.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : list.isError ? (
          <div className="p-5"><Alert tone="danger" title="Couldn't load customers" action={<Button variant="secondary" size="sm" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={UserRound} title={search ? "No matching customers" : "No customer accounts yet"}
            description={search ? "Try a different search." : "Shoppers can create an account from your storefront to save their cart and addresses."} />
        ) : (
          <>
            <Table aria-busy={list.isFetching}>
              <thead>
                <tr><Th>Customer</Th><Th className="hidden md:table-cell">Mobile</Th><Th className="hidden sm:table-cell">Joined</Th><Th>Marketing</Th></tr>
              </thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.id}>
                    <Td><p className="font-medium">{c.name}</p><p className="text-[13px] break-all text-fg-muted">{c.email}</p></Td>
                    <Td className="hidden tabular-nums text-fg-muted md:table-cell">{c.phone ?? "—"}</Td>
                    <Td className="hidden text-fg-muted sm:table-cell">{formatDate(c.createdAt)}</Td>
                    <Td>{c.marketingOptIn ? <Badge tone="success">Opted in</Badge> : <span className="text-fg-muted">No</span>}</Td>
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
