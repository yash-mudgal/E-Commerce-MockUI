"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, MessageSquareQuote, RefreshCw, Star } from "lucide-react";
import * as React from "react";
import { storefrontUrl } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton, type Tone } from "@/components/ui/display";
import { Field, Textarea } from "@/components/ui/form";
import { Pagination } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import type { AdminReview, AdminReviewPage, ReviewStatus } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const TONE: Record<ReviewStatus, Tone> = { Pending: "warning", Published: "success", Hidden: "neutral" };
const LABEL: Record<ReviewStatus, string> = { Pending: "Waiting for review", Published: "Published", Hidden: "Hidden" };

export default function ReviewsPage() {
  const me = useMe();
  const allowed = !!me.data && can(me.data, "catalog.write");
  const [status, setStatus] = React.useState<ReviewStatus | "">("Pending");
  const [page, setPage] = React.useState(1);
  const [replying, setReplying] = React.useState<AdminReview | null>(null);
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  const list = useQuery({
    queryKey: ["admin-reviews", params.toString()],
    queryFn: () => api<AdminReviewPage>(`/admin/reviews?${params}`),
    enabled: allowed,
    placeholderData: keepPreviousData,
  });
  const counts = list.data?.counts;
  const qc = useQueryClient();
  const toast = useToast();
  const moderate = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReviewStatus }) => api(`/admin/reviews/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["admin-reviews"] }); toast.notify(v.status === "Published" ? "Review published" : "Review hidden"); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });
  const host = me.data?.tenant?.host;

  return (
    <>
      <PageHeader title="Reviews" description="Shoppers can review a product once their order is delivered. Nothing appears on your store until you publish it. Shoppers see their first name and last initial only." />
      {me.isPending ? <Skeleton className="h-64" /> : !allowed ? (
        <Card><EmptyState icon={MessageSquareQuote} title="You don't have access to reviews" description="Ask the store owner for catalogue permissions." /></Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {(["Pending", "Published", "Hidden", ""] as const).map((s) => (
              <Button key={s || "all"} size="sm" variant={status === s ? "primary" : "secondary"} aria-pressed={status === s}
                onClick={() => { setStatus(s); setPage(1); }}>
                {s ? LABEL[s] : "All"}{s && counts ? ` (${counts[s.toLowerCase() as keyof typeof counts]})` : ""}
              </Button>
            ))}
          </div>
          <Card>
            {list.isError ? (
              <div className="p-5"><Alert tone="danger" title="Couldn't load reviews" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
            ) : list.isPending ? (
              <div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
            ) : list.data.items.length === 0 ? (
              <EmptyState icon={MessageSquareQuote} title={status === "Pending" ? "No reviews waiting" : "No reviews here"} description="Reviews appear here when shoppers write them." />
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {list.data.items.map((r) => (
                    <li key={r.id} className="grid gap-2 p-4 sm:p-5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                        <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${r.rating} out of 5 stars`}>
                          {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn("size-4", n <= r.rating ? "fill-warning text-warning" : "text-border-strong")} aria-hidden />)}
                        </span>
                        {host ? (
                          <a href={`${storefrontUrl(host)}/products/${r.productSlug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
                            {r.productTitle}<ExternalLink className="size-3.5 text-fg-subtle" aria-hidden /><span className="sr-only">(opens the storefront)</span>
                          </a>
                        ) : <span className="font-medium">{r.productTitle}</span>}
                        <span className="text-fg-muted">· {r.customerName} ({r.customerEmail}) · {formatDate(r.updatedAt)}</span>
                      </div>
                      {r.title && <p className="font-medium">{r.title}</p>}
                      <p className="text-sm whitespace-pre-wrap">{r.body}</p>
                      {r.reply && <p className="rounded-md bg-surface-muted p-3 text-sm"><span className="font-medium">Your reply: </span>{r.reply}</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {r.status !== "Published" && (
                          <Button size="sm" loading={moderate.isPending && moderate.variables?.id === r.id && moderate.variables.status === "Published"}
                            onClick={() => moderate.mutate({ id: r.id, status: "Published" })}>Publish</Button>
                        )}
                        {r.status !== "Hidden" && (
                          <Button size="sm" variant="secondary" loading={moderate.isPending && moderate.variables?.id === r.id && moderate.variables.status === "Hidden"}
                            onClick={() => moderate.mutate({ id: r.id, status: "Hidden" })}>Hide</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setReplying(r)}>{r.reply ? "Edit reply" : "Reply"}</Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-border p-3"><Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.totalCount} onPage={setPage} /></div>
              </>
            )}
          </Card>
          {replying && <ReplyDialog review={replying} onClose={() => setReplying(null)} />}
        </>
      )}
    </>
  );
}

function ReplyDialog({ review, onClose }: { review: AdminReview; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = React.useState(review.reply ?? "");
  const save = useMutation({
    mutationFn: () => api(`/admin/reviews/${review.id}`, { method: "PATCH", body: { reply } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-reviews"] }); toast.notify(reply.trim() ? "Reply saved" : "Reply removed"); onClose(); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Reply to review" description={`${review.customerName} on ${review.productTitle}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} loading={save.isPending}>Save reply</Button>
      </>}>
      <div className="grid gap-4">
        <p className="rounded-md bg-surface-muted p-3 text-sm whitespace-pre-wrap">{review.body}</p>
        <Field label="Your public reply" hint="Shown under the review on your store once it's published. Leave empty to remove it.">
          <Textarea rows={4} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
