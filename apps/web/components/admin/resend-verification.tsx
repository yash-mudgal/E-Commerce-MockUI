"use client";

import { useMutation } from "@tanstack/react-query";
import { MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";

export function ResendVerification({ email, compact }: { email: string; compact?: boolean }) {
  const toast = useToast();
  const resend = useMutation({
    mutationFn: () => api("/auth/email/resend", { method: "POST" }),
    onSuccess: () => toast.notify(`We sent a new confirmation link to ${email}`),
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });
  if (compact)
    return (
      <Button variant="link" size="sm" className="text-inherit underline" loading={resend.isPending} onClick={() => resend.mutate()}>
        Resend the link
      </Button>
    );
  return (
    <div className="flex items-start gap-3 border-t border-border p-5 text-sm">
      <MailWarning className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div>
        <p>Confirm your email so you get order alerts and account notices. Your store can&apos;t launch until the owner&apos;s email is confirmed.</p>
        <Button variant="secondary" size="sm" className="mt-3" loading={resend.isPending} onClick={() => resend.mutate()}>
          Send a new confirmation link
        </Button>
      </div>
    </div>
  );
}
