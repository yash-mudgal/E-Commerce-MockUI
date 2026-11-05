"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FileText, ImageOff, Layers, Plus, RefreshCw } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { storefrontUrl } from "@/components/admin/shell";
import { RichText } from "@/components/store/rich-text";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import type { AdminCollection, AdminPage, HeroImageOption, StorefrontSettingsForm } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

/** Suggested pages. Titles only: the store writes its own policies (ShopMint never drafts legal text for a store). */
const SUGGESTED = [
  { title: "About us", hint: "Who you are, what you make and how." },
  { title: "Shipping and delivery", hint: "Where you deliver, dispatch times, couriers, charges." },
  { title: "Returns and exchanges", hint: "Your return window, condition of items, how refunds are paid." },
  { title: "Privacy policy", hint: "What personal data you collect and why (DPDP Act 2023)." },
  { title: "Terms of service", hint: "The terms that apply to orders on your store." },
  { title: "FAQ", hint: "Answers to the questions shoppers ask most." },
];

const fieldError = (e: unknown, name: string) => (e instanceof ApiError ? e.fieldErrors[name] : undefined);

export default function StorefrontAdminPage() {
  const me = useMe();
  const settingsOk = !!me.data && can(me.data, "settings.write");
  const catalogOk = !!me.data && can(me.data, "catalog.write");
  const host = me.data?.tenant?.host;
  return (
    <>
      <PageHeader title="Storefront" description="What shoppers see on your home page, the collections you curate and your store's own pages."
        actions={host ? <Button asChild variant="secondary"><a href={storefrontUrl(host)} target="_blank" rel="noreferrer"><ExternalLink />View store</a></Button> : undefined} />
      {me.isPending ? <Skeleton className="h-96" /> : (
        <div className="grid gap-6">
          {settingsOk && <HomeSettings />}
          {catalogOk && <Collections />}
          {settingsOk && <Pages host={host} />}
          {!settingsOk && !catalogOk && <Card><EmptyState icon={Layers} title="You don't have access" description="Ask the store owner for settings or catalogue permissions." /></Card>}
        </div>
      )}
    </>
  );
}

// ---------- Home page ----------

function HomeSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ["storefront-settings"], queryFn: () => api<StorefrontSettingsForm>("/admin/storefront") });
  const images = useQuery({ queryKey: ["hero-images"], queryFn: () => api<HeroImageOption[]>("/admin/storefront/hero-images") });
  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api<AdminCollection[]>("/admin/collections") });
  const [form, setForm] = React.useState<StorefrontSettingsForm | null>(null);
  const value = form ?? settings.data ?? null;
  const set = (patch: Partial<StorefrontSettingsForm>) => setForm({ ...(value as StorefrontSettingsForm), ...patch });
  const save = useMutation({
    mutationFn: () => api<StorefrontSettingsForm>("/admin/storefront", { method: "PUT", body: value }),
    onSuccess: (s) => { qc.setQueryData(["storefront-settings"], s); setForm(null); toast.notify("Home page saved. Your store updates within a minute."); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });

  return (
    <Card>
      <CardHeader title="Home page" description="Leave a field empty to use the default: your tagline as the headline, your newest product photos, and your shipping terms in the announcement bar." />
      {settings.isError ? <div className="p-5"><Alert tone="danger" title="Couldn't load settings">{errorMessage(settings.error)}</Alert></div>
        : !value ? <div className="p-5"><Skeleton className="h-48" /></div> : (
        <form className="grid gap-5 p-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Headline" optional error={fieldError(save.error, "heroHeading")}>
              <Input maxLength={120} value={value.heroHeading ?? ""} onChange={(e) => set({ heroHeading: e.target.value })} placeholder="Handwoven, made to last" />
            </Field>
            <Field label="Announcement bar" optional hint="Shown at the very top of every page." error={fieldError(save.error, "announcement")}>
              <Input maxLength={140} value={value.announcement ?? ""} onChange={(e) => set({ announcement: e.target.value })} placeholder="Free shipping on orders over ₹999" />
            </Field>
          </div>
          <Field label="Introduction" optional error={fieldError(save.error, "heroText")}>
            <Textarea rows={2} maxLength={300} value={value.heroText ?? ""} onChange={(e) => set({ heroText: e.target.value })} />
          </Field>
          <fieldset>
            <legend className="text-sm font-medium">Hero photo <span className="font-normal text-fg-subtle">(optional)</span></legend>
            <p className="mt-0.5 text-[13px] text-fg-muted">Pick one of your product photos. It links to that product.</p>
            {images.isPending ? <Skeleton className="mt-3 h-24" /> : !images.data?.length ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-fg-muted"><ImageOff className="size-4" aria-hidden />Add photos to your products to choose one here.</p>
            ) : (
              <div className="mt-3 flex gap-3 overflow-x-auto pb-2" role="radiogroup" aria-label="Hero photo">
                <button type="button" role="radio" aria-checked={!value.heroMediaId} onClick={() => set({ heroMediaId: null })}
                  className={cn("grid h-24 w-20 shrink-0 place-items-center rounded-md border text-xs text-fg-muted", !value.heroMediaId ? "border-brand ring-2 ring-brand/30" : "border-border")}>
                  Automatic
                </button>
                {images.data.map((img) => (
                  <button key={img.mediaId} type="button" role="radio" aria-checked={value.heroMediaId === img.mediaId} onClick={() => set({ heroMediaId: img.mediaId })}
                    aria-label={`${img.productTitle}${img.altText ? `: ${img.altText}` : ""}`}
                    className={cn("relative h-24 w-20 shrink-0 overflow-hidden rounded-md border", value.heroMediaId === img.mediaId ? "border-brand ring-2 ring-brand/30" : "border-border")}>
                    <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
                    {value.heroMediaId === img.mediaId && <span className="absolute right-1 bottom-1 grid size-5 place-items-center rounded-full bg-brand text-brand-fg"><Check className="size-3" aria-hidden /></span>}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
          <div className="grid gap-5 md:grid-cols-2">
            <fieldset>
              <legend className="text-sm font-medium">Sections</legend>
              <div className="mt-2 grid gap-2 text-sm">
                {([["showCategories", "Shop by category"], ["showNewArrivals", "New arrivals"], ["showSale", "On sale (when products are discounted)"]] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2.5">
                    <input type="checkbox" checked={value[k]} onChange={(e) => set({ [k]: e.target.checked })} className="size-4 accent-[var(--brand)]" />{label}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Featured collection" optional hint="Shown near the top of the home page.">
              <Select value={value.featuredCollectionId ?? ""} onChange={(e) => set({ featuredCollectionId: e.target.value || null })}>
                <option value="">None</option>
                {(collections.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}{c.published ? "" : " (hidden)"}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            {form && <Button type="button" variant="ghost" onClick={() => setForm(null)}>Discard changes</Button>}
            <Button type="submit" loading={save.isPending} disabled={!form}>Save home page</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

// ---------- Collections ----------

function Collections() {
  const list = useQuery({ queryKey: ["collections"], queryFn: () => api<AdminCollection[]>("/admin/collections") });
  const [editing, setEditing] = React.useState<AdminCollection | "new" | null>(null);
  return (
    <Card>
      <CardHeader title="Collections" description="A collection shows every active product with a given tag, so it stays up to date as you tag products (Products → Tags)."
        action={<Button size="sm" onClick={() => setEditing("new")}><Plus />New collection</Button>} />
      {list.isError ? <div className="p-5"><Alert tone="danger" title="Couldn't load collections" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw />Retry</Button>}>{errorMessage(list.error)}</Alert></div>
        : list.isPending ? <div className="p-5"><Skeleton className="h-20" /></div>
        : list.data.length === 0 ? <EmptyState icon={Layers} title="No collections yet" description="Group products for an occasion or a season, like “Wedding edit” or “Under ₹999”." />
        : (
          <ul className="divide-y divide-border">
            {list.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{c.title}<Badge tone={c.published ? "success" : "neutral"}>{c.published ? "Published" : "Hidden"}</Badge></p>
                  <p className="text-sm text-fg-muted">Tag “{c.tag}” · {c.productCount} {c.productCount === 1 ? "product" : "products"} · /products?collection={c.slug}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)} aria-label={`Edit ${c.title}`}>Edit</Button>
              </li>
            ))}
          </ul>
        )}
      {editing && <CollectionDialog collection={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function CollectionDialog({ collection, onClose }: { collection: AdminCollection | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = React.useState(collection?.title ?? "");
  const [tag, setTag] = React.useState(collection?.tag ?? "");
  const [description, setDescription] = React.useState(collection?.description ?? "");
  const [published, setPublished] = React.useState(collection?.published ?? true);
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ["collections"] }); toast.notify(msg); onClose(); };
  const save = useMutation({
    mutationFn: () => api(collection ? `/admin/collections/${collection.id}` : "/admin/collections", { method: collection ? "PUT" : "POST", body: { title, tag, description, published } }),
    onSuccess: () => done(collection ? "Collection saved" : "Collection created"),
  });
  const remove = useMutation({ mutationFn: () => api(`/admin/collections/${collection!.id}`, { method: "DELETE" }), onSuccess: () => done("Collection deleted") });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={collection ? "Edit collection" : "New collection"}
      footer={<>
        {collection && <Button variant="danger" className="mr-auto" loading={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>{collection ? "Save" : "Create"}</Button>
      </>}>
      <div className="grid gap-4">
        <Field label="Title" error={fieldError(save.error, "title")}><Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="The Wedding Edit" /></Field>
        <Field label="Product tag" hint="Products with this tag (any capitalisation) are in the collection." error={fieldError(save.error, "tag")}>
          <Input value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} placeholder="wedding" />
        </Field>
        <Field label="Description" optional error={fieldError(save.error, "description")}><Textarea rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="size-4 accent-[var(--brand)]" />Show on the storefront</label>
        {(save.isError && !fieldError(save.error, "title") && !fieldError(save.error, "tag")) && <p className="text-sm text-danger" role="alert">{errorMessage(save.error)}</p>}
        {remove.isError && <p className="text-sm text-danger" role="alert">{errorMessage(remove.error)}</p>}
      </div>
    </Dialog>
  );
}

// ---------- Pages ----------

function Pages({ host }: { host?: string }) {
  const list = useQuery({ queryKey: ["store-pages"], queryFn: () => api<AdminPage[]>("/admin/pages") });
  const [editing, setEditing] = React.useState<AdminPage | { title: string; hint: string } | null>(null);
  const missing = SUGGESTED.filter((s) => !list.data?.some((p) => p.title.toLowerCase() === s.title.toLowerCase()));
  return (
    <Card>
      <CardHeader title="Pages" description="Your store's information pages. Published pages are linked in the store's footer. Write them in your own words; you know your policies."
        action={<Button size="sm" onClick={() => setEditing({ title: "", hint: "" })}><Plus />New page</Button>} />
      {list.isError ? <div className="p-5"><Alert tone="danger" title="Couldn't load pages">{errorMessage(list.error)}</Alert></div>
        : list.isPending ? <div className="p-5"><Skeleton className="h-20" /></div> : (
        <>
          {list.data.length > 0 && (
            <ul className="divide-y divide-border">
              {list.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                  <FileText className="size-4 text-fg-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{p.title}<Badge tone={p.published ? "success" : "neutral"}>{p.published ? "Published" : "Draft"}</Badge></p>
                    <p className="text-sm text-fg-muted">/pages/{p.slug} · updated {formatDate(p.updatedAt)}</p>
                  </div>
                  {p.published && host && <Button asChild size="sm" variant="ghost"><a href={`${storefrontUrl(host)}/pages/${p.slug}`} target="_blank" rel="noreferrer">View<span className="sr-only"> {p.title}</span></a></Button>}
                  <Button size="sm" variant="secondary" onClick={() => setEditing(p)} aria-label={`Edit ${p.title}`}>Edit</Button>
                </li>
              ))}
            </ul>
          )}
          {missing.length > 0 && (
            <div className="border-t border-border p-4 sm:px-5">
              <p className="text-sm text-fg-muted">Pages shoppers look for:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {missing.map((s) => <Button key={s.title} size="sm" variant="secondary" onClick={() => setEditing(s)}><Plus />{s.title}</Button>)}
              </div>
            </div>
          )}
        </>
      )}
      {editing && <PageDialog page={"id" in editing ? editing : null} suggestion={"id" in editing ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function PageDialog({ page, suggestion, onClose }: { page: AdminPage | null; suggestion: { title: string; hint: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = React.useState(page?.title ?? suggestion?.title ?? "");
  const [body, setBody] = React.useState(page?.body ?? "");
  const [preview, setPreview] = React.useState(false);
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ["store-pages"] }); toast.notify(msg); onClose(); };
  const save = useMutation({
    mutationFn: (published: boolean) => api(page ? `/admin/pages/${page.id}` : "/admin/pages", { method: page ? "PUT" : "POST", body: { title, body, published } }),
    onSuccess: (_, published) => done(published ? "Page published" : "Draft saved"),
  });
  const remove = useMutation({ mutationFn: () => api(`/admin/pages/${page!.id}`, { method: "DELETE" }), onSuccess: () => done("Page deleted") });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={page ? "Edit page" : "New page"} className="max-w-2xl"
      footer={<>
        {page && <Button variant="danger" className="mr-auto" loading={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>}
        <Button variant="secondary" loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>Save as draft</Button>
        <Button loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>Publish</Button>
      </>}>
      <div className="grid gap-4">
        <Field label="Title" error={fieldError(save.error, "title")}><Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{preview ? "Preview" : "Content"}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</Button>
          </div>
          {preview ? (
            <div className="mt-1.5 max-h-80 overflow-y-auto rounded-md border border-border p-4">{body.trim() ? <RichText source={body} /> : <p className="text-sm text-fg-muted">Nothing written yet.</p>}</div>
          ) : (
            <Field label="Page content" hint={<>{suggestion?.hint ? `${suggestion.hint} ` : ""}Formatting: “## Heading”, “- list item”, **bold**, [link](https://…). A blank line starts a new paragraph.</>} error={fieldError(save.error, "body")}>
              <Textarea rows={12} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-[13px]" />
            </Field>
          )}
        </div>
        {save.isError && !fieldError(save.error, "title") && !fieldError(save.error, "body") && <p className="text-sm text-danger" role="alert">{errorMessage(save.error)}</p>}
      </div>
    </Dialog>
  );
}
