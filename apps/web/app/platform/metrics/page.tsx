"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw, ShieldAlert } from "lucide-react";
import * as React from "react";
import { BarChart, countMax } from "@/components/admin/bar-chart";
import { PlatformHeader } from "@/components/platform/header";
import { isMfaRequired, MfaRequiredCard } from "@/components/platform-mfa";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stat } from "@/components/ui/display";
import { Field, Select } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { emailHealth, funnelSteps, METRICS_PRESETS, metricsRange, paymentHealth, type MetricsPreset } from "@/lib/platform-metrics";
import { periodLabel } from "@/lib/reports";
import type { PlatformMetrics } from "@/lib/types";
import { formatDate, formatINR } from "@/lib/utils";

const num = (n: number) => n.toLocaleString("en-IN");
const count = (n: number) => `${num(n)}`;

export default function PlatformMetricsPage() {
  const me = useMe();
  const isAdmin = me.data?.user.isPlatformAdmin;
  return (
    <div className="min-h-dvh">
      <PlatformHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {me.isPending ? <Skeleton className="h-64" /> : !isAdmin ? (
          <Card><EmptyState icon={ShieldAlert} title="Platform access required" description="This console is only available to ShopMint operators." /></Card>
        ) : <MetricsLoader />}
      </main>
    </div>
  );
}

