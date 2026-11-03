"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Shapes, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import type { Category } from "@/lib/types";

type Editing = { mode: "create" } | { mode: "edit"; category: Category };

export default function CategoriesPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [deleting, setDeleting] = React.useState<Category | null>(null);
  const list = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/admin/categories") });

  const remove = useMutation({
    mutationFn: (c: Category) => api<void>(`/admin/categories/${c.id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.notify("Category deleted"); setDeleting(null); },
    onError: (e) => { toast.notify(errorMessage(e), "error"); setDeleting(null); },
  });

  const ordered = (list.data ?? []).filter((c) => !c.parentId).flatMap((p) => [p, ...(list.data ?? []).filter((c) => c.parentId === p.id)]);

  return (
    <>
      <PageHeader title="Categories" description="Group products so shoppers can browse your storefront." actions={<Button onClick={() => setEditing({ mode: "create" })}><Plus />Add category</Button>} />
      <Card>
        {list.isError ? (
          <div className="p-5"><Alert tone="danger" title="Couldn't load categories" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
        ) : list.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : ordered.length === 0 ? (
          <EmptyState icon={Shapes} title="No categories yet" description="Categories appear as navigation on your storefront, e.g. Ethnic Wear, Footwear, Spices." action={<Button onClick={() => setEditing({ mode: "create" })}><Plus />Add category</Button>} />
        ) : (
          <Table>
            <thead><tr><Th>Name</Th><Th className="hidden sm:table-cell">Slug</Th><Th className="text-right">Products</Th><Th className="w-24"><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {ordered.map((c) => (
                <tr key={c.id} className="hover:bg-surface-muted/50">
                  <Td className="font-medium">{c.parentId ? <span className="pl-5 text-fg-muted">↳ <span className="text-fg">{c.name}</span></span> : c.name}</Td>
                  <Td className="hidden font-mono text-xs text-fg-muted sm:table-cell">{c.slug}</Td>
                  <Td className="tabular text-right">{c.productCount}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditing({ mode: "edit", category: c })} aria-label={`Edit ${c.name}`}><Pencil /></Button>
                      {can(me.data, "catalog.delete") && <Button variant="ghost" size="icon" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}><Trash2 /></Button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && <CategoryDialog editing={editing} parents={(list.data ?? []).filter((c) => !c.parentId && (editing.mode === "create" || c.id !== editing.category.id))} onClose={() => setEditing(null)} />}
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description={deleting && deleting.productCount > 0 ? `This category has ${deleting.productCount} product(s). Move them to another category first.` : "This can't be undone."}
        footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>Delete</Button></>}
      />
    </>
  );
}

function CategoryDialog({ editing, parents, onClose }: { editing: Editing; parents: Category[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const initial = editing.mode === "edit" ? editing.category : undefined;
  const [name, setName] = React.useState(initial?.name ?? "");
  const [parentId, setParentId] = React.useState(initial?.parentId ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      const body = { name, parentId: parentId || null, position: initial?.position ?? 0, slug: initial?.slug };
      return initial ? api<Category>(`/admin/categories/${initial.id}`, { method: "PUT", body }) : api<Category>("/admin/categories", { method: "POST", body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.notify(initial ? "Category updated" : "Category added"); onClose(); },
    onError: (e) => setErrors(e instanceof ApiError && e.problem.errors ? e.fieldErrors : { name: errorMessage(e) }),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial ? "Edit category" : "Add category"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="category-form" loading={save.isPending}>{initial ? "Save" : "Add category"}</Button></>}
    >
      <form id="category-form" noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) { setErrors({ name: "Enter a name" }); return; } setErrors({}); save.mutate(); }}>
        <Field label="Name" error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
        </Field>
        <Field label="Parent category" optional error={errors.parentId}>
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">None (top level)</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}
