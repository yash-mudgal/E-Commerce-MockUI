"use client";

import * as React from "react";
import { niceMax } from "@/components/admin/sales-card";
import { formatINR } from "@/lib/utils";

export type Bar = { key: string; label: string; value: number; detail: string };

const compact = (v: number) => (v >= 10_000_000 ? `₹${v / 10_000_000}Cr` : v >= 100_000 ? `₹${v / 100_000}L` : v >= 1000 ? `₹${v / 1000}K` : `₹${v}`);

/**
 * Single-series column chart of rupee amounts (one hue, so no legend; the heading names the series). Each column is a
 * focusable button with a tooltip on hover and focus, and the same numbers are in a table view.
 */
export function BarChart({ bars, label, height = 160 }: { bars: Bar[]; label: string; height?: number }) {
  const [active, setActive] = React.useState<number | null>(null);
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const ticks = [0, max / 2, max];
  const a = active === null ? null : bars[active];
  return (
    <div>
      <div className="flex">
        <div className="relative mr-2 w-12 shrink-0 text-right text-[11px] text-fg-muted tabular-nums" style={{ height }} aria-hidden>
          {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: height - (t / max) * height }}>{compact(t)}</span>)}
        </div>
        <div className="relative flex-1" style={{ height }} onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => <div key={t} className="absolute inset-x-0 border-t border-border" style={{ top: height - (t / max) * height }} aria-hidden />)}
          <ul className="absolute inset-0 flex items-end gap-[2px]" aria-label={label}>
            {bars.map((b, i) => (
              <li key={b.key} className="flex h-full min-w-0 flex-1 items-end justify-center">
                <button type="button" className="flex h-full w-full items-end justify-center focus-visible:outline-2 focus-visible:outline-brand"
                  onPointerEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} aria-label={`${b.label}: ${formatINR(b.value)}, ${b.detail}`}>
                  <span className="block w-full max-w-6 rounded-t-[4px] bg-brand transition-opacity"
                    style={{ height: b.value > 0 ? Math.max(2, (b.value / max) * height) : 0, opacity: active === null || active === i ? 1 : 0.55 }} />
                </button>
              </li>
            ))}
          </ul>
          {a && (
            <div role="status" className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-[var(--shadow-overlay)]"
              style={{ left: `${Math.min(90, Math.max(10, ((active! + 0.5) / bars.length) * 100))}%` }}>
              <p className="font-semibold tabular-nums">{formatINR(a.value)}</p>
              <p className="text-fg-muted">{a.label} · {a.detail}</p>
            </div>
          )}
        </div>
      </div>
      {bars.length > 0 && (
        <div className="mt-1 ml-14 flex justify-between text-[11px] text-fg-muted" aria-hidden>
          <span>{bars[0].label}</span>{bars.length > 1 && <span>{bars[bars.length - 1].label}</span>}
        </div>
      )}
    </div>
  );
}
