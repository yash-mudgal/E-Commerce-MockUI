"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Mail, RefreshCw, Search, ShieldAlert } from "lucide-react";
import * as React from "react";
import { PlatformHeader } from "@/components/platform/header";
import { isMfaRequired, MfaRequiredCard } from "@/components/platform-mfa";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton, type Tone } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Pagination } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { FeedbackItem, FeedbackPage, FeedbackStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const STATUSES: FeedbackStatus[] = ["New", "Triaged", "Planned", "Done", "Declined"];
const STATUS_TONE: Record<FeedbackStatus, Tone> = { New: "info", Triaged: "neutral", Planned: "brand", Done: "success", Declined: "neutral" };
const CATEGORY_LABEL = { Problem: "Problem", Idea: "Idea", Question: "Question", Other: "Other" } as const;

export default function PlatformFeedbackPage() {
  const me = useMe();
  const isAdmin = me.data?.user.isPlatformAdmin;
  const [status, setStatus] = React.useState<FeedbackStatus | "">("New");
  const [category, setCategory] = React.useState("");
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [editing, setEditing] = React.useState<FeedbackItem | null>(null);
  React.useEffect(() => { const t = setTimeout(() => { setDebounced(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (status) params.set("status", status);
  if (category) params.set("category", category);
  if (debounced) params.set("q", debounced);
  const list = useQuery({
    queryKey: ["platform-feedback", params.toString()],
    queryFn: () => api<FeedbackPage>(`/platform/feedback?${params}`),
    enabled: !!isAdmin,
    placeholderData: keepPreviousData,
  });
  const counts = list.data?.counts;

  return (
    <div className="min-h-dvh">
      <PlatformHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {me.isPending ? <Skeleton className="h-64" /> : !isAdmin ? (
          <Card><EmptyState icon={ShieldAlert} title="Platform access required" description="This console is only available to ShopMint operators." /></Card>
        ) : (
          <>
            <PageHeader title="Feedback" description="Problems, ideas and questions merchants send from their admin. Triage new items weekly (docs/OPERATING_REVIEW.md). A sender's email is shown only if they agreed to be contacted." />
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              {(["", ...STATUSES] as const).map((s) => (
                <Button key={s || "all"} size="sm" variant={status === s ? "primary" : "secondary"} aria-pressed={status === s}
                  onClick={() => { setStatus(s); setPage(1); }}>
                  {s || "All"}{s && counts ? ` (${counts[s.toLowerCase() as keyof typeof counts]})` : ""}
                </Button>
              ))}
            </div>
            <Card>
              <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row">
                <div className="relative sm:w-80">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
                  <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" className="pl-9" aria-label="Search feedback" />
                </div>
                <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Category" className="sm:w-44">
                  <option value="">All categories</option>
                  {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
              {list.isError && isMfaRequired(list.error) ? <div className="p-5"><MfaRequiredCard /></div> : list.isError ? (
                <div className="p-5"><Alert tone="danger" title="Couldn't load feedback" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
              ) : list.isPending ? (
                <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
              ) : list.data.items.length === 0 ? (
                <EmptyState icon={Inbox} title={status === "New" ? "No new feedback" : "Nothing here"} description="Feedback appears here as merchants send it." />
              ) : (
                <>
                  <ul className="divide-y divide-border">
                    {list.data.items.map((item) => (
                      <li key={item.id} className="grid gap-2 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                          <Badge>{CATEGORY_LABEL[item.category]}</Badge>
                          <span className="font-medium">{item.storeName}</span>
                          <span className="text-fg-muted">· {formatDate(item.createdAt)}{item.page ? ` · ${item.page}` : ""}</span>
                          <span className="flex-1" />
                          <Button size="sm" variant="secondary" onClick={() => setEditing(item)} aria-label={`Update feedback from ${item.storeName}`}>Update</Button>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{item.message}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-muted">
                          {item.contactEmail
                            ? <a className="inline-flex items-center gap-1 text-brand underline-offset-2 hover:underline" href={`mailto:${item.contactEmail}`}><Mail className="size-3.5" aria-hidden />{item.contactEmail}</a>
                            : <span>Didn&apos;t ask to be contacted</span>}
                          {item.teamNote && <span>Team note: {item.teamNote}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-border p-3"><Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.totalCount} onPage={setPage} /></div>
                </>
              )}
            </Card>
            {editing && <UpdateDialog item={editing} onClose={() => setEditing(null)} />}
          </>
        )}
      </main>
    </div>
  );
}

function UpdateDialog({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = React.useState<FeedbackStatus>(item.status === "New" ? "Triaged" : item.status);
  const [note, setNote] = React.useState(item.teamNote ?? "");
  const save = useMutation({
    mutationFn: () => api<void>(`/platform/feedback/${item.id}`, { method: "PATCH", body: { status, teamNote: note } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform-feedback"] }); toast.notify("Feedback updated"); onClose(); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Update feedback" description={`From ${item.storeName}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
      </>}>
      <div className="grid gap-4">
        <p className="rounded-md bg-surface-muted p-3 text-sm whitespace-pre-wrap">{item.message}</p>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Team note" optional hint="Internal; merchants don't see it.">
          <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
