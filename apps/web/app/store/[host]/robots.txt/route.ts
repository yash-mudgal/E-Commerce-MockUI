import { getStore, isValidHost, storeOrigin } from "@/lib/storefront";

/** Per-store robots.txt. Stores that haven't launched ask crawlers to stay away entirely. */
export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const store = isValidHost(host) ? await getStore(host) : null;
  const body = store?.isLive
    ? `User-agent: *\nAllow: /\nDisallow: /cart\nDisallow: /account\n\nSitemap: ${storeOrigin(host)}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
