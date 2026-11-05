import { Badge } from "@/components/ui/display";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/orders";
import type { Order, OrderStatus, PaymentStatus } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const s = PAYMENT_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

/** Items and totals of a placed order (amounts are the server's stored snapshot). */
export function OrderItems({ order, className }: { order: Order; className?: string }) {
  const tax = Number(order.cgst) + Number(order.sgst) + Number(order.igst);
  return (
    <div className={className}>
      <ul className="divide-y divide-border">
        {order.lines.map((l) => (
          <li key={l.id} className="flex justify-between gap-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{l.productTitle}</p>
              <p className="text-fg-muted">{l.variantLabel ? `${l.variantLabel} · ` : ""}SKU {l.sku} · {l.quantity} × {formatINR(l.unitPrice)}</p>
            </div>
            <p className="tabular shrink-0">{formatINR(l.gross)}</p>
          </li>
        ))}
      </ul>
      <dl className="space-y-2 border-t border-border pt-3 text-sm">
        <TotalRow label="Items" value={formatINR(order.subtotal)} />
        {Number(order.discount) > 0 && <TotalRow label={`Coupon ${order.couponCode ?? ""}`} value={`−${formatINR(order.discount)}`} />}
        <TotalRow label="Delivery" value={Number(order.shipping) > 0 ? formatINR(order.shipping) : "Free"} />
        <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{formatINR(order.total)}</dd></div>
        {Number(order.giftCardAmount) > 0 && <TotalRow label="Paid by gift card" value={formatINR(order.giftCardAmount)} />}
        {Number(order.giftCardAmount) > 0 && Number(order.total) > Number(order.giftCardAmount) && (
          <TotalRow label={order.paymentMethod === "Cod" ? "Paid in cash" : "Paid online"} value={formatINR(Number(order.total) - Number(order.giftCardAmount))} />
        )}
        {Number(order.refundedTotal) > 0 && <TotalRow label="Refunded" value={`−${formatINR(order.refundedTotal)}`} />}
      </dl>
      <p className="mt-1 text-xs text-fg-muted">Includes {formatINR(tax)} GST.</p>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><dt className="text-fg-muted">{label}</dt><dd className="tabular">{value}</dd></div>;
}

export function ShipToBlock({ order }: { order: Order }) {
  const a = order.shipTo;
  return (
    <address className="text-sm not-italic">
      <span className="font-medium">{a.name}</span><br />
      <span className="text-fg-muted">{a.line1}{a.line2 && <>, {a.line2}</>}<br />{a.city}, {a.stateName} {a.pincode}<br />{a.phone}</span>
    </address>
  );
}

export function Shipments({ order }: { order: Order }) {
  if (order.shipments.length === 0) return null;
  return (
    <ul className="space-y-2 text-sm">
      {order.shipments.map((s, i) => (
        <li key={i}>
          <p><span className="font-medium">{s.carrier}</span> · tracking <span className="tabular">{s.trackingNumber}</span></p>
          <p className="text-fg-muted">Shipped {formatDateTime(s.shippedAt)}{s.deliveredAt && <> · delivered {formatDateTime(s.deliveredAt)}</>}</p>
          {s.trackingUrl && <a href={s.trackingUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-brand underline underline-offset-2">Track this parcel<span className="sr-only"> (opens the carrier&apos;s site)</span></a>}
        </li>
      ))}
    </ul>
  );
}

const REFUND_LABEL = { Pending: "Processing", Processed: "Refunded", Failed: "Failed", Manual: "Recorded (paid back by the store)" } as const;

export function Refunds({ order, showReason }: { order: Order; showReason?: boolean }) {
  if (order.refunds.length === 0) return null;
  return (
    <ul className="space-y-2 text-sm">
      {order.refunds.map((r) => (
        <li key={r.id} className="flex justify-between gap-3">
          <span>
            <span className={cn("font-medium", r.status === "Failed" && "text-danger")}>{REFUND_LABEL[r.status]}</span>
            <span className="text-fg-muted"> · {formatDateTime(r.createdAt)}</span>
            {showReason && r.reason && <span className="block text-fg-muted">{r.reason}</span>}
          </span>
          <span className="tabular shrink-0">{formatINR(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
