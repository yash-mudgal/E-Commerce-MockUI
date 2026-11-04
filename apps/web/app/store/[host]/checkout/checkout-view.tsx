"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CreditCard, FlaskConical, Lock, MapPin, Plus, Tag, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { usePayment } from "@/components/store/payment";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { api, ApiError, errorMessage } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/orders";
import { cartKey, useShopper } from "@/lib/shop";
import type { Address, CheckoutResult, Quote, StorefrontStore } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";
import { AddressDialog, addressesKey } from "../account/account-home";

type Method = "online" | "cod";

/**
 * Checkout for signed-in shoppers. The browser only chooses the address, coupon and payment method: every price, tax,
 * discount, shipping fee and stock check is computed by the API (the quote shown here is re-computed when the order is
 * placed). Each "Place order" press uses one idempotency key, so a double click or retry can't create two orders.
 */
export function CheckoutView() {
  const router = useRouter();
  const qc = useQueryClient();
  const shopper = useShopper();
  const store = useQuery({ queryKey: ["storefront-store"], queryFn: () => api<StorefrontStore>("/storefront/store"), staleTime: 300_000 });
  const addresses = useQuery({ queryKey: addressesKey, queryFn: () => api<Address[]>("/storefront/account/addresses"), enabled: !!shopper.data });
  const [addressId, setAddressId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [coupon, setCoupon] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState<Method | null>(null);
  const [placeError, setPlaceError] = React.useState<string | null>(null);
  const { pay, dialog } = usePayment(store.data?.brandColor);
  // One key per distinct order attempt; changing anything that affects the order starts a new one.
  const key = React.useRef<string>("");
  React.useEffect(() => { key.current = newIdempotencyKey(); }, [addressId, coupon, method]);

  React.useEffect(() => {
    if (shopper.isSuccess && !shopper.data) router.replace("/account/login?next=/checkout");
  }, [shopper.isSuccess, shopper.data, router]);

  const selected = addressId ?? addresses.data?.find((a) => a.isDefault)?.id ?? addresses.data?.[0]?.id ?? null;
  const quote = useQuery({
    queryKey: ["checkout-quote", selected, coupon],
    queryFn: () => api<Quote>("/storefront/checkout/quote", { method: "POST", body: { addressId: selected, couponCode: coupon } }),
    enabled: !!selected,
    retry: false,
  });
  const payment = quote.data?.payment;
  const chosen: Method | null = method ?? (payment?.onlineAvailable ? "online" : payment?.codAvailable ? "cod" : null);
  const chosenValid = chosen === "online" ? !!payment?.onlineAvailable : chosen === "cod" ? !!payment?.codAvailable : false;

  const place = useMutation({
    mutationFn: () => api<CheckoutResult>("/storefront/checkout/orders", {
      method: "POST", body: { addressId: selected, couponCode: coupon, paymentMethod: chosen }, headers: { "Idempotency-Key": key.current },
    }),
    onMutate: () => setPlaceError(null),
    onSuccess: async (result) => {
      qc.invalidateQueries({ queryKey: cartKey });
      if (result.payment) {
        const outcome = await pay(result.orderId, result.payment);
        if (outcome.error) {
          // Declined (order still awaiting payment) or not yet confirmable; the order page offers "Pay now" again.
          router.push(`/account/orders/${result.orderId}?payment=${outcome.order ? "failed" : "error"}`);
          return;
        }
      }
      router.push(`/account/orders/${result.orderId}?placed=1`);
    },
    onError: (e) => {
      key.current = newIdempotencyKey();
      if (e instanceof ApiError && e.fieldErrors.couponCode) setCoupon(null);
      setPlaceError(errorMessage(e));
      qc.invalidateQueries({ queryKey: ["checkout-quote"] });
    },
  });

  if (shopper.isError) return <Alert tone="danger" className="mt-6">{errorMessage(shopper.error)}</Alert>;
  if (!shopper.data || addresses.isPending) return <div className="mt-6 grid gap-6 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>;
  if (addresses.isError) return <Alert tone="danger" className="mt-6" title="Couldn't load your addresses">{errorMessage(addresses.error)}</Alert>;

  const quoteProblem = quote.error instanceof ApiError ? quote.error : null;
  const cartProblem = quoteProblem?.code === "cart-changed";
  const busy = place.isPending || place.isSuccess;

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Step n={1} title="Delivery address" action={addresses.data.length > 0 && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus />New address</Button>}>
          {addresses.data.length === 0 ? (
            <div className="flex flex-col items-start gap-3 text-sm text-fg-muted">
              <p className="flex items-center gap-2"><MapPin className="size-4" aria-hidden />Add where we should deliver your order.</p>
              <Button onClick={() => setAdding(true)}><Plus />Add an address</Button>
            </div>
          ) : (
            <fieldset>
              <legend className="sr-only">Choose a delivery address</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {addresses.data.map((a) => (
                  <label key={a.id} className={cn("flex cursor-pointer gap-3 rounded-md border p-4 text-sm", selected === a.id ? "border-brand ring-1 ring-brand" : "border-border hover:border-border-strong")}>
                    <input type="radio" name="address" className="mt-0.5 size-4 accent-[var(--brand)]" checked={selected === a.id} onChange={() => setAddressId(a.id)} disabled={busy} />
                    <span>
                      <span className="block font-medium">{a.name}</span>
                      <span className="mt-1 block text-fg-muted">{a.line1}{a.line2 && <>, {a.line2}</>}, {a.city}, {a.stateName} {a.pincode}</span>
                      <span className="mt-1 block text-fg-muted">{a.phone}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </Step>

        <Step n={2} title="Payment">
          {!selected ? <p className="text-sm text-fg-muted">Choose an address to see payment options.</p> : !payment ? <Skeleton className="h-20" /> : (
            <fieldset>
              <legend className="sr-only">Choose how to pay</legend>
              <div className="space-y-3">
                <MethodOption value="online" chosen={chosen} onChange={setMethod} disabled={!payment.onlineAvailable || busy} icon={CreditCard}
                  title="Pay online" detail={payment.onlineAvailable ? "UPI, cards, net banking and wallets via Razorpay." : "Online payment isn't available for this store yet."}
                  badge={payment.onlineIsTest ? <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning"><FlaskConical className="size-3" aria-hidden />Test mode — no real payment</span> : null} />
                <MethodOption value="cod" chosen={chosen} onChange={setMethod} disabled={!payment.codAvailable || busy} icon={Banknote}
                  title="Cash on delivery" detail={payment.codAvailable ? "Pay in cash when your order arrives." : payment.codUnavailableReason ?? "Not available for this order."} />
              </div>
            </fieldset>
          )}
        </Step>
      </div>

      <aside className="h-fit rounded-[var(--radius-card)] border border-border bg-bg p-5" aria-label="Order summary">
        <h2 className="font-semibold">Order summary</h2>
        {!selected ? <p className="mt-3 text-sm text-fg-muted">Add a delivery address to see your total.</p>
          : cartProblem || quoteProblem?.status === 422 && quoteProblem.code !== "validation" ? (
            <Alert tone="warning" className="mt-4" action={<Button asChild size="sm" variant="secondary"><Link href="/cart">Review cart</Link></Button>}>{errorMessage(quote.error)}</Alert>
          ) : quote.isError ? <Alert tone="danger" className="mt-4">{errorMessage(quote.error)}</Alert>
          : !quote.data ? <div className="mt-4 space-y-2"><Skeleton className="h-5" /><Skeleton className="h-5" /><Skeleton className="h-8" /></div> : (
            <Summary quote={quote.data} />
          )}
        {selected && (quote.data || coupon) && <CouponBox addressId={selected} applied={coupon} onApply={setCoupon} disabled={busy} />}
        {placeError && <Alert tone="danger" className="mt-4">{placeError}</Alert>}
        <Button className="mt-5 w-full" size="lg" disabled={!quote.data || !chosenValid || quote.isFetching} loading={busy} onClick={() => place.mutate()}>
          {chosen === "online" ? <><Lock />Pay {quote.data ? formatINR(quote.data.total) : ""}</> : "Place order"}
        </Button>
        <p className="mt-3 text-xs text-fg-muted">Items are held for 15 minutes while you pay. Prices include GST.</p>
      </aside>
      {adding && <AddressDialog address={null} onClose={() => setAdding(false)} onSaved={(a) => setAddressId(a.id)} />}
      {dialog}
    </div>
  );
}

function Step({ n, title, action, children }: { n: number; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border p-5" aria-labelledby={`step-${n}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`step-${n}`} className="flex items-center gap-2 font-semibold">
          <span className="grid size-6 place-items-center rounded-full bg-brand text-xs text-brand-fg" aria-hidden>{n}</span>{title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MethodOption({ value, chosen, onChange, disabled, icon: Icon, title, detail, badge }: {
  value: Method; chosen: Method | null; onChange: (m: Method) => void; disabled: boolean; icon: typeof CreditCard; title: string; detail: string; badge?: React.ReactNode;
}) {
  const on = chosen === value && !disabled;
  return (
    <label className={cn("flex gap-3 rounded-md border p-4 text-sm", disabled ? "cursor-not-allowed border-border opacity-70" : "cursor-pointer", on ? "border-brand ring-1 ring-brand" : "border-border")}>
      <input type="radio" name="method" className="mt-0.5 size-4 accent-[var(--brand)]" checked={on} disabled={disabled} onChange={() => onChange(value)} />
      <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 font-medium">{title}{badge}</span>
        <span className="mt-0.5 block text-fg-muted">{detail}</span>
      </span>
    </label>
  );
}

function Summary({ quote }: { quote: Quote }) {
  const tax = Number(quote.cgst) + Number(quote.sgst) + Number(quote.igst);
  return (
    <>
      <ul className="mt-4 space-y-3 text-sm">
        {quote.lines.map((l) => (
          <li key={l.variantId} className="flex justify-between gap-3">
            <span className="min-w-0"><span className="block truncate">{l.productTitle}</span>
              <span className="text-fg-muted">{l.variantLabel ? `${l.variantLabel} · ` : ""}Qty {l.quantity}</span></span>
            <span className="tabular shrink-0">{formatINR(l.gross)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
        <Row label="Items" value={formatINR(quote.subtotal)} />
        {Number(quote.discount) > 0 && <Row label={`Coupon ${quote.couponCode}`} value={`−${formatINR(quote.discount)}`} className="text-success" />}
        <Row label="Delivery" value={Number(quote.shipping) > 0 ? formatINR(quote.shipping) : "Free"} />
        <div className="flex justify-between border-t border-border pt-3 text-base font-semibold"><dt>Total</dt><dd className="tabular" data-testid="checkout-total">{formatINR(quote.total)}</dd></div>
      </dl>
      <p className="mt-1 text-xs text-fg-muted">
        Includes {formatINR(tax)} GST ({quote.intraState ? `CGST ${formatINR(quote.cgst)} + SGST ${formatINR(quote.sgst)}` : `IGST ${formatINR(quote.igst)}`}).
      </p>
    </>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return <div className={cn("flex justify-between", className)}><dt className={className ? undefined : "text-fg-muted"}>{label}</dt><dd className="tabular">{value}</dd></div>;
}

function CouponBox({ addressId, applied, onApply, disabled }: { addressId: string; applied: string | null; onApply: (c: string | null) => void; disabled: boolean }) {
  const qc = useQueryClient();
  const [code, setCode] = React.useState("");
  const check = useMutation({
    mutationFn: (c: string) => api<Quote>("/storefront/checkout/quote", { method: "POST", body: { addressId, couponCode: c } }),
    onSuccess: (q, c) => { qc.setQueryData(["checkout-quote", addressId, c], q); onApply(c); setCode(""); },
  });
  if (applied)
    return (
      <div className="mt-4 flex items-center justify-between gap-2 rounded-md border border-border bg-surface py-1.5 pr-1 pl-3 text-sm">
        <span className="flex min-w-0 items-center gap-2"><Tag className="size-4 shrink-0 text-success" aria-hidden /><span className="min-w-0 break-all">Coupon <strong>{applied}</strong> applied</span></span>
        <Button variant="ghost" size="icon" className="shrink-0" disabled={disabled} onClick={() => onApply(null)} aria-label="Remove coupon" title="Remove coupon"><X /></Button>
      </div>
    );
  return (
    <form className="mt-4" onSubmit={(e) => { e.preventDefault(); if (code.trim()) check.mutate(code.trim().toUpperCase()); }}>
      <label htmlFor="coupon" className="text-sm font-medium">Coupon code</label>
      <div className="mt-1 flex gap-2">
        <Input id="coupon" value={code} onChange={(e) => { setCode(e.target.value); check.reset(); }} maxLength={30} autoComplete="off" className="uppercase"
          aria-invalid={check.isError || undefined} aria-describedby={check.isError ? "coupon-error" : undefined} disabled={disabled} />
        <Button type="submit" variant="secondary" loading={check.isPending} disabled={disabled || !code.trim()}>Apply</Button>
      </div>
      {check.isError && <p id="coupon-error" className="mt-1 text-sm text-danger" role="alert">{check.error instanceof ApiError ? check.error.fieldErrors.couponCode ?? errorMessage(check.error) : errorMessage(check.error)}</p>}
    </form>
  );
}
