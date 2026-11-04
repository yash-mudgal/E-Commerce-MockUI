"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { ResendVerification } from "@/components/admin/resend-verification";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/schemas";

export default function AccountPage() {
  const me = useMe();
  if (!me.data) return <><PageHeader title="Your account" /><Skeleton className="h-64" /></>;
  const user = me.data.user;
  return (
    <>
      <PageHeader title="Your account" description="Your personal login. It's separate from the store's settings." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title="Profile" />
          <dl className="grid gap-4 p-5 text-sm">
            <div><dt className="text-fg-muted">Name</dt><dd className="mt-0.5 font-medium">{user.name}</dd></div>
            <div>
              <dt className="text-fg-muted">Email</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-2 font-medium break-all">
                {user.email}
                {user.emailVerified ? <Badge tone="success"><CheckCircle2 className="size-3" />Confirmed</Badge> : <Badge tone="warning">Not confirmed</Badge>}
              </dd>
            </div>
            {me.data.role && me.data.tenant && (
              <div><dt className="text-fg-muted">Role in {me.data.tenant.name}</dt><dd className="mt-0.5 font-medium">{me.data.role}</dd></div>
            )}
          </dl>
          {!user.emailVerified && <ResendVerification email={user.email} />}
        </Card>
        <ChangePassword />
      </div>
    </>
  );
}

function ChangePassword() {
  const toast = useToast();
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await api("/auth/password/change", { method: "POST", body: { currentPassword, newPassword } });
      form.reset();
      toast.notify("Password changed. Other devices have been signed out.");
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof ChangePasswordInput, { message: m });
      else toast.notify(errorMessage(e), "error");
    }
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Change password" description="You stay signed in here. Every other device is signed out." />
      <form onSubmit={onSubmit} noValidate className="grid gap-4 p-5 sm:max-w-md">
        <Field label="Current password" error={errors.currentPassword?.message}>
          <Input type="password" autoComplete="current-password" {...form.register("currentPassword")} />
        </Field>
        <Field label="New password" hint="At least 10 characters." error={errors.newPassword?.message}>
          <Input type="password" autoComplete="new-password" {...form.register("newPassword")} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
        </Field>
        <div><Button type="submit" loading={isSubmitting}>Change password</Button></div>
      </form>
    </Card>
  );
}
