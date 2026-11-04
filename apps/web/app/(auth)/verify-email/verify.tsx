"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/display";
import { api, errorMessage } from "@/lib/api";
import { meKey } from "@/lib/hooks";

/**
 * Confirmation needs a click rather than happening on page load, so link scanners and previews in email
 * clients can't use up the token.
 */
export function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: () => api("/auth/email/verify", { method: "POST", body: { token } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });

  if (verify.isSuccess)
    return (
      <Card className="p-6 sm:p-8">
        <CheckCircle2 className="size-8 text-success" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Email confirmed</h1>
        <p className="mt-2 text-sm text-fg-muted">Thanks. We&apos;ll use this address for order alerts and account notices.</p>
        <Button asChild size="lg" className="mt-6 w-full"><Link href="/admin">Go to your dashboard</Link></Button>
      </Card>
    );

  return (
    <Card className="p-6 sm:p-8">
      <MailCheck className="size-8 text-brand" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Confirm your email address</h1>
      {!token ? (
        <Alert tone="danger" className="mt-4">This link is incomplete. Open it from your email again, or send a new one from your account page.</Alert>
      ) : (
        <>
          <p className="mt-2 text-sm text-fg-muted">Confirm that this address belongs to you.</p>
          {verify.isError && (
            <Alert tone="danger" className="mt-4">
              {errorMessage(verify.error)} You can send a new link from <Link href="/admin/account" className="font-medium underline">your account page</Link>.
            </Alert>
          )}
          <Button size="lg" className="mt-6 w-full" loading={verify.isPending} onClick={() => verify.mutate()}>
            Confirm email
          </Button>
        </>
      )}
    </Card>
  );
}
