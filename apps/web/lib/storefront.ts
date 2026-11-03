import { cacheLife, cacheTag } from "next/cache";
import type { Paged, StorefrontCard, StorefrontCategory, StorefrontProduct, StorefrontStore } from "./types";

/**
 * Server-side storefront data access. The Next.js server calls the API directly and passes the shopper's
 * host as X-Forwarded-Host, which the API trusts only from configured proxy networks. Results are cached
 * briefly per host. Catalogue edits show up within about a minute; tag-based revalidation from API events
 * is planned for Phase 7.
 */
const API = process.env.API_URL ?? "http://localhost:5080";
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export function isValidHost(host: string): boolean {
  return host.length <= 253 && HOST_RE.test(host);
}

async function sf<T>(host: string, path: string): Promise<T | null> {
  if (!isValidHost(host)) return null;
  const res = await fetch(`${API}/api/storefront${path}`, {
    headers: { Accept: "application/json", "X-Forwarded-Host": host, "X-Forwarded-For": "127.0.0.1", "X-Forwarded-Proto": "https" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storefront API returned ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export async function getStore(host: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`store:${host}`);
  return sf<StorefrontStore>(host, "/store");
}

export async function getCategories(host: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`store:${host}`, `store:${host}:catalog`);
  return (await sf<StorefrontCategory[]>(host, "/categories")) ?? [];
}

export async function getProducts(host: string, query: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`store:${host}:catalog`);
  return sf<Paged<StorefrontCard>>(host, `/products${query ? `?${query}` : ""}`);
}

export async function getProduct(host: string, slug: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`store:${host}:catalog`);
  return sf<StorefrontProduct>(host, `/products/${encodeURIComponent(slug)}`);
}

/** Only a validated #rrggbb colour may be injected into CSS. */
export function safeBrandColor(color: string | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#4f46e5";
}
