import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Skeleton } from "@/components/ui/display";
import { ResetPasswordForm } from "./reset-form";

// The URL carries a one-time token: never send it to other sites in the Referer header.
export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer", robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Card className="p-6"><Skeleton className="h-56" /></Card>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
