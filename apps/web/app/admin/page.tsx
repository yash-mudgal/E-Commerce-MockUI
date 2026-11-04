"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, CheckCircle2, Circle, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stat } from "@/components/ui/display";
import { Table, Td, Th } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { storefrontUrl } from "@/components/admin/shell";
import { can, onboardingKey, useMe } from "@/lib/hooks";
import type { DashboardSummary, OnboardingStatus, Store } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

export default function DashboardPage() {
  const me = useMe();
  const summary = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardSummary>("/admin/dashboard/summary"), enabled: can(me.data, "reports.read") });
  const store = useQuery({ queryKey: ["store"], queryFn: () => api<Store>("/admin/store") });
  const onboarding = useQuery({ queryKey: onboardingKey, queryFn: () => api<OnboardingStatus>("/admin/onboarding") });
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
              <LaunchStatus status={onboarding.data} host={me.data?.tenant?.host} error={onboarding.error} />
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

function LaunchStatus({ status, host, error }: { status?: OnboardingStatus; host?: string; error: unknown }) {
  if (error) return <><CardHeader title="Launch checklist" /><div className="p-5"><Alert tone="danger">{errorMessage(error)}</Alert></div></>;
  if (!status) return <><CardHeader title="Launch checklist" /><div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div></>;
  const remaining = status.steps.filter((s) => !s.done);
  const done = status.steps.length - remaining.length;
  if (status.isLive)
    return (
      <>
        <CardHeader title="Your store is live" description={host} />
        <div className="flex flex-col gap-3 p-5 pt-1 text-sm">
          <p className="text-fg-muted">Shoppers can browse your catalogue now. {remaining.length > 0 && `${remaining.length} optional ${remaining.length === 1 ? "step is" : "steps are"} still open.`}</p>
          <div className="flex flex-wrap gap-2">
            {host && <Button asChild variant="secondary" size="sm"><a href={storefrontUrl(host)} target="_blank" rel="noreferrer">View storefront<ExternalLink /><span className="sr-only">(opens in a new tab)</span></a></Button>}
            {remaining.length > 0 && <Button asChild variant="ghost" size="sm"><Link href="/admin/setup">Finish setup</Link></Button>}
          </div>
        </div>
      </>
    );
  return (
    <>
      <CardHeader title="Get ready to launch" description={`${done} of ${status.steps.length} steps done`} />
      <div className="p-2">
        <ul>
          {remaining.slice(0, 4).map((s) => (
            <li key={s.key}>
              <Link href="/admin/setup" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-surface-muted">
                <Circle className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="font-medium">{s.title}</span>
                {s.required && <span className="ml-auto text-xs text-fg-muted">Required</span>}
              </Link>
            </li>
          ))}
          {done > 0 && (
            <li className="flex items-center gap-3 px-3 py-2.5 text-sm text-fg-muted">
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
              {done} {done === 1 ? "step" : "steps"} complete
            </li>
          )}
        </ul>
        <div className="px-3 pt-2 pb-3">
          <Button asChild size="sm"><Link href="/admin/setup">{status.canLaunch ? "Review and launch" : "Continue setup"}<ArrowRight /></Link></Button>
        </div>
      </div>
    </>
  );
}
