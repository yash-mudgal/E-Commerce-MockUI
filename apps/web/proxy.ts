import { NextResponse, type NextRequest } from "next/server";

/**
 * Host-based routing for multi-tenancy.
 *  - App hosts (APP_HOSTS, default localhost / app.localhost) serve marketing, auth, /admin and /platform.
 *  - Any other host is a merchant storefront: /path is rewritten to /store/<host>/path. The API then resolves
 *    the tenant from that host. The browser never chooses a tenant ID.
 * The admin guard here is only an optimistic redirect for signed-out visitors. Real authorisation happens
 * in the API on every request.
 */
const APP_HOSTS = (process.env.APP_HOSTS ?? "localhost,127.0.0.1,app.localhost")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const SESSION_COOKIES = ["sm_session", "__Host-sm_session"];

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const { pathname, search } = request.nextUrl;

  if (!APP_HOSTS.includes(host)) {
    if (pathname.startsWith("/store/")) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = `/store/${host}${pathname === "/" ? "" : pathname}`;
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
  // Skip API proxying, Next internals and static files.
  matcher: ["/((?!api/|_next/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)"],
};
