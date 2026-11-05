"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";

/** Footer newsletter sign-up. Double opt-in: we email a confirmation link, and say the same thing whoever signs up. */
export function NewsletterSignup({ storeName }: { storeName: string }) {
  const [email, setEmail] = React.useState("");
  const send = useMutation({ mutationFn: () => api("/storefront/newsletter", { method: "POST", body: { email } }) });
  return (
    <div>
      <h2 id="footer-news" className="text-xs font-semibold tracking-[0.14em] text-fg uppercase">Newsletter</h2>
      <p className="mt-4 text-sm text-fg-muted">New arrivals and offers from {storeName}. Unsubscribe any time.</p>
      {send.isSuccess ? (
        <p className="mt-4 text-sm" role="status">Almost there: check your inbox and confirm your subscription.</p>
      ) : (
        <form className="mt-4 flex max-w-sm" onSubmit={(e) => { e.preventDefault(); send.mutate(); }} aria-labelledby="footer-news">
          <label htmlFor="newsletter-email" className="sr-only">Newsletter sign-up</label>
          <input id="newsletter-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" autoComplete="email"
            className="h-11 min-w-0 flex-1 rounded-l-[var(--radius-control)] border border-r-0 border-border-strong bg-surface px-3 text-sm" />
          <button type="submit" disabled={send.isPending} aria-label="Subscribe"
            className="grid h-11 w-12 place-items-center rounded-r-[var(--radius-control)] bg-fg text-surface hover:bg-fg/90 disabled:opacity-60">
            <ArrowRight className="size-4" aria-hidden />
          </button>
        </form>
      )}
      {send.isError && <p className="mt-2 text-sm text-danger" role="alert">{errorMessage(send.error)}</p>}
    </div>
  );
}
