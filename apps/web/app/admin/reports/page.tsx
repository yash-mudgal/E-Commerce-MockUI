"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import * as React from "react";
import { BarChart } from "@/components/admin/bar-chart";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import { defaultGroup, periodLabel, presetRange, type RangePreset } from "@/lib/reports";
import type { GstReport, SalesReport } from "@/lib/types";
import { formatINR } from "@/lib/utils";

const PRESETS: [RangePreset, string][] = [
  ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["this-month", "This month"], ["last-month", "Last month"],
  ["this-fy", "This financial year"], ["last-fy", "Last financial year"], ["custom", "Custom dates"],
];

export default function ReportsPage() {
  const me = useMe();
  const allowed = can(me.data, "reports.read");
  const [preset, setPreset] = React.useState<RangePreset>("30d");
  const [custom, setCustom] = React.useState(() => presetRange("30d"));
  const range = preset === "custom" ? custom : presetRange(preset);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to;
  const [groupBy, setGroupBy] = React.useState<"auto" | "day" | "week" | "month">("auto");
  const group = groupBy === "auto" ? (valid ? defaultGroup(range.from, range.to) : "day") : groupBy;
  const qs = `from=${range.from}&to=${range.to}`;

  const sales = useQuery({
    queryKey: ["report-sales", range.from, range.to, group],
    queryFn: () => api<SalesReport>(`/admin/reports/sales?${qs}&groupBy=${group}`),
    enabled: allowed && valid, placeholderData: keepPreviousData,
  });
  const gst = useQuery({
    queryKey: ["report-gst", range.from, range.to],
    queryFn: () => api<GstReport>(`/admin/reports/gst?${qs}`),
    enabled: allowed && valid, placeholderData: keepPreviousData,
  });

  if (me.data && !allowed) return <><PageHeader title="Reports" /><Alert tone="info">You don&apos;t have access to reports.</Alert></>;
  return (
    <>
      <PageHeader title="Reports" description="Sales from confirmed orders by Indian date, net of refunds. Unpaid and cancelled orders aren't counted as sales."
        actions={valid && (
          <div className="flex flex-wrap gap-2">
            {can(me.data, "orders.read") && <Button asChild variant="secondary" size="sm"><a href={`/api/admin/reports/orders.csv?${qs}`} download><Download />Orders CSV</a></Button>}
            <Button asChild variant="secondary" size="sm"><a href={`/api/admin/reports/gst.csv?${qs}`} download><Download />GST CSV</a></Button>
            <Button asChild variant="secondary" size="sm"><a href={`/api/admin/reports/hsn.csv?${qs}`} download><Download />HSN CSV</a></Button>
          </div>
        )} />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="Period" className="w-52">
          <Select value={preset} onChange={(e) => { const p = e.target.value as RangePreset; if (p === "custom") setCustom(range); setPreset(p); }}>
            {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        {preset === "custom" && <>
          <Field label="From" className="w-44"><Input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
          <Field label="To" className="w-44"><Input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
        </>}
        <Field label="Group by" className="w-40">
          <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="auto">Automatic</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
          </Select>
        </Field>
      </div>
      {!valid && <Alert tone="warning" className="mb-6">Choose a start date on or before the end date.</Alert>}
      {sales.isError ? (
        <Alert tone="danger" title="Couldn't load the report" action={<Button variant="secondary" size="sm" onClick={() => sales.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(sales.error)}</Alert>
      ) : !sales.data ? <Skeleton className="h-96" /> : <SalesView r={sales.data} busy={sales.isFetching} />}
      <div className="mt-6">
        {gst.isError ? <Alert tone="danger" title="Couldn't load the GST summary">{errorMessage(gst.error)}</Alert>
          : !gst.data ? <Skeleton className="h-48" /> : <GstView g={gst.data} />}
      </div>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="p-5">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-fg-muted">{hint}</dd>}
    </div>
  );
}

function SalesView({ r, busy }: { r: SalesReport; busy: boolean }) {
  const t = r.totals;
  if (t.orders === 0 && r.cancelled.orders === 0)
    return <Card><EmptyState icon={BarChart3} title="No sales in this period" description="Confirmed orders placed in these dates appear here." /></Card>;
  const bars = r.series.map((p) => ({ key: p.start, label: periodLabel(p.start, r.groupBy), value: Number(p.netSales), detail: `${p.orders} ${p.orders === 1 ? "order" : "orders"}` }));
  return (
    <div className="space-y-6" aria-busy={busy}>
      <Card className="overflow-hidden">
        <dl className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4 [&>div]:bg-surface">
          <Kpi label="Net sales" value={formatINR(t.netSales)} hint={`${formatINR(t.total)} sales − ${formatINR(t.refunds)} refunds`} />
          <Kpi label="Orders" value={t.orders.toLocaleString("en-IN")} hint={`${t.units.toLocaleString("en-IN")} items`} />
          <Kpi label="Average order" value={formatINR(t.averageOrderValue)} />
          <Kpi label="GST collected" value={formatINR(t.tax)} hint={`On ${formatINR(t.taxable)} taxable value`} />
        </dl>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border px-5 py-3 text-sm sm:grid-cols-4">
          <Line label="Item sales" value={t.grossSales} />
          <Line label="Discounts" value={t.discounts} negative />
          <Line label="Delivery" value={t.shipping} />
          <Line label="Cancelled orders" value={r.cancelled.total} note={`${r.cancelled.orders}`} />
        </dl>
      </Card>

      <Card>
        <CardHeader title="Net sales" description={`By ${r.groupBy}. Amounts include GST.`} />
        <div className="px-5 pt-5 pb-4">
          <BarChart bars={bars} label="Net sales by period" />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-fg-muted hover:text-fg">Show as table</summary>
            <div className="mt-2 max-h-72 overflow-y-auto">
              <table className="w-full text-left text-[13px]">
                <thead><tr className="text-fg-muted"><th scope="col" className="py-1 font-medium">Period</th><th scope="col" className="py-1 text-right font-medium">Orders</th><th scope="col" className="py-1 text-right font-medium">Sales</th><th scope="col" className="py-1 text-right font-medium">Refunds</th><th scope="col" className="py-1 text-right font-medium">Net</th></tr></thead>
                <tbody className="tabular-nums">
                  {r.series.filter((p) => p.orders > 0).map((p) => (
                    <tr key={p.start} className="border-t border-border"><td className="py-1">{periodLabel(p.start, r.groupBy)}</td><td className="py-1 text-right">{p.orders}</td><td className="py-1 text-right">{formatINR(p.total)}</td><td className="py-1 text-right">{formatINR(p.refunds)}</td><td className="py-1 text-right">{formatINR(p.netSales)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top products" description="By sales value after discounts, including GST." />
          {r.topProducts.length === 0 ? <p className="px-5 pb-5 text-sm text-fg-muted">No items sold.</p> : (
            <Table>
              <thead><tr><Th>Product</Th><Th className="text-right">Units</Th><Th className="text-right">Sales</Th></tr></thead>
              <tbody>{r.topProducts.map((p) => <tr key={p.title}><Td>{p.title}</Td><Td className="tabular text-right">{p.units}</Td><Td className="tabular text-right">{formatINR(p.revenue)}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="By payment method" />
            <Table>
              <thead><tr><Th>Method</Th><Th className="text-right">Orders</Th><Th className="text-right">Net sales</Th></tr></thead>
              <tbody>{r.byPayment.map((p) => <tr key={p.method}><Td>{p.method === "cod" ? "Cash on delivery" : "Online"}</Td><Td className="tabular text-right">{p.orders}</Td><Td className="tabular text-right">{formatINR(p.netSales)}</Td></tr>)}</tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="By delivery state" />
            <Table>
              <thead><tr><Th>State</Th><Th className="text-right">Orders</Th><Th className="text-right">Sales</Th></tr></thead>
              <tbody>{r.byState.slice(0, 10).map((s) => <tr key={s.stateCode}><Td>{s.stateName}</Td><Td className="tabular text-right">{s.orders}</Td><Td className="tabular text-right">{formatINR(s.total)}</Td></tr>)}</tbody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, negative, note, count }: { label: string; value: string; negative?: boolean; note?: string; count?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-fg-muted">{label}{note ? ` (${note})` : ""}</dt>
      <dd className="tabular-nums">{count ? value : `${negative && Number(value) > 0 ? "−" : ""}${formatINR(value)}`}</dd>
    </div>
  );
}

function GstView({ g }: { g: GstReport }) {
  return (
    <Card>
      <CardHeader title="GST summary" description="Tax invoices issued in this period, by place of supply and rate (for GSTR-1). Delivery is shown at the rate it was taxed." />
      {g.invoices === 0 ? <p className="px-5 pb-5 text-sm text-fg-muted">No invoices in this period.</p> : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 px-5 pt-4 pb-4 text-sm sm:grid-cols-5">
            <Line label="Invoices" value={String(g.invoices)} count />
            <Line label="Taxable" value={g.taxable} />
            <Line label="CGST" value={g.cgst} />
            <Line label="SGST" value={g.sgst} />
            <Line label="IGST" value={g.igst} />
          </dl>
          <Table>
            <thead><tr><Th>Place of supply</Th><Th className="text-right">Rate</Th><Th className="hidden text-right sm:table-cell">Invoices</Th><Th className="text-right">Taxable</Th><Th className="text-right">CGST</Th><Th className="text-right">SGST</Th><Th className="text-right">IGST</Th></tr></thead>
            <tbody>
              {g.byStateAndRate.map((x) => (
                <tr key={`${x.stateCode}-${x.rate}`}>
                  <Td>{x.stateName} <span className="text-fg-muted">({x.stateCode})</span></Td><Td className="tabular text-right">{Number(x.rate)}%</Td>
                  <Td className="tabular hidden text-right sm:table-cell">{x.invoices}</Td><Td className="tabular text-right">{formatINR(x.taxable)}</Td>
                  <Td className="tabular text-right">{formatINR(x.cgst)}</Td><Td className="tabular text-right">{formatINR(x.sgst)}</Td><Td className="tabular text-right">{formatINR(x.igst)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <details className="border-t border-border px-5 py-3 text-sm">
            <summary className="cursor-pointer text-fg-muted hover:text-fg">HSN summary</summary>
            <table className="mt-2 w-full text-left text-[13px]">
              <thead><tr className="text-fg-muted"><th scope="col" className="py-1 font-medium">HSN/SAC</th><th scope="col" className="py-1 font-medium">Description</th><th scope="col" className="py-1 text-right font-medium">Rate</th><th scope="col" className="py-1 text-right font-medium">Qty</th><th scope="col" className="py-1 text-right font-medium">Taxable</th></tr></thead>
              <tbody className="tabular-nums">{g.hsn.map((h) => <tr key={`${h.code}-${h.rate}`} className="border-t border-border"><td className="py-1">{h.code}</td><td className="py-1">{h.description}</td><td className="py-1 text-right">{Number(h.rate)}%</td><td className="py-1 text-right">{h.quantity}</td><td className="py-1 text-right">{formatINR(h.taxable)}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      )}
      {g.cancelledInvoices.orders > 0 && (
        <p className="border-t border-border px-5 py-3 text-sm text-fg-muted">
          {g.cancelledInvoices.orders} {g.cancelledInvoices.orders === 1 ? "invoice was" : "invoices were"} cancelled ({formatINR(g.cancelledInvoices.total)}) and {g.cancelledInvoices.orders === 1 ? "is" : "are"} left out. Issue credit notes for them with your accountant.
        </p>
      )}
    </Card>
  );
}
