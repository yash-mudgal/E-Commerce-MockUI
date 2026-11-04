/** Date ranges for reports, in Indian calendar days (the API interprets dates as IST). */
export type RangePreset = "7d" | "30d" | "this-month" | "last-month" | "this-fy" | "last-fy" | "custom";

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Today's date in India as a UTC-midnight Date (so arithmetic stays in whole days). */
export function istToday(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Indian financial years run 1 April – 31 March. */
export function presetRange(p: Exclude<RangePreset, "custom">, now = new Date()): { from: string; to: string } {
  const t = istToday(now);
  const y = t.getUTCFullYear(), m = t.getUTCMonth();
  const fyStart = m >= 3 ? y : y - 1;
  switch (p) {
    case "7d": return { from: ymd(addDays(t, -6)), to: ymd(t) };
    case "30d": return { from: ymd(addDays(t, -29)), to: ymd(t) };
    case "this-month": return { from: ymd(new Date(Date.UTC(y, m, 1))), to: ymd(t) };
    case "last-month": return { from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 0))) };
    case "this-fy": return { from: `${fyStart}-04-01`, to: ymd(t) };
    case "last-fy": return { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` };
  }
}

/** Sensible grouping for a range length: days up to ~2 months, weeks up to ~6 months, then months. */
export function defaultGroup(from: string, to: string): "day" | "week" | "month" {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  return days <= 62 ? "day" : days <= 186 ? "week" : "month";
}

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(new Date(iso));

export function periodLabel(start: string, group: "day" | "week" | "month"): string {
  return group === "month" ? fmt(start, { month: "short", year: "numeric" }) : group === "week" ? `Week of ${fmt(start, { day: "numeric", month: "short" })}` : fmt(start, { day: "numeric", month: "short" });
}
