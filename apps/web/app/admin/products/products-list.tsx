"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ImageOff, Package, Plus, RefreshCw, Search, SearchX } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton, type Tone } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import type { Paged, ProductListItem, ProductStatus } from "@/lib/types";
import { cn, formatDate, formatINR } from "@/lib/utils";

const TABS: { value: "" | ProductStatus; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
];
const STATUS_TONE: Record<ProductStatus, Tone> = { active: "success", draft: "neutral", archived: "warning" };
const PAGE_SIZE = 20;

export function ProductsList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = (params.get("status") ?? "") as "" | ProductStatus;
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [search, setSearch] = React.useState(q);

  const setParams = React.useCallback(
    (next: Record<string, string | number | undefined>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === "" || (k === "page" && v === 1)) sp.delete(k);
        else sp.set(k, String(v));
      }
      router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Debounced search kept in the URL so results are shareable.
  React.useEffect(() => {
    if (search === q) return;
    const t = window.setTimeout(() => setParams({ q: search.trim(), page: undefined }), 300);
    return () => window.clearTimeout(t);
  }, [search, q, setParams]);

  const query = useQuery({
    queryKey: ["products", { status, q, page }],
    queryFn: ({ signal }) => {
      const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (status) sp.set("status", status);
      if (q) sp.set("q", q);
      return api<Paged<ProductListItem>>(`/admin/products?${sp}`, { signal });
    },
    placeholderData: keepPreviousData,
  });

  const filtered = !!q || !!status;
  return (
    <>
      <PageHeader
        title="Products"
        description="Everything you sell, with variants, pricing and stock."
        actions={
          <Button asChild>
            <Link href="/admin/products/new"><Plus />Add product</Link>
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Filter by status" className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.value}
                role="tab"
                aria-selected={status === t.value}
                onClick={() => setParams({ status: t.value, page: undefined })}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap", status === t.value ? "bg-surface-muted text-fg" : "text-fg-muted hover:text-fg")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input type="search" placeholder="Search title or SKU" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" aria-label="Search products" />
          </div>
        </div>

        {query.isError ? (
          <div className="p-5">
            <Alert tone="danger" title="Couldn't load products" action={<Button variant="secondary" size="sm" onClick={() => query.refetch()}><RefreshCw />Retry</Button>}>
              {errorMessage(query.error)}
            </Alert>
          </div>
        ) : query.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : query.data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No products match" description="Try a different search or status filter." action={<Button variant="secondary" onClick={() => { setSearch(""); setParams({ q: undefined, status: undefined, page: undefined }); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={Package} title="Add your first product" description="Create products with sizes, colours and stock. Active products appear on your storefront immediately." action={<Button asChild><Link href="/admin/products/new"><Plus />Add product</Link></Button>} />
          )
        ) : (
          <>
            <Table className={cn(query.isPlaceholderData && "opacity-60")}>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Inventory</Th>
                  <Th className="hidden text-right sm:table-cell">Price</Th>
                  <Th className="hidden md:table-cell">Category</Th>
                  <Th className="hidden lg:table-cell">Updated</Th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((p) => (
                  <tr key={p.id} className="group hover:bg-surface-muted/50">
                    <Td className="max-w-[18rem]">
                      <div className="flex items-center gap-3">
                        <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface-muted" aria-hidden>
                          {p.thumbnailUrl ? <Image src={p.thumbnailUrl} alt="" fill sizes="40px" className="object-cover" /> : <ImageOff className="size-4 text-fg-subtle" />}
                        </span>
                        <div className="min-w-0">
                          <Link href={`/admin/products/${p.id}`} className="block truncate font-medium text-fg group-hover:text-brand focus-visible:outline-offset-4">
                            {p.title}
                          </Link>
                          <p className="truncate text-xs text-fg-muted">
                            {p.primarySku}
                            {p.variantCount > 1 && ` · ${p.variantCount} variants`}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td><Badge tone={STATUS_TONE[p.status]}>{p.status[0].toUpperCase() + p.status.slice(1)}</Badge></Td>
                    <Td className={cn("tabular text-right", p.totalStock === 0 ? "text-danger" : "text-fg")}>{p.totalStock === 0 ? "Out of stock" : `${p.totalStock} in stock`}</Td>
                    <Td className="tabular hidden text-right sm:table-cell">
                      {p.priceMin === p.priceMax ? formatINR(p.priceMin) : `${formatINR(p.priceMin)} – ${formatINR(p.priceMax)}`}
                    </Td>
                    <Td className="hidden text-fg-muted md:table-cell">{p.categoryName ?? "—"}</Td>
                    <Td className="hidden text-fg-muted lg:table-cell">{formatDate(p.updatedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.totalCount} onPage={(p) => setParams({ page: p })} />
          </>
        )}
      </Card>
    </>
  );
}
