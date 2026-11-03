"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, Circle, PackagePlus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stat } from "@/components/ui/display";
import { Table, Td, Th } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import type { DashboardSummary, Store } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

export default function DashboardPage() {
  const me = useMe();
  const summary = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardSummary>("/admin/dashboard/summary"), enabled: can(me.data, "reports.read") });
  const store = useQuery({ queryKey: ["store"], queryFn: () => api<Store>("/admin/store") });
  const firstName = me.data?.user.name.split(" ")[0];

  return (
    <>
      <PageHeader title={firstName ? `Welcome back, ${firstName}` : "Dashboard"} description={store.data ? `Here's what's happening at ${store.data.name}.` : undefined} />

      {summary.isError ? (
        <Alert tone="danger" title="Couldn't load your dashboard" action={<Button variant="secondary" size="sm" onClick={() => summary.refetch()}><RefreshCw />Retry</Button>}>
          {errorMessage(summary.error)}
        </Alert>
      ) : (
        <div className="flex flex-col gap-6">
          <Card className="overflow-hidden">
            {/* 1px gaps over a border-coloured background draw the dividers at every breakpoint. */}
            <dl className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4 [&>div]:bg-surface">
              {summary.isPending ? (
                Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="p-5"><Skeleton className="h-4 w-24" /><Skeleton className="mt-3 h-7 w-16" /></div>
                ))
              ) : (
                <>
                  <Stat label="Active products" value={formatNumber(summary.data!.catalog.active)} hint={`${summary.data!.catalog.draft} draft`} />
                  <Stat label="Units in stock" value={formatNumber(summary.data!.catalog.unitsOnHand)} hint={`across ${summary.data!.catalog.variants} variants`} />
                  <Stat label="Low stock" value={formatNumber(summary.data!.catalog.lowStockVariants)} hint={`at or below ${store.data?.lowStockThreshold ?? "…"} units`} tone={summary.data!.catalog.lowStockVariants ? "warning" : undefined} />
                  <Stat label="Out of stock" value={formatNumber(summary.data!.catalog.outOfStockVariants)} hint="active variants" tone={summary.data!.catalog.outOfStockVariants ? "danger" : undefined} />
                </>
              )}
            </dl>
          </Card>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Sales" description="Revenue, orders and trends" />
              <EmptyState
                icon={BarChart3}
                title="Sales analytics start with your first order"
                description="Checkout and payments are being built next. Once orders come in, revenue, order volume and average order value will appear here from real data."
              />
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Get ready to sell" description="Set up the essentials for your store" />
              <SetupChecklist products={summary.data?.catalog.products} store={store.data} loading={summary.isPending || store.isPending} />
            </Card>
          </div>

          <Card>
            <CardHeader title="Needs restocking" description="Active variants at or below your low-stock threshold" action={<Button asChild variant="secondary" size="sm"><Link href="/admin/products">All products</Link></Button>} />
            {summary.isPending ? (
              <div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
            ) : summary.data!.lowStock.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Stock levels look healthy" description="Nothing is at or below your low-stock threshold." />
            ) : (
              <Table>
                <thead>
                  <tr><Th>Product</Th><Th className="hidden sm:table-cell">SKU</Th><Th className="text-right">Available</Th></tr>
                </thead>
                <tbody>
                  {summary.data!.lowStock.map((v) => (
                    <tr key={v.sku} className="hover:bg-surface-muted/50">
                      <Td>
                        <Link href={`/admin/products/${v.productId}`} className="font-medium text-fg hover:text-brand">{v.title}</Link>
                        {v.optionValues.length > 0 && <span className="ml-2 text-fg-muted">{v.optionValues.join(" / ")}</span>}
                      </Td>
                      <Td className="hidden font-mono text-xs text-fg-muted sm:table-cell">{v.sku}</Td>
                      <Td className="text-right">
                        <Badge tone={v.onHand <= 0 ? "danger" : "warning"}>{v.onHand <= 0 ? "Out of stock" : `${v.onHand} left`}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function SetupChecklist({ products, store, loading }: { products?: number; store?: Store; loading: boolean }) {
  if (loading) return <div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>;
  const steps = [
    { done: (products ?? 0) > 0, label: "Add your first product", href: "/admin/products/new" },
    { done: !!store?.gstin, label: "Add your GSTIN for tax invoices", href: "/admin/settings" },
    { done: !!store?.tagline, label: "Write a tagline for your storefront", href: "/admin/settings" },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  return (
    <div className="p-2">
      <ul>
        {steps.map((s) => (
          <li key={s.label}>
            <Link href={s.href} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-surface-muted">
              {s.done ? <CheckCircle2 className="size-4 text-success" aria-label="Done" /> : <Circle className="size-4 text-fg-subtle" aria-label="To do" />}
              <span className={s.done ? "text-fg-muted line-through" : "font-medium"}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {remaining === 0 ? (
        <p className="px-3 pt-1 pb-3 text-sm text-fg-muted">All set. Your storefront is ready for shoppers.</p>
      ) : (products ?? 0) === 0 ? (
        <div className="px-3 pt-2 pb-3">
          <Button asChild size="sm"><Link href="/admin/products/new"><PackagePlus />Add product</Link></Button>
        </div>
      ) : null}
    </div>
  );
}
