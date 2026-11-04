"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, RefreshCw } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import { locationSchema, type LocationInput } from "@/lib/inventory";
import type { LocationsOverview, StockLocation } from "@/lib/types";

const key = ["locations"] as const;

export default function LocationsPage() {
  const me = useMe();
  const editable = can(me.data, "settings.write");
  const q = useQuery({ queryKey: key, queryFn: () => api<LocationsOverview>("/admin/locations") });
  const [editing, setEditing] = React.useState<StockLocation | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<StockLocation | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/locations/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.notify("Location deleted"); setDeleting(null); qc.invalidateQueries({ queryKey: key }); },
  });

  const full = !!q.data && q.data.maxLocations !== null && q.data.locations.length >= q.data.maxLocations;
  return (
    <>
      <PageHeader
        title="Locations"
        description="Warehouses, shops or godowns where you keep stock. New products start at the default location."
        actions={editable && <Button onClick={() => setEditing("new")} disabled={!q.data || full}><Plus />Add location</Button>}
      />
      {!editable && <Alert tone="info" className="mb-6">Only the store owner can add or change locations.</Alert>}
      {q.data && full && editable && (
        <Alert tone="info" className="mb-6">
          Your plan includes {q.data.maxLocations} {q.data.maxLocations === 1 ? "location" : "locations"}. Upgrade to the Pro plan to add more. Billing arrives in a later release; contact support to change plans.
        </Alert>
      )}
      <Card>
        {q.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : q.isError ? (
          <div className="p-5"><Alert tone="danger" title="Couldn't load locations" action={<Button variant="secondary" size="sm" onClick={() => q.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(q.error)}</Alert></div>
        ) : (
          <Table>
            <thead>
              <tr><Th>Location</Th><Th className="hidden sm:table-cell">GST state</Th><Th className="text-right">Units on hand</Th><Th className="w-0"><span className="sr-only">Actions</span></Th></tr>
            </thead>
            <tbody>
              {q.data.locations.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <p className="flex items-center gap-2 font-medium"><MapPin className="size-4 text-fg-subtle" aria-hidden />{l.name}{l.isDefault && <Badge tone="info">Default</Badge>}</p>
                    <p className="font-mono text-xs text-fg-muted">{l.code}</p>
                  </Td>
                  <Td className="hidden text-fg-muted sm:table-cell">{l.stateCode ?? "—"}</Td>
                  <Td className="tabular text-right">{l.unitsOnHand}<p className="text-xs text-fg-muted">{l.variantsStocked} {l.variantsStocked === 1 ? "variant" : "variants"}</p></Td>
                  <Td>
                    {editable && (
                      <div className="flex flex-col items-end gap-1 whitespace-nowrap sm:flex-row sm:justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>Edit<span className="sr-only"> {l.name}</span></Button>
                        {!l.isDefault && <Button variant="ghost" size="sm" onClick={() => { remove.reset(); setDeleting(l); }}>Delete<span className="sr-only"> {l.name}</span></Button>}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && <LocationDialog location={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>Delete</Button></>}
      >
        {remove.isError ? <Alert tone="danger">{errorMessage(remove.error)}</Alert> : <p className="text-sm text-fg-muted">The location must be empty. Its stock history stays in the ledger.</p>}
      </Dialog>
    </>
  );
}

function LocationDialog({ location, onClose }: { location: StockLocation | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<LocationInput>({
    resolver: zodResolver(locationSchema),
    defaultValues: { name: location?.name ?? "", code: location?.code ?? "", stateCode: location?.stateCode ?? "", isDefault: location?.isDefault ?? false },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const body = { ...v, code: v.code.toUpperCase(), stateCode: v.stateCode || null };
    try {
      await api(location ? `/admin/locations/${location.id}` : "/admin/locations", { method: location ? "PUT" : "POST", body });
      toast.notify(location ? "Location saved" : "Location added");
      qc.invalidateQueries({ queryKey: key });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof LocationInput, { message: m });
      else setError(errorMessage(e));
    }
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={location ? `Edit ${location.name}` : "Add a location"}
      footer={<><Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="location-form" loading={isSubmitting}>{location ? "Save" : "Add location"}</Button></>}>
      <form id="location-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name" error={errors.name?.message}><Input autoFocus placeholder="e.g. Pune warehouse" {...form.register("name")} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Short code" hint="Shown in stock lists" error={errors.code?.message}><Input className="font-mono uppercase" maxLength={16} {...form.register("code")} /></Field>
          <Field label="GST state code" optional hint="For tax on shipments" error={errors.stateCode?.message}><Input inputMode="numeric" maxLength={2} {...form.register("stateCode")} /></Field>
        </div>
        {!location?.isDefault && (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" {...form.register("isDefault")} />
            Make this the default location
          </label>
        )}
      </form>
    </Dialog>
  );
}
