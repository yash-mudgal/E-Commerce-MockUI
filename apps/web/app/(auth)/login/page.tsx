import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { Card, Skeleton } from "@/components/ui/display";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<Card className="p-6"><Skeleton className="h-64" /></Card>}>
      <LoginForm />
    </Suspense>
  );
}
