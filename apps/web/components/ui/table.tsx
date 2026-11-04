import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "./button";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    // relative: absolutely positioned descendants (e.g. sr-only labels) stay inside the scroll area instead of
    // widening the page.
    <div className="relative overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("h-10 border-b border-border bg-surface-muted/60 px-4 text-left text-xs font-medium tracking-wide text-fg-muted uppercase first:pl-5 last:pr-5", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-border px-4 py-3 align-middle first:pl-5 last:pr-5", className)} {...props} />;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 px-5 py-3 text-sm text-fg-muted">
      <p className="tabular">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <span className="hidden sm:inline">Next</span>
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
