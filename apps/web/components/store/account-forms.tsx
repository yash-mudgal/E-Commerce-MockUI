"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { api, ApiError, errorMessage } from "@/lib/api";
import { forgotSchema, loginSchema, resetSchema, safeNext, shopperSignupSchema, type ForgotInput, type LoginInput, type ResetInput, type ShopperSignupInput } from "@/lib/schemas";
import { cartKey, shopperKey } from "@/lib/shop";
import type { Shopper } from "@/lib/types";

/** Narrow centred card used by the storefront's account pages. */
export function AccountCard({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function useSignedIn() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  return (shopper: Shopper) => {
    qc.setQueryData(shopperKey, shopper);
    // Signing in may have merged a guest cart into the account's cart.
    qc.invalidateQueries({ queryKey: cartKey });
    router.replace(safeNext(params.get("next"), "/account"));
  };
}

export function ShopperLoginForm() {
  const done = useSignedIn();
  const params = useSearchParams();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try { done(await api<Shopper>("/storefront/account/login", { method: "POST", body: v })); }
    catch (e) { setError(errorMessage(e)); }
  });
  const { errors, isSubmitting } = form.formState;
  const next = params.get("next");
  return (
    <AccountCard title="Sign in" description="Your cart and addresses, on every device.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="email" autoFocus {...form.register("email")} /></Field>
        <div>
          <Field label="Password" error={errors.password?.message}><Input type="password" autoComplete="current-password" {...form.register("password")} /></Field>
          <p className="mt-1.5 text-right text-[13px]"><Link href="/account/forgot-password" className="font-medium text-brand hover:underline">Forgot password?</Link></p>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Sign in</Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-muted">
        New here? <Link href={`/account/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-brand hover:underline">Create an account</Link>
      </p>
    </AccountCard>
  );
}

export function ShopperSignupForm({ storeName }: { storeName: string }) {
  const done = useSignedIn();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<ShopperSignupInput>({ resolver: zodResolver(shopperSignupSchema), defaultValues: { name: "", email: "", password: "", marketingOptIn: false } });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try { done(await api<Shopper>("/storefront/account/signup", { method: "POST", body: v })); }
    catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof ShopperSignupInput, { message: m });
      else setError(errorMessage(e));
    }
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <AccountCard title={`Create your ${storeName} account`} description="Save your cart and addresses for faster ordering.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error} {error.includes("Sign in") && <Link href="/account/login" className="font-medium underline">Sign in</Link>}</Alert>}
        <Field label="Your name" error={errors.name?.message}><Input autoComplete="name" autoFocus {...form.register("name")} /></Field>
        <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="email" {...form.register("email")} /></Field>
        <Field label="Password" hint="At least 10 characters." error={errors.password?.message}><Input type="password" autoComplete="new-password" {...form.register("password")} /></Field>
        <label className="flex items-start gap-2 text-sm text-fg-muted">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" {...form.register("marketingOptIn")} />
          <span>Email me about new arrivals and offers from {storeName}. You can change this any time.</span>
        </label>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-muted">
        Already have an account? <Link href="/account/login" className="font-medium text-brand hover:underline">Sign in</Link>
      </p>
    </AccountCard>
  );
}

export function ShopperForgotForm() {
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<ForgotInput>({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });
  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try { await api("/storefront/account/password/forgot", { method: "POST", body: { email } }); setSentTo(email); }
    catch (e) { setError(errorMessage(e)); }
  });
  if (sentTo)
    return (
      <AccountCard title="Check your email">
        <MailCheck className="size-8 text-brand" aria-hidden />
        <p className="mt-3 text-sm text-fg-muted">If an account exists for <span className="font-medium text-fg">{sentTo}</span>, we&apos;ve sent a link to reset the password. It works once and expires in 1 hour.</p>
        <Button asChild variant="secondary" className="mt-6 w-full"><Link href="/account/login">Back to sign in</Link></Button>
      </AccountCard>
    );
  const { errors, isSubmitting } = form.formState;
  return (
    <AccountCard title="Reset your password" description="We'll email you a link to choose a new one.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="email" autoFocus {...form.register("email")} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Send reset link</Button>
      </form>
    </AccountCard>
  );
}

export function ShopperResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<ResetInput>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirm: "" } });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try { await api("/storefront/account/password/reset", { method: "POST", body: { token, password } }); setDone(true); }
    catch (e) {
      if (e instanceof ApiError && e.fieldErrors.password) form.setError("password", { message: e.fieldErrors.password });
      else setError(errorMessage(e));
    }
  });
  if (done)
    return (
      <AccountCard title="Password updated">
        <CheckCircle2 className="size-8 text-success" aria-hidden />
        <p className="mt-3 text-sm text-fg-muted">You&apos;ve been signed out on other devices. Sign in with your new password.</p>
        <Button asChild size="lg" className="mt-6 w-full"><Link href="/account/login">Sign in</Link></Button>
      </AccountCard>
    );
  const { errors, isSubmitting } = form.formState;
  return (
    <AccountCard title="Choose a new password">
      {!token ? (
        <Alert tone="danger">This link is incomplete. <Link href="/account/forgot-password" className="font-medium underline">Request a new one</Link>.</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {error && <Alert tone="danger">{error} <Link href="/account/forgot-password" className="font-medium underline">Request a new link</Link></Alert>}
          <Field label="New password" hint="At least 10 characters." error={errors.password?.message}><Input type="password" autoComplete="new-password" autoFocus {...form.register("password")} /></Field>
          <Field label="Confirm new password" error={errors.confirm?.message}><Input type="password" autoComplete="new-password" {...form.register("confirm")} /></Field>
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Update password</Button>
        </form>
      )}
    </AccountCard>
  );
}
