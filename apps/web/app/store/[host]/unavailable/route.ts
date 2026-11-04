import { isValidHost } from "@/lib/storefront";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Shown for every page of a suspended store (unpaid ShopMint plan, or suspended by the platform). 503 with
 * Retry-After tells crawlers the store is coming back, so it doesn't drop out of search results like a 404 would.
 * The store's details aren't public while it's suspended, so the page is deliberately plain.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const name = isValidHost(host) ? host : "This store";
  const html = `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Temporarily unavailable</title>
<style>
body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;background:#fff}
main{max-width:28rem;margin:0 auto;padding:120px 24px;text-align:center}
.code{font-size:14px;color:#4b5563;margin:0}h1{font-size:24px;margin:8px 0}p{color:#4b5563;font-size:14px;line-height:1.5}
</style></head><body><main><p class="code">${esc(name)}</p><h1>This store is temporarily unavailable</h1>
<p>Please check back later. If you placed an order here, it isn't affected; the store will contact you.</p></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "3600" } });
}
