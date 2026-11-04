"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, TicketPercent } from "lucide-react";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import { couponSchema, type CouponInput } from "@/lib/schemas";
import type { Coupon } from "@/lib/types";
import { formatDate, formatINR } from "@/lib/utils";

const key = ["coupons"] as const;

/** "2026-11-04T18:30:00Z" → "2026-11-05" (the date in India), for date inputs. */
function toLocalDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
/** Coupons start at 00:00 and end at 23:59:59 Indian time on the chosen dates. */
function fromLocalDate(d: string, end: boolean): string | null {
  return d ? `${d}T${end ? "23:59:59" : "00:00:00"}+05:30` : null;
}

export function describeCoupon(c: Pick<Coupon, "kind" | "value" | "maxDiscount" | "minSubtotal">): string {
  const off = c.kind === "percent" ? `${Number(c.value)}% off${c.maxDiscount ? ` (up to ${formatINR(c.maxDiscount)})` : ""}` : `${formatINR(c.value)} off`;
  return Number(c.minSubtotal) > 0 ? `${off} on orders of ${formatINR(c.minSubtotal)}+` : off;
}

function couponState(c: Coupon): { label: string; tone: "success" | "neutral" | "warning" } {
  const now = Date.now();
  if (!c.isActive) return { label: "Off", tone: "neutral" };
  if (c.endsAt && new Date(c.endsAt).getTime() < now) return { label: "Ended", tone: "neutral" };
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return { label: "Scheduled", tone: "warning" };
  if (c.usageLimit !== null && c.timesUsed >= c.usageLimit) return { label: "Used up", tone: "neutral" };
  return { label: "Active", tone: "success" };
}

