"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ExternalLink, PartyPopper, RefreshCw, Rocket } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ResendVerification } from "@/components/admin/resend-verification";
import { storefrontUrl } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, meKey, onboardingKey, useMe } from "@/lib/hooks";
import type { Me, OnboardingStatus, OnboardingStep, Store } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

export default function SetupPage() {
  const me = useMe();
  const status = useQuery({ queryKey: onboardingKey, queryFn: () => api<OnboardingStatus>("/admin/onboarding") });

  if (status.isPending || !me.data) return <><PageHeader title="Launch checklist" /><Skeleton className="h-96" /></>;
  if (status.isError)
    return (
      <>
        <PageHeader title="Launch checklist" />
        <Alert tone="danger" title="Couldn't load your checklist" action={<Button variant="secondary" size="sm" onClick={() => status.refetch()}><RefreshCw />Retry</Button>}>
          {errorMessage(status.error)}
        </Alert>
      </>
    );

  const s = status.data;
  const done = s.steps.filter((x) => x.done).length;
  const firstOpen = s.steps.find((x) => !x.done)?.key;
  return (
    <>
      <PageHeader
        title={s.isLive ? "Your store is live" : "Launch your store"}
        description={s.isLive ? `Launched on ${formatDate(s.launchedAt)}. The remaining steps are optional but recommended.` : "Shoppers see a “coming soon” page until you launch. Finish the required steps, then publish."}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={s.steps.length} aria-valuenow={done}>
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(done / s.steps.length) * 100}%` }} />
            </div>
            <span className="text-sm text-fg-muted tabular-nums">{done} of {s.steps.length} done</span>
          </div>
          <ol className="flex flex-col gap-3">
            {s.steps.map((step, i) => (
              <StepCard key={step.key} n={i + 1} step={step} me={me.data!} defaultOpen={step.key === firstOpen} />
            ))}
          </ol>
        </div>
        <LaunchPanel status={s} me={me.data} />
      </div>
    </>
  );
}

function StepCard({ n, step, me, defaultOpen }: { n: number; step: OnboardingStep; me: Me; defaultOpen: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const panelId = `step-${step.key}`;
  return (
    <li>
      <Card className={cn(step.done && "bg-surface-muted/40")}>
        <button
          type="button"
          className="flex w-full items-center gap-3 p-4 text-left"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          {step.done ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="Done" /> : <Circle className="size-5 shrink-0 text-fg-subtle" aria-label="To do" />}
          <span className="min-w-0 flex-1">
            <span className={cn("block font-medium", step.done && "text-fg-muted")}>
              <span className="sr-only">Step {n}: </span>{step.title}
            </span>
            <span className="block text-[13px] text-fg-muted">{step.description}</span>
          </span>
          {step.required ? !step.done && <Badge tone="warning">Required</Badge> : <Badge>Optional</Badge>}
        </button>
        {open && (
          <div id={panelId} className="border-t border-border px-4 py-4 sm:pl-12">
            <StepAction step={step} me={me} />
          </div>
        )}
      </Card>
    </li>
  );
}

function StepAction({ step, me }: { step: OnboardingStep; me: Me }) {
  const settings = can(me, "settings.write");
  switch (step.key) {
    case "verify_email":
      if (step.done) return <p className="text-sm text-fg-muted">The owner&apos;s email address is confirmed.</p>;
      return me.role === "Owner" ? (
        me.user.emailVerified ? <p className="text-sm text-fg-muted">Your email is confirmed. Refresh to update this step.</p> : (
          <div className="text-sm">
            <p>We sent a confirmation link to <span className="font-medium">{me.user.email}</span> when you signed up. Open it and click <span className="font-medium">Confirm email</span>.</p>
            <p className="mt-2 text-fg-muted">Can&apos;t find it? <ResendVerification email={me.user.email} compact /></p>
          </div>
        )
      ) : <p className="text-sm text-fg-muted">Ask the store owner to confirm their email from the link we sent them.</p>;
    case "store_details":
      return settings ? <SupportEmailForm done={step.done} /> : <p className="text-sm text-fg-muted">Ask the owner to add a support email in store settings.</p>;
    case "first_product":
      return (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-fg-muted">{step.done ? "You have a product ready to sell." : "Set its status to Active and give at least one variant stock on hand."}</p>
          <Button asChild size="sm" variant={step.done ? "secondary" : "primary"}>
            <Link href={step.done ? "/admin/products" : "/admin/products/new"}>{step.done ? "View products" : "Add a product"}</Link>
          </Button>
        </div>
      );
    case "branding":
    case "tax":
      return (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-fg-muted">{step.key === "tax" ? "Needed before you can issue GST tax invoices." : "A tagline and brand colour make your storefront recognisable."}</p>
          <Button asChild size="sm" variant="secondary"><Link href="/admin/settings">Open store settings</Link></Button>
        </div>
      );
    case "team":
      return can(me, "staff.manage") ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-fg-muted">{step.done ? "Your team is set up." : "Invite staff so everyone has their own login."}</p>
          <Button asChild size="sm" variant="secondary"><Link href="/admin/staff">Manage team</Link></Button>
        </div>
      ) : <p className="text-sm text-fg-muted">The owner or a manager can invite people.</p>;
    default:
      return null;
  }
}

/** Inline form for the one blocking store detail. Sends the full settings object the API expects. */
function SupportEmailForm({ done }: { done: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const store = useQuery({ queryKey: ["store"], queryFn: () => api<Store>("/admin/store") });
  const [email, setEmail] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: (supportEmail: string) => {
      const s = store.data!;
      return api<Store>("/admin/store", {
        method: "PATCH",
        body: { name: s.name, legalName: s.legalName, gstin: s.gstin, stateCode: s.stateCode, tagline: s.tagline, supportEmail, brandColor: s.brandColor, lowStockThreshold: s.lowStockThreshold },
      });
    },
    onSuccess: (saved) => {
      qc.setQueryData(["store"], saved);
      qc.invalidateQueries({ queryKey: onboardingKey });
      setError(null);
      toast.notify("Support email saved");
    },
    onError: (e) => setError(e instanceof ApiError ? (e.fieldErrors.supportEmail ?? errorMessage(e)) : errorMessage(e)),
  });

  if (store.isPending) return <Skeleton className="h-16" />;
  if (store.isError) return <Alert tone="danger">{errorMessage(store.error)}</Alert>;
  const value = email ?? store.data.supportEmail ?? "";
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return setError("Enter a valid email address");
        save.mutate(value.trim());
      }}
    >
      <Field label="Support email" error={error ?? undefined} hint={done ? "Shown in your storefront footer." : "Customers will use this to contact you."} className="flex-1">
        <Input type="email" value={value} onChange={(e) => setEmail(e.target.value)} placeholder="help@yourstore.in" />
      </Field>
      <Button type="submit" className="sm:mt-[26px]" loading={save.isPending} disabled={value.trim() === (store.data.supportEmail ?? "")}>Save</Button>
    </form>
  );
}

function LaunchPanel({ status, me }: { status: OnboardingStatus; me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = can(me, "settings.write");
  const launch = useMutation({
    mutationFn: () => api<OnboardingStatus>("/admin/onboarding/launch", { method: "POST" }),
    onSuccess: (next) => {
      qc.setQueryData(onboardingKey, next);
      qc.invalidateQueries({ queryKey: meKey });
      toast.notify("Your store is live");
    },
  });
  const missing = status.steps.filter((s) => s.required && !s.done);
  const host = me.tenant?.host ?? "";

  if (status.isLive)
    return (
      <Card className="h-fit p-5">
        <PartyPopper className="size-6 text-brand" aria-hidden />
        <h2 className="mt-3 font-semibold">Open for business</h2>
        <p className="mt-1 text-sm text-fg-muted">Shoppers can browse your catalogue at <span className="font-medium break-all text-fg">{host}</span>.</p>
        {launch.isSuccess && <p className="mt-2 text-[13px] text-fg-muted">Your storefront updates within a few seconds. If you still see “coming soon”, refresh the page.</p>}
        <Button asChild variant="secondary" className="mt-4 w-full">
          <a href={storefrontUrl(host)} target="_blank" rel="noreferrer">View storefront<ExternalLink /><span className="sr-only">(opens in a new tab)</span></a>
        </Button>
      </Card>
    );

  return (
    <Card className="h-fit p-5">
      <Rocket className="size-6 text-brand" aria-hidden />
      <h2 className="mt-3 font-semibold">Publish your storefront</h2>
      <p className="mt-1 text-sm text-fg-muted">
        {missing.length ? `${missing.length} required ${missing.length === 1 ? "step" : "steps"} left before you can launch.` : "Everything required is done. Launch when you're ready."}
      </p>
      {launch.isError && <Alert tone="danger" className="mt-3">{errorMessage(launch.error)}</Alert>}
      {allowed ? (
        <Button className="mt-4 w-full" size="lg" disabled={!status.canLaunch} loading={launch.isPending} onClick={() => launch.mutate()}>
          Launch store
        </Button>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">Only the owner can launch the store.</p>
      )}
      <p className="mt-3 text-[13px] text-fg-muted">Payments and checkout are being built. Until then shoppers can browse your catalogue but can&apos;t place orders.</p>
    </Card>
  );
}
