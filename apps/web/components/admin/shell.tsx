"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Boxes, ExternalLink, History, LayoutDashboard, LogOut, Menu, Package, Rocket, Settings, Shapes, ShieldCheck, Store, UserCog, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { Logo } from "@/components/logo";
import { Alert, Skeleton } from "@/components/ui/display";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { can, meKey, useMe } from "@/lib/hooks";
import { ResendVerification } from "./resend-verification";
import type { Me } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof Package; exact?: boolean; show?: (me: Me) => boolean };

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/setup", label: "Launch checklist", icon: Rocket, show: (me) => !me.tenant?.isLive },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/inventory", label: "Inventory", icon: Boxes },
  { href: "/admin/categories", label: "Categories", icon: Shapes },
  { href: "/admin/staff", label: "Team", icon: Users, show: (me) => can(me, "staff.manage") },
  { href: "/admin/activity", label: "Activity log", icon: History, show: (me) => can(me, "audit.read") },
  { href: "/admin/settings", label: "Store settings", icon: Settings },
];

export function storefrontUrl(host: string): string {
  if (typeof window === "undefined") return `https://${host}`;
  const port = window.location.port ? `:${window.location.port}` : "";
  return `${window.location.protocol}//${host}${port}`;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  if (me.isPending || (me.isError && me.error && !me.data)) {
    return (
      <div className="flex min-h-dvh">
        <div className="hidden w-64 bg-sidebar lg:block" />
        <div className="flex-1 p-8">
          {me.isError ? <Alert tone="danger" title="Couldn't load your account">{errorMessage(me.error)}</Alert> : <Skeleton className="h-8 w-48" />}
        </div>
      </div>
    );
  }
  const data = me.data!;

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <div className="hidden w-64 shrink-0 bg-sidebar lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col">
          <SidebarContent me={data} pathname={pathname} />
        </aside>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar">
            <button onClick={() => setOpen(false)} className="absolute top-4 right-3 rounded-md p-1.5 text-sidebar-fg hover:bg-sidebar-active" aria-label="Close navigation">
              <X className="size-5" />
            </button>
            <SidebarContent me={data} pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="-ml-1 rounded-md p-1.5 text-fg-muted hover:bg-surface-muted" aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <Logo />
        </header>
        <StatusBanner me={data} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {data.tenant ? children : <NoStore me={data} />}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ me, pathname, onNavigate }: { me: Me; pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="px-5 pt-5 pb-4">
        <Logo inverted />
      </div>
      {me.tenant && <StoreSwitcher me={me} />}
      <nav className="mt-2 flex-1 overflow-y-auto px-3" aria-label="Main">
        <ul className="flex flex-col gap-0.5">
          {NAV.filter((n) => !n.show || n.show(me)).map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-sidebar-active text-white" : "text-sidebar-fg hover:bg-sidebar-active/60 hover:text-white",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
          {me.tenant && (
            <li>
              <a href={storefrontUrl(me.tenant.host)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-fg hover:bg-sidebar-active/60 hover:text-white">
                <Store className="size-4" aria-hidden />
                View storefront
                <ExternalLink className="ml-auto size-3.5 opacity-60" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          )}
          {me.user.isPlatformAdmin && (
            <li className="mt-4 border-t border-white/10 pt-4">
              <Link href="/platform" onClick={onNavigate} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-fg hover:bg-sidebar-active/60 hover:text-white">
                <ShieldCheck className="size-4" aria-hidden />
                Platform console
              </Link>
            </li>
          )}
        </ul>
      </nav>
      <UserFooter me={me} onNavigate={onNavigate} />
    </>
  );
}

function StoreSwitcher({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const switchTenant = useMutation({
    mutationFn: (tenantId: string) => api<Me>("/auth/switch-tenant", { method: "POST", body: { tenantId } }),
    onSuccess: (next) => {
      qc.clear();
      qc.setQueryData(meKey, next);
      toast.notify(`Switched to ${next.tenant?.name}`);
    },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });
  if (me.memberships.length <= 1)
    return (
      <div className="mx-3 rounded-md bg-sidebar-active/60 px-3 py-2.5">
        <p className="truncate text-sm font-medium text-white">{me.tenant!.name}</p>
        <p className="truncate text-xs text-sidebar-fg">{me.tenant!.host}</p>
      </div>
    );
  return (
    <div className="mx-3">
      <label htmlFor="store-switch" className="sr-only">Switch store</label>
      <Select
        id="store-switch"
        value={me.tenant!.id}
        disabled={switchTenant.isPending}
        onChange={(e) => switchTenant.mutate(e.target.value)}
        className="border-white/10 bg-sidebar-active text-white"
      >
        {me.memberships.map((m) => (
          <option key={m.tenantId} value={m.tenantId}>
            {m.tenantName}
          </option>
        ))}
      </Select>
    </div>
  );
}

function UserFooter({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      qc.clear();
      router.replace("/login");
    },
  });
  const initials = me.user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-white" aria-hidden>
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{me.user.name}</p>
        <p className="truncate text-xs text-sidebar-fg">{me.role ?? (me.user.isPlatformAdmin ? "Platform admin" : "")}</p>
      </div>
      <Link href="/admin/account" onClick={onNavigate} className="rounded-md p-1.5 text-sidebar-fg hover:bg-sidebar-active hover:text-white" aria-label="Your account" title="Your account">
        <UserCog className="size-4" />
      </Link>
      <button onClick={() => logout.mutate()} disabled={logout.isPending} className="rounded-md p-1.5 text-sidebar-fg hover:bg-sidebar-active hover:text-white" aria-label="Sign out" title="Sign out">
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

function StatusBanner({ me }: { me: Me }) {
  // Captured once per mount so render stays pure.
  const [now] = React.useState(() => Date.now());
  const t = me.tenant;
  if (!t) return null;
  if (t.status === "Suspended" || t.status === "Cancelled")
    return (
      <div className="border-b border-danger/20 bg-danger-soft px-4 py-2.5 text-center text-sm text-danger">
        This store is suspended. Your storefront is offline and changes are disabled. Contact support to restore access.
      </div>
    );
  if (!me.user.emailVerified)
    return (
      <div className="border-b border-warning/25 bg-warning-soft px-4 py-2 text-center text-sm text-warning">
        Confirm your email address: we sent a link to <span className="font-medium break-all">{me.user.email}</span>. <ResendVerification email={me.user.email} compact />
      </div>
    );
  if (t.status === "Trialing" && t.trialEndsAt) {
    const days = Math.max(0, Math.ceil((new Date(t.trialEndsAt).getTime() - now) / 86_400_000));
    return (
      <div className="border-b border-border bg-brand-soft px-4 py-2 text-center text-sm text-fg">
        Free trial: <span className="font-medium">{days} {days === 1 ? "day" : "days"} left</span>. Billing and plans will be available here before your trial ends.
      </div>
    );
  }
  return null;
}

function NoStore({ me }: { me: Me }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">You&apos;re not a member of any store yet</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Ask a store owner to invite you, or {me.user.isPlatformAdmin ? <Link href="/platform" className="text-brand hover:underline">open the platform console</Link> : <Link href="/signup" className="text-brand hover:underline">create your own store</Link>}.
      </p>
    </div>
  );
}
