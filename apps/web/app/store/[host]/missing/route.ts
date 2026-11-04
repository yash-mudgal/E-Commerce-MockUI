import { getStore, isValidHost, safeBrandColor } from "@/lib/storefront";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The 404 page for unknown stores and product pages. proxy.ts rewrites to this route because a rewritten page can't
 * change its own status once streaming starts, while a route handler sets it directly. Store-branded when the store
 * exists; deliberately small and self-contained.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const store = isValidHost(host) ? await getStore(host) : null;
  const brand = safeBrandColor(store?.brandColor);
  const title = store ? `Page not found · ${esc(store.name)}` : "Store not found";
  const heading = store ? "We couldn't find that page" : "This store doesn't exist";
  const text = store
    ? "The product may have been removed or renamed."
    : "Check the address, or the store may have closed.";
  const links = store
    ? `<a class="btn" href="/products">Browse all products</a><a href="/">Go to the home page</a>`
    : `<a class="btn" href="https://shopmint.in">Visit ShopMint</a>`;
  const html = `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>
body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;background:#fff}
header{border-bottom:1px solid #e2e8f0;padding:20px 24px;font-weight:600;font-size:18px}
main{max-width:28rem;margin:0 auto;padding:96px 24px;text-align:center}
.code{font-size:14px;color:#4b5563;margin:0}h1{font-size:24px;margin:8px 0}p{color:#4b5563;font-size:14px;line-height:1.5}
.links{display:flex;flex-direction:column;gap:12px;align-items:center;margin-top:24px}
a{color:${brand};font-size:14px;font-weight:500}.btn{background:${brand};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px}
</style></head><body>${store ? `<header>${esc(store.name)}</header>` : ""}<main><p class="code">404</p><h1>${heading}</h1><p>${text}</p>
<div class="links">${links}</div></main></body></html>`;
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
