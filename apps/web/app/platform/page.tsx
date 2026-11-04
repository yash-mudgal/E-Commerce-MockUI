"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton, type Tone } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/form";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { Paged, PlatformPlan, PlatformTenant } from "@/lib/types";
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
  const [assigning, setAssigning] = React.useState<PlatformTenant | null>(null);
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
            <PageHeader title="Stores" description="Every merchant on the platform. Suspending a store takes its storefront offline and makes its admin read-only; paying doesn't lift a platform suspension."
              actions={<Button asChild variant="secondary"><Link href="/platform/plans">Plans</Link></Button>} />
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
                          <Td><p className="font-medium">{t.name}</p><p className="text-xs text-fg-muted">{t.host} · {t.plan}{t.billing ? ` · ${billingLabel(t.billing)}` : ""}</p></Td>
                          <Td>
                            <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status === "PastDue" ? "Past due" : t.status}</Badge>
                            {t.suspensionReason && <p className="mt-1 text-xs text-fg-muted">{REASON[t.suspensionReason]}</p>}
                          </Td>
                          <Td className="hidden text-fg-muted md:table-cell">{t.ownerEmail ?? "—"}</Td>
                          <Td className="tabular hidden text-right sm:table-cell">{t.products}</Td>
                          <Td className="hidden text-fg-muted lg:table-cell">{formatDate(t.createdAt)}</Td>
                          <Td className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setAssigning(t)}>Plan<span className="sr-only"> for {t.name}</span></Button>
                              {t.suspensionReason === "Platform" ? (
                                <Button size="sm" variant="secondary" onClick={() => setActing({ tenant: t, action: "reactivate" })}>Reactivate</Button>
                              ) : (
                                <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setActing({ tenant: t, action: "suspend" })}>Suspend<span className="sr-only"> {t.name}</span></Button>
                              )}
                            </div>
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
        description={acting?.action === "suspend" ? "The storefront goes offline immediately and the merchant can no longer make changes. Paying doesn't lift this. It's recorded in the audit log." : "The platform suspension is lifted. The store returns to its billing state (trial, active, or closed if unpaid)."}
        footer={<><Button variant="secondary" onClick={() => setActing(null)}>Cancel</Button><Button variant={acting?.action === "suspend" ? "danger" : "primary"} loading={change.isPending} disabled={acting?.action === "suspend" && reason.trim().length < 3} onClick={() => acting && change.mutate(acting)}>{acting?.action === "suspend" ? "Suspend store" : "Reactivate"}</Button></>}
      >
        <Field label="Reason" hint="Kept in the audit log." optional={acting?.action !== "suspend"}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={acting?.action === "suspend" ? "e.g. Payment fraud investigation" : ""} />
        </Field>
      </Dialog>
      {assigning && <AssignPlanDialog tenant={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

const REASON = { Platform: "By ShopMint", TrialExpired: "Trial ended", PaymentFailed: "Unpaid" } as const;

function billingLabel(b: string) {
  const [gateway, status] = b.split(":");
  return `${gateway === "manual" ? "assigned plan" : gateway === "test" ? "test billing" : "Razorpay"} ${status.toLowerCase()}`;
}

function AssignPlanDialog({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const plans = useQuery({ queryKey: ["platform-plans"], queryFn: () => api<PlatformPlan[]>("/platform/plans") });
  const [plan, setPlan] = React.useState("");
  const [note, setNote] = React.useState("");
  const assign = useMutation({
    mutationFn: () => api(`/platform/tenants/${tenant.id}/plan`, { method: "POST", body: { planCode: plan === "none" ? null : plan, note: note.trim() || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform-tenants"] }); toast.notify(plan === "none" ? "Assigned plan ended" : "Plan assigned"); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !assign.isPending && onClose()} title={`Assign a plan to ${tenant.name}`}
      description="For contracts paid outside Razorpay (e.g. annual invoices). The store is active on this plan with no online payment. Stores paying through Razorpay must cancel first."
      footer={<><Button variant="secondary" onClick={onClose} disabled={assign.isPending}>Cancel</Button><Button disabled={!plan} loading={assign.isPending} onClick={() => assign.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Plan">
          <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">Choose…</option>
            {plans.data?.filter((p) => p.code !== "trial").map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            <option value="none">End the assigned plan</option>
          </Select>
        </Field>
        <Field label="Note" optional hint="Kept in the audit log."><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Annual contract #1042" /></Field>
        {assign.isError && <Alert tone="danger">{errorMessage(assign.error)}</Alert>}
      </div>
    </Dialog>
  );
}
