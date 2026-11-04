"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldAlert } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { PlatformHeader } from "@/components/platform/header";
import { isMfaRequired, MfaRequiredCard } from "@/components/platform-mfa";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { planSchema, type PlanInput, type PlanOutput } from "@/lib/schemas";
import type { PlatformPlan } from "@/lib/types";
import { formatINR } from "@/lib/utils";

const key = ["platform-plans"] as const;
const lim = (n: number | null) => (n === null ? "Unlimited" : n.toLocaleString("en-IN"));

export default function PlatformPlansPage() {
  const me = useMe();
  const isAdmin = me.data?.user.isPlatformAdmin;
  const plans = useQuery({ queryKey: key, queryFn: () => api<PlatformPlan[]>("/platform/plans"), enabled: !!isAdmin });
  const [editing, setEditing] = React.useState<PlatformPlan | null>(null);
  return (
    <div className="min-h-dvh">
      <PlatformHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {me.isPending ? <Skeleton className="h-64" /> : !isAdmin ? (
          <Card><EmptyState icon={ShieldAlert} title="Platform access required" description="This console is only available to ShopMint operators." /></Card>
        ) : (
          <>
            <PageHeader title="Plans" description="Limits apply to every store on the plan straight away. Prices exclude 18% GST; each public plan needs a Razorpay plan in ShopMint's account charging the price including GST." />
            <Card>
              {plans.isError && isMfaRequired(plans.error) ? <div className="p-5"><MfaRequiredCard /></div> : plans.isError ? <div className="p-5"><Alert tone="danger" action={<Button size="sm" variant="secondary" onClick={() => plans.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(plans.error)}</Alert></div>
                : !plans.data ? <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div> : (
                  <Table>
                    <thead><tr><Th>Plan</Th><Th className="text-right">Price</Th><Th className="hidden text-right md:table-cell">Products</Th><Th className="hidden text-right md:table-cell">Team</Th><Th className="hidden text-right md:table-cell">Locations</Th><Th className="hidden lg:table-cell">Razorpay plan</Th><Th className="text-right">Stores</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                    <tbody>
                      {plans.data.map((p) => (
                        <tr key={p.code}>
                          <Td><p className="font-medium">{p.name}</p><p className="text-xs text-fg-muted">{p.code}{p.isPublic ? "" : " · not offered to merchants"}</p></Td>
                          <Td className="tabular text-right">{formatINR(p.monthlyPrice)}<p className="text-xs text-fg-muted">{formatINR(p.monthlyPriceWithGst)} incl. GST</p></Td>
                          <Td className="tabular hidden text-right md:table-cell">{lim(p.maxProducts)}</Td>
                          <Td className="tabular hidden text-right md:table-cell">{lim(p.maxStaff)}</Td>
                          <Td className="tabular hidden text-right md:table-cell">{lim(p.maxLocations)}</Td>
                          <Td className="hidden font-mono text-xs lg:table-cell">{p.razorpayPlanId ?? (p.isPublic ? <span className="font-sans text-warning">Not linked</span> : "—")}</Td>
                          <Td className="tabular text-right">{p.stores}</Td>
                          <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit<span className="sr-only"> {p.name}</span></Button></Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
            </Card>
          </>
        )}
      </main>
      {editing && <EditPlanDialog plan={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditPlanDialog({ plan, onClose }: { plan: PlatformPlan; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const str = (n: number | null) => (n === null ? "" : String(n));
  const form = useForm<PlanInput, unknown, PlanOutput>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      name: plan.name, monthlyPrice: String(Number(plan.monthlyPrice)), maxProducts: str(plan.maxProducts), maxStaff: str(plan.maxStaff),
      maxLocations: str(plan.maxLocations), isPublic: plan.isPublic, razorpayPlanId: plan.razorpayPlanId ?? "",
    },
  });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const saved = await api<PlatformPlan[]>(`/platform/plans/${plan.code}`, { method: "PUT", ifMatch: plan.version, body: { ...v, customDomain: plan.customDomain } });
      qc.setQueryData(key, saved);
      toast.notify(`${v.name} saved`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof PlanInput, { message: m });
      else setError(errorMessage(e));
    }
  });
  const { errors, isSubmitting } = form.formState;
  const trial = plan.code === "trial";
  return (
    <Dialog open onOpenChange={(o) => !o && !isSubmitting && onClose()} title={`Edit ${plan.name}`} className="max-w-lg"
      description={plan.stores > 0 ? `${plan.stores} ${plan.stores === 1 ? "store is" : "stores are"} on this plan. Lower limits block new additions above them; nothing existing is removed.` : undefined}
      footer={<><Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="plan-form" loading={isSubmitting}>Save plan</Button></>}>
      <form id="plan-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Name" error={errors.name?.message}><Input {...form.register("name")} /></Field>
        <Field label="Price per month (₹, excl. GST)" error={errors.monthlyPrice?.message}><Input inputMode="decimal" readOnly={trial} {...form.register("monthlyPrice")} /></Field>
        <Field label="Products" optional hint="Empty = unlimited" error={errors.maxProducts?.message}><Input inputMode="numeric" {...form.register("maxProducts")} /></Field>
        <Field label="Team members" optional hint="Besides the owner" error={errors.maxStaff?.message}><Input inputMode="numeric" {...form.register("maxStaff")} /></Field>
        <Field label="Stock locations" optional error={errors.maxLocations?.message}><Input inputMode="numeric" {...form.register("maxLocations")} /></Field>
        <Field label="Razorpay plan ID" optional error={errors.razorpayPlanId?.message} hint="From ShopMint's Razorpay Dashboard → Subscriptions → Plans.">
          <Input className="font-mono" readOnly={trial} {...form.register("razorpayPlanId")} />
        </Field>
        {!trial && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-[var(--brand)]" {...form.register("isPublic")} />Offer to merchants on the Billing page</label>}
      </form>
    </Dialog>
  );
}
