import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/display";
import { ApiError } from "@/lib/api";

/** Shown instead of platform data when the session hasn't passed two-step verification. */
export function isMfaRequired(e: unknown): boolean {
  return e instanceof ApiError && e.code === "mfa-required";
}

export function MfaRequiredCard() {
  return (
    <Card>
      <EmptyState icon={ShieldCheck} title="Turn on two-step verification" description="Platform tools need a sign-in with an authenticator code. Turn it on under Your account; you stay signed in."
        action={<Button asChild><Link href="/admin/account#security">Set up two-step verification</Link></Button>} />
    </Card>
  );
}
