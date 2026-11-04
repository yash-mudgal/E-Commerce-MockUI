"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Boxes, History, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import { ADJUSTMENT_REASONS, adjustmentDelta, adjustmentSchema, movementLabel, type AdjustmentInput } from "@/lib/inventory";
import type { InventoryItem, LocationsOverview, Paged, StockLocation, StockMovement } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const inventoryKey = ["inventory"] as const;

export default function InventoryPage() {
  const me = useMe();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [search, setSearch] = React.useState(q);
  const [locationId, setLocationId] = React.useState("");
  const [stock, setStock] = React.useState(params.get("stock") ?? "all");
  const [page, setPage] = React.useState(1);
  const [action, setAction] = React.useState<{ kind: "adjust" | "move" | "history"; item: InventoryItem } | null>(null);
  const writable = can(me.data, "inventory.write");

  React.useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const locations = useQuery({ queryKey: ["locations"], queryFn: () => api<LocationsOverview>("/admin/locations") });
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), stock });
  if (search) query.set("q", search);
  if (locationId) query.set("locationId", locationId);
  const items = useQuery({
    queryKey: [...inventoryKey, query.toString()],
    queryFn: () => api<Paged<InventoryItem>>(`/admin/inventory?${query}`),
    placeholderData: keepPreviousData,
  });
  const locs = locations.data?.locations ?? [];
  const code = (id: string) => locs.find((l) => l.id === id)?.code ?? "?";

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock for every variant. Every change is recorded with a reason, so you can always see why a count changed."
        actions={can(me.data, "settings.write") && <Button asChild variant="secondary"><Link href="/admin/locations">Locations</Link></Button>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by product or SKU" aria-label="Search inventory" className="pl-9" />
        </div>
        {locs.length > 1 && (
          <Select value={locationId} onChange={(e) => { setLocationId(e.target.value); setPage(1); }} aria-label="Location" className="sm:w-48">
            <option value="">All locations</option>
            {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}
        <Select value={stock} onChange={(e) => { setStock(e.target.value); setPage(1); }} aria-label="Stock level" className="sm:w-40">
          <option value="all">All stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </Select>
      </div>

      <Card>
        {items.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : items.isError ? (
          <div className="p-5">
            <Alert tone="danger" title="Couldn't load inventory" action={<Button variant="secondary" size="sm" onClick={() => items.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(items.error)}</Alert>
          </div>
        ) : items.data.items.length === 0 ? (
          <EmptyState icon={Boxes} title={search || stock !== "all" ? "Nothing matches" : "No products yet"}
            description={search || stock !== "all" ? "Try a different search or filter." : "Add products and their stock will show up here."} />
        ) : (
          <>
            <Table aria-busy={items.isFetching}>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th className="text-right">On hand</Th>
                  <Th className="hidden text-right sm:table-cell">Reserved</Th>
                  <Th className="text-right">Available</Th>
                  <Th className="w-0"><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {items.data.items.map((i) => (
                  <tr key={i.variantId} className="align-top">
                    <Td>
                      <Link href={`/admin/products/${i.productId}`} className="font-medium text-fg hover:text-brand">{i.productTitle}</Link>
                      {i.optionValues.length > 0 && <span className="ml-1.5 text-fg-muted">{i.optionValues.join(" / ")}</span>}
                      <p className="font-mono text-xs text-fg-muted">{i.sku}{!i.isActive && " · not for sale"}</p>
                      {!locationId && locs.length > 1 && i.levels.length > 0 && (
                        <p className="mt-0.5 text-xs text-fg-muted">{i.levels.map((l) => `${code(l.locationId)} ${l.onHand}`).join(" · ")}</p>
                      )}
                    </Td>
                    <Td className="tabular text-right">{i.onHand}</Td>
                    <Td className="tabular hidden text-right text-fg-muted sm:table-cell">{i.reserved}</Td>
                    <Td className="text-right">
                      {i.available <= 0 ? <Badge tone="danger">Out</Badge> : i.lowStock ? <Badge tone="warning">{i.available} low</Badge> : <span className="tabular">{i.available}</span>}
                    </Td>
                    <Td>
                      <div className="flex flex-col items-end gap-1 whitespace-nowrap sm:flex-row sm:justify-end">
                        {writable && <Button variant="ghost" size="sm" onClick={() => setAction({ kind: "adjust", item: i })}><SlidersHorizontal /><span className="hidden md:inline">Adjust</span><span className="sr-only md:hidden">Adjust {i.sku}</span></Button>}
                        {writable && locs.length > 1 && <Button variant="ghost" size="sm" onClick={() => setAction({ kind: "move", item: i })}><ArrowLeftRight /><span className="hidden md:inline">Move</span><span className="sr-only md:hidden">Move {i.sku}</span></Button>}
                        <Button variant="ghost" size="sm" onClick={() => setAction({ kind: "history", item: i })}><History /><span className="hidden md:inline">History</span><span className="sr-only md:hidden">History of {i.sku}</span></Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={items.data.totalCount} onPage={setPage} />
          </>
        )}
      </Card>

      {action?.kind === "adjust" && <AdjustDialog item={action.item} locations={locs} preferredLocation={locationId} onClose={() => setAction(null)} />}
      {action?.kind === "move" && <MoveDialog item={action.item} locations={locs} onClose={() => setAction(null)} />}
      {action?.kind === "history" && <HistoryDialog item={action.item} onClose={() => setAction(null)} />}
    </>
  );
}

function itemName(i: InventoryItem) {
  return `${i.productTitle}${i.optionValues.length ? ` (${i.optionValues.join(" / ")})` : ""}`;
}

function AdjustDialog({ item, locations, preferredLocation, onClose }: { item: InventoryItem; locations: StockLocation[]; preferredLocation: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const defaultLocation = preferredLocation || locations.find((l) => l.isDefault)?.id || "";
  const form = useForm<AdjustmentInput>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { locationId: defaultLocation, reason: "receipt", mode: "change", quantity: "", note: "" },
  });
  const [error, setError] = React.useState<string | null>(null);
  const [locationId, reason, mode, quantity] = useWatch({ control: form.control, name: ["locationId", "reason", "mode", "quantity"] });
  const current = item.levels.find((l) => l.locationId === locationId);
  const onHand = current?.onHand ?? 0;
  const n = Number(quantity);
  const delta = quantity && Number.isInteger(n) ? adjustmentDelta(mode, reason, n, onHand) : null;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const line = v.mode === "count" ? { variantId: item.variantId, countedOnHand: Number(v.quantity) } : { variantId: item.variantId, delta: adjustmentDelta("change", v.reason, Number(v.quantity), onHand) };
    try {
      await api("/admin/inventory/adjustments", { method: "POST", body: { locationId: v.locationId, reason: v.reason, note: v.note || null, lines: [line] } });
      toast.notify(`Stock updated for ${item.sku}`);
      qc.invalidateQueries({ queryKey: inventoryKey });
      qc.invalidateQueries({ queryKey: ["locations"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.problem.errors ? Object.values(e.problem.errors)[0][0] : errorMessage(e));
    }
  });

  const { errors, isSubmitting } = form.formState;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Adjust stock" description={itemName(item)}
      footer={<><Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="adjust-form" loading={isSubmitting}>Save adjustment</Button></>}>
      <form id="adjust-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {locations.length > 1 && (
          <Field label="Location" error={errors.locationId?.message}>
            <Select {...form.register("locationId")}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          </Field>
        )}
        <Field label="Reason" error={errors.reason?.message}>
          <Select {...form.register("reason")}>{ADJUSTMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">How do you want to enter it?</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2"><input type="radio" value="change" className="accent-[var(--brand)]" {...form.register("mode")} />Units added or removed</label>
            <label className="inline-flex items-center gap-2"><input type="radio" value="count" className="accent-[var(--brand)]" {...form.register("mode")} />Counted total</label>
          </div>
        </fieldset>
        <Field
          label={mode === "count" ? "Counted on hand" : reason === "correction" ? "Change (use − to remove)" : "Units"}
          error={errors.quantity?.message}
          hint={`Now ${onHand} on hand${current?.reserved ? `, ${current.reserved} reserved` : ""}.${delta !== null ? ` After saving: ${onHand + delta}.` : ""}`}
        >
          <Input inputMode="numeric" autoFocus className="tabular" {...form.register("quantity")} />
        </Field>
        <Field label="Note" optional hint="Supplier invoice, what happened, who counted…" error={errors.note?.message}>
          <Textarea rows={2} maxLength={500} {...form.register("note")} />
        </Field>
      </form>
    </Dialog>
  );
}

function MoveDialog({ item, locations, onClose }: { item: InventoryItem; locations: StockLocation[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const stocked = item.levels.filter((l) => l.onHand - l.reserved > 0).map((l) => l.locationId);
  const [from, setFrom] = React.useState(stocked[0] ?? locations[0].id);
  const [to, setTo] = React.useState(locations.find((l) => l.id !== (stocked[0] ?? locations[0].id))?.id ?? "");
  const [qty, setQty] = React.useState("");
  const [note, setNote] = React.useState("");
  const free = (() => { const l = item.levels.find((x) => x.locationId === from); return l ? l.onHand - l.reserved : 0; })();
  const move = useMutation({
    mutationFn: () => api("/admin/inventory/transfers", { method: "POST", body: { fromLocationId: from, toLocationId: to, note: note || null, lines: [{ variantId: item.variantId, quantity: Number(qty) }] } }),
    onSuccess: () => { toast.notify(`Moved ${qty} × ${item.sku}`); qc.invalidateQueries({ queryKey: inventoryKey }); qc.invalidateQueries({ queryKey: ["locations"] }); onClose(); },
  });
  const qtyError = qty && (!/^\d+$/.test(qty) || Number(qty) < 1) ? "Enter a whole number of units" : qty && Number(qty) > free ? `Only ${free} free to move from here` : null;
  const valid = !!qty && !qtyError && from !== to && !!to;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Move stock" description={itemName(item)}
      footer={<><Button variant="secondary" onClick={onClose} disabled={move.isPending}>Cancel</Button><Button onClick={() => move.mutate()} disabled={!valid} loading={move.isPending}>Move stock</Button></>}>
      <div className="flex flex-col gap-4">
        {move.isError && <Alert tone="danger">{move.error instanceof ApiError && move.error.problem.errors ? Object.values(move.error.problem.errors)[0][0] : errorMessage(move.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" hint={`${free} free to move`}>
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          </Field>
          <Field label="To" error={from === to ? "Choose a different location" : undefined}>
            <Select value={to} onChange={(e) => setTo(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          </Field>
        </div>
        <Field label="Units" error={qtyError ?? undefined}><Input inputMode="numeric" className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Note" optional><Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const [page, setPage] = React.useState(1);
  const log = useQuery({
    queryKey: ["movements", item.variantId, page],
    queryFn: () => api<Paged<StockMovement>>(`/admin/inventory/movements?variantId=${item.variantId}&page=${page}&pageSize=10`),
    placeholderData: keepPreviousData,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Stock history" description={`${itemName(item)} · ${item.sku}`} className="max-w-2xl">
      {log.isPending ? <Skeleton className="h-40" /> : log.isError ? <Alert tone="danger">{errorMessage(log.error)}</Alert> : log.data.items.length === 0 ? (
        <p className="text-sm text-fg-muted">No stock changes recorded yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {log.data.items.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{movementLabel(m.reason)}{m.locationName && <span className="font-normal text-fg-muted"> · {m.locationName}</span>}</p>
                  {m.note && <p className="text-[13px] break-words text-fg-muted">“{m.note}”</p>}
                  <p className="text-xs text-fg-muted">{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(m.at))}{m.actorName && ` · ${m.actorName}`}</p>
                </div>
                <span className={cn("tabular shrink-0 font-semibold", m.delta > 0 ? "text-success" : "text-danger")}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
              </li>
            ))}
          </ul>
          {log.data.totalCount > 10 && <Pagination page={page} pageSize={10} total={log.data.totalCount} onPage={setPage} />}
        </>
      )}
    </Dialog>
  );
}
