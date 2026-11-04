"use client";

import { useMutation } from "@tanstack/react-query";
import { MailX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/display";
import { api, errorMessage } from "@/lib/api";

/**
 * Opt-out from the store's marketing emails. It takes a click (a POST), not just opening the link, so email
 * scanners that prefetch links can't unsubscribe people by accident.
 */
export function Unsubscribe() {
  const token = useSearchParams().get("token") ?? "";
  const run = useMutation({ mutationFn: () => api("/storefront/account/unsubscribe", { method: "POST", body: { token } }) });
  if (run.isSuccess)
    return (
      <div className="text-center" role="status">
        <MailX className="mx-auto size-10 text-fg-subtle" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">You&apos;re unsubscribed</h1>
        <p className="mt-2 text-sm text-fg-muted">You won&apos;t get marketing emails from this store any more. Emails about your orders still arrive.</p>
        <Button asChild variant="secondary" className="mt-6"><Link href="/">Back to the store</Link></Button>
      </div>
    );
  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold">Unsubscribe from this store&apos;s emails?</h1>
      <p className="mt-2 text-sm text-fg-muted">You&apos;ll stop getting cart reminders and offers. Emails about your orders still arrive.</p>
      {!token && <Alert tone="danger" className="mt-4">This link is incomplete. Use the link from the email, or sign in and change your email settings.</Alert>}
      {run.isError && <Alert tone="danger" className="mt-4">{errorMessage(run.error)}</Alert>}
      <Button className="mt-6" disabled={!token} loading={run.isPending} onClick={() => run.mutate()}>Unsubscribe</Button>
    </div>
  );
}
