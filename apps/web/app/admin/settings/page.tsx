"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, CreditCard, FlaskConical } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { BRAND_PRESETS, contrastWithWhite } from "@/lib/color";
import { can, meKey, useMe } from "@/lib/hooks";
import { razorpayKeysSchema, storeSchema, type RazorpayKeysInput, type StoreInput } from "@/lib/schemas";
import type { PaymentSettings, Store } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "499.00" → "499" for editing; keeps paise when present. */
function plain(v: string): string {
  return v.endsWith(".00") ? v.slice(0, -3) : v;
}

export default function SettingsPage() {
  const store = useQuery({ queryKey: ["store"], queryFn: () => api<Store>("/admin/store") });
  if (store.isPending) return <><PageHeader title="Store settings" /><Skeleton className="h-96" /></>;
  if (store.isError) return <><PageHeader title="Store settings" /><Alert tone="danger" title="Couldn't load settings">{errorMessage(store.error)}</Alert></>;
  return <><SettingsForm store={store.data} /><PaymentSettingsCard /></>;
}

function SettingsForm({ store }: { store: Store }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const editable = can(me.data, "settings.write");
  const form = useForm<StoreInput, unknown, ReturnType<typeof storeSchema.parse>>({
    resolver: zodResolver(storeSchema),
    defaultValues: {
      name: store.name, legalName: store.legalName ?? "", gstin: store.gstin ?? "", tagline: store.tagline ?? "",
      supportEmail: store.supportEmail ?? "", brandColor: store.brandColor, lowStockThreshold: String(store.lowStockThreshold),
      businessAddress: store.businessAddress ?? "", shippingFee: plain(store.shippingFee), freeShippingThreshold: store.freeShippingThreshold ? plain(store.freeShippingThreshold) : "",
      codEnabled: store.codEnabled, codMaxOrderValue: plain(store.codMaxOrderValue),
    },
  });
  const { register, formState, setError, watch, setValue, reset } = form;
  const color = watch("brandColor");
  const contrast = contrastWithWhite(color);

  const save = useMutation({
    mutationFn: ({ freeShippingThreshold, shippingFee, codMaxOrderValue, ...rest }: ReturnType<typeof storeSchema.parse>) => api<Store>("/admin/store", {
      method: "PATCH",
      body: {
        ...rest, shippingFee: Number(shippingFee), codMaxOrderValue: Number(codMaxOrderValue),
        ...(freeShippingThreshold ? { freeShippingThreshold: Number(freeShippingThreshold) } : { clearFreeShipping: true }),
      },
    }),
    onSuccess: (saved) => {
      qc.setQueryData(["store"], saved);
      qc.invalidateQueries({ queryKey: meKey });
      reset(form.getValues());
      toast.notify("Settings saved");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) setError(k as keyof StoreInput, { message: m });
      else toast.notify(errorMessage(e), "error");
    },
  });

  const errors = formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
      <PageHeader title="Store settings" description={`Your storefront: ${store.host}`} actions={editable && <Button type="submit" loading={save.isPending} disabled={!formState.isDirty}>Save changes</Button>} />
      {!editable && <Alert tone="info" className="mb-6">Only the store owner can change these settings.</Alert>}
      <fieldset disabled={!editable} className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Store details" description="Shown on your storefront and invoices." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Store name" error={errors.name?.message} className="sm:col-span-2"><Input {...register("name")} /></Field>
              <Field label="Tagline" optional error={errors.tagline?.message} className="sm:col-span-2" hint="One line under your store name on the home page.">
                <Input {...register("tagline")} maxLength={200} />
              </Field>
              <Field label="Support email" optional error={errors.supportEmail?.message}><Input type="email" {...register("supportEmail")} /></Field>
              <Field label="Low-stock alert at" error={errors.lowStockThreshold?.message} hint="Units per variant"><Input inputMode="numeric" {...register("lowStockThreshold")} /></Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Tax registration" description="Required for GST tax invoices." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Legal business name" optional error={errors.legalName?.message}><Input {...register("legalName")} /></Field>
              <Field label="GSTIN" optional error={errors.gstin?.message} hint="Your state is derived from the first two digits."><Input className="font-mono uppercase" maxLength={15} {...register("gstin")} /></Field>
              <Field label="Registered business address" optional error={errors.businessAddress?.message} className="sm:col-span-2" hint="Printed on tax invoices.">
                <Textarea rows={3} maxLength={500} {...register("businessAddress")} />
              </Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Delivery and cash on delivery" description="Applied at checkout. Prices and fees include GST." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Delivery fee (₹)" error={errors.shippingFee?.message} hint="Charged per order. Enter 0 for free delivery."><Input inputMode="decimal" {...register("shippingFee")} /></Field>
              <Field label="Free delivery from (₹)" optional error={errors.freeShippingThreshold?.message} hint="Order value after discounts. Leave empty to always charge."><Input inputMode="decimal" {...register("freeShippingThreshold")} /></Field>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" {...register("codEnabled")} />
                <span><span className="font-medium">Offer cash on delivery</span><span className="block text-fg-muted">Shoppers pay the courier in cash. You record the payment when you mark the order delivered.</span></span>
              </label>
              <Field label="Cash on delivery up to (₹)" error={errors.codMaxOrderValue?.message} hint="Larger orders must be paid online."><Input inputMode="decimal" {...register("codMaxOrderValue")} /></Field>
            </div>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Brand colour" description="Used for buttons and links on your storefront." />
          <div className="flex flex-col gap-4 p-5">
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Preset colours">
              {BRAND_PRESETS.map(([name, hex]) => (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={color.toLowerCase() === hex}
                  aria-label={name}
                  title={name}
                  onClick={() => setValue("brandColor", hex, { shouldDirty: true, shouldValidate: true })}
                  className={cn("grid aspect-square place-items-center rounded-md ring-offset-2 transition", color.toLowerCase() === hex && "ring-2 ring-fg")}
                  style={{ background: hex }}
                >
                  {color.toLowerCase() === hex && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
            <div className="flex items-start gap-2">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#4f46e5"} onChange={(e) => setValue("brandColor", e.target.value, { shouldDirty: true, shouldValidate: true })} className="mt-[26px] h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border-strong bg-surface p-1" aria-label="Pick a colour" />
              <Field label="Custom hex" error={errors.brandColor?.message} className="flex-1">
                <Input className="font-mono" {...register("brandColor")} />
              </Field>
            </div>
            <div className="rounded-md border border-border p-4">
              <p className="mb-3 text-xs font-medium tracking-wide text-fg-muted uppercase">Preview</p>
              <span className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium text-white" style={{ background: color }}>Add to cart</span>
              <p className={cn("mt-3 text-[13px]", contrast >= 4.5 ? "text-success" : "text-danger")}>
                Contrast {contrast.toFixed(1)}:1 {contrast >= 4.5 ? "meets accessibility guidelines." : "is too low for white text. Pick a darker shade."}
              </p>
            </div>
          </div>
        </Card>
      </fieldset>
    </form>
  );
}

const WEBHOOK_EVENTS = ["payment.captured", "payment.failed", "order.paid", "refund.processed", "refund.failed"];

/**
 * Razorpay connection. Keys are checked against Razorpay before saving, then stored encrypted; the secret is never
 * sent back to the browser (only a masked key ID). Hidden from staff without settings access.
 */
function PaymentSettingsCard() {
  const me = useMe();
  const allowed = can(me.data, "settings.write");
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ["payment-settings"], queryFn: () => api<PaymentSettings>("/admin/payments"), enabled: allowed });
  const [replacing, setReplacing] = React.useState(false);
  const [confirmOff, setConfirmOff] = React.useState(false);
  const disconnect = useMutation({
    mutationFn: () => api("/admin/payments/razorpay", { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payment-settings"] }); setConfirmOff(false); toast.notify("Razorpay disconnected"); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });
  if (!allowed) return null;
  return (
    <Card className="mt-6" id="payments">
      <CardHeader title="Online payments" description="Connect your own Razorpay account. Money goes straight to your Razorpay balance." />
      <div className="p-5">
        {settings.isPending ? <Skeleton className="h-24" /> : settings.isError ? <Alert tone="danger">{errorMessage(settings.error)}</Alert> : (() => {
          const s = settings.data;
          if (!s.encryptionConfigured) return <Alert tone="warning" title="Payments can't be set up yet">The platform&apos;s encryption key for payment secrets isn&apos;t configured. Contact ShopMint support.</Alert>;
          return (
            <div className="space-y-5">
              {s.connected && !replacing ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <CreditCard className="size-4 text-fg-muted" aria-hidden />Connected with key <span className="font-mono">{s.keyIdHint}</span>
                    <Badge tone={s.mode === "live" ? "success" : "warning"}>{s.mode === "live" ? "Live mode" : "Razorpay test keys"}</Badge>
                  </p>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>Replace keys</Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmOff(true)}>Disconnect</Button>
                  </div>
                </div>
              ) : (
                <>
                  {!s.connected && (s.testModeAvailable
                    ? <Alert tone="warning" title="Test mode"><span className="inline-flex items-center gap-1"><FlaskConical className="size-4" aria-hidden />Until you connect Razorpay, online checkout uses a simulator and no money moves. Test mode exists only on development servers.</span></Alert>
                    : <Alert tone="info">Until you connect Razorpay, shoppers can only choose cash on delivery.</Alert>)}
                  <KeysForm onDone={() => setReplacing(false)} onCancel={s.connected ? () => setReplacing(false) : undefined} />
                </>
              )}
              <div className="rounded-md border border-border bg-surface-muted/50 p-4 text-sm">
                <p className="font-medium">Webhook (required)</p>
                <p className="mt-1 text-fg-muted">In the Razorpay Dashboard, open Settings → Webhooks, add this URL with the same webhook secret you enter here, and select these events: {WEBHOOK_EVENTS.join(", ")}. Webhooks confirm payments even if the shopper closes their browser.</p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded border border-border bg-surface px-2 py-1.5 text-[13px]" data-testid="webhook-url">{s.webhookUrl}</code>
                  <Button type="button" variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(s.webhookUrl).then(() => toast.notify("Webhook URL copied"), () => toast.notify("Couldn't copy. Select the text instead.", "error"))}>
                    <Copy />Copy
                  </Button>
                </div>
                <p className="mt-3 text-fg-muted">Also turn on automatic payment capture (Settings → Payment capture) so payments are captured as soon as they succeed.</p>
              </div>
            </div>
          );
        })()}
      </div>
      {confirmOff && (
        <Dialog open onOpenChange={(v) => !v && setConfirmOff(false)} title="Disconnect Razorpay?"
          description="Shoppers won't be able to pay online until you connect again. Orders already paid aren't affected."
          footer={<><Button variant="secondary" onClick={() => setConfirmOff(false)}>Keep connected</Button><Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button></>} />
      )}
    </Card>
  );
}

function KeysForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<RazorpayKeysInput>({ resolver: zodResolver(razorpayKeysSchema), defaultValues: { keyId: "", keySecret: "", webhookSecret: "" } });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const saved = await api<PaymentSettings>("/admin/payments/razorpay", { method: "PUT", body: v });
      qc.setQueryData(["payment-settings"], saved);
      form.reset();
      toast.notify("Razorpay connected");
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof RazorpayKeysInput, { message: m });
      else setError(errorMessage(e));
    }
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2" aria-label="Razorpay keys">
      {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
      <Field label="Key ID" error={errors.keyId?.message} hint="Razorpay Dashboard → Account & Settings → API keys."><Input className="font-mono" autoComplete="off" {...form.register("keyId")} /></Field>
      <Field label="Key secret" error={errors.keySecret?.message} hint="Stored encrypted. It's never shown again."><Input type="password" autoComplete="new-password" {...form.register("keySecret")} /></Field>
      <Field label="Webhook secret" error={errors.webhookSecret?.message} hint="Any strong secret; enter the same one in Razorpay's webhook settings." className="sm:col-span-2">
        <Input type="password" autoComplete="new-password" {...form.register("webhookSecret")} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={isSubmitting}>Check and connect</Button>
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>}
      </div>
    </form>
  );
}
