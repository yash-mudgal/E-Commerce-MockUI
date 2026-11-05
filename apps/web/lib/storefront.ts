import { cacheLife, cacheTag } from "next/cache";
import type { Facets, Paged, ReviewPage, StorefrontHome, StorePageContent, StorefrontCard, StorefrontCategory, StorefrontProduct, StorefrontSitemap, StorefrontStore } from "./types";

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

/** Home page settings, published collections and store pages (footer links). */
export async function getHome(host: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`store:${host}`, `store:${host}:catalog`);
  return sf<StorefrontHome>(host, "/home");
}

export async function getPage(host: string, slug: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`store:${host}`);
  return sf<StorePageContent>(host, `/pages/${encodeURIComponent(slug)}`);
}

/** Size, colour… values with product counts, for a listing's category, collection or search. */
export async function getFacets(host: string, query: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`store:${host}:catalog`);
  return (await sf<Facets>(host, `/facets${query ? `?${query}` : ""}`)) ?? { options: [], priceMin: null, priceMax: null };
}

/** First page of a product's published reviews (moderation refreshes the catalogue tag). */
export async function getReviews(host: string, slug: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`store:${host}:catalog`);
  return sf<ReviewPage>(host, `/products/${encodeURIComponent(slug)}/reviews`);
}

export async function getSitemap(host: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(`store:${host}:catalog`);
  return sf<StorefrontSitemap>(host, "/sitemap");
}

/**
 * Public origin of a storefront, for canonical URLs, Open Graph and sitemaps. Built from the validated host and a
 * configured template (STOREFRONT_URL_TEMPLATE, e.g. "https://{host}"; "http://{host}:3000" for local development).
 */
export function storeOrigin(host: string): string {
  return (process.env.STOREFRONT_URL_TEMPLATE ?? "https://{host}").replace("{host}", host).replace(/\/$/, "");
}

/** JSON for a <script type="application/ld+json">, escaped so store-supplied text can't close the tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** Only a validated #rrggbb colour may be injected into CSS. */
export function safeBrandColor(color: string | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#4f46e5";
}
