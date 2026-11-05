"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import type { ReturnInfo, ReturnReason, ReturnStatus, ShopperReturns } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";

export const REASONS: Record<ReturnReason, string> = {
  Damaged: "Arrived damaged", WrongItem: "Wrong item sent", SizeOrFit: "Size or fit", NotAsDescribed: "Not as described", ChangedMind: "Changed my mind", Other: "Other",
};
export const RETURN_LABEL: Record<ReturnStatus, string> = {
  Requested: "Waiting for the store", Approved: "Approved: send it back", Rejected: "Not accepted", Received: "Received by the store", Refunded: "Refunded", Closed: "Completed",
};
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

/** Returns for a delivered order: what's been requested, and a form to request more within the store's window. */
export function OrderReturns({ orderId }: { orderId: string }) {
  const key = ["order-returns", orderId];
  const data = useQuery({ queryKey: key, queryFn: () => api<ShopperReturns>(`/storefront/account/orders/${orderId}/returns`) });
  const [open, setOpen] = React.useState(false);
  if (!data.data) return null;
  const r = data.data;
  if (r.returns.length === 0 && !r.canRequest && r.reason?.includes("once your order has been delivered")) return null;
  return (
    <section className="mt-6 rounded-[var(--radius-card)] border border-border p-5" aria-labelledby="returns-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="returns-h" className="font-semibold">Returns</h2>
        {r.canRequest && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><RotateCcw />Request a return</Button>}
      </div>
      {r.canRequest && r.deadline && <p className="mt-1 text-sm text-fg-muted">You can request a return until {dateFmt.format(new Date(r.deadline))}.</p>}
      {!r.canRequest && r.reason && <p className="mt-1 text-sm text-fg-muted">{r.reason}</p>}
      {r.returns.length > 0 && <ul className="mt-4 divide-y divide-border">{r.returns.map((x) => <ReturnRow key={x.id} r={x} />)}</ul>}
      {open && <RequestDialog orderId={orderId} data={r} onClose={() => setOpen(false)} />}
    </section>
  );
}

function ReturnRow({ r }: { r: ReturnInfo }) {
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", r.status === "Rejected" ? "bg-danger-soft text-danger" : r.status === "Refunded" || r.status === "Closed" ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          {RETURN_LABEL[r.status]}
        </span>
        <span className="text-fg-muted">{r.resolution === "Refund" ? "Refund" : "Exchange"} · {REASONS[r.reason]}</span>
      </div>
      <p className="mt-2">{r.lines.map((l) => `${l.quantity} × ${l.productTitle}${l.variantLabel ? ` (${l.variantLabel})` : ""}`).join(", ")}</p>
      {r.refundedAmount && <p className="mt-1 text-fg-muted">Refunded {formatINR(r.refundedAmount)}</p>}
      {r.storeNote && <p className="mt-2 rounded-md bg-surface-muted p-2.5 text-fg-muted"><span className="font-medium text-fg">From the store: </span>{r.storeNote}</p>}
    </li>
  );
}

function RequestDialog({ orderId, data, onClose }: { orderId: string; data: ShopperReturns; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [reason, setReason] = React.useState<ReturnReason | "">("");
  const [resolution, setResolution] = React.useState<"Refund" | "Exchange">("Refund");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([orderLineId, quantity]) => ({ orderLineId, quantity }));
  const value = data.lines.reduce((n, l) => n + (qty[l.orderLineId] ?? 0) * Number(l.unitRefund), 0);
  const send = useMutation({
    mutationFn: () => api(`/storefront/account/orders/${orderId}/returns`, { method: "POST", body: { reason, resolution, note: note || null, lines } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["order-returns", orderId] }); toast.notify("Return requested. The store will reply by email."); onClose(); },
  });
  const submit = () => {
    if (lines.length === 0) return setError("Choose at least one item to return.");
    if (!reason) return setError("Tell the store why you're returning it.");
    setError(null);
    send.mutate();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Request a return" description="Choose the items and tell the store what happened."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={send.isPending} onClick={submit}>Send request</Button></>}>
      <div className="grid gap-4">
        <fieldset>
          <legend className="text-sm font-medium">Items</legend>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {data.lines.map((l) => (
              <li key={l.orderLineId} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{l.productTitle}</span>
                  <span className="text-fg-muted">{l.variantLabel ? `${l.variantLabel} · ` : ""}{formatINR(l.unitRefund)} each{l.returnable < l.ordered ? ` · ${l.ordered - l.returnable} already returned` : ""}</span>
                </span>
                <label className="flex shrink-0 items-center gap-2">
                  <span className="sr-only">Quantity of {l.productTitle} to return</span>
                  <Select value={String(qty[l.orderLineId] ?? 0)} disabled={l.returnable === 0} className="w-20"
                    onChange={(e) => setQty((q) => ({ ...q, [l.orderLineId]: Number(e.target.value) }))}>
                    {Array.from({ length: l.returnable + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                  </Select>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value as ReturnReason)}>
            <option value="">Choose a reason</option>
            {Object.entries(REASONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">What would you like?</legend>
          <div className="mt-2 flex gap-4 text-sm">
            {(["Refund", "Exchange"] as const).map((v) => (
              <label key={v} className="flex items-center gap-2"><input type="radio" name="resolution" checked={resolution === v} onChange={() => setResolution(v)} className="size-4 accent-[var(--brand)]" />{v === "Refund" ? "A refund" : "An exchange"}</label>
            ))}
          </div>
        </fieldset>
        <Field label="Details" optional hint="Sizes you'd like instead, what was damaged…">
          <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {value > 0 && <p className="text-sm text-fg-muted">Value of these items: <span className="font-medium text-fg">{formatINR(value)}</span>. The store confirms any refund after receiving them.</p>}
        {(error || send.isError) && <p className="text-sm text-danger" role="alert">{error ?? errorMessage(send.error)}</p>}
      </div>
    </Dialog>
  );
}
