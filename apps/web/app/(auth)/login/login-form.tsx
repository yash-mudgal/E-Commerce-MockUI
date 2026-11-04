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
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const me = await api<Me>("/auth/login", { method: "POST", body: values });
      qc.setQueryData(meKey, me);
      const fallback = me.tenant ? "/admin" : me.user.isPlatformAdmin ? "/platform" : "/admin";
      router.replace(safeNext(params.get("next"), fallback));
    } catch (e) {
      setError(errorMessage(e));
    }
  });

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
