"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { CardHeader, EmptyState } from "@/components/ui/display";
import type { SalesSummary } from "@/lib/types";
import { formatINR, formatNumber } from "@/lib/utils";

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** The last `days` calendar days (Indian time) ending today, with zero-revenue days filled in. */
export function fillDays(summary: SalesSummary, today = new Date()): { date: string; orders: number; revenue: number }[] {
  const byDate = new Map(summary.daily.map((d) => [d.date, d]));
  const ist = new Date(today.getTime() + 330 * 60_000);
  const out: { date: string; orders: number; revenue: number }[] = [];
  for (let i = summary.days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    const hit = byDate.get(key);
    out.push({ date: key, orders: hit?.orders ?? 0, revenue: hit ? Number(hit.revenue) : 0 });
  }
  return out;
}

/** Clean axis maximum: 1, 2, 2.5 or 5 × a power of ten at or above the largest value. */
export function niceMax(v: number): number {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

const compact = (v: number) => (v >= 100_000 ? `₹${v / 100_000}L` : v >= 1000 ? `₹${v / 1000}K` : `₹${v}`);

/**
 * Sales for the last 30 days, from confirmed orders net of refunds (computed by the API). Before the first order the
 * card says so instead of showing placeholder numbers.
 */
export function SalesCard({ sales }: { sales: SalesSummary | null }) {
  if (!sales)
    return (
      <>
        <CardHeader title="Sales" description="Last 30 days" />
        <EmptyState icon={BarChart3} title="No orders yet" description="Revenue, order count and average order value appear here from real orders once shoppers check out." />
      </>
    );
  const days = fillDays(sales);
  const max = niceMax(Math.max(...days.map((d) => d.revenue)));
  return (
    <>
      <CardHeader title="Sales" description="Last 30 days · confirmed orders, net of refunds"
        action={<Link href="/admin/orders" className="text-sm font-medium text-brand hover:underline">View orders</Link>} />
      <dl className="grid grid-cols-3 gap-4 px-5">
        <Hero label="Revenue" value={formatINR(sales.revenue)} />
        <Hero label="Orders" value={formatNumber(sales.orders)} />
        <Hero label="Avg. order" value={formatINR(sales.averageOrderValue)} />
      </dl>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-5 text-sm">
        <Link href="/admin/orders" className="text-fg-muted hover:text-fg"><span className="font-semibold text-fg tabular-nums">{sales.toFulfil}</span> to fulfil</Link>
        <span className="text-fg-muted"><span className="font-semibold text-fg tabular-nums">{sales.awaitingPayment}</span> awaiting payment</span>
      </div>
      <RevenueBars days={days} max={max} />
    </>
  );
}

function Hero({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-fg-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</dd>
    </div>
  );
}

function RevenueBars({ days, max }: { days: { date: string; orders: number; revenue: number }[]; max: number }) {
  const [active, setActive] = React.useState<number | null>(null);
  const H = 120;
  const ticks = [0, max / 2, max];
  const a = active === null ? null : days[active];
  return (
    <div className="px-5 pt-5 pb-4">
      <div className="relative">
        <div className="flex">
          {/* y-axis */}
          <div className="relative mr-2 w-10 shrink-0 text-right text-[11px] text-fg-muted tabular-nums" style={{ height: H }} aria-hidden>
            {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>{compact(t)}</span>)}
          </div>
          <div className="relative flex-1" style={{ height: H }} onPointerLeave={() => setActive(null)}>
            {ticks.map((t) => <div key={t} className="absolute inset-x-0 border-t border-border" style={{ top: H - (t / max) * H }} aria-hidden />)}
            <ul className="absolute inset-0 flex items-end gap-[2px]" aria-label="Daily revenue">
              {days.map((d, i) => (
                <li key={d.date} className="flex h-full flex-1 items-end justify-center">
                  <button type="button" className="flex h-full w-full items-end justify-center focus-visible:outline-2 focus-visible:outline-brand"
                    onPointerEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                    aria-label={`${dayFmt.format(new Date(d.date))}: ${formatINR(d.revenue)} from ${d.orders} ${d.orders === 1 ? "order" : "orders"}`}>
                    <span className="block w-full max-w-6 rounded-t-[4px] bg-brand transition-opacity"
                      style={{ height: d.revenue > 0 ? Math.max(2, (d.revenue / max) * H) : 0, opacity: active === null || active === i ? 1 : 0.55 }} />
                  </button>
                </li>
              ))}
            </ul>
            {a && (
              <div role="status" className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-[var(--shadow-overlay)] whitespace-nowrap"
                style={{ left: `${((active! + 0.5) / days.length) * 100}%` }}>
                <p className="font-semibold tabular-nums">{formatINR(a.revenue)}</p>
                <p className="text-fg-muted">{dayFmt.format(new Date(a.date))} · {a.orders} {a.orders === 1 ? "order" : "orders"}</p>
              </div>
            )}
          </div>
        </div>
        <div className="ml-12 mt-1 flex justify-between text-[11px] text-fg-muted" aria-hidden>
          <span>{dayFmt.format(new Date(days[0].date))}</span><span>Today</span>
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-fg-muted hover:text-fg">Show as table</summary>
        <div className="mt-2 max-h-60 overflow-y-auto">
          <table className="w-full text-left text-[13px]">
            <thead><tr className="text-fg-muted"><th scope="col" className="py-1 font-medium">Day</th><th scope="col" className="py-1 text-right font-medium">Orders</th><th scope="col" className="py-1 text-right font-medium">Revenue</th></tr></thead>
            <tbody className="tabular-nums">
              {days.filter((d) => d.orders > 0).reverse().map((d) => (
                <tr key={d.date} className="border-t border-border"><td className="py-1">{dayFmt.format(new Date(d.date))}</td><td className="py-1 text-right">{d.orders}</td><td className="py-1 text-right">{formatINR(d.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
