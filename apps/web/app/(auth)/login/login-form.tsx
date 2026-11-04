"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { meKey } from "@/lib/hooks";
import { loginSchema, safeNext, type LoginInput } from "@/lib/schemas";
import type { Me } from "@/lib/types";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const finish = (me: Me) => {
    qc.setQueryData(meKey, me);
    const fallback = me.tenant ? "/admin" : me.user.isPlatformAdmin ? "/platform" : "/admin";
    router.replace(safeNext(params.get("next"), fallback));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<Me | { mfaRequired: true; challenge: string }>("/auth/login", { method: "POST", body: values });
      if ("mfaRequired" in res) setChallenge(res.challenge);
      else finish(res);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  if (challenge) return <CodeStep challenge={challenge} onDone={finish} onRestart={() => { setChallenge(null); form.setValue("password", ""); }} />;

  const { errors, isSubmitting } = form.formState;
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Sign in to your store</h1>
      <p className="mt-1 text-sm text-fg-muted">Welcome back. Enter your details to continue.</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register("email")} />
        </Field>
        <div>
          <Field label="Password" error={errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...form.register("password")} />
          </Field>
          <p className="mt-1.5 text-right text-[13px]">
            <Link href="/forgot-password" className="font-medium text-brand hover:underline">
              Forgot password?
            </Link>
          </p>
        </div>
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-muted">
        New to ShopMint?{" "}
        <Link href="/signup" className="font-medium text-brand hover:underline">
          Create a store
        </Link>
      </p>
    </Card>
  );
}

/** Second step for accounts with two-step verification: a code from the authenticator app, or a recovery code. */
function CodeStep({ challenge, onDone, onRestart }: { challenge: string; onDone: (me: Me) => void; onRestart: () => void }) {
  const [code, setCode] = React.useState("");
  const [recovery, setRecovery] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onDone(await api<Me>("/auth/mfa/verify", { method: "POST", body: { challenge, code } }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Two-step verification</h1>
      <p className="mt-1 text-sm text-fg-muted">{recovery ? "Enter one of the recovery codes you saved. Each works once." : "Enter the 6-digit code from your authenticator app."}</p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={recovery ? "Recovery code" : "Code"}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="one-time-code"
            inputMode={recovery ? "text" : "numeric"} maxLength={recovery ? 11 : 7} className="font-mono tracking-widest" />
        </Field>
        <Button type="submit" size="lg" loading={busy} disabled={code.trim().length < 6} className="w-full">Verify</Button>
      </form>
      <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="font-medium text-brand hover:underline" onClick={() => { setRecovery(!recovery); setCode(""); setError(null); }}>
          {recovery ? "Use the authenticator app" : "Use a recovery code"}
        </button>
        <button type="button" className="text-fg-muted hover:underline" onClick={onRestart}>Start again</button>
      </div>
    </Card>
  );
}
