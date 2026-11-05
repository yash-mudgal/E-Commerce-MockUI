"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

/**
 * Confirm or unsubscribe from a newsletter link. It waits for a click (email scanners follow links automatically, so
 * opening the page alone changes nothing).
 */
export function NewsletterToken({ action }: { action: "confirm" | "unsubscribe" }) {
  const token = useSearchParams().get("token") ?? "";
  const run = useMutation({ mutationFn: () => api(`/storefront/newsletter/${action}`, { method: "POST", body: { token } }) });
  const confirm = action === "confirm";
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center sm:px-6">
      <h1 className="font-display text-3xl tracking-tight sm:text-4xl">{confirm ? "Confirm your subscription" : "Unsubscribe"}</h1>
      {run.isSuccess ? (
        <>
          <p className="mt-4 text-fg-muted" role="status">{confirm ? "You're subscribed. Thanks for joining!" : "You won't get the newsletter any more."}</p>
          <Button asChild className="mt-8"><Link href="/">Back to the store</Link></Button>
        </>
      ) : (
        <>
          <p className="mt-4 text-fg-muted">{confirm ? "Confirm to start receiving the store's newsletter." : "Stop receiving the store's newsletter at this address?"}</p>
          <Button className="mt-8" loading={run.isPending} disabled={!token} onClick={() => run.mutate()}>{confirm ? "Confirm subscription" : "Unsubscribe"}</Button>
          {(run.isError || !token) && <p className="mt-4 text-sm text-danger" role="alert">{token ? errorMessage(run.error) : "This link is incomplete. Open it again from the email."}</p>}
        </>
      )}
    </div>
  );
}
