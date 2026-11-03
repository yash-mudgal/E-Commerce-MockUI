"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useFieldArray, useForm, type FieldErrors } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import { GST_RATES, productSchema, type ProductInput, type ProductOutput } from "@/lib/schemas";
import type { Category, Product } from "@/lib/types";
import { cn, discountPercent } from "@/lib/utils";

const emptyVariant = (optionCount: number): ProductInput["variants"][number] => ({
  sku: "", optionValues: Array(optionCount).fill(""), price: "", mrp: "", cost: "", stockOnHand: "0", isActive: true,
});

export function toFormValues(p?: Product): ProductInput {
  if (!p)
    return { title: "", description: "", categoryId: "", status: "active", hsnCode: "", gstRate: "12", optionNames: [], tags: "", variants: [emptyVariant(0)] };
  return {
    title: p.title,
    description: p.description,
    categoryId: p.categoryId ?? "",
    status: p.status,
    hsnCode: p.hsnCode ?? "",
    gstRate: (GST_RATES.find((r) => Number(r) === Number(p.gstRate)) ?? "12") as ProductInput["gstRate"],
    optionNames: p.optionNames,
    tags: p.tags.join(", "),
    variants: p.variants.map((v) => ({
      id: v.id, sku: v.sku, optionValues: v.optionValues, price: trimMoney(v.price), mrp: trimMoney(v.mrp),
      cost: v.cost ? trimMoney(v.cost) : "", stockOnHand: String(v.stockOnHand), isActive: v.isActive,
    })),
  };
}

const trimMoney = (s: string) => s.replace(/\.00$/, "");

