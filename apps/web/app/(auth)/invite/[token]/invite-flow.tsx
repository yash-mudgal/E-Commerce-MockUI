"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Alert, Card, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { api, ApiError, errorMessage } from "@/lib/api";
import { meKey } from "@/lib/hooks";
import { acceptInviteSchema, type AcceptInviteInput } from "@/lib/schemas";
import type { InvitationPreview, Me } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function InviteFlow({ token }: { token: string }) {
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api<InvitationPreview>(`/auth/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });
  // Whether someone is already signed in here (without the admin redirect that useMe() performs).
  const session = useQuery({ queryKey: meKey, queryFn: () => api<Me>("/auth/me"), retry: false });

  if (preview.isPending || session.isPending) return <Card className="p-6"><Skeleton className="h-64" /></Card>;
  if (preview.isError)
    return (
      <Card className="p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">This invitation can&apos;t be used</h1>
        <p className="mt-2 text-sm text-fg-muted">{errorMessage(preview.error)}</p>
        <p className="mt-2 text-sm text-fg-muted">Invitations expire after 7 days and stop working once accepted, revoked or resent.</p>
        <Button asChild variant="secondary" className="mt-6 w-full"><Link href="/login">Go to sign in</Link></Button>
      </Card>
    );

  const inv = preview.data;
  const me = session.data;
  return (
    <Card className="p-6 sm:p-8">
      <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><Store className="size-5" aria-hidden /></span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Join {inv.storeName}</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {inv.invitedBy} invited <span className="font-medium text-fg">{inv.email}</span> to join as {inv.role === "Manager" ? "a Manager" : "Staff"}. The invitation expires on {formatDate(inv.expiresAt)}.
      </p>
      <div className="mt-6">
        {!inv.accountExists ? (
          me ? <SignedInAsSomeoneElse me={me} invitedEmail={inv.email} /> : <NewAccountForm token={token} email={inv.email} />
        ) : !me ? (
          <>
            <Alert tone="info">You already have a ShopMint account for this email. Sign in to accept.</Alert>
            <Button asChild size="lg" className="mt-4 w-full">
              <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in to accept</Link>
            </Button>
          </>
        ) : me.user.email.toLowerCase() !== inv.email.toLowerCase() ? (
          <SignedInAsSomeoneElse me={me} invitedEmail={inv.email} />
        ) : (
          <AcceptExisting token={token} />
        )}
      </div>
    </Card>
  );
}

function useAccepted() {
  const router = useRouter();
  const qc = useQueryClient();
  return (me: Me) => {
    qc.clear();
    qc.setQueryData(meKey, me);
    router.replace("/admin");
  };
}

function AcceptExisting({ token }: { token: string }) {
  const done = useAccepted();
  const accept = useMutation({
    mutationFn: () => api<Me>("/auth/invitations/accept", { method: "POST", body: { token } }),
    onSuccess: done,
  });
  return (
    <>
      {accept.isError && <Alert tone="danger" className="mb-4">{errorMessage(accept.error)}</Alert>}
      <Button size="lg" className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
        Accept invitation
      </Button>
    </>
  );
}

function SignedInAsSomeoneElse({ me, invitedEmail }: { me: Me; invitedEmail: string }) {
  const qc = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => qc.resetQueries(),
  });
  return (
    <>
      <Alert tone="warning">
        You&apos;re signed in as <span className="font-medium">{me.user.email}</span>, but this invitation is for <span className="font-medium">{invitedEmail}</span>. Sign out to continue.
      </Alert>
      <Button size="lg" variant="secondary" className="mt-4 w-full" loading={signOut.isPending} onClick={() => signOut.mutate()}>
        Sign out
      </Button>
    </>
  );
}

function NewAccountForm({ token, email }: { token: string; email: string }) {
  const done = useAccepted();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<AcceptInviteInput>({ resolver: zodResolver(acceptInviteSchema), defaultValues: { name: "", password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async ({ name, password }) => {
    setError(null);
    try {
      done(await api<Me>("/auth/invitations/accept", { method: "POST", body: { token, name, password } }));
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length)
        for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof AcceptInviteInput, { message: m });
      else setError(errorMessage(e));
    }
  });

  const { errors, isSubmitting } = form.formState;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="text-sm text-fg-muted">Create your login to accept.</p>
      {/* Lets password managers save the login against the right address. */}
      <input type="email" value={email} autoComplete="username" readOnly hidden />
      <Field label="Your name" error={errors.name?.message}>
        <Input autoComplete="name" autoFocus {...form.register("name")} />
      </Field>
      <Field label="Password" hint="At least 10 characters." error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Field label="Confirm password" error={errors.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
        Join store
      </Button>
    </form>
  );
}
