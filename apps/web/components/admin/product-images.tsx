"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ImagePlus, Trash2, TriangleAlert, X } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import type { Product, ProductImage } from "@/lib/types";
import { checkImageFile, MAX_IMAGES, move, uploadProductImage } from "@/lib/upload";
import { cn } from "@/lib/utils";

type Upload = { key: string; name: string; progress: number; error: string | null; preview: string };

/**
 * Images for an existing product: upload (button or drag and drop), alt text, order and delete. The first image
 * is the main one on the storefront. Reordering uses buttons rather than drag so it works by keyboard.
 */
export function ProductImages({ product, editable }: { product: Product; editable: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = React.useState<Upload[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const images = product.media;
  const key = ["product", product.id];

  // Preview URLs are freed when their tile goes away, and any left over when the editor closes.
  const previews = React.useRef(new Set<string>());
  React.useEffect(() => {
    const live = previews.current;
    return () => live.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  const drop = (id: string) =>
    setUploads((all) => {
      const gone = all.find((u) => u.key === id);
      if (gone) { URL.revokeObjectURL(gone.preview); previews.current.delete(gone.preview); }
      return all.filter((u) => u.key !== id);
    });

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const patch = (id: string, change: Partial<Upload>) => setUploads((all) => all.map((u) => (u.key === id ? { ...u, ...change } : u)));

  const start = (files: FileList | File[]) => {
    const list = Array.from(files);
    const room = MAX_IMAGES - images.length - uploads.filter((u) => !u.error).length;
    if (list.length > room) toast.notify(room > 0 ? `Only ${room} more ${room === 1 ? "image fits" : "images fit"}. A product can have ${MAX_IMAGES}.` : `A product can have up to ${MAX_IMAGES} images.`, "error");
    for (const file of list.slice(0, Math.max(0, room))) {
      const id = crypto.randomUUID();
      const problem = checkImageFile(file);
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      setUploads((all) => [...all, { key: id, name: file.name, progress: 0, error: problem, preview }]);
      if (problem) continue;
      uploadProductImage(product.id, file, (p) => patch(id, { progress: p }))
        .then(() => refresh())
        .then(() => drop(id))
        .catch((e) => patch(id, { error: errorMessage(e) }));
    }
  };

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api<ProductImage[]>(`/admin/products/${product.id}/media/order`, { method: "PUT", body: { mediaIds: ids } }),
    onMutate: (ids) => {
      // Optimistic: show the new order immediately.
      qc.setQueryData<Product>(key, (p) => p && { ...p, media: ids.map((id, i) => ({ ...p.media.find((m) => m.id === id)!, position: i })) });
    },
    onError: (e) => { toast.notify(errorMessage(e), "error"); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/products/${product.id}/media/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.notify("Image deleted"); refresh(); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });
  const saveAlt = useMutation({
    mutationFn: ({ id, altText }: { id: string; altText: string }) =>
      api<ProductImage>(`/admin/products/${product.id}/media/${id}`, { method: "PATCH", body: { altText } }),
    onSuccess: () => { toast.notify("Description saved"); refresh(); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });

  const ids = images.map((m) => m.id);
  return (
    <Card>
      <CardHeader title="Images" description={`JPEG, PNG or WebP up to 5 MB. The first image is the main one. ${images.length}/${MAX_IMAGES}`} />
      <div
        className={cn("p-5", dragging && "bg-brand-soft/40")}
        onDragOver={(e) => { if (editable) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (editable) start(e.dataTransfer.files); }}
      >
        {images.length === 0 && uploads.length === 0 ? (
          <div className="flex flex-col items-center rounded-md border border-dashed border-border-strong px-4 py-8 text-center">
            <ImagePlus className="size-6 text-fg-subtle" aria-hidden />
            <p className="mt-2 text-sm font-medium">No images yet</p>
            <p className="text-[13px] text-fg-muted">{editable ? "Drop images here or choose files. Products with photos sell better." : "Images appear here once added."}</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {images.map((m, i) => (
              <li key={m.id} className="flex flex-col gap-2">
                <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-surface-muted">
                  <Image src={m.url} alt={m.altText ?? ""} fill sizes="(min-width: 640px) 200px, 45vw" className="object-cover" />
                  {i === 0 && <Badge tone="info" className="absolute top-2 left-2">Main</Badge>}
                </div>
                <AltText image={m} index={i} disabled={!editable} onSave={(altText) => saveAlt.mutate({ id: m.id, altText })} />
                {editable && (
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon" aria-label={`Move image ${i + 1} earlier`} disabled={i === 0 || reorder.isPending} onClick={() => reorder.mutate(move(ids, i, i - 1))}><ChevronLeft /></Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Move image ${i + 1} later`} disabled={i === images.length - 1 || reorder.isPending} onClick={() => reorder.mutate(move(ids, i, i + 1))}><ChevronRight /></Button>
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Delete image ${i + 1}`} loading={remove.isPending && remove.variables === m.id} onClick={() => remove.mutate(m.id)}><Trash2 /></Button>
                  </div>
                )}
              </li>
            ))}
            {uploads.map((u) => (
              <li key={u.key} className="flex flex-col gap-2">
                <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-surface-muted">
                  {/* A refused file may not be an image at all, so only uploads in progress show a preview. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not optimisable */}
                  {!u.error && <img src={u.preview} alt="" className="size-full object-cover opacity-60" />}
                  {u.error ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger-soft/90 p-2 text-center text-[13px] text-danger">
                      <TriangleAlert className="size-4" aria-hidden />{u.error}
                    </div>
                  ) : (
                    <div className="absolute inset-x-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-white/70" role="progressbar" aria-label={`Uploading ${u.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)}>
                      <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.max(5, u.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] text-fg-muted" title={u.name}>{u.error ? u.name : "Uploading…"}</p>
                  {u.error && (
                    <Button type="button" variant="ghost" size="icon" aria-label={`Dismiss ${u.name}`} onClick={() => drop(u.key)}><X /></Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {editable && images.length + uploads.filter((u) => !u.error).length < MAX_IMAGES && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              aria-label="Choose images to upload"
              onChange={(e) => { if (e.target.files) start(e.target.files); e.target.value = ""; }}
            />
            <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => inputRef.current?.click()}>
              <ImagePlus />Add images
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function AltText({ image, index, disabled, onSave }: { image: ProductImage; index: number; disabled: boolean; onSave: (v: string) => void }) {
  const [value, setValue] = React.useState(image.altText ?? "");
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">Description of image {index + 1}</label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        maxLength={250}
        placeholder="Describe the image"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { if (value.trim() !== (image.altText ?? "")) onSave(value); }}
        // This field sits inside the product form: Enter saves the description instead of submitting the product.
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        className="h-8 text-[13px]"
      />
    </div>
  );
}
