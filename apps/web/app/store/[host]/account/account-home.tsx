"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, MapPin, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Skeleton } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { addressSchema, changePasswordSchema, profileSchema, type AddressInput, type AddressOutput, type ChangePasswordInput, type ProfileInput } from "@/lib/schemas";
import { cartKey, INDIAN_STATES, shopperKey, useShopper } from "@/lib/shop";
import type { Address, Shopper } from "@/lib/types";

const addressesKey = ["shopper-addresses"] as const;

export function AccountHome() {
  const shopper = useShopper();
  const router = useRouter();
  const qc = useQueryClient();
  // Set while signing out, so clearing the session goes home instead of bouncing to the sign-in page.
  const leaving = React.useRef(false);
  React.useEffect(() => {
    if (shopper.isSuccess && !shopper.data && !leaving.current) router.replace("/account/login?next=/account");
  }, [shopper.isSuccess, shopper.data, router]);
  const signOut = useMutation({
    mutationFn: () => { leaving.current = true; return api("/storefront/account/logout", { method: "POST" }); },
    onSettled: () => { router.replace("/"); qc.setQueryData(shopperKey, null); qc.invalidateQueries({ queryKey: cartKey }); },
  });

  if (shopper.isError)
    return <div className="mx-auto max-w-4xl px-4 py-10"><Alert tone="danger" title="Couldn't load your account">{errorMessage(shopper.error)}</Alert></div>;
  if (!shopper.data)
    return <div className="mx-auto max-w-4xl px-4 py-10"><Skeleton className="h-64" /></div>;
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hello, {shopper.data.name.split(" ")[0]}</h1>
          <p className="text-sm text-fg-muted">{shopper.data.email}</p>
        </div>
        <Button variant="secondary" loading={signOut.isPending} onClick={() => signOut.mutate()}><LogOut />Sign out</Button>
      </div>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Profile shopper={shopper.data} />
        <ChangePassword />
        <div className="md:col-span-2"><Addresses /></div>
      </div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Profile({ shopper }: { shopper: Shopper }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: shopper.name, phone: shopper.phone ?? "", marketingOptIn: shopper.marketingOptIn },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const saved = await api<Shopper>("/storefront/account/me", { method: "PATCH", body: { ...v, phone: v.phone || null } });
      qc.setQueryData(shopperKey, saved);
      form.reset({ name: saved.name, phone: saved.phone ?? "", marketingOptIn: saved.marketingOptIn });
      toast.notify("Details saved");
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof ProfileInput, { message: m });
      else toast.notify(errorMessage(e), "error");
    }
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  return (
    <Section title="Your details">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Name" error={errors.name?.message}><Input autoComplete="name" {...form.register("name")} /></Field>
        <Field label="Mobile" optional error={errors.phone?.message}><Input type="tel" inputMode="tel" autoComplete="tel" {...form.register("phone")} /></Field>
        <label className="flex items-start gap-2 text-sm text-fg-muted">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" {...form.register("marketingOptIn")} />
          Email me about new arrivals and offers
        </label>
        <div><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save</Button></div>
      </form>
    </Section>
  );
}

function ChangePassword() {
  const toast = useToast();
  const form = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });
  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await api("/storefront/account/password/change", { method: "POST", body: { currentPassword, newPassword } });
      form.reset();
      toast.notify("Password changed. Other devices have been signed out.");
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof ChangePasswordInput, { message: m });
      else toast.notify(errorMessage(e), "error");
    }
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <Section title="Password">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Current password" error={errors.currentPassword?.message}><Input type="password" autoComplete="current-password" {...form.register("currentPassword")} /></Field>
        <Field label="New password" hint="At least 10 characters." error={errors.newPassword?.message}><Input type="password" autoComplete="new-password" {...form.register("newPassword")} /></Field>
        <Field label="Confirm new password" error={errors.confirm?.message}><Input type="password" autoComplete="new-password" {...form.register("confirm")} /></Field>
        <div><Button type="submit" variant="secondary" loading={isSubmitting}>Change password</Button></div>
      </form>
    </Section>
  );
}

