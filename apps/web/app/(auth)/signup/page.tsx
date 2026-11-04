"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { api, ApiError, errorMessage } from "@/lib/api";
import { meKey } from "@/lib/hooks";
import { signupSchema, type SignupInput } from "@/lib/schemas";
import type { Me } from "@/lib/types";
import { slugify } from "@/lib/utils";

const STORE_DOMAIN = process.env.NEXT_PUBLIC_STORE_DOMAIN ?? "shopmint.in";

export default function SignupPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [subTouched, setSubTouched] = React.useState(false);
  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", storeName: "", subdomain: "" },
  });
  const sub = form.watch("subdomain");

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const me = await api<Me>("/auth/signup", { method: "POST", body: values });
      qc.setQueryData(meKey, me);
      router.replace("/admin");
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) {
        for (const [field, message] of Object.entries(e.fieldErrors)) form.setError(field as keyof SignupInput, { message });
      } else setError(errorMessage(e));
    }
  });

  const { errors, isSubmitting } = form.formState;
  const storeName = form.register("storeName");
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Create your store</h1>
      <p className="mt-1 text-sm text-fg-muted">14-day free trial. No card needed.</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Your name" error={errors.name?.message}>
          <Input autoComplete="name" autoFocus {...form.register("name")} />
        </Field>
        <Field label="Work email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field label="Password" hint="At least 10 characters." error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <Field label="Store name" error={errors.storeName?.message}>
          <Input
            {...storeName}
            onChange={(e) => {
              storeName.onChange(e);
              if (!subTouched) form.setValue("subdomain", slugify(e.target.value).slice(0, 30));
            }}
          />
        </Field>
        <Field
          label="Store address"
          error={errors.subdomain?.message}
          hint={
            <>
              Your store will live at <span className="font-medium text-fg">{sub || "yourstore"}.{STORE_DOMAIN}</span>. You can add your own domain later.
            </>
          }
        >
          <Input autoCapitalize="none" spellCheck={false} {...form.register("subdomain", { onChange: () => setSubTouched(true) })} />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
          Create store
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-muted">
        Already selling with us?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
