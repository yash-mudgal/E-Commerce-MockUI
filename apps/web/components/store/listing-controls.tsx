"use client";

import { SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { LISTING_SORTS as SORTS } from "@/lib/store-terms";
import { Sheet } from "./sheet";


/** Sort menu that applies on change. Inside the GET form, so it also works without JavaScript (with "Apply"). */
export function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-fg-muted">Sort by</span>
      <select name="sort" defaultValue={value} aria-label="Sort by"
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value === "newest") next.delete("sort"); else next.set("sort", e.target.value);
          next.delete("page");
          router.push(`${pathname}${next.size ? `?${next}` : ""}`);
        }}
        className="h-10 rounded-[var(--radius-control)] border border-border-strong bg-surface pr-8 pl-3 text-sm focus-visible:border-fg">
        {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** On small screens the filter panel opens from the side; the same server-rendered form is inside. */
export function MobileFilters({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const params = useSearchParams().toString();
  const [seen, setSeen] = React.useState(params);
  // Close after filters are applied (the query changes); adjusted during render, as React recommends.
  if (seen !== params) { setSeen(params); if (open) setOpen(false); }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium lg:hidden">
        <SlidersHorizontal className="size-4" aria-hidden />Filters{count > 0 && <span className="grid size-5 place-items-center rounded-full bg-fg text-[11px] text-surface">{count}</span>}
      </button>
      <Sheet open={open} onOpenChange={setOpen} side="left" title="Filters" description="Filter products">
        <div className="px-5 py-4">{children}</div>
      </Sheet>
    </>
  );
}
