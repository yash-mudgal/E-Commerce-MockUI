"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, CardHeader, EmptyState, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { ShippingZone } from "@/lib/types";
import { formatINR } from "@/lib/utils";

const fe = (e: unknown, k: string) => (e instanceof ApiError ? e.fieldErrors[k] : undefined);

/** Delivery zones by PIN-code prefix: fee, free-shipping threshold, delivery days and COD per zone. */
export function DeliveryZonesCard({ editable }: { editable: boolean }) {
  const list = useQuery({ queryKey: ["shipping-zones"], queryFn: () => api<ShippingZone[]>("/admin/shipping-zones"), enabled: editable });
  const [editing, setEditing] = React.useState<ShippingZone | "new" | null>(null);
  if (!editable) return null;
  return (
    <Card className="mt-6">
      <CardHeader title="Delivery zones" description="Different fees, delivery times or cash on delivery by PIN code. The most specific prefix wins (400001 before 400 before 4)."
        action={<Button type="button" size="sm" onClick={() => setEditing("new")}><Plus />Add zone</Button>} />
      {list.isError ? <div className="p-5"><Alert tone="danger" title="Couldn't load zones">{errorMessage(list.error)}</Alert></div>
        : list.isPending ? <div className="p-5"><Skeleton className="h-16" /></div>
        : list.data.length === 0 ? <EmptyState icon={MapPin} title="No delivery zones" description="Every PIN code uses the delivery fee and estimate above." />
        : (
          <ul className="divide-y divide-border">
            {list.data.map((z) => (
              <li key={z.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{z.name} {!z.codAvailable && <Badge className="ml-1">No COD</Badge>}</p>
                  <p className="text-sm text-fg-muted">
                    PIN codes {z.pincodePrefixes.slice(0, 6).join(", ")}{z.pincodePrefixes.length > 6 ? ` +${z.pincodePrefixes.length - 6} more` : ""} ·{" "}
                    {z.fee === null ? "standard fee" : Number(z.fee) === 0 ? "free delivery" : `${formatINR(z.fee)} delivery`} · {z.minDays === z.maxDays ? z.maxDays : `${z.minDays}–${z.maxDays}`} days
                  </p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(z)} aria-label={`Edit ${z.name}`}>Edit</Button>
              </li>
            ))}
          </ul>
        )}
      {editing && <ZoneDialog zone={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ZoneDialog({ zone, onClose }: { zone: ShippingZone | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = React.useState(zone?.name ?? "");
  const [prefixes, setPrefixes] = React.useState(zone?.pincodePrefixes.join(", ") ?? "");
  const [fee, setFee] = React.useState(zone?.fee ?? "");
  const [free, setFree] = React.useState(zone?.freeShippingThreshold ?? "");
  const [minDays, setMinDays] = React.useState(String(zone?.minDays ?? 2));
  const [maxDays, setMaxDays] = React.useState(String(zone?.maxDays ?? 4));
  const [cod, setCod] = React.useState(zone?.codAvailable ?? true);
  const done = (m: string) => { qc.invalidateQueries({ queryKey: ["shipping-zones"] }); toast.notify(m); onClose(); };
  const body = {
    name, pincodePrefixes: prefixes.split(/[\s,]+/).filter(Boolean), fee: fee === "" ? null : Number(fee), freeShippingThreshold: free === "" ? null : Number(free),
    minDays: Number(minDays), maxDays: Number(maxDays), codAvailable: cod,
  };
  const save = useMutation({
    mutationFn: () => api(zone ? `/admin/shipping-zones/${zone.id}` : "/admin/shipping-zones", { method: zone ? "PUT" : "POST", body }),
    onSuccess: () => done(zone ? "Zone saved" : "Zone added"),
  });
  const remove = useMutation({ mutationFn: () => api(`/admin/shipping-zones/${zone!.id}`, { method: "DELETE" }), onSuccess: () => done("Zone deleted") });
  const prefixError = fe(save.error, "pincodePrefixes") ?? Object.entries(save.error instanceof ApiError ? save.error.fieldErrors : {}).find(([k]) => k.startsWith("pincodePrefixes"))?.[1];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={zone ? "Edit delivery zone" : "Add delivery zone"}
      footer={<>
        {zone && <Button variant="danger" className="mr-auto" loading={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>{zone ? "Save" : "Add zone"}</Button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={fe(save.error, "name")} className="sm:col-span-2"><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Mumbai and Pune" /></Field>
        <Field label="PIN codes or prefixes" error={prefixError} className="sm:col-span-2" hint="Separate with commas: 400, 401, 411001.">
          <Input value={prefixes} onChange={(e) => setPrefixes(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Delivery fee (₹)" optional hint="Empty: your standard fee." error={fe(save.error, "fee")}><Input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Free delivery from (₹)" optional hint="Empty: your standard threshold." error={fe(save.error, "freeShippingThreshold")}><Input value={free} onChange={(e) => setFree(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Delivery from (days)" error={fe(save.error, "minDays")}><Input value={minDays} onChange={(e) => setMinDays(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Delivery up to (days)" error={fe(save.error, "maxDays")}><Input value={maxDays} onChange={(e) => setMaxDays(e.target.value)} inputMode="numeric" /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} className="size-4 accent-[var(--brand)]" />Cash on delivery in this zone (if you offer it)</label>
        {save.isError && !(save.error instanceof ApiError && save.error.problem.errors) && <p className="text-sm text-danger sm:col-span-2" role="alert">{errorMessage(save.error)}</p>}
      </div>
    </Dialog>
  );
}
