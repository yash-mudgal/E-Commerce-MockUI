import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Skeleton } from "@/components/ui/display";
import { VerifyEmail } from "./verify";

export const metadata: Metadata = { title: "Confirm your email", referrer: "no-referrer", robots: { index: false } };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Card className="p-6"><Skeleton className="h-40" /></Card>}>
      <VerifyEmail />
    </Suspense>
  );
}
