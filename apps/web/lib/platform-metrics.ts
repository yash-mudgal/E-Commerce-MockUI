import { istToday, ymd } from "@/lib/reports";
import type { PlatformMetrics } from "@/lib/types";

export type MetricsPreset = "28d" | "90d" | "182d" | "365d";
export const METRICS_PRESETS: [MetricsPreset, string][] = [["28d", "Last 4 weeks"], ["90d", "Last 90 days"], ["182d", "Last 6 months"], ["365d", "Last 12 months"]];

/** Inclusive range of Indian calendar days ending today. */
export function metricsRange(p: MetricsPreset, now = new Date()): { from: string; to: string } {
  const days = Number(p.slice(0, -1));
  const t = istToday(now);
  return { from: ymd(new Date(t.getTime() - (days - 1) * 86_400_000)), to: ymd(t) };
}

export type FunnelStep = { key: keyof PlatformMetrics["funnel"]; label: string; count: number; ofStart: number | null; ofPrevious: number | null };

// "On a paid plan now" isn't a step after "first order" (a store can pay before selling), so it has no previous stage.

const STEPS: [keyof PlatformMetrics["funnel"], string][] = [
  ["signedUp", "Signed up"], ["emailConfirmed", "Confirmed email"], ["addedProduct", "Added a product"],
  ["launched", "Launched the store"], ["firstOrder", "Got a first order"], ["onPaidPlan", "On a paid plan now"],
];

/** Funnel stages for stores created in the range, with the share of sign-ups and of the previous stage (whole percent). */
export function funnelSteps(f: PlatformMetrics["funnel"]): FunnelStep[] {
  const pct = (n: number, d: number) => (d === 0 ? null : Math.round((100 * n) / d));
  return STEPS.map(([key, label], i) => ({
    key, label, count: f[key],
    ofStart: i === 0 ? null : pct(f[key], f.signedUp),
    ofPrevious: i === 0 || key === "onPaidPlan" ? null : pct(f[key], f[STEPS[i - 1][0]]),
  }));
}

export type Health = { tone: "success" | "warning" | "danger" | "neutral"; label: string };

/**
 * Online payment success: Razorpay's own success rates are typically well above 90%, so below 90% is worth a look and
 * below 80% suggests a broken integration. Initial thresholds, to be revisited with real data (docs/SLO.md).
 */
export function paymentHealth(rate: string | null, attempts: number): Health {
  if (rate === null || attempts < 20) return { tone: "neutral", label: attempts === 0 ? "No online payments yet" : "Too few payments to judge" };
  const r = Number(rate);
  return r >= 90 ? { tone: "success", label: "Healthy" } : r >= 80 ? { tone: "warning", label: "Below 90%: check failures" } : { tone: "danger", label: "Below 80%: investigate now" };
}

export function emailHealth(e: PlatformMetrics["email"]): Health {
  if (e.stuckPending > 0) return { tone: "danger", label: `${e.stuckPending} waiting over 15 minutes` };
  if (e.failed > 0) return { tone: "warning", label: `${e.failed} failed permanently` };
  return e.sent === 0 ? { tone: "neutral", label: "No email in this period" } : { tone: "success", label: "Delivering" };
}
