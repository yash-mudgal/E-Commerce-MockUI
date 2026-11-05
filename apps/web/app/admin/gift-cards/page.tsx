"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Gift, Plus, RefreshCw, Search } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton, Stat, type Tone } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import { formatDate, formatINR } from "@/lib/utils";

type GiftCard = { id: string; last4: string; initialValue: string; balance: string; expiresAt: string | null; isActive: boolean; status: "Active" | "Used" | "Expired" | "Disabled";
  recipientName: string | null; recipientEmail: string | null; note: string | null; createdAt: string };
type Page = { items: GiftCard[]; page: number; pageSize: number; totalCount: number; outstanding: string };
type Detail = { card: GiftCard; transactions: { kind: string; amount: string; balanceAfter: string; orderNumber: number | null; at: string }[] };
const TONE: Record<GiftCard["status"], Tone> = { Active: "success", Used: "neutral", Expired: "warning", Disabled: "danger" };
const fe = (e: unknown, k: string) => (e instanceof ApiError ? e.fieldErrors[k] : undefined);

export default function GiftCardsPage() {
  const me = useMe();
  const allowed = !!me.data && can(me.data, "orders.read");
  const issuer = !!me.data && can(me.data, "settings.write");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [issuing, setIssuing] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page) });
  if (q.trim()) params.set("q", q.trim());
  const list = useQuery({ queryKey: ["gift-cards", params.toString()], queryFn: () => api<Page>(`/admin/gift-cards?${params}`), enabled: allowed, placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Gift cards" description="Issue gift cards shoppers can pay with at checkout (with the rest paid online). Codes are shown once; ShopMint keeps only a fingerprint of each code."
        actions={issuer && <Button onClick={() => setIssuing(true)}><Plus />Issue gift card</Button>} />
      {me.isPending ? <Skeleton className="h-64" /> : !allowed ? <Card><EmptyState icon={Gift} title="You don't have access to gift cards" /></Card> : (
        <>
          {list.data && <Card className="mb-6 sm:w-72"><dl><Stat label="Outstanding balance" value={formatINR(list.data.outstanding)} hint="Active, unexpired cards" /></dl></Card>}
          <Card>
            <div className="border-b border-border p-3">
              <div className="relative sm:w-80">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
                <Input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Last 4 characters, name or email" className="pl-9" aria-label="Search gift cards" />
              </div>
            </div>
            {list.isError ? <div className="p-5"><Alert tone="danger" title="Couldn't load gift cards" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
              : list.isPending ? <div className="p-5"><Skeleton className="h-32" /></div>
              : list.data.items.length === 0 ? <EmptyState icon={Gift} title="No gift cards yet" description="Issue one for a customer, a giveaway or a sale in your shop." />
              : (
                <>
                  <Table>
                    <thead><tr><Th>Card</Th><Th>Recipient</Th><Th className="text-right">Value</Th><Th className="text-right">Balance</Th><Th>Expires</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                    <tbody>
                      {list.data.items.map((c) => (
                        <tr key={c.id} className="border-t border-border">
                          <Td className="font-mono">•••• {c.last4}</Td>
                          <Td>{c.recipientName ?? c.recipientEmail ?? <span className="text-fg-subtle">—</span>}</Td>
                          <Td className="tabular text-right">{formatINR(c.initialValue)}</Td>
                          <Td className="tabular text-right font-medium">{formatINR(c.balance)}</Td>
                          <Td>{c.expiresAt ? formatDate(c.expiresAt) : "Never"}</Td>
                          <Td><Badge tone={TONE[c.status]}>{c.status}</Badge></Td>
                          <Td className="text-right"><Button size="sm" variant="secondary" onClick={() => setOpen(c.id)} aria-label={`Details for card ending ${c.last4}`}>Details</Button></Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <div className="border-t border-border p-3"><Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.totalCount} onPage={setPage} /></div>
                </>
              )}
          </Card>
        </>
      )}
      {issuing && <IssueDialog onClose={() => setIssuing(false)} />}
      {open && <DetailDialog id={open} canDisable={issuer} onClose={() => setOpen(null)} />}
    </>
  );
}

function IssueDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = React.useState("");
  const [expires, setExpires] = React.useState("");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [note, setNote] = React.useState("");
  const [send, setSend] = React.useState(true);
  const issue = useMutation({
    mutationFn: () => api<{ code: string; card: GiftCard }>("/admin/gift-cards", {
      method: "POST",
      body: { value: Number(value), expiresAt: expires ? new Date(`${expires}T23:59:59+05:30`).toISOString() : null, recipientName: name || null, recipientEmail: email || null, note: note || null, sendEmail: send && !!email },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gift-cards"] }),
  });
  if (issue.data)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Gift card issued" footer={<Button onClick={onClose}>Done</Button>}>
        <p className="text-sm text-fg-muted">Copy the code now. It won&apos;t be shown again{issue.data.card.recipientEmail && send ? `; we've also emailed it to ${issue.data.card.recipientEmail}` : ""}.</p>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted p-4">
          <code className="font-mono text-lg tracking-wider" data-testid="gift-card-code">{issue.data.code}</code>
          <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(issue.data.code); toast.notify("Code copied"); }}><Copy />Copy</Button>
        </div>
        <p className="mt-3 text-sm">Worth {formatINR(issue.data.card.initialValue)}{issue.data.card.expiresAt ? `, valid until ${formatDate(issue.data.card.expiresAt)}` : ""}.</p>
      </Dialog>
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Issue a gift card"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={issue.isPending} onClick={() => issue.mutate()}>Issue gift card</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Value (₹)" error={fe(issue.error, "value")}><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Valid until" optional error={fe(issue.error, "expiresAt")} hint="Leave empty for no expiry."><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        <Field label="Recipient name" optional error={fe(issue.error, "recipientName")}><Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Recipient email" optional error={fe(issue.error, "recipientEmail")}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Message" optional className="sm:col-span-2" hint="Included in the email." error={fe(issue.error, "note")}><Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} disabled={!email} className="size-4 accent-[var(--brand)]" />Email the code to the recipient</label>
        {issue.isError && !(issue.error instanceof ApiError && issue.error.problem.errors) && <p className="text-sm text-danger sm:col-span-2" role="alert">{errorMessage(issue.error)}</p>}
      </div>
    </Dialog>
  );
}

