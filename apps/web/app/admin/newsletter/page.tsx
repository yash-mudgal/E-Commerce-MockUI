"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Mail, RefreshCw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton, Stat } from "@/components/ui/display";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import { formatDate } from "@/lib/utils";

type Page = { items: { email: string; status: "Pending" | "Subscribed" | "Unsubscribed"; confirmedAt: string | null; createdAt: string }[];
  page: number; pageSize: number; totalCount: number; counts: { subscribed: number; pending: number; unsubscribed: number } };

export default function NewsletterPage() {
  const me = useMe();
  const allowed = !!me.data && can(me.data, "orders.read");
  const [status, setStatus] = React.useState<"" | "Subscribed" | "Pending" | "Unsubscribed">("Subscribed");
  const [page, setPage] = React.useState(1);
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  const list = useQuery({ queryKey: ["newsletter", params.toString()], queryFn: () => api<Page>(`/admin/newsletter?${params}`), enabled: allowed, placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Newsletter" description="People who signed up in your store's footer. They're only counted as subscribed after confirming by email (double opt-in). Export them to the email tool you use."
        actions={allowed && <Button asChild variant="secondary"><a href="/api/admin/newsletter/subscribers.csv" download><Download />Export subscribers (CSV)</a></Button>} />
      {me.isPending ? <Skeleton className="h-64" /> : !allowed ? <Card><EmptyState icon={Mail} title="You don't have access to the newsletter list" /></Card> : (
        <>
          {list.data && (
            <Card className="mb-6">
              <dl className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Stat label="Subscribed" value={list.data.counts.subscribed} />
                <Stat label="Waiting to confirm" value={list.data.counts.pending} />
                <Stat label="Unsubscribed" value={list.data.counts.unsubscribed} />
              </dl>
            </Card>
          )}
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {(["Subscribed", "Pending", "Unsubscribed", ""] as const).map((s) => (
              <Button key={s || "all"} size="sm" variant={status === s ? "primary" : "secondary"} aria-pressed={status === s} onClick={() => { setStatus(s); setPage(1); }}>
                {s === "Pending" ? "Waiting to confirm" : s || "All"}
              </Button>
            ))}
          </div>
          <Card>
            {list.isError ? <div className="p-5"><Alert tone="danger" title="Couldn't load subscribers" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
              : list.isPending ? <div className="p-5"><Skeleton className="h-32" /></div>
              : list.data.items.length === 0 ? <EmptyState icon={Mail} title="No one here yet" description="Shoppers sign up from the newsletter box in your store's footer." />
              : (
                <>
                  <Table>
                    <thead><tr><Th>Email</Th><Th>Status</Th><Th>Signed up</Th><Th>Confirmed</Th></tr></thead>
                    <tbody>
                      {list.data.items.map((s) => (
                        <tr key={s.email} className="border-t border-border">
                          <Td>{s.email}</Td>
                          <Td><Badge tone={s.status === "Subscribed" ? "success" : s.status === "Pending" ? "warning" : "neutral"}>{s.status === "Pending" ? "Waiting to confirm" : s.status}</Badge></Td>
                          <Td>{formatDate(s.createdAt)}</Td>
                          <Td>{s.confirmedAt ? formatDate(s.confirmedAt) : "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <div className="border-t border-border p-3"><Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.totalCount} onPage={setPage} /></div>
                </>
              )}
          </Card>
        </>
      )}
    </>
  );
}
