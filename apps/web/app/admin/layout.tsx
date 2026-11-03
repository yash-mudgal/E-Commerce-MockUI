import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/shell";
import { Providers } from "@/components/providers";

export const metadata: Metadata = { title: { default: "Dashboard", template: "%s · ShopMint admin" }, robots: { index: false } };

/** Static frame rendered instantly while the session-aware shell streams in. */
function ShellFallback() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-64 shrink-0 bg-sidebar lg:block" />
      <div className="flex-1 px-4 py-8 sm:px-6 lg:px-10">
        <div className="h-7 w-56 animate-pulse rounded bg-surface-muted" />
        <div className="mt-8 h-64 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Suspense fallback={<ShellFallback />}>
        <AdminShell>{children}</AdminShell>
      </Suspense>
    </Providers>
  );
}
