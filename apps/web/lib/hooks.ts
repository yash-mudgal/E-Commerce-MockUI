"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { api, ApiError } from "./api";
import type { Me } from "./types";

export const meKey = ["me"] as const;
export const onboardingKey = ["onboarding"] as const;

/** Current session. Redirects to /login when the API reports the session is missing or revoked. */
export function useMe() {
  const router = useRouter();
  const pathname = usePathname();
  const q = useQuery({ queryKey: meKey, queryFn: () => api<Me>("/auth/me"), staleTime: 60_000 });
  const unauthenticated = q.error instanceof ApiError && q.error.status === 401;
  React.useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);
  return q;
}

export function can(me: Me | undefined, permission: string): boolean {
  return !!me?.permissions.includes(permission);
}
