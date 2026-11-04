"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { forgotSchema, type ForgotInput } from "@/lib/schemas";

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<ForgotInput>({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await api("/auth/password/forgot", { method: "POST", body: { email } });
      setSentTo(email);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  if (sentTo)
    return (
      <Card className="p-6 sm:p-8">
        <MailCheck className="size-8 text-brand" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-fg-muted">
          If an account exists for <span className="font-medium text-fg">{sentTo}</span>, we&apos;ve sent a link to reset the password. It works once and expires in 1 hour.
        </p>
        <p className="mt-4 text-sm text-fg-muted">Didn&apos;t get it? Check your spam folder, or wait a minute and try again.</p>
        <Button asChild variant="secondary" className="mt-6 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </Card>
    );

  const { errors, isSubmitting } = form.formState;
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-fg-muted">Enter the email you sign in with and we&apos;ll send you a reset link.</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register("email")} />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
