import { BadgeCheck } from "lucide-react";
import type { PublicReview } from "@/lib/types";
import { Stars } from "./stars";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
export const reviewDate = (iso: string) => dateFmt.format(new Date(iso));

/** One published review (used by the server-rendered first page and the client "more reviews" pages). */
export function ReviewItem({ r }: { r: PublicReview }) {
  return (
    <li className="py-6 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={r.rating} />
        {r.title && <p className="font-medium">{r.title}</p>}
      </div>
      <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-fg-muted">{r.body}</p>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-muted">
        <span className="font-medium text-fg">{r.author}</span>
        <BadgeCheck className="size-3.5 text-success" aria-hidden /><span>Verified buyer</span>
        <span aria-hidden>·</span><time dateTime={r.createdAt}>{reviewDate(r.createdAt)}</time>
      </p>
      {r.reply && (
        <div className="mt-4 rounded-[var(--radius-control)] border-l-2 border-fg bg-surface-muted px-4 py-3">
          <p className="text-xs font-semibold tracking-wide uppercase">Reply from the store</p>
          <p className="mt-1 text-sm whitespace-pre-line text-fg-muted">{r.reply}</p>
        </div>
      )}
    </li>
  );
}
