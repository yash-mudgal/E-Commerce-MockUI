"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { BRAND_PRESETS, contrastWithWhite } from "@/lib/color";
import { can, meKey, useMe } from "@/lib/hooks";
import { storeSchema, type StoreInput } from "@/lib/schemas";
import type { Store } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const store = useQuery({ queryKey: ["store"], queryFn: () => api<Store>("/admin/store") });
  if (store.isPending) return <><PageHeader title="Store settings" /><Skeleton className="h-96" /></>;
  if (store.isError) return <><PageHeader title="Store settings" /><Alert tone="danger" title="Couldn't load settings">{errorMessage(store.error)}</Alert></>;
  return <SettingsForm store={store.data} />;
}

function SettingsForm({ store }: { store: Store }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const editable = can(me.data, "settings.write");
  const form = useForm<StoreInput, unknown, ReturnType<typeof storeSchema.parse>>({
    resolver: zodResolver(storeSchema),
    defaultValues: {
      name: store.name, legalName: store.legalName ?? "", gstin: store.gstin ?? "", tagline: store.tagline ?? "",
      supportEmail: store.supportEmail ?? "", brandColor: store.brandColor, lowStockThreshold: String(store.lowStockThreshold),
    },
  });
  const { register, formState, setError, watch, setValue, reset } = form;
  const color = watch("brandColor");
  const contrast = contrastWithWhite(color);

  const save = useMutation({
    mutationFn: (body: ReturnType<typeof storeSchema.parse>) => api<Store>("/admin/store", { method: "PATCH", body }),
    onSuccess: (saved) => {
      qc.setQueryData(["store"], saved);
      qc.invalidateQueries({ queryKey: meKey });
      reset(form.getValues());
      toast.notify("Settings saved");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) setError(k as keyof StoreInput, { message: m });
      else toast.notify(errorMessage(e), "error");
    },
  });

  const errors = formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
      <PageHeader title="Store settings" description={`Your storefront: ${store.host}`} actions={editable && <Button type="submit" loading={save.isPending} disabled={!formState.isDirty}>Save changes</Button>} />
      {!editable && <Alert tone="info" className="mb-6">Only the store owner can change these settings.</Alert>}
      <fieldset disabled={!editable} className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Store details" description="Shown on your storefront and invoices." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Store name" error={errors.name?.message} className="sm:col-span-2"><Input {...register("name")} /></Field>
              <Field label="Tagline" optional error={errors.tagline?.message} className="sm:col-span-2" hint="One line under your store name on the home page.">
                <Input {...register("tagline")} maxLength={200} />
              </Field>
              <Field label="Support email" optional error={errors.supportEmail?.message}><Input type="email" {...register("supportEmail")} /></Field>
              <Field label="Low-stock alert at" error={errors.lowStockThreshold?.message} hint="Units per variant"><Input inputMode="numeric" {...register("lowStockThreshold")} /></Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Tax registration" description="Required for GST tax invoices." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Legal business name" optional error={errors.legalName?.message}><Input {...register("legalName")} /></Field>
              <Field label="GSTIN" optional error={errors.gstin?.message} hint="Your state is derived from the first two digits."><Input className="font-mono uppercase" maxLength={15} {...register("gstin")} /></Field>
            </div>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Brand colour" description="Used for buttons and links on your storefront." />
          <div className="flex flex-col gap-4 p-5">
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Preset colours">
              {BRAND_PRESETS.map(([name, hex]) => (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={color.toLowerCase() === hex}
                  aria-label={name}
                  title={name}
                  onClick={() => setValue("brandColor", hex, { shouldDirty: true, shouldValidate: true })}
                  className={cn("grid aspect-square place-items-center rounded-md ring-offset-2 transition", color.toLowerCase() === hex && "ring-2 ring-fg")}
                  style={{ background: hex }}
                >
                  {color.toLowerCase() === hex && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
            <div className="flex items-start gap-2">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#4f46e5"} onChange={(e) => setValue("brandColor", e.target.value, { shouldDirty: true, shouldValidate: true })} className="mt-[26px] h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border-strong bg-surface p-1" aria-label="Pick a colour" />
              <Field label="Custom hex" error={errors.brandColor?.message} className="flex-1">
                <Input className="font-mono" {...register("brandColor")} />
              </Field>
            </div>
            <div className="rounded-md border border-border p-4">
              <p className="mb-3 text-xs font-medium tracking-wide text-fg-muted uppercase">Preview</p>
              <span className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium text-white" style={{ background: color }}>Add to cart</span>
              <p className={cn("mt-3 text-[13px]", contrast >= 4.5 ? "text-success" : "text-danger")}>
                Contrast {contrast.toFixed(1)}:1 {contrast >= 4.5 ? "meets accessibility guidelines." : "is too low for white text. Pick a darker shade."}
              </p>
            </div>
          </div>
        </Card>
      </fieldset>
    </form>
  );
}
