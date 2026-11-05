"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, FileText } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { formatDateTime, OrderItems, OrderStatusBadge, Refunds, Shipments, ShipToBlock } from "@/components/orders/order-parts";
import { usePayment } from "@/components/store/payment";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Skeleton } from "@/components/ui/display";
import { Field, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { ORDER_STEPS, stepIndex } from "@/lib/orders";
import type { CheckoutResult, Order, StorefrontStore } from "@/lib/types";
import { cn } from "@/lib/utils";

export function OrderView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const key = ["shopper-order", id];
  const order = useQuery({
    queryKey: key,
    queryFn: () => api<Order>(`/storefront/account/orders/${id}`),
    // While a payment is being confirmed (e.g. by webhook), check again every few seconds.
    refetchInterval: (q) => (q.state.data?.status === "PendingPayment" ? 5000 : false),
  });
  const store = useQuery({ queryKey: ["storefront-store"], queryFn: () => api<StorefrontStore>("/storefront/store"), staleTime: 300_000 });
  const { pay, dialog } = usePayment(store.data?.brandColor);
  const [payError, setPayError] = React.useState<string | null>(
    params.get("payment") === "failed" ? "Your payment didn't go through. Nothing was charged; you can try again."
      : params.get("payment") === "error" ? "We couldn't confirm your payment yet. If money was taken, this order will update automatically." : null);
  const [cancelling, setCancelling] = React.useState(false);

  const payNow = useMutation({
    mutationFn: async () => {
      setPayError(null);
      const r = await api<CheckoutResult>(`/storefront/checkout/orders/${id}/pay`, { method: "POST" });
      if (!r.payment) return null;
      return pay(r.orderId, r.payment);
    },
    onSuccess: (outcome) => {
      if (outcome?.order) qc.setQueryData(key, outcome.order);
      if (outcome?.error) setPayError(outcome.error);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => { setPayError(errorMessage(e)); qc.invalidateQueries({ queryKey: key }); },
  });

  if (order.isError) {
    if (order.error instanceof ApiError && order.error.status === 401) { router.replace(`/account/login?next=/account/orders/${id}`); return null; }
    return <Alert tone="danger" title="Couldn't load this order">{errorMessage(order.error)}</Alert>;
  }
  if (!order.data) return <Skeleton className="h-96" />;
  const o = order.data;
  const placed = params.get("placed") === "1";

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted"><Link href="/account" className="hover:underline">Your account</Link> / <Link href="/account/orders" className="hover:underline">Orders</Link> / #{o.number}</nav>
      {placed && o.status !== "PendingPayment" && o.status !== "Cancelled" && o.status !== "Expired" && (
        <div className="mt-4 flex gap-3 rounded-[var(--radius-card)] border border-success/30 bg-success-soft p-4" role="status">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div><p className="font-semibold">Thank you! Your order is confirmed.</p><p className="text-sm text-fg-muted">We&apos;ve emailed a confirmation to {o.email}.</p></div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 font-display text-3xl tracking-tight sm:text-4xl">Order #{o.number}<OrderStatusBadge status={o.status} /></h1>
          <p className="mt-1 text-sm text-fg-muted">Placed {formatDateTime(o.placedAt)} · {o.paymentMethod === "Cod" ? "Cash on delivery" : "Online payment"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.invoiceNumber && <Button asChild variant="secondary"><Link href={`/account/orders/${o.id}/invoice`}><FileText />Invoice</Link></Button>}
          {o.actions.includes("cancel") && <Button variant="secondary" onClick={() => setCancelling(true)}>Cancel order</Button>}
        </div>
      </div>

      {o.status === "PendingPayment" && (
        <Alert tone="warning" className="mt-6" title="Waiting for payment"
          action={o.actions.includes("pay") && <Button size="sm" loading={payNow.isPending} onClick={() => payNow.mutate()}>Pay now</Button>}>
          Your items are held until {formatDateTime(o.reservedUntil)}. If payment isn&apos;t completed by then, the order is cancelled automatically and nothing is charged.
        </Alert>
      )}
      {payError && <Alert tone="danger" className="mt-4">{payError}</Alert>}
      {o.status === "Expired" && <Alert tone="info" className="mt-6">Payment wasn&apos;t completed in time, so this order was cancelled. Nothing was charged.</Alert>}
      {o.status === "Cancelled" && (
        <Alert tone="info" className="mt-6" title="Order cancelled">
          Cancelled {formatDateTime(o.cancelledAt)}.{" "}
          {o.paymentMethod === "Online" && o.paymentStatus !== "Voided" ? "Any amount paid is refunded to your original payment method, usually within 5–7 working days." : ""}
        </Alert>
      )}

      {!["PendingPayment", "Cancelled", "Expired"].includes(o.status) && <Progress order={o} />}

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <section className="rounded-[var(--radius-card)] border border-border p-5 md:col-span-2" aria-labelledby="items-h">
          <h2 id="items-h" className="font-semibold">Items</h2>
          <OrderItems order={o} className="mt-2" />
        </section>
        <div className="space-y-6">
          <section className="rounded-[var(--radius-card)] border border-border p-5" aria-labelledby="ship-h">
            <h2 id="ship-h" className="font-semibold">Delivery address</h2>
            <div className="mt-3"><ShipToBlock order={o} /></div>
          </section>
          {o.shipments.length > 0 && (
            <section className="rounded-[var(--radius-card)] border border-border p-5" aria-labelledby="track-h">
              <h2 id="track-h" className="font-semibold">Shipping</h2>
              <div className="mt-3"><Shipments order={o} /></div>
            </section>
          )}
          {o.refunds.length > 0 && (
            <section className="rounded-[var(--radius-card)] border border-border p-5" aria-labelledby="refund-h">
              <h2 id="refund-h" className="font-semibold">Refunds</h2>
              <div className="mt-3"><Refunds order={o} /></div>
            </section>
          )}
        </div>
      </div>
      {cancelling && <CancelDialog order={o} onClose={() => setCancelling(false)} onDone={(u) => qc.setQueryData(key, u)} />}
      {dialog}
    </>
  );
}

function Progress({ order }: { order: Order }) {
  const at = stepIndex(order.status);
  const labels = { Confirmed: "Confirmed", Packed: "Packed", Shipped: "Shipped", Delivered: "Delivered" } as Record<string, string>;
  return (
    <ol className="mt-6 grid grid-cols-4 gap-2" aria-label="Order progress">
      {ORDER_STEPS.map((s, i) => (
        <li key={s} className="flex flex-col gap-2" aria-current={i === at ? "step" : undefined}>
          <span className={cn("h-1.5 rounded-full", i <= at ? "bg-brand" : "bg-surface-muted")} aria-hidden />
          <span className={cn("flex items-center gap-1 text-xs sm:text-sm", i <= at ? "font-medium text-fg" : "text-fg-muted")}>
            {i <= at && <Check className="size-3.5" aria-hidden />}{labels[s]}<span className="sr-only">{i <= at ? " (done)" : " (not yet)"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function CancelDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const toast = useToast();
  const [reason, setReason] = React.useState("");
  const cancel = useMutation({
    mutationFn: () => api<Order>(`/storefront/account/orders/${order.id}/cancel`, { method: "POST", body: { reason: reason.trim() || null } }),
    onSuccess: (o) => { onDone(o); toast.notify("Order cancelled"); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && !cancel.isPending && onClose()} title={`Cancel order #${order.number}?`}
      description={order.paymentStatus === "Paid" ? "You'll get a full refund to your original payment method." : "You haven't been charged for this order."}
      footer={<><Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>Keep order</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel order</Button></>}>
      <Field label="Reason" optional><Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {cancel.isError && <Alert tone="danger" className="mt-3">{errorMessage(cancel.error)}</Alert>}
    </Dialog>
  );
}