function DetailDialog({ id, canDisable, onClose }: { id: string; canDisable: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const detail = useQuery({ queryKey: ["gift-card", id], queryFn: () => api<Detail>(`/admin/gift-cards/${id}`) });
  const disable = useMutation({
    mutationFn: () => api(`/admin/gift-cards/${id}/disable`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gift-cards"] }); qc.invalidateQueries({ queryKey: ["gift-card", id] }); toast.notify("Gift card disabled"); },
  });
  const c = detail.data?.card;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={c ? `Gift card •••• ${c.last4}` : "Gift card"}
      footer={<>{canDisable && c?.isActive && <Button variant="danger" className="mr-auto" loading={disable.isPending} onClick={() => disable.mutate()}>Disable card</Button>}<Button variant="secondary" onClick={onClose}>Close</Button></>}>
      {!detail.data ? <Skeleton className="h-32" /> : (
        <div className="grid gap-4">
          <p className="text-sm">Balance <strong>{formatINR(detail.data.card.balance)}</strong> of {formatINR(detail.data.card.initialValue)} · <Badge tone={TONE[detail.data.card.status]}>{detail.data.card.status}</Badge></p>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {detail.data.transactions.map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{t.kind}{t.orderNumber ? ` · order #${t.orderNumber}` : ""}<span className="block text-xs text-fg-muted">{formatDate(t.at)}</span></span>
                <span className="tabular text-right">{Number(t.amount) === 0 ? "" : `${Number(t.amount) > 0 ? "+" : "−"}${formatINR(Math.abs(Number(t.amount)))}`}<span className="block text-xs text-fg-muted">bal. {formatINR(t.balanceAfter)}</span></span>
              </li>
            ))}
          </ul>
          {disable.isError && <p className="text-sm text-danger" role="alert">{errorMessage(disable.error)}</p>}
        </div>
      )}
    </Dialog>
  );
}
