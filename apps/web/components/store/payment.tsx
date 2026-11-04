"use client";

import { FlaskConical } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/display";
import { api, errorMessage } from "@/lib/api";
import { loadRazorpay } from "@/lib/razorpay";
import type { CheckoutPayment, Order } from "@/lib/types";
import { formatINR } from "@/lib/utils";

/**
 * Opens the payment step for an unpaid order.
 *  - Razorpay: loads Razorpay Checkout (checkout.razorpay.com) with the store's key ID and the gateway order the API
 *    created. On success the handler sends the signed response to /verify; the API checks the signature with the
 *    store's secret and re-reads the payment from Razorpay before confirming. Webhooks confirm it independently.
 *  - Test mode (local development and demos only, never in production): a clearly labelled simulator instead of a
 *    real payment page. No money moves.
 * The outcome is reported through onDone with the refreshed order, or null when the shopper closed the window.
 */
type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };

export type PaymentOutcome = { order: Order | null; error?: string };

export function usePayment(brandColor?: string) {
  const [test, setTest] = React.useState<{ orderId: string; payment: CheckoutPayment; resolve: (o: PaymentOutcome) => void } | null>(null);

  const pay = React.useCallback((orderId: string, payment: CheckoutPayment): Promise<PaymentOutcome> => {
    if (payment.isTest) return new Promise((resolve) => setTest({ orderId, payment, resolve }));
    return new Promise((resolve) => {
      loadRazorpay().then(() => {
        let settled = false;
        const finish = (o: PaymentOutcome) => { if (!settled) { settled = true; resolve(o); } };
        const rzp = new window.Razorpay!({
          key: payment.keyId,
          order_id: payment.gatewayOrderId,
          amount: payment.amountPaise,
          currency: payment.currency,
          name: payment.storeName,
          description: "Order payment",
          prefill: { name: payment.customerName, email: payment.email, contact: payment.phone },
          theme: brandColor ? { color: brandColor } : undefined,
          handler: async (r: RazorpayResponse) => {
            try {
              const order = await api<Order>(`/storefront/checkout/orders/${orderId}/verify`, {
                method: "POST", body: { razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id, razorpaySignature: r.razorpay_signature },
              });
              finish({ order });
            } catch (e) {
              finish({ order: null, error: errorMessage(e) });
            }
          },
          modal: { ondismiss: () => finish({ order: null }) },
        });
        // Razorpay keeps its window open after a failed attempt so the shopper can retry; nothing to do here.
        rzp.on("payment.failed", () => {});
        rzp.open();
      }, (e: Error) => resolve({ order: null, error: e.message }));
    });
  }, [brandColor]);

  const dialog = test ? (
    <TestPaymentDialog orderId={test.orderId} payment={test.payment}
      onDone={(o) => { test.resolve(o); setTest(null); }} />
  ) : null;

  return { pay, dialog };
}

function TestPaymentDialog({ orderId, payment, onDone }: { orderId: string; payment: CheckoutPayment; onDone: (o: PaymentOutcome) => void }) {
  const [busy, setBusy] = React.useState<"success" | "failure" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (outcome: "success" | "failure") => {
    setBusy(outcome);
    setError(null);
    try {
      const order = await api<Order>(`/storefront/checkout/orders/${orderId}/test-payment`, { method: "POST", body: { outcome } });
      onDone({ order, error: outcome === "failure" ? "The test payment was declined. You can try again." : undefined });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onDone({ order: null })} title="Test payment"
      description="This store is in test mode. No real payment page is shown and no money moves."
      footer={<>
        <Button variant="secondary" disabled={!!busy} loading={busy === "failure"} onClick={() => run("failure")}>Simulate a failed payment</Button>
        <Button disabled={!!busy} loading={busy === "success"} onClick={() => run("success")}>Simulate a successful payment</Button>
      </>}>
      <div className="flex gap-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning" data-testid="test-mode-banner">
        <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>Test mode is for trying out checkout before connecting Razorpay. It is switched off on the live platform.</p>
      </div>
      <p className="mt-4 text-sm">Amount: <span className="tabular font-semibold">{formatINR(payment.amountPaise / 100)}</span></p>
      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
    </Dialog>
  );
}
