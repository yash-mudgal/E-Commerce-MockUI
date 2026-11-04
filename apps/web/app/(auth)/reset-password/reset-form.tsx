"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { api, ApiError, errorMessage } from "@/lib/api";
import { resetSchema, type ResetInput } from "@/lib/schemas";

export function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; expired: boolean } | null>(null);
  const form = useForm<ResetInput>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await api("/auth/password/reset", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.password) form.setError("password", { message: e.fieldErrors.password });
      else setError({ message: errorMessage(e), expired: e instanceof ApiError && e.code === "invalid-token" });
    }
  });

  if (!token)
    return (
      <Card className="p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">This link is incomplete</h1>
        <p className="mt-2 text-sm text-fg-muted">Open the link from your email again, or request a new one.</p>
        <Button asChild className="mt-6 w-full"><Link href="/forgot-password">Request a new link</Link></Button>
      </Card>
    );

  if (done)
    return (
      <Card className="p-6 sm:p-8">
        <CheckCircle2 className="size-8 text-success" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Password updated</h1>
        <p className="mt-2 text-sm text-fg-muted">For your security we signed you out everywhere. Sign in with your new password.</p>
        <Button asChild size="lg" className="mt-6 w-full"><Link href="/login">Sign in</Link></Button>
      </Card>
    );

  const { errors, isSubmitting } = form.formState;
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-fg-muted">This signs you out on every device.</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
        {error && (
          <Alert tone="danger" action={error.expired ? <Button asChild variant="secondary" size="sm"><Link href="/forgot-password">Request a new link</Link></Button> : undefined}>
            {error.message}
          </Alert>
        )}
        <Field label="New password" hint="At least 10 characters." error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" autoFocus {...form.register("password")} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          Update password
        </Button>
      </form>
    </Card>
  );
}
