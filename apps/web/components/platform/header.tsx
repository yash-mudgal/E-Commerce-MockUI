"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/display";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/platform", label: "Stores" },
  { href: "/platform/metrics", label: "Metrics" },
  { href: "/platform/feedback", label: "Feedback" },
  { href: "/platform/plans", label: "Plans" },
];

/** Platform console header with section navigation (scrolls sideways on small screens instead of overflowing). */
export function PlatformHeader() {
  const path = usePathname();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Logo />
        <Badge tone="brand">Platform</Badge>
        <span className="flex-1" />
        <Button asChild variant="ghost" size="sm"><Link href="/admin"><ArrowLeft />Merchant admin</Link></Button>
      </div>
      <nav aria-label="Platform sections" className="mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6">
        <ul className="flex gap-1">
          {LINKS.map((l) => {
            const current = l.href === "/platform" ? path === "/platform" : path.startsWith(l.href);
            return (
              <li key={l.href}>
                <Link href={l.href} aria-current={current ? "page" : undefined}
                  className={cn("inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap",
                    current ? "border-brand text-fg" : "border-transparent text-fg-muted hover:text-fg")}>
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