export default function CouponsPage() {
  const me = useMe();
  const allowed = can(me.data, "orders.read");
  const editable = can(me.data, "settings.write");
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: key, queryFn: () => api<Coupon[]>("/admin/coupons"), enabled: allowed });
  const [editing, setEditing] = React.useState<Coupon | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (c: Coupon) => api(`/admin/coupons/${c.id}`, { method: "DELETE" }),
    onSuccess: () => { toast.notify("Coupon deleted"); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });

  if (me.data && !allowed) return <><PageHeader title="Coupons" /><Alert tone="info">You don&apos;t have access to coupons.</Alert></>;
  return (
    <>
      <PageHeader title="Coupons" description="Discount codes shoppers enter at checkout. Discounts are applied before GST is calculated."
        actions={editable && <Button onClick={() => setEditing("new")}><Plus />New coupon</Button>} />
      <Card>
        {list.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : list.isError ? (
          <div className="p-5"><Alert tone="danger" title="Couldn't load coupons" action={<Button variant="secondary" size="sm" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
        ) : list.data.length === 0 ? (
          <EmptyState icon={TicketPercent} title="No coupons yet" description="Create a code like WELCOME10 to offer a discount at checkout." />
        ) : (
          <Table>
            <thead><tr><Th>Code</Th><Th className="hidden md:table-cell">Validity</Th><Th>Used</Th><Th>Status</Th>{editable && <Th><span className="sr-only">Actions</span></Th>}</tr></thead>
            <tbody>
              {list.data.map((c) => {
                const st = couponState(c);
                return (
                  <tr key={c.id}>
                    <Td><p className="font-mono font-medium">{c.code}</p><p className="text-[13px] text-fg-muted">{describeCoupon(c)}</p></Td>
                    <Td className="hidden text-fg-muted md:table-cell">{c.startsAt || c.endsAt ? `${c.startsAt ? formatDate(c.startsAt) : "Now"} – ${c.endsAt ? formatDate(c.endsAt) : "no end"}` : "Always"}</Td>
                    <Td className="tabular-nums">{c.timesUsed}{c.usageLimit !== null && <span className="text-fg-muted"> / {c.usageLimit}</span>}</Td>
                    <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                    {editable && (
                      <Td className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>Edit<span className="sr-only"> {c.code}</span></Button>
                        {c.timesUsed === 0 && <Button variant="ghost" size="sm" loading={remove.isPending && remove.variables?.id === c.id} onClick={() => remove.mutate(c)}>Delete<span className="sr-only"> {c.code}</span></Button>}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <CouponDialog coupon={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CouponDialog({ coupon, onClose }: { coupon: Coupon | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<CouponInput>({
    resolver: zodResolver(couponSchema),
    defaultValues: {
      code: coupon?.code ?? "", kind: coupon?.kind ?? "percent", value: coupon ? String(Number(coupon.value)) : "",
      minSubtotal: coupon && Number(coupon.minSubtotal) > 0 ? String(Number(coupon.minSubtotal)) : "",
      maxDiscount: coupon?.maxDiscount ? String(Number(coupon.maxDiscount)) : "",
      startsAt: toLocalDate(coupon?.startsAt ?? null), endsAt: toLocalDate(coupon?.endsAt ?? null),
      usageLimit: coupon?.usageLimit ? String(coupon.usageLimit) : "", perCustomerLimit: String(coupon?.perCustomerLimit ?? 1), isActive: coupon?.isActive ?? true,
    },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    const body = {
      code: v.code.trim().toUpperCase(), kind: v.kind, value: Number(v.value), minSubtotal: v.minSubtotal ? Number(v.minSubtotal) : 0,
      maxDiscount: v.kind === "percent" && v.maxDiscount ? Number(v.maxDiscount) : null,
      startsAt: fromLocalDate(v.startsAt, false), endsAt: fromLocalDate(v.endsAt, true),
      usageLimit: v.usageLimit ? Number(v.usageLimit) : null, perCustomerLimit: Number(v.perCustomerLimit), isActive: v.isActive,
    };
    try {
      await api<Coupon>(coupon ? `/admin/coupons/${coupon.id}` : "/admin/coupons", { method: coupon ? "PUT" : "POST", body, ifMatch: coupon?.version });
      toast.notify(coupon ? "Coupon saved" : "Coupon created");
      qc.invalidateQueries({ queryKey: key });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof CouponInput, { message: m });
      else setError(errorMessage(e));
    }
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <Dialog open onOpenChange={(o) => !o && !isSubmitting && onClose()} title={coupon ? `Edit ${coupon.code}` : "New coupon"} className="max-w-lg"
      footer={<><Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="coupon-form" loading={isSubmitting}>Save coupon</Button></>}>
      <form id="coupon-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Code" error={errors.code?.message} hint="Shoppers type this at checkout."><Input className="font-mono uppercase" autoFocus maxLength={30} autoComplete="off" {...form.register("code")} /></Field>
        <Field label="Discount type" error={errors.kind?.message}>
          <Select {...form.register("kind")}><option value="percent">Percentage</option><option value="fixed">Fixed amount (₹)</option></Select>
        </Field>
        <Field label={kind === "percent" ? "Percent off" : "Amount off (₹)"} error={errors.value?.message}><Input inputMode="decimal" {...form.register("value")} /></Field>
        {kind === "percent" ? (
          <Field label="Maximum discount (₹)" optional error={errors.maxDiscount?.message}><Input inputMode="decimal" {...form.register("maxDiscount")} /></Field>
        ) : <div className="hidden sm:block" />}
        <Field label="Minimum order (₹)" optional error={errors.minSubtotal?.message} hint="Item total before discount."><Input inputMode="decimal" {...form.register("minSubtotal")} /></Field>
        <Field label="Uses per customer" error={errors.perCustomerLimit?.message}><Input inputMode="numeric" {...form.register("perCustomerLimit")} /></Field>
        <Field label="Starts" optional error={errors.startsAt?.message}><Input type="date" {...form.register("startsAt")} /></Field>
        <Field label="Ends" optional error={errors.endsAt?.message} hint="Last day it can be used."><Input type="date" {...form.register("endsAt")} /></Field>
        <Field label="Total uses" optional error={errors.usageLimit?.message} hint="Leave empty for no limit."><Input inputMode="numeric" {...form.register("usageLimit")} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand)]" {...form.register("isActive")} />Active</label>
      </form>
    </Dialog>
  );
}
