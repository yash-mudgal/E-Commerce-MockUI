import { getSitemap, getStore, isValidHost, storeOrigin } from "@/lib/storefront";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Per-store sitemap (served at https://<store>/sitemap.xml via proxy.ts). Only live stores have one. */
export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  if (!isValidHost(host)) return new Response("Not found", { status: 404 });
  const [store, map] = await Promise.all([getStore(host), getSitemap(host)]);
  if (!store?.isLive || !map) return new Response("Not found", { status: 404 });
  const origin = storeOrigin(host);
  const urls: [string, string][] = [
    [`${origin}/`, map.storeUpdatedAt],
    [`${origin}/products`, map.storeUpdatedAt],
    ...map.categories.map((c): [string, string] => [`${origin}/products?category=${encodeURIComponent(c.slug)}`, c.updatedAt]),
    ...map.products.map((p): [string, string] => [`${origin}/products/${encodeURIComponent(p.slug)}`, p.updatedAt]),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(([loc, mod]) => `  <url><loc>${esc(loc)}</loc><lastmod>${new Date(mod).toISOString()}</lastmod></url>`)
    .join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
