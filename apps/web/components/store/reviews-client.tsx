"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { useShopper } from "@/lib/shop";
import type { MyReview, PublicReview, ReviewEligibility, ReviewPage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ReviewItem } from "./review-item";

const noop = () => () => {};

/** Further pages of reviews, loaded on request. */
export function MoreReviews({ slug, from }: { slug: string; from: number }) {
  const [pages, setPages] = React.useState<PublicReview[][]>([]);
  const [next, setNext] = React.useState(from);
  const [done, setDone] = React.useState(false);
  const load = useMutation({
    mutationFn: () => api<ReviewPage>(`/storefront/products/${encodeURIComponent(slug)}/reviews?page=${next}`),
    onSuccess: (p) => {
      setPages((all) => [...all, p.items]);
      setNext((n) => n + 1);
      if (p.page * p.pageSize >= p.totalCount) setDone(true);
    },
  });
  return (
    <>
      {pages.length > 0 && <ul className="divide-y divide-border border-t border-border">{pages.flat().map((r) => <ReviewItem key={r.id} r={r} />)}</ul>}
      {!done && (
        <Button variant="secondary" className="mt-6" loading={load.isPending} onClick={() => load.mutate()}>Show more reviews</Button>
      )}
      {load.isError && <p className="mt-2 text-sm text-danger" role="alert">{errorMessage(load.error)}</p>}
    </>
  );
}

const STATUS: Record<MyReview["status"], string> = {
  Pending: "Thanks! The store will check your review before it appears.",
  Published: "Your review is live.",
  Hidden: "The store isn't showing your review. You can edit it.",
};

/** Write or edit your review. Shown to signed-in shoppers who received the product. */
export function WriteReview({ slug }: { slug: string }) {
  const hydrated = React.useSyncExternalStore(noop, () => true, () => false);
  const shopper = useShopper();
  const pathname = usePathname();
  const signedIn = hydrated && !!shopper.data;
  const key = ["my-review", slug];
  const mine = useQuery({ queryKey: key, queryFn: () => api<ReviewEligibility>(`/storefront/products/${encodeURIComponent(slug)}/reviews/mine`), enabled: signedIn });
  const [open, setOpen] = React.useState(false);

  if (!hydrated || shopper.isPending) return null;
  if (!signedIn)
    return (
      <p className="mt-6 text-sm">
        <Link href={`/account/login?next=${encodeURIComponent(`${pathname}#reviews`)}`} className="font-medium underline underline-offset-4">Sign in</Link>
        <span className="text-fg-muted"> to review a product you&apos;ve received.</span>
      </p>
    );
  if (!mine.data) return null;
  if (!mine.data.canReview) return <p className="mt-6 text-sm text-fg-muted">{mine.data.reason}</p>;
  const existing = mine.data.review;
  return (
    <div className="mt-6">
      {existing && !open && <p className="mb-3 text-sm text-fg-muted" role="status">{STATUS[existing.status]}</p>}
      {open ? (
        <ReviewForm slug={slug} existing={existing} onDone={() => setOpen(false)} />
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>{existing ? "Edit your review" : "Write a review"}</Button>
      )}
    </div>
  );
}

function ReviewForm({ slug, existing, onDone }: { slug: string; existing: MyReview | null; onDone: () => void }) {
  const [rating, setRating] = React.useState(existing?.rating ?? 0);
  const [title, setTitle] = React.useState(existing?.title ?? "");
  const [body, setBody] = React.useState(existing?.body ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api<MyReview>(`/storefront/products/${encodeURIComponent(slug)}/reviews/mine`, { method: "PUT", body: { rating, title: title || null, body } }),
    onSuccess: (r) => { qc.setQueryData(["my-review", slug], { canReview: true, reason: null, review: r }); onDone(); },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1) return setError("Choose a rating from 1 to 5 stars.");
    if (body.trim().length < 10) return setError("Tell other shoppers a little more (at least 10 characters).");
    setError(null);
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4 rounded-[var(--radius-card)] border border-border bg-surface p-5" noValidate>
      <fieldset>
        <legend className="text-sm font-medium">Your rating</legend>
        <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} ${n === 1 ? "star" : "stars"}`} onClick={() => setRating(n)}
              className="rounded p-0.5 text-fg hover:scale-110">
              <Star className={cn("size-7", n <= rating ? "fill-current" : "text-border-strong")} strokeWidth={1.5} aria-hidden />
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="review-title" className="text-sm font-medium">Title <span className="font-normal text-fg-muted">(optional)</span></label>
        <input id="review-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100}
          className="mt-1.5 h-10 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm" />
      </div>
      <div>
        <label htmlFor="review-body" className="text-sm font-medium">Your review</label>
        <textarea id="review-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={5}
          aria-describedby="review-help" className="mt-1.5 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-sm" />
        <p id="review-help" className="mt-1 text-xs text-fg-muted">Fit, quality, how it looks in person. Your first name and last initial are shown.</p>
      </div>
      {(error || save.isError) && <p className="text-sm text-danger" role="alert">{error ?? errorMessage(save.error)}</p>}
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending}>Submit review</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
