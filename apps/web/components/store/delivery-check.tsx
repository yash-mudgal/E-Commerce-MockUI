"use client";

import { useMutation } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { deliveryDays } from "@/lib/store-terms";
import type { DeliveryCheck as Result } from "@/lib/types";
import { formatINR } from "@/lib/utils";

const KEY = "shopmint:pincode";
const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** "Deliver to PIN code": the store's real terms for that PIN code (zone fee, COD, estimate). The PIN is kept on this device. */
export function DeliveryCheck() {
  const [pin, setPin] = React.useState("");
  // The "by" date is worked out when the answer arrives (not during render).
  const check = useMutation({
    mutationFn: async (p: string) => {
      const r = await api<Result>(`/storefront/delivery?pincode=${p}`);
      return { ...r, by: r.maxDays != null ? dayFmt.format(new Date(Date.now() + r.maxDays * 86_400_000)) : null };
    },
  });
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // Restoring the shopper's last PIN code from this device is a one-off read at mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && /^[1-9]\d{5}$/.test(saved)) { setPin(saved); check.mutate(saved); }
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[1-9]\d{5}$/.test(pin)) { check.reset(); return; }
    try { localStorage.setItem(KEY, pin); } catch { /* fine */ }
    check.mutate(pin);
  };
  const r = check.data;
  const days = r ? deliveryDays(r.minDays, r.maxDays) : null;
  const by = r?.by ?? null;
  const invalid = pin.length > 0 && !/^[1-9]\d{0,5}$/.test(pin);
  return (
    <div>
      <form onSubmit={submit} className="flex items-center gap-2">
        <label htmlFor="pincode" className="sr-only">PIN code</label>
        <div className="relative flex-1">
          <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input id="pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={pin} placeholder="Enter PIN code for delivery"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-invalid={invalid || undefined} aria-describedby="pincode-result"
            className="h-10 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface pr-3 pl-9 text-sm" />
        </div>
        <button type="submit" disabled={pin.length !== 6 || check.isPending} className="h-10 rounded-[var(--radius-control)] border border-fg px-4 text-sm font-medium hover:bg-fg hover:text-surface disabled:opacity-50">Check</button>
      </form>
      <div id="pincode-result" role="status" className="mt-2 text-sm">
        {check.isError && <p className="text-danger">{errorMessage(check.error)}</p>}
        {r && !r.serviceable && <p className="text-danger">Sorry, this store doesn&apos;t deliver to {r.pincode} yet.</p>}
        {r && r.serviceable && (
          <ul className="space-y-1 text-fg-muted">
            <li><span className="font-medium text-fg">{days ? `Delivery in ${days}` : "Delivers"}</span> to {r.pincode}{by && <> (by {by})</>}</li>
            <li>{Number(r.fee) === 0 || (r.freeShippingThreshold !== null && Number(r.freeShippingThreshold) === 0) ? "Free shipping"
              : r.freeShippingThreshold !== null ? `${formatINR(r.fee)} shipping, free over ${formatINR(r.freeShippingThreshold)}` : `${formatINR(r.fee)} shipping`}</li>
            <li>{r.cod ? `Cash on delivery available (orders up to ${formatINR(r.codMaxOrderValue)})` : "Cash on delivery not available"}</li>
          </ul>
        )}
      </div>
    </div>
  );
}