function Addresses() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: addressesKey, queryFn: () => api<Address[]>("/storefront/account/addresses") });
  const [editing, setEditing] = React.useState<Address | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/storefront/account/addresses/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.notify("Address removed"); qc.invalidateQueries({ queryKey: addressesKey }); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });
  return (
    <Section title="Delivery addresses" action={<Button size="sm" variant="secondary" onClick={() => setEditing("new")}><Plus />Add address</Button>}>
      {list.isPending ? <Skeleton className="h-24" /> : list.isError ? <Alert tone="danger">{errorMessage(list.error)}</Alert> : list.data.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted"><MapPin className="size-4" aria-hidden />No saved addresses yet. Add one to check out faster.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.data.map((a) => (
            <li key={a.id} className="rounded-md border border-border p-4 text-sm">
              <p className="flex items-center gap-2 font-medium">{a.name}{a.isDefault && <Badge tone="info">Default</Badge>}</p>
              <address className="mt-1 text-fg-muted not-italic">
                {a.line1}{a.line2 && <>, {a.line2}</>}<br />{a.city}, {a.stateName} {a.pincode}<br />{a.phone}
              </address>
              <div className="mt-3 flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>Edit<span className="sr-only"> address for {a.name}, {a.city}</span></Button>
                <Button variant="ghost" size="sm" loading={remove.isPending && remove.variables === a.id} onClick={() => remove.mutate(a.id)}>Remove<span className="sr-only"> address for {a.name}, {a.city}</span></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <AddressDialog address={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function AddressDialog({ address, onClose }: { address: Address | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<AddressInput, unknown, AddressOutput>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      name: address?.name ?? "", phone: address?.phone ?? "", line1: address?.line1 ?? "", line2: address?.line2 ?? "", city: address?.city ?? "",
      stateCode: address?.stateCode ?? "", pincode: address?.pincode ?? "", isDefault: address?.isDefault ?? false,
    },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api(address ? `/storefront/account/addresses/${address.id}` : "/storefront/account/addresses", {
        method: address ? "PUT" : "POST", body: { ...v, line2: v.line2 || null },
      });
      toast.notify(address ? "Address saved" : "Address added");
      qc.invalidateQueries({ queryKey: addressesKey });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof AddressInput, { message: m });
      else setError(errorMessage(e));
    }
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={address ? "Edit address" : "Add an address"} className="max-w-lg"
      footer={<><Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="address-form" loading={isSubmitting}>Save address</Button></>}>
      <form id="address-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Full name" error={errors.name?.message}><Input autoComplete="name" autoFocus {...form.register("name")} /></Field>
        <Field label="Mobile" error={errors.phone?.message}><Input type="tel" inputMode="tel" autoComplete="tel" {...form.register("phone")} /></Field>
        <Field label="House, building, street" error={errors.line1?.message} className="sm:col-span-2"><Input autoComplete="address-line1" {...form.register("line1")} /></Field>
        <Field label="Area, landmark" optional error={errors.line2?.message} className="sm:col-span-2"><Input autoComplete="address-line2" {...form.register("line2")} /></Field>
        <Field label="City" error={errors.city?.message}><Input autoComplete="address-level2" {...form.register("city")} /></Field>
        <Field label="PIN code" error={errors.pincode?.message}><Input inputMode="numeric" autoComplete="postal-code" maxLength={6} {...form.register("pincode")} /></Field>
        <Field label="State" error={errors.stateCode?.message} className="sm:col-span-2">
          <Select autoComplete="address-level1" {...form.register("stateCode")}>
            <option value="">Choose a state</option>
            {INDIAN_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </Select>
        </Field>
        {!address?.isDefault && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" {...form.register("isDefault")} />Use as my default address
          </label>
        )}
      </form>
    </Dialog>
  );
}
