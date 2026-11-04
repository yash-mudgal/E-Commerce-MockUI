import { NextResponse, type NextRequest } from "next/server";

/**
 * Host-based routing for multi-tenancy.
 *  - App hosts (APP_HOSTS, default localhost / app.localhost) serve marketing, auth, /admin and /platform.
 *  - Any other host is a merchant storefront: /path is rewritten to /store/<host>/path. The API then resolves the
 *    tenant from that host. The browser never chooses a tenant ID.
 *  - Unknown stores and unknown product pages are answered with a real 404 status (streamed pages can't change their
 *    status once rendering starts, so the check happens here, before rendering).
 * The admin guard here is only an optimistic redirect for signed-out visitors. Real authorisation happens
 * in the API on every request.
 */
const APP_HOSTS = (process.env.APP_HOSTS ?? "localhost,127.0.0.1,app.localhost")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const SESSION_COOKIES = ["sm_session", "__Host-sm_session"];
const API = process.env.API_URL ?? "http://localhost:5080";
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const SLUG_RE = /^\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;

/** Small in-process cache of "does this exist?" answers: found for 60 s, missing for 30 s. */
const seen = new Map<string, { exists: boolean; until: number }>();

async function exists(host: string, apiPath: string): Promise<boolean> {
  const key = `${host}${apiPath}`;
  const hit = seen.get(key);
  if (hit && hit.until > Date.now()) return hit.exists;
  let found = true;
  try {
    const res = await fetch(`${API}/api/storefront${apiPath}`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Forwarded-Host": host, "X-Forwarded-For": "127.0.0.1", "X-Forwarded-Proto": "https" },
      signal: AbortSignal.timeout(3000),
    });
    found = res.status !== 404;
  } catch {
    return true; // fail open: if the API is unreachable, let the page render its own error state
  }
  if (seen.size > 5000) seen.clear();
  seen.set(key, { exists: found, until: Date.now() + (found ? 60_000 : 30_000) });
  return found;
}

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const { pathname, search } = request.nextUrl;

  // /store/<host>/… is internal: reachable only through the rewrite below, never directly. Otherwise one store's
  // domain (or ShopMint's own) could be made to show another store's pages.
  if (pathname === "/store" || pathname.startsWith("/store/")) return new NextResponse("Not found", { status: 404 });

  if (!APP_HOSTS.includes(host)) {
    const url = request.nextUrl.clone();
    url.pathname = `/store/${host}${pathname === "/" ? "" : pathname}`;
    // robots.txt and sitemap.xml answer for any host; everything else 404s for unknown stores and products.
    if (pathname !== "/robots.txt" && pathname !== "/sitemap.xml" && HOST_RE.test(host)) {
      const slug = SLUG_RE.exec(pathname)?.[1];
      const ok = (await exists(host, "/store")) && (!slug || (await exists(host, `/products/${slug}`)));
      if (!ok) {
        url.pathname = `/store/${host}/missing`;
        url.search = "";
        return NextResponse.rewrite(url);
      }
    }
    return NextResponse.rewrite(url);
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/platform")) {
    const hasSession = SESSION_COOKIES.some((c) => request.cookies.has(c));
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  // Skip API proxying, the internal revalidation hook, Next internals and static files.
  matcher: ["/((?!api/|internal/|_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)"],
};