function toRequest(v: ProductOutput) {
  return {
    title: v.title,
    description: v.description,
    categoryId: v.categoryId || null,
    status: v.status,
    hsnCode: v.hsnCode || null,
    gstRate: v.gstRate,
    optionNames: v.optionNames,
    tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean),
    variants: v.variants.map((x) => ({
      id: x.id, sku: x.sku, optionValues: x.optionValues, price: x.price, mrp: x.mrp, cost: x.cost === "" ? null : x.cost, stockOnHand: x.stockOnHand, isActive: x.isActive,
    })),
  };
}

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [formError, setFormError] = React.useState<{ message: string; stale?: boolean } | null>(null);
  const [confirm, setConfirm] = React.useState<"archive" | "delete" | null>(null);
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/admin/categories") });

  const form = useForm<ProductInput, unknown, ProductOutput>({ resolver: zodResolver(productSchema), defaultValues: toFormValues(product) });
  const { register, control, formState, setError, reset, getValues, setValue } = form;
  const variants = useFieldArray({ control, name: "variants" });
  const optionNames = form.watch("optionNames");
  const errors = formState.errors;

  React.useEffect(() => { if (product) reset(toFormValues(product)); }, [product, reset]);

  const save = useMutation({
    mutationFn: (body: ReturnType<typeof toRequest>) =>
      product
        ? api<Product>(`/admin/products/${product.id}`, { method: "PUT", body, ifMatch: product.version })
        : api<Product>("/admin/products", { method: "POST", body }),
    onSuccess: (saved) => {
      qc.setQueryData(["product", saved.id], saved);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.notify(product ? "Product saved" : "Product created");
      if (!product) router.replace(`/admin/products/${saved.id}`);
      else reset(toFormValues(saved));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.problem.errors) {
        for (const [path, message] of Object.entries(e.fieldErrors)) setError(path as never, { message });
        setFormError({ message: "Some fields need attention." });
      } else if (e instanceof ApiError && e.code === "concurrency") {
        setFormError({ message: "Someone else changed this product while you were editing.", stale: true });
      } else setFormError({ message: errorMessage(e) });
    },
  });

  const lifecycle = useMutation({
    mutationFn: (action: "archive" | "delete") =>
      action === "archive"
        ? api<void>(`/admin/products/${product!.id}/archive`, { method: "POST" })
        : api<void>(`/admin/products/${product!.id}`, { method: "DELETE" }),
    onSuccess: (_, action) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.notify(action === "archive" ? "Product archived" : "Product deleted");
      router.push("/admin/products");
    },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });

  const onSubmit = form.handleSubmit(
    (values) => { setFormError(null); save.mutate(toRequest(values)); },
    (errs: FieldErrors<ProductInput>) => { setFormError({ message: "Some fields need attention." }); focusFirstError(errs); },
  );

  function addOption() {
    setValue("optionNames", [...getValues("optionNames"), ""]);
    getValues("variants").forEach((v, i) => setValue(`variants.${i}.optionValues`, [...v.optionValues, ""]));
  }
  function removeOption(index: number) {
    setValue("optionNames", getValues("optionNames").filter((_, i) => i !== index));
    getValues("variants").forEach((v, i) => setValue(`variants.${i}.optionValues`, v.optionValues.filter((_, j) => j !== index)));
  }

  const canDelete = can(me.data, "catalog.delete");
  return (
    <form onSubmit={onSubmit} onChange={() => { if (formError && !formError.stale) setFormError(null); }} noValidate>
      <PageHeader
        back={<Link href="/admin/products" className="mb-2 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />Products</Link>}
        title={product ? product.title : "Add product"}
        description={product ? <span className="inline-flex items-center gap-2">/{product.slug} <StatusBadge status={product.status} /></span> : "Fill in the details shoppers see, then add a variant for each size or colour you sell."}
        actions={
          <>
            {product && product.status !== "archived" && <Button type="button" variant="secondary" onClick={() => setConfirm("archive")}><Archive />Archive</Button>}
            {product && canDelete && <Button type="button" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirm("delete")}><Trash2 />Delete</Button>}
            <Button type="submit" loading={save.isPending} disabled={!!product && !formState.isDirty}>{product ? "Save changes" : "Create product"}</Button>
          </>
        }
      />

      {formError && (
        <Alert tone="danger" className="mb-6" title={formError.message}
          action={formError.stale ? <Button type="button" size="sm" variant="secondary" onClick={() => { qc.invalidateQueries({ queryKey: ["product", product!.id] }); setFormError(null); }}>Load latest</Button> : undefined}>
          {formError.stale ? "Your changes were not saved. Load the latest version and re-apply your edits." : undefined}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <div className="flex flex-col gap-4 p-5">
              <Field label="Title" error={errors.title?.message}>
                <Input placeholder="e.g. Jaipuri Cotton Anarkali Kurta" {...register("title")} />
              </Field>
              <Field label="Description" optional hint="Fabric, fit, care instructions: whatever helps a shopper decide." error={errors.description?.message}>
                <Textarea rows={5} {...register("description")} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Variants"
              description="Each variant has its own SKU, price and stock."
              action={optionNames.length < 3 ? <Button type="button" variant="secondary" size="sm" onClick={addOption}><Plus />Add option</Button> : undefined}
            />
            {optionNames.length > 0 && (
              <div className="flex flex-wrap gap-3 border-b border-border px-5 py-4">
                {optionNames.map((_, i) => (
                  <div key={i} className="flex items-end gap-1">
                    <Field label={`Option ${i + 1}`} error={errors.optionNames?.[i]?.message} className="w-40">
                      <Input placeholder={i === 0 ? "Size" : "Colour"} {...register(`optionNames.${i}`)} />
                    </Field>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeOption(i)} aria-label={`Remove option ${i + 1}`}><X /></Button>
                  </div>
                ))}
              </div>
            )}
            <div className="divide-y divide-border">
              {variants.fields.map((field, i) => {
                const ve = errors.variants?.[i];
                const price = form.watch(`variants.${i}.price`);
                const mrp = form.watch(`variants.${i}.mrp`);
                const off = discountPercent(price || 0, mrp || 0);
                return (
                  <fieldset key={field.id} className="px-5 py-4">
                    <legend className="sr-only">Variant {i + 1}</legend>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                      {optionNames.map((name, j) => (
                        <Field key={j} label={name || `Option ${j + 1}`} error={ve?.optionValues?.[j]?.message} className="col-span-1 sm:col-span-2">
                          <Input {...register(`variants.${i}.optionValues.${j}`)} />
                        </Field>
                      ))}
                      <Field label="SKU" error={ve?.sku?.message} className="col-span-2">
                        <Input className="font-mono text-[13px]" autoCapitalize="characters" {...register(`variants.${i}.sku`)} />
                      </Field>
                      <Field label="Price (₹)" error={ve?.price?.message} hint="Incl. GST">
                        <Input inputMode="decimal" className="tabular" {...register(`variants.${i}.price`)} />
                      </Field>
                      <Field label="MRP (₹)" error={ve?.mrp?.message} hint={off > 0 ? `${off}% off` : undefined}>
                        <Input inputMode="decimal" className="tabular" {...register(`variants.${i}.mrp`)} />
                      </Field>
                      <Field label="Cost (₹)" hint="Optional" error={ve?.cost?.message}>
                        <Input inputMode="decimal" className="tabular" {...register(`variants.${i}.cost`)} />
                      </Field>
                      <Field label="In stock" error={ve?.stockOnHand?.message}>
                        <Input inputMode="numeric" className="tabular" {...register(`variants.${i}.stockOnHand`)} />
                      </Field>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <label className="inline-flex items-center gap-2 text-sm text-fg-muted">
                        <input type="checkbox" className="size-4 accent-[var(--brand)]" {...register(`variants.${i}.isActive`)} />
                        Available for sale
                      </label>
                      {variants.fields.length > 1 && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => variants.remove(i)}><Trash2 />Remove</Button>
                      )}
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <div className="border-t border-border px-5 py-3">
              {errors.variants?.root?.message && <p className="mb-2 text-[13px] text-danger">{errors.variants.root.message}</p>}
              <Button type="button" variant="secondary" size="sm" onClick={() => variants.append(emptyVariant(optionNames.length))} disabled={variants.fields.length >= 100}>
                <Plus />Add variant
              </Button>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Status" />
            <div className="p-5">
              <Field label="Visibility" hint="Only active products appear on your storefront." error={errors.status?.message}>
                <Select {...register("status")}>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </Select>
              </Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Organisation" />
            <div className="flex flex-col gap-4 p-5">
              <Field label="Category" optional error={errors.categoryId?.message}>
                <Select {...register("categoryId")} disabled={categories.isPending}>
                  <option value="">No category</option>
                  {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Tags" optional hint="Comma-separated. Used in storefront search." error={errors.tags?.message}>
                <Input placeholder="cotton, festive" {...register("tags")} />
              </Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Tax" description="Prices include GST." />
            <div className="grid grid-cols-2 gap-4 p-5">
              <Field label="GST rate" error={errors.gstRate?.message}>
                <Select {...register("gstRate")}>{GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</Select>
              </Field>
              <Field label="HSN code" hint="Optional" error={errors.hsnCode?.message}>
                <Input inputMode="numeric" className="tabular" {...register("hsnCode")} />
              </Field>
            </div>
          </Card>
        </div>
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "delete" ? "Delete this product?" : "Archive this product?"}
        description={confirm === "delete" ? "This permanently removes the product, its variants and stock records. This can't be undone." : "Archived products are hidden from your storefront and product list. You can restore them later by changing the status."}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === "delete" ? "danger" : "primary"} loading={lifecycle.isPending} onClick={() => confirm && lifecycle.mutate(confirm)}>
              {confirm === "delete" ? "Delete product" : "Archive product"}
            </Button>
          </>
        }
      />
    </form>
  );
}

function StatusBadge({ status }: { status: Product["status"] }) {
  return <Badge tone={status === "active" ? "success" : status === "archived" ? "warning" : "neutral"}>{status[0].toUpperCase() + status.slice(1)}</Badge>;
}

function focusFirstError(errs: FieldErrors<ProductInput>) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>("[aria-invalid='true']");
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  void errs;
}

export function ProductFormSkeleton() {
  return <div className={cn("grid gap-6 lg:grid-cols-3")}><div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-surface-muted lg:col-span-2" /><div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" /></div>;
}
