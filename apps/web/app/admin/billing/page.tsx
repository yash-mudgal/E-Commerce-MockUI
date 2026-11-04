"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FlaskConical, Receipt, RefreshCw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { can, meKey, useMe } from "@/lib/hooks";
import { loadRazorpay } from "@/lib/razorpay";
import type { BillingCheckout, BillingOverview, BillingPlanOption } from "@/lib/types";
import { cn, formatDate, formatINR } from "@/lib/utils";

const key = ["billing"] as const;
const limit = (n: number | null, unit: string) => (n === null ? `Unlimited ${unit}` : `${n.toLocaleString("en-IN")} ${unit}`);

/**
 * The store's own ShopMint plan. Owners subscribe through Razorpay (ShopMint's account), or a labelled simulator in
 * test mode. Every state shown here comes from the API, which derives it from the subscription and trial.
 */
export default function BillingPage() {
  const me = useMe();
  const allowed = can(me.data, "billing.manage");
  const billing = useQuery({ queryKey: key, queryFn: () => api<BillingOverview>("/admin/billing"), enabled: allowed });

  if (me.data && !allowed)
    return <><PageHeader title="Billing" /><Alert tone="info">Only the store owner can view and change the ShopMint plan. Your store is on the <strong>{me.data.tenant?.plan}</strong> plan.</Alert></>;
  if (billing.isError)
    return <><PageHeader title="Billing" /><Alert tone="danger" title="Couldn't load billing" action={<Button variant="secondary" size="sm" onClick={() => billing.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(billing.error)}</Alert></>;
  if (!billing.data) return <><PageHeader title="Billing" /><Skeleton className="h-96" /></>;
  return <BillingView b={billing.data} />;
}

function BillingView({ b }: { b: BillingOverview }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pay, setPay] = React.useState<BillingCheckout | null>(null);
  const [confirm, setConfirm] = React.useState<{ option: BillingPlanOption } | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const refresh = (next?: BillingOverview) => {
    if (next) qc.setQueryData(key, next);
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: meKey });
  };

  const checkout = useMutation({
    mutationFn: (plan: string) => api<BillingCheckout>("/admin/billing/checkout", { method: "POST", body: { planCode: plan } }),
    onMutate: () => setError(null),
    onSuccess: async (c) => {
      if (c.isTest) { setPay(c); return; }
      try {
        await loadRazorpay();
        const rzp = new window.Razorpay!({
          key: c.keyId, subscription_id: c.subscriptionId, name: "ShopMint", description: `${c.planName} plan for ${c.storeName}`,
          prefill: { email: c.email },
          handler: async (r: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
            try {
              refresh(await api<BillingOverview>("/admin/billing/verify", {
                method: "POST", body: { razorpayPaymentId: r.razorpay_payment_id, razorpaySubscriptionId: r.razorpay_subscription_id, razorpaySignature: r.razorpay_signature },
              }));
              toast.notify("Subscription set up");
            } catch (e) { setError(errorMessage(e)); refresh(); }
          },
          modal: { ondismiss: () => refresh() },
        });
        rzp.open();
      } catch (e) { setError((e as Error).message); }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const sub = b.subscription;
  const pending = sub?.pendingPlanCode ? b.plans.find((p) => p.code === sub.pendingPlanCode)?.name ?? sub.pendingPlanCode : null;
  const canCancel = sub && sub.gateway !== "manual" && !sub.cancelAtPeriodEnd && ["Active", "Authenticated", "Pending", "Halted"].includes(sub.status);

  return (
    <>
      <PageHeader title="Billing" description={`Your ShopMint plan. Prices are per month and exclude ${Number(b.gstRate)}% GST.`} />
      {b.isTestMode && (
        <Alert tone="warning" className="mb-4" title="Test mode">
          <span className="inline-flex items-center gap-1"><FlaskConical className="size-4" aria-hidden />ShopMint&apos;s Razorpay account isn&apos;t connected here, so payments are simulated and nothing is charged. This is only possible on development servers.</span>
        </Alert>
      )}
      <StatusNotice b={b} pending={pending} />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Current plan" />
          <div className="space-y-4 px-5 pt-4 pb-5 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold">{b.planName}</span>
              <StatusBadge status={b.status} />
            </div>
            <dl className="space-y-1.5">
              {sub && <Row label="Billed through" value={sub.gateway === "manual" ? "Assigned by ShopMint" : sub.gateway === "test" ? "Test mode (simulated)" : "Razorpay"} />}
              {sub?.gatewaySubscriptionId && <Row label="Reference" value={sub.gatewaySubscriptionId} />}
              {sub?.status === "Active" && sub.currentPeriodEnd && <Row label={sub.cancelAtPeriodEnd ? "Ends" : "Renews"} value={formatDate(sub.currentPeriodEnd)} />}
              {sub?.status === "Authenticated" && sub.startAt && <Row label="First charge" value={formatDate(sub.startAt)} />}
              {b.status === "Trialing" && b.trialEndsAt && <Row label="Trial ends" value={formatDate(b.trialEndsAt)} />}
            </dl>
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">Usage</p>
              <Usage label="Products" used={b.usage.products} max={b.limits.maxProducts} />
              <Usage label="Team members and invitations" used={b.usage.staff} max={b.limits.maxStaff} />
              <Usage label="Stock locations" used={b.usage.locations} max={b.limits.maxLocations} />
            </div>
            {canCancel && <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setCancelling(true)}>Cancel subscription</Button>}
          </div>
        </Card>

        <section className="lg:col-span-2" aria-labelledby="plans-h">
          <h2 id="plans-h" className="sr-only">Plans</h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {b.plans.map((p) => (
              <li key={p.code} className={cn("flex flex-col rounded-[var(--radius-card)] border bg-surface p-5", p.action === "current" ? "border-brand ring-1 ring-brand" : "border-border")}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{p.name}</h3>
                  {p.action === "current" && <Badge tone="brand">Your plan</Badge>}
                </div>
                <p className="mt-2"><span className="text-2xl font-semibold tabular-nums">{formatINR(p.monthlyPrice)}</span><span className="text-sm text-fg-muted"> /month</span></p>
                <p className="text-xs text-fg-muted">plus GST · {formatINR(p.monthlyPriceWithGst)} including GST</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {[limit(p.maxProducts, "products"), limit(p.maxStaff, p.maxStaff === 1 ? "team member" : "team members"), limit(p.maxLocations, p.maxLocations === 1 ? "stock location" : "stock locations")].map((f) => (
                    <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{f}</li>
                  ))}
                </ul>
                {p.action !== "current" && p.action !== "none" && (
                  <Button className="mt-5" variant={p.action === "downgrade" ? "secondary" : "primary"} disabled={!p.available}
                    loading={checkout.isPending && checkout.variables === p.code}
                    onClick={() => (p.action === "subscribe" ? checkout.mutate(p.code) : setConfirm({ option: p }))}>
                    {p.action === "subscribe" ? `Choose ${p.name}` : p.action === "upgrade" ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
                  </Button>
                )}
                {p.unavailableReason && <p className="mt-2 text-xs text-fg-muted">{p.unavailableReason}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Card className="mt-6">
        <CardHeader title="Payments" description="Each successful charge for your ShopMint plan." />
        {b.invoices.length === 0 ? (
          <EmptyState icon={Receipt} title="No payments yet" description="Receipts appear here after each charge." />
        ) : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Plan</Th><Th className="hidden sm:table-cell">Period</Th><Th className="text-right">Amount</Th><Th><span className="sr-only">Invoice</span></Th></tr></thead>
            <tbody>
              {b.invoices.map((i) => (
                <tr key={i.id}>
                  <Td>{formatDate(i.paidAt)}</Td>
                  <Td>{b.plans.find((p) => p.code === i.planCode)?.name ?? i.planCode}</Td>
                  <Td className="hidden text-fg-muted sm:table-cell">{i.periodStart && i.periodEnd ? `${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}` : "—"}</Td>
                  <Td className="tabular text-right">{formatINR(i.amount)}</Td>
                  <Td className="text-right">
                    {i.invoiceUrl ? <a href={i.invoiceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">Invoice<ExternalLink className="size-3.5" aria-hidden /><span className="sr-only"> (opens Razorpay)</span></a>
                      : <span className="font-mono text-xs text-fg-muted">{i.reference}</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {pay && <TestPaymentDialog checkout={pay} onClose={(next) => { setPay(null); refresh(next); }} />}
      {confirm && <ChangePlanDialog b={b} option={confirm.option} onClose={(next) => { setConfirm(null); if (next) refresh(next); }} />}
      {cancelling && <CancelDialog b={b} onClose={(next) => { setCancelling(false); if (next) refresh(next); }} />}
    </>
  );
}

function StatusBadge({ status }: { status: BillingOverview["status"] }) {
  const map = { Trialing: ["Trial", "info"], Active: ["Active", "success"], PastDue: ["Payment failed", "warning"], Suspended: ["Closed", "danger"], Cancelled: ["Ended", "neutral"] } as const;
  const [label, tone] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

function StatusNotice({ b, pending }: { b: BillingOverview; pending: string | null }) {
  const sub = b.subscription;
  const cls = "mb-4";
  if (b.status === "Suspended" && b.suspensionReason === "Platform")
    return <Alert tone="danger" className={cls} title="Suspended by ShopMint">Your storefront is offline and the admin is read-only. Contact ShopMint support to resolve this.</Alert>;
  if (b.status === "Suspended")
    return <Alert tone="danger" className={cls} title={b.suspensionReason === "TrialExpired" ? "Your free trial has ended" : "We couldn't collect payment"}>Your storefront is closed and the admin is read-only. Choose a plan below to reopen straight away; your data is kept.</Alert>;
  if (b.status === "Cancelled")
    return <Alert tone="warning" className={cls} title="Your subscription has ended">Your storefront is closed and the admin is read-only. Choose a plan to reopen.</Alert>;
  if (b.status === "PastDue")
    return <Alert tone="warning" className={cls} title="Payment failed">Razorpay will retry the charge. Your store stays open until {formatDate(b.graceEndsAt)}. To pay with a different card or UPI, choose a plan below.</Alert>;
  if (b.status === "Trialing" && sub?.status === "Authenticated")
    return <Alert tone="success" className={cls} title="You're all set">Your {sub.planName} plan starts when the trial ends ({formatDate(sub.startAt)}); that&apos;s when the first charge happens.</Alert>;
  if (b.status === "Trialing")
    return <Alert tone="info" className={cls}>Your free trial ends on {formatDate(b.trialEndsAt)}. Choose a plan now; you won&apos;t be charged until the trial ends.</Alert>;
  if (sub?.cancelAtPeriodEnd)
    return <Alert tone="warning" className={cls} title="Subscription cancelled">Your plan ends on {formatDate(sub.currentPeriodEnd)}, then your store closes. Choose a plan to keep it open; billing starts when the current period ends.</Alert>;
  if (pending) return <Alert tone="info" className={cls}>You&apos;ll move to {pending} on {formatDate(sub?.currentPeriodEnd)}, when the current period ends.</Alert>;
  return null;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-fg-muted">{label}</dt><dd className="text-right">{value}</dd></div>;
}

function Usage({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between gap-3"><span>{label}</span><span className="tabular-nums text-fg-muted">{used.toLocaleString("en-IN")}{max === null ? " (no limit)" : ` of ${max.toLocaleString("en-IN")}`}</span></div>
      {max !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-brand")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function TestPaymentDialog({ checkout, onClose }: { checkout: BillingCheckout; onClose: (next?: BillingOverview) => void }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<"success" | "failure" | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const run = async (outcome: "success" | "failure") => {
    setBusy(outcome);
    setMessage(null);
    try {
      const r = await api<{ paid: boolean; billing: BillingOverview }>("/admin/billing/test-payment", { method: "POST", body: { subscriptionId: checkout.subscriptionId, outcome } });
      if (r.paid) { toast.notify("Subscription set up"); onClose(r.billing); }
      else setMessage("The test payment was declined. Nothing changed; you can try again.");
    } catch (e) { setMessage(errorMessage(e)); }
    setBusy(null);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()} title="Test payment" description="Billing is in test mode. No real payment page is shown and nothing is charged."
      footer={<>
        <Button variant="secondary" disabled={!!busy} loading={busy === "failure"} onClick={() => run("failure")}>Simulate a failed payment</Button>
        <Button disabled={!!busy} loading={busy === "success"} onClick={() => run("success")}>Simulate a successful payment</Button>
      </>}>
      <p className="text-sm">{checkout.planName} plan · <span className="tabular font-semibold">{formatINR(checkout.amountWithGst)}</span> a month including GST{checkout.startAt ? `, first charge on ${formatDate(checkout.startAt)}` : ""}.</p>
      {message && <Alert tone="warning" className="mt-3">{message}</Alert>}
    </Dialog>
  );
}

function ChangePlanDialog({ b, option, onClose }: { b: BillingOverview; option: BillingPlanOption; onClose: (next?: BillingOverview) => void }) {
  const toast = useToast();
  const change = useMutation({
    mutationFn: () => api<BillingOverview>("/admin/billing/change-plan", { method: "POST", body: { planCode: option.code } }),
    onSuccess: (next) => { toast.notify(option.action === "upgrade" ? `Upgraded to ${option.name}` : `You'll move to ${option.name} at the end of the period`); onClose(next); },
  });
  const upgrade = option.action === "upgrade";
  return (
    <Dialog open onOpenChange={(o) => !o && !change.isPending && onClose()} title={upgrade ? `Upgrade to ${option.name}?` : `Switch to ${option.name}?`}
      description={upgrade
        ? `${option.name}'s limits apply now and Razorpay charges ${formatINR(option.monthlyPriceWithGst)} (including GST) for the new plan.`
        : `You keep ${b.planName} until ${formatDate(b.subscription?.currentPeriodEnd)}, then pay ${formatINR(option.monthlyPriceWithGst)} a month (including GST).`}
      footer={<><Button variant="secondary" onClick={() => onClose()} disabled={change.isPending}>Cancel</Button><Button loading={change.isPending} onClick={() => change.mutate()}>{upgrade ? "Upgrade" : "Switch plan"}</Button></>}>
      {change.isError && <Alert tone="danger">{errorMessage(change.error)}</Alert>}
    </Dialog>
  );
}

function CancelDialog({ b, onClose }: { b: BillingOverview; onClose: (next?: BillingOverview) => void }) {
  const toast = useToast();
  const sub = b.subscription!;
  const atEnd = sub.status === "Active";
  const cancel = useMutation({
    mutationFn: () => api<BillingOverview>("/admin/billing/cancel", { method: "POST" }),
    onSuccess: (next) => { toast.notify("Subscription cancelled"); onClose(next); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !cancel.isPending && onClose()} title="Cancel your subscription?"
      description={atEnd
        ? `You keep ${sub.planName} until ${formatDate(sub.currentPeriodEnd)}. After that your storefront closes and the admin becomes read-only. Your data is kept.`
        : "The subscription stops now and nothing more is charged."}
      footer={<><Button variant="secondary" onClick={() => onClose()} disabled={cancel.isPending}>Keep subscription</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel subscription</Button></>}>
      {cancel.isError && <Alert tone="danger">{errorMessage(cancel.error)}</Alert>}
    </Dialog>
  );
}
