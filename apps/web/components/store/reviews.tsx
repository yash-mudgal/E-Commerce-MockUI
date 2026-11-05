import { BadgeCheck } from "lucide-react";
import type { ReviewPage } from "@/lib/types";
import { ReviewItem } from "./review-item";
import { MoreReviews, WriteReview } from "./reviews-client";
import { Stars } from "./stars";

/** Ratings and published reviews for a product. Every review comes from a shopper whose order was delivered. */
export function ReviewsSection({ slug, page }: { slug: string; page: ReviewPage }) {
  const { summary } = page;
  return (
    <section id="reviews" className="mt-24 scroll-mt-32 border-t border-border pt-16" aria-labelledby="reviews-heading">
      <div className="grid gap-12 lg:grid-cols-[20rem_1fr]">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-fg-muted uppercase">Reviews</p>
          <h2 id="reviews-heading" className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">What shoppers say</h2>
          {summary.count > 0 && summary.average ? (
            <>
              <div className="mt-6 flex items-center gap-3">
                <span className="font-display text-5xl">{summary.average}</span>
                <div>
                  <Stars value={Number(summary.average)} size="md" />
                  <p className="mt-1 text-sm text-fg-muted">{summary.count} {summary.count === 1 ? "review" : "reviews"}</p>
                </div>
              </div>
              <dl className="mt-6 space-y-2">
                {[5, 4, 3, 2, 1].map((star) => {
                  const n = summary.distribution[star - 1] ?? 0;
                  return (
                    <div key={star} className="flex items-center gap-3 text-sm">
                      <dt className="w-12 shrink-0 text-fg-muted">{star} star</dt>
                      <dd className="flex flex-1 items-center gap-3">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                          <span className="block h-full rounded-full bg-fg" style={{ width: `${(n / summary.count) * 100}%` }} />
                        </span>
                        <span className="tabular w-6 text-right text-fg-muted">{n}</span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          ) : (
            <p className="mt-4 text-sm text-fg-muted">No reviews yet. Shoppers who receive this product can review it.</p>
          )}
          <p className="mt-6 flex items-start gap-2 text-xs text-fg-muted">
            <BadgeCheck className="mt-px size-4 shrink-0" aria-hidden />Only shoppers whose order was delivered can write a review. The store checks each one before it appears.
          </p>
          <WriteReview slug={slug} />
        </div>
        <div>
          {page.items.length > 0 && (
            <ul className="divide-y divide-border">
              {page.items.map((r) => <ReviewItem key={r.id} r={r} />)}
            </ul>
          )}
          {page.totalCount > page.items.length && <MoreReviews slug={slug} from={2} />}
        </div>
      </div>
    </section>
  );
}
