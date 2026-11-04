"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { History, RefreshCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Select } from "@/components/ui/form";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { AUDIT_AREAS, auditHref, describeAudit } from "@/lib/audit";
import { can, useMe } from "@/lib/hooks";
import type { AuditEntry, Paged } from "@/lib/types";

const PAGE_SIZE = 25;

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export default function ActivityPage() {
  const me = useMe();
  const allowed = can(me.data, "audit.read");
  const [area, setArea] = React.useState("");
  const [page, setPage] = React.useState(1);
  const log = useQuery({
    queryKey: ["audit", area, page],
    queryFn: () => api<Paged<AuditEntry>>(`/admin/audit?page=${page}&pageSize=${PAGE_SIZE}${area ? `&area=${area}` : ""}`),
    enabled: allowed,
    placeholderData: keepPreviousData,
  });

  if (!allowed)
    return (
      <>
        <PageHeader title="Activity log" />
        <Alert tone="info">Only the store owner and managers can view the activity log.</Alert>
      </>
    );

  return (
    <>
      <PageHeader title="Activity log" description="A permanent record of changes in this store and who made them. Entries can't be edited or deleted." />
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="area" className="text-sm font-medium">Show</label>
        <Select id="area" value={area} onChange={(e) => { setArea(e.target.value); setPage(1); }} className="w-60">
          {AUDIT_AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </Select>
      </div>
      <Card>
        {log.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : log.isError ? (
          <div className="p-5">
            <Alert tone="danger" title="Couldn't load the activity log" action={<Button variant="secondary" size="sm" onClick={() => log.refetch()}><RefreshCw />Retry</Button>}>
              {errorMessage(log.error)}
            </Alert>
          </div>
        ) : log.data.items.length === 0 ? (
          <EmptyState icon={History} title="No activity yet" description={area ? "Nothing in this area yet. Try showing all activity." : "Changes to your store will appear here."} />
        ) : (
          <>
            <Table aria-busy={log.isFetching}>
              <thead>
                <tr><Th className="w-44">When</Th><Th>What happened</Th><Th className="hidden md:table-cell">Who</Th></tr>
              </thead>
              <tbody>
                {log.data.items.map((e) => {
                  const href = auditHref(e);
                  const text = describeAudit(e);
                  return (
                    <tr key={e.id} className="align-top">
                      <Td className="whitespace-nowrap text-fg-muted tabular-nums">{formatWhen(e.at)}</Td>
                      <Td>
                        {href ? <Link href={href} className="text-fg hover:text-brand hover:underline">{text}</Link> : <span>{text}</span>}
                        {/* On small screens the actor moves under the description. */}
                        <p className="text-[13px] text-fg-muted md:hidden">{e.actor ? e.actor.name : "ShopMint"}</p>
                      </Td>
                      <Td className="hidden md:table-cell">
                        {e.actor ? (
                          <>
                            <p>{e.actor.name}</p>
                            <p className="text-[13px] break-all text-fg-muted">{e.actor.email}</p>
                          </>
                        ) : (
                          <span className="text-fg-muted">ShopMint</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={log.data.totalCount} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
