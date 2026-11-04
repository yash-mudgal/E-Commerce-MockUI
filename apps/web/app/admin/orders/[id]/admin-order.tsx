"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, PackageCheck, RotateCcw, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { formatDateTime, OrderItems, OrderStatusBadge, PaymentStatusBadge, Refunds, Shipments, ShipToBlock } from "@/components/orders/order-parts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Card, CardHeader, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import { refundSchema, shipSchema, type RefundInput, type RefundOutput, type ShipInput } from "@/lib/schemas";
import type { Order } from "@/lib/types";
import { formatINR } from "@/lib/utils";

export function AdminOrder() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["order", id];
  const order = useQuery({ queryKey: key, queryFn: () => api<Order>(`/admin/orders/${id}`) });
  const [dialog, setDialog] = React.useState<"ship" | "cancel" | "refund" | null>(null);
  const done = (o: Order, message: string) => {
    qc.setQueryData(key, o);
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    toast.notify(message);
  };
  const step = useMutation({
    mutationFn: (action: "pack" | "deliver") => api<Order>(`/admin/orders/${id}/${action}`, { method: "POST" }),
    onSuccess: (o, action) => done(o, action === "pack" ? "Marked as packed" : "Marked as delivered"),
    onError: (e) => { toast.notify(errorMessage(e), "error"); qc.invalidateQueries({ queryKey: key }); },
  });

  if (order.isError) return <Alert tone="danger" title="Couldn't load this order">{errorMessage(order.error)}</Alert>;
  if (!order.data || !me.data) return <Skeleton className="h-96" />;
  const o = order.data;
  const fulfil = can(me.data, "orders.fulfil");
  const refund = can(me.data, "orders.refund");
  const has = (a: Order["actions"][number]) => o.actions.includes(a);

  return (
    <>
      <PageHeader
        back={<Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />Orders</Link>}
        title={`Order #${o.number}`}
        description={<span className="flex flex-wrap items-center gap-2">Placed {formatDateTime(o.placedAt)} <OrderStatusBadge status={o.status} /><PaymentStatusBadge status={o.paymentStatus} /></span>}
        actions={<>
          {o.invoiceNumber && <Button asChild variant="secondary"><Link href={`/admin/orders/${o.id}/invoice`}><FileText />Invoice</Link></Button>}
          {fulfil && has("pack") && <Button variant="secondary" loading={step.isPending && step.variables === "pack"} onClick={() => step.mutate("pack")}><PackageCheck />Mark packed</Button>}
          {fulfil && has("ship") && <Button onClick={() => setDialog("ship")}><Truck />Ship</Button>}
          {fulfil && has("deliver") && <Button loading={step.isPending && step.variables === "deliver"} onClick={() => step.mutate("deliver")}><PackageCheck />Mark delivered</Button>}
          {refund && has("refund") && <Button variant="secondary" onClick={() => setDialog("refund")}><RotateCcw />Refund</Button>}
          {refund && has("cancel") && <Button variant="secondary" onClick={() => setDialog("cancel")}><XCircle />Cancel order</Button>}
        </>}
      />
      {o.status === "PendingPayment" && <Alert tone="warning" className="mb-6">Waiting for the shopper to pay. Stock is held until {formatDateTime(o.reservedUntil)}; after that the order expires automatically.</Alert>}
      {o.paymentMethod === "Cod" && o.paymentStatus === "CodDue" && !["Cancelled", "Expired"].includes(o.status) && (
        <Alert tone="info" className="mb-6">Cash on delivery: collect {formatINR(o.total)} on delivery. Marking the order delivered records the payment.</Alert>
      )}
      {o.status === "Cancelled" && <Alert tone="info" className="mb-6" title="Cancelled">{formatDateTime(o.cancelledAt)}{o.cancelReason ? ` — ${o.cancelReason}` : ""}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card><CardHeader title="Items" /><div className="px-5 pb-5"><OrderItems order={o} /></div></Card>
          {o.payments.length > 0 && (
            <Card>
              <CardHeader title="Payment attempts" description="From the payment gateway. Each checkout or retry creates an attempt." />
              <Table>
                <thead><tr><Th>Gateway</Th><Th>Reference</Th><Th>Status</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>
                  {o.payments.map((p) => (
                    <tr key={p.gatewayOrderId}>
                      <Td>{p.gateway === "test" ? "Test mode" : "Razorpay"}<p className="text-[13px] text-fg-muted">{formatDateTime(p.createdAt)}</p></Td>
                      <Td className="text-[13px] break-all"><span className="tabular">{p.gatewayPaymentId ?? p.gatewayOrderId}</span></Td>
                      <Td>{p.status}{p.status === "Failed" && p.failureReason && <p className="text-[13px] text-danger">{p.failureReason}</p>}</Td>
                      <Td className="tabular text-right">{formatINR(p.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          {o.refunds.length > 0 && <Card><CardHeader title="Refunds" /><div className="px-5 pb-5"><Refunds order={o} showReason /></div></Card>}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Customer" />
            <div className="space-y-3 px-5 pb-5 text-sm">
              <p><span className="font-medium">{o.customerName}</span><br /><a href={`mailto:${o.email}`} className="break-all text-brand hover:underline">{o.email}</a></p>
              <div><p className="mb-1 text-xs font-medium tracking-wide text-fg-muted uppercase">Ship to</p><ShipToBlock order={o} /></div>
            </div>
          </Card>
          {o.shipments.length > 0 && <Card><CardHeader title="Shipment" /><div className="px-5 pb-5"><Shipments order={o} /></div></Card>}
          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-1.5 px-5 pb-5 text-sm">
              <Detail label="Payment" value={o.paymentMethod === "Cod" ? "Cash on delivery" : "Online"} />
              {o.paidAt && <Detail label="Paid" value={formatDateTime(o.paidAt)} />}
              <Detail label="Invoice" value={o.invoiceNumber ?? "Not issued"} />
              {Number(o.refundable) > 0 && <Detail label="Refundable" value={formatINR(o.refundable)} />}
            </dl>
          </Card>
        </div>
      </div>
      {dialog === "ship" && <ShipDialog order={o} onClose={() => setDialog(null)} onDone={(u) => done(u, "Marked as shipped. The customer has been emailed.")} />}
      {dialog === "cancel" && <CancelDialog order={o} onClose={() => setDialog(null)} onDone={(u) => done(u, "Order cancelled")} />}
      {dialog === "refund" && <RefundDialog order={o} onClose={() => setDialog(null)} onDone={(u) => done(u, "Refund recorded")} />}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-fg-muted">{label}</dt><dd className="text-right">{value}</dd></div>;
}

function ShipDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<ShipInput>({ resolver: zodResolver(shipSchema), defaultValues: { carrier: "", trackingNumber: "", trackingUrl: "" } });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      onDone(await api<Order>(`/admin/orders/${order.id}/ship`, { method: "POST", body: { ...v, trackingUrl: v.trackingUrl || null } }));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof ShipInput, { message: m });
      else setError(errorMessage(e));
    }
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <Dialog open onOpenChange={(v) => !v && !isSubmitting && onClose()} title={`Ship order #${order.number}`} description="The customer gets an email with these tracking details."
      footer={<><Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="ship-form" loading={isSubmitting}>Mark shipped</Button></>}>
      <form id="ship-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Courier" error={errors.carrier?.message}><Input autoFocus placeholder="e.g. Delhivery" {...form.register("carrier")} /></Field>
        <Field label="Tracking number" error={errors.trackingNumber?.message}><Input {...form.register("trackingNumber")} /></Field>
        <Field label="Tracking link" optional error={errors.trackingUrl?.message}><Input type="url" placeholder="https://" {...form.register("trackingUrl")} /></Field>
      </form>
    </Dialog>
  );
}

function CancelDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const [reason, setReason] = React.useState("");
  const cancel = useMutation({
    mutationFn: () => api<Order>(`/admin/orders/${order.id}/cancel`, { method: "POST", body: { reason: reason.trim() || null } }),
    onSuccess: (o) => { onDone(o); onClose(); },
  });
  const paidOnline = order.paymentMethod === "Online" && (order.paymentStatus === "Paid" || order.paymentStatus === "PartiallyRefunded");
  return (
    <Dialog open onOpenChange={(v) => !v && !cancel.isPending && onClose()} title={`Cancel order #${order.number}?`}
      description={`Items go back into stock and the customer is emailed.${paidOnline ? ` ${formatINR(order.refundable)} is refunded to their original payment method.` : ""}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>Keep order</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel order</Button></>}>
      <Field label="Reason (shown to the customer)" optional><Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {cancel.isError && <Alert tone="danger" className="mt-3">{errorMessage(cancel.error)}</Alert>}
    </Dialog>
  );
}

function RefundDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const [error, setError] = React.useState<string | null>(null);
  const max = Number(order.refundable);
  const form = useForm<RefundInput, unknown, RefundOutput>({ resolver: zodResolver(refundSchema(max)), defaultValues: { amount: order.refundable, reason: "" } });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      onDone(await api<Order>(`/admin/orders/${order.id}/refunds`, { method: "POST", body: v }));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof RefundInput, { message: m });
      else setError(errorMessage(e));
    }
  });
  const { errors, isSubmitting } = form.formState;
  const cod = order.paymentMethod === "Cod";
  return (
    <Dialog open onOpenChange={(v) => !v && !isSubmitting && onClose()} title={`Refund order #${order.number}`}
      description={cod ? "Cash on delivery: pay the customer back yourself (UPI or bank transfer), then record it here." : "The refund is sent through Razorpay to the customer's original payment method."}
      footer={<><Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="refund-form" loading={isSubmitting}>{cod ? "Record refund" : "Send refund"}</Button></>}>
      <form id="refund-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Amount (₹)" hint={`Up to ${formatINR(max)}.`} error={errors.amount?.message}><Input inputMode="decimal" autoFocus {...form.register("amount")} /></Field>
        <Field label="Reason (internal)" error={errors.reason?.message}><Textarea rows={3} maxLength={300} {...form.register("reason")} /></Field>
      </form>
    </Dialog>
  );
}