/** Rendered only once the user is known, so "today" is read in the browser, never while prerendering the shell. */
function MetricsLoader() {
  const [preset, setPreset] = React.useState<MetricsPreset>("90d");
  const range = metricsRange(preset);
  const metrics = useQuery({
    queryKey: ["platform-metrics", range.from, range.to],
    queryFn: () => api<PlatformMetrics>(`/platform/metrics?from=${range.from}&to=${range.to}`),
    placeholderData: keepPreviousData,
  });
  return (
          <>
            <PageHeader title="Metrics"
              description="Computed from the database when you open this page; nothing is sampled. Plan prices exclude GST. Weeks run Monday to Sunday, India time."
              actions={
                <Field label="Period" className="w-48">
                  <Select value={preset} onChange={(e) => setPreset(e.target.value as MetricsPreset)}>
                    {METRICS_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
              } />
            {metrics.isError && isMfaRequired(metrics.error) ? <MfaRequiredCard /> : metrics.isError ? (
              <Alert tone="danger" title="Couldn't load metrics" action={<Button size="sm" variant="secondary" onClick={() => metrics.refetch()}><RefreshCw />Retry</Button>}>
                {errorMessage(metrics.error)}
              </Alert>
            ) : metrics.isPending ? (
              <div className="grid gap-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
            ) : <Metrics m={metrics.data} />}
          </>
  );
}

function Metrics({ m }: { m: PlatformMetrics }) {
  const [table, setTable] = React.useState(false);
  const pay = paymentHealth(m.payments.successRate, m.payments.captured + m.payments.failed);
  const mail = emailHealth(m.email);
  const steps = funnelSteps(m.funnel);
  const label = (w: string) => periodLabel(w, "week");
  const period = `${formatDate(m.from)} – ${formatDate(m.to)}`;
  return (
    <div className="grid gap-6">
      <section aria-labelledby="now-heading">
        <h2 id="now-heading" className="mb-3 text-sm font-semibold text-fg-muted">Now <span className="font-normal">· as of {new Date(m.asOf).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span></h2>
        <Card>
          <dl className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
            <Stat label="Monthly recurring revenue" value={formatINR(m.revenue.mrr)} hint={`${num(m.revenue.payingStores)} stores on paid plans`} />
            <Stat label="At risk (past due)" value={formatINR(m.revenue.pastDueMrr)} tone={Number(m.revenue.pastDueMrr) > 0 ? "warning" : undefined}
              hint={`${num(m.stores.pastDue)} stores with a failed payment`} />
            <Stat label="Stores" value={num(m.stores.total)} hint={`${num(m.stores.launched)} launched`} />
            <Stat label="In trial" value={num(m.stores.trialing)} hint={`${num(m.stores.suspended)} suspended · ${num(m.stores.cancelled)} cancelled`} />
          </dl>
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recurring revenue by plan" description="Stores currently active on a paid plan" />
          {m.revenue.byPlan.length === 0 ? <p className="px-5 pb-5 text-sm text-fg-muted">No store is on a paid plan yet.</p> : (
            <Table>
              <thead><tr><Th>Plan</Th><Th className="text-right">Stores</Th><Th className="text-right">Price / month</Th><Th className="text-right">MRR</Th></tr></thead>
              <tbody>
                {m.revenue.byPlan.map((p) => (
                  <tr key={p.plan}><Td>{p.name}</Td><Td className="text-right tabular-nums">{num(p.stores)}</Td>
                    <Td className="text-right tabular-nums">{formatINR(p.monthlyPrice)}</Td><Td className="text-right font-medium tabular-nums">{formatINR(p.mrr)}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Stores by status" description="Every store on the platform" />
          <Table>
            <thead><tr><Th>Status</Th><Th className="text-right">Stores</Th></tr></thead>
            <tbody>
              {([["In trial", m.stores.trialing], ["Active", m.stores.active], ["Past due", m.stores.pastDue], ["Suspended", m.stores.suspended], ["Cancelled", m.stores.cancelled]] as const)
                .map(([l, v]) => <tr key={l}><Td>{l}</Td><Td className="text-right tabular-nums">{num(v)}</Td></tr>)}
            </tbody>
          </Table>
        </Card>
      </div>

      <section aria-labelledby="period-heading" className="grid gap-6">
        <h2 id="period-heading" className="-mb-3 text-sm font-semibold text-fg-muted">In this period <span className="font-normal">· {period}</span></h2>
        <Card>
          <dl className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
            <Stat label="Net sales across stores" value={formatINR(m.commerce.netSales)} hint={`${num(m.commerce.orders)} orders, after refunds`} />
            <Stat label="Stores with orders" value={num(m.commerce.storesWithOrders)} />
            <Stat label="Online payment success" value={m.payments.successRate === null ? "–" : `${Number(m.payments.successRate).toFixed(1)}%`}
              hint={<span className="flex flex-wrap items-center gap-1.5"><Badge tone={pay.tone}>{pay.label}</Badge>{num(m.payments.captured)} paid, {num(m.payments.failed)} failed</span>} />
            <Stat label="Emails sent" value={num(m.email.sent)} hint={<Badge tone={mail.tone}>{mail.label}</Badge>} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Onboarding" description={`Stores that signed up ${period}, and how far each has got. Bars are the share of sign-ups.`} />
          {m.funnel.signedUp === 0 ? <p className="px-5 pb-5 text-sm text-fg-muted">No stores signed up in this period.</p> : (
            <ol className="grid gap-3 px-5 pt-4 pb-5">
              {steps.map((s) => (
                <li key={s.key} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[10rem_1fr_13rem]">
                  <span className="truncate">{s.label}</span>
                  <span className="h-3 rounded-[4px] bg-surface-muted" aria-hidden>
                    <span className="block h-3 rounded-[4px] bg-brand" style={{ width: `${s.ofStart ?? 100}%` }} />
                  </span>
                  <span className="col-span-2 tabular-nums sm:col-span-1 sm:text-right">
                    <span className="font-medium">{num(s.count)}</span>
                    {s.ofStart !== null && <span className="text-fg-muted"> · {s.ofStart}%{s.ofPrevious !== null && s.ofPrevious !== s.ofStart ? ` (${s.ofPrevious}% of previous)` : ""}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Net sales by week" description="All stores, confirmed orders after refunds" />
            <div className="px-5 pb-5">
              <BarChart label="Net sales by week" bars={m.weeks.map((w) => ({ key: w.weekStart, label: label(w.weekStart), value: Number(w.netSales), detail: `${num(w.orders)} orders` }))} />
            </div>
          </Card>
          <Card>
            <CardHeader title="New stores by week" description="Sign-ups" />
            <div className="px-5 pb-5">
              <BarChart label="New stores by week" format={(v) => `${count(v)} sign-ups`} tick={count} scale={countMax}
                bars={m.weeks.map((w) => ({ key: w.weekStart, label: label(w.weekStart), value: w.signups, detail: `${num(w.launches)} launched` }))} />
            </div>
          </Card>
        </div>
        <div>
          <Button variant="secondary" size="sm" onClick={() => setTable((t) => !t)} aria-expanded={table} aria-controls="weeks-table">
            {table ? "Hide" : "Show"} weekly numbers as a table
          </Button>
          {table && (
            <Card className="mt-3" id="weeks-table">
              <Table>
                <caption className="sr-only">Weekly sign-ups, launches, orders and net sales</caption>
                <thead><tr><Th>Week</Th><Th className="text-right">Sign-ups</Th><Th className="text-right">Launched</Th><Th className="text-right">Orders</Th><Th className="text-right">Net sales</Th></tr></thead>
                <tbody>
                  {m.weeks.map((w) => (
                    <tr key={w.weekStart}><Td>{label(w.weekStart)}</Td><Td className="text-right tabular-nums">{num(w.signups)}</Td><Td className="text-right tabular-nums">{num(w.launches)}</Td>
                      <Td className="text-right tabular-nums">{num(w.orders)}</Td><Td className="text-right tabular-nums">{formatINR(w.netSales)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
