"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton, type Tone } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { Paged, PlatformTenant } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const STATUS_TONE: Record<string, Tone> = { Active: "success", Trialing: "info", PastDue: "warning", Suspended: "danger", Cancelled: "neutral" };

export default function PlatformPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [acting, setActing] = React.useState<{ tenant: PlatformTenant; action: "suspend" | "reactivate" } | null>(null);
  const [reason, setReason] = React.useState("");

  React.useEffect(() => { const t = setTimeout(() => { setDebounced(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const isAdmin = me.data?.user.isPlatformAdmin;
  const list = useQuery({
    queryKey: ["platform-tenants", debounced, page],
    queryFn: () => api<Paged<PlatformTenant>>(`/platform/tenants?page=${page}&pageSize=20${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`),
    enabled: !!isAdmin,
    placeholderData: keepPreviousData,
  });

  const change = useMutation({
    mutationFn: ({ tenant, action }: { tenant: PlatformTenant; action: string }) => api<void>(`/platform/tenants/${tenant.id}/${action}`, { method: "POST", body: { reason } }),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["platform-tenants"] }); toast.notify(`${v.tenant.name} ${v.action === "suspend" ? "suspended" : "reactivated"}`); setActing(null); setReason(""); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Logo />
          <Badge tone="brand">Platform</Badge>
          <span className="flex-1" />
          <Button asChild variant="ghost" size="sm"><Link href="/admin"><ArrowLeft />Merchant admin</Link></Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {me.isPending ? (
          <Skeleton className="h-64" />
        ) : !isAdmin ? (
          <Card><EmptyState icon={ShieldAlert} title="Platform access required" description="This console is only available to ShopMint operators." /></Card>
        ) : (
          <>
            <PageHeader title="Stores" description="Every merchant on the platform. Suspending a store takes its storefront offline and makes its admin read-only." />
            <Card>
              <div className="border-b border-border p-3">
                <div className="relative sm:w-80">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
                  <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or address" className="pl-9" aria-label="Search stores" />
                </div>
              </div>
              {list.isError ? (
                <div className="p-5"><Alert tone="danger" title="Couldn't load stores" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
              ) : list.isPending ? (
                <div className="space-y-3 p-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : list.data.items.length === 0 ? (
                <EmptyState icon={Building2} title="No stores found" />
              ) : (
                <>
                  <Table>
                    <thead><tr><Th>Store</Th><Th>Status</Th><Th className="hidden md:table-cell">Owner</Th><Th className="hidden text-right sm:table-cell">Products</Th><Th className="hidden lg:table-cell">Created</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                    <tbody>
                      {list.data.items.map((t) => (
                        <tr key={t.id} className="hover:bg-surface-muted/50">
                          <Td><p className="font-medium">{t.name}</p><p className="text-xs text-fg-muted">{t.host} · {t.plan}</p></Td>
                          <Td><Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status === "PastDue" ? "Past due" : t.status}</Badge></Td>
                          <Td className="hidden text-fg-muted md:table-cell">{t.ownerEmail ?? "—"}</Td>
                          <Td className="tabular hidden text-right sm:table-cell">{t.products}</Td>
                          <Td className="hidden text-fg-muted lg:table-cell">{formatDate(t.createdAt)}</Td>
                          <Td className="text-right">
                            {t.status === "Suspended" ? (
                              <Button size="sm" variant="secondary" onClick={() => setActing({ tenant: t, action: "reactivate" })}>Reactivate</Button>
                            ) : (
                              <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setActing({ tenant: t, action: "suspend" })}>Suspend</Button>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <Pagination page={page} pageSize={20} total={list.data.totalCount} onPage={setPage} />
                </>
              )}
            </Card>
          </>
        )}
      </main>
      <Dialog
        open={!!acting}
        onOpenChange={(o) => { if (!o) { setActing(null); setReason(""); } }}
        title={acting?.action === "suspend" ? `Suspend ${acting?.tenant.name}?` : `Reactivate ${acting?.tenant.name}?`}
        description={acting?.action === "suspend" ? "The storefront goes offline immediately and the merchant can no longer make changes. This is recorded in the audit log." : "The storefront comes back online and the merchant regains full access."}
        footer={<><Button variant="secondary" onClick={() => setActing(null)}>Cancel</Button><Button variant={acting?.action === "suspend" ? "danger" : "primary"} loading={change.isPending} disabled={acting?.action === "suspend" && reason.trim().length < 3} onClick={() => acting && change.mutate(acting)}>{acting?.action === "suspend" ? "Suspend store" : "Reactivate"}</Button></>}
      >
        <Field label="Reason" hint="Kept in the audit log." optional={acting?.action !== "suspend"}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={acting?.action === "suspend" ? "e.g. Payment fraud investigation" : ""} />
        </Field>
      </Dialog>
    </div>
  );
}
