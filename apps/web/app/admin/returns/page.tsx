"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { REASONS, RETURN_LABEL } from "@/components/store/order-returns";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton, type Tone } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Pagination } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import type { ReturnInfo, ReturnStatus } from "@/lib/types";
import { formatDate, formatINR } from "@/lib/utils";

const TONE: Record<ReturnStatus, Tone> = { Requested: "warning", Approved: "info", Rejected: "neutral", Received: "brand", Refunded: "success", Closed: "success" };
const ADMIN_LABEL: Record<ReturnStatus, string> = { ...RETURN_LABEL, Requested: "New request", Approved: "Approved, awaiting parcel", Received: "Received" };
type Page = { items: ReturnInfo[]; page: number; pageSize: number; totalCount: number; open: number };
type Action = { kind: "approve" | "reject" | "close" | "receive" | "refund"; r: ReturnInfo };

export default function ReturnsPage() {
  const me = useMe();
  const allowed = !!me.data && can(me.data, "orders.read");
  const [status, setStatus] = React.useState<ReturnStatus | "">("Requested");
  const [page, setPage] = React.useState(1);
  const [action, setAction] = React.useState<Action | null>(null);
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  const list = useQuery({ queryKey: ["admin-returns", params.toString()], queryFn: () => api<Page>(`/admin/returns?${params}`), enabled: allowed, placeholderData: keepPreviousData });
  const fulfil = !!me.data && can(me.data, "orders.fulfil");
  const refund = !!me.data && can(me.data, "orders.refund");
  return (
    <>
      <PageHeader title="Returns" description="Shoppers request returns from their order page within your return window (Store settings → Returns). Approve, receive the parcel, then refund or complete an exchange." />
      {me.isPending ? <Skeleton className="h-64" /> : !allowed ? <Card><EmptyState icon={RotateCcw} title="You don't have access to returns" /></Card> : (
        <>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {(["Requested", "Approved", "Received", "Refunded", "Rejected", "Closed", ""] as const).map((s) => (
              <Button key={s || "all"} size="sm" variant={status === s ? "primary" : "secondary"} aria-pressed={status === s} onClick={() => { setStatus(s); setPage(1); }}>
                {s ? ADMIN_LABEL[s] : "All"}
              </Button>
            ))}
          </div>
          <Card>
            {list.isError ? <div className="p-5"><Alert tone="danger" title="Couldn't load returns" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
              : list.isPending ? <div className="space-y-3 p-5"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
              : list.data.items.length === 0 ? <EmptyState icon={RotateCcw} title={status === "Requested" ? "No new return requests" : "No returns here"} description="Returns appear here when shoppers request them." />
              : (
                <>
                  <ul className="divide-y divide-border">
                    {list.data.items.map((r) => (
                      <li key={r.id} className="grid gap-2 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone={TONE[r.status]}>{ADMIN_LABEL[r.status]}</Badge>
                          <Link href={`/admin/orders/${r.orderId}`} className="font-medium hover:underline">Order #{r.orderNumber}</Link>
                          <span className="text-fg-muted">· {r.customerName} ({r.customerEmail}) · {formatDate(r.createdAt)}</span>
                        </div>
                        <p className="text-sm"><span className="font-medium">{r.resolution === "Refund" ? "Wants a refund" : "Wants an exchange"}</span> · {REASONS[r.reason]} · value {formatINR(r.value)}</p>
                        <p className="text-sm text-fg-muted">{r.lines.map((l) => `${l.quantity} × ${l.productTitle}${l.variantLabel ? ` (${l.variantLabel})` : ""}`).join(", ")}</p>
                        {r.note && <p className="rounded-md bg-surface-muted p-2.5 text-sm">“{r.note}”</p>}
                        {r.storeNote && <p className="text-sm text-fg-muted">Your note: {r.storeNote}</p>}
                        {(r.restocked || r.refundedAmount) && <p className="text-sm text-fg-muted">{r.restocked ? "Restocked. " : ""}{r.refundedAmount ? `Refunded ${formatINR(r.refundedAmount)}.` : ""}</p>}
                        <div className="flex flex-wrap gap-2 pt-1">
                          {fulfil && r.status === "Requested" && <><Button size="sm" onClick={() => setAction({ kind: "approve", r })}>Approve</Button><Button size="sm" variant="secondary" onClick={() => setAction({ kind: "reject", r })}>Decline</Button></>}
                          {fulfil && r.status === "Approved" && <Button size="sm" onClick={() => setAction({ kind: "receive", r })}>Mark received</Button>}
                          {refund && r.status === "Received" && r.resolution === "Refund" && <Button size="sm" onClick={() => setAction({ kind: "refund", r })}>Refund</Button>}
                          {fulfil && (r.status === "Approved" || r.status === "Received") && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "close", r })}>{r.resolution === "Exchange" ? "Exchange sent, complete" : "Complete without refund"}</Button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-border p-3"><Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.totalCount} onPage={setPage} /></div>
                </>
              )}
          </Card>
          {action && <ActionDialog action={action} onClose={() => setAction(null)} />}
        </>
      )}
    </>
  );
}

const TITLES = { approve: "Approve return", reject: "Decline return", close: "Complete return", receive: "Mark parcel received", refund: "Refund return" } as const;

function ActionDialog({ action, onClose }: { action: Action; onClose: () => void }) {
  const { kind, r } = action;
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = React.useState("");
  const [restock, setRestock] = React.useState(true);
  const [amount, setAmount] = React.useState(String(Number(r.value)));
  const run = useMutation({
    mutationFn: () => api(`/admin/returns/${r.id}/${kind}`, {
      method: "POST",
      body: kind === "receive" ? { restock } : kind === "refund" ? { amount: Number(amount) } : { note: note || null },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-returns"] }); toast.notify(`${TITLES[kind]}: done. The shopper is emailed.`); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={TITLES[kind]} description={`Order #${r.orderNumber} · ${r.customerName}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={kind === "reject" ? "danger" : "primary"} loading={run.isPending} onClick={() => run.mutate()}>{TITLES[kind]}</Button></>}>
      <div className="grid gap-4">
        {(kind === "approve" || kind === "reject" || kind === "close") && (
          <Field label={kind === "approve" ? "Instructions for the shopper" : kind === "reject" ? "Reason (sent to the shopper)" : "Note for the shopper"} optional={kind !== "reject"}
            hint={kind === "approve" ? "How to pack and send it back, pickup details…" : undefined}>
            <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        {kind === "receive" && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand)]" />
            <span><span className="font-medium">Put the items back in stock</span><span className="block text-fg-muted">At the location each item was sold from. Untick for damaged items.</span></span>
          </label>
        )}
        {kind === "refund" && (
          <Field label="Refund amount (₹)" hint={`Up to ${formatINR(r.value)}, the returned items' value. Online payments are refunded through Razorpay; cash on delivery refunds are recorded for you to pay.`}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        )}
        {run.isError && <p className="text-sm text-danger" role="alert">{errorMessage(run.error)}</p>}
      </div>
    </Dialog>
  );
}
