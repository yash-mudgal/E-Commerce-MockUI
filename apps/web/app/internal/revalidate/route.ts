import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";

const TAG = /^store:[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:catalog)?$/;

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Called by the API after a merchant changes something shoppers see (ADR-020). Drops the cached storefront data for
 * the given store tags so the next visit renders fresh content. Protected by a shared secret (REVALIDATE_SECRET);
 * without one configured the endpoint is disabled.
 */
export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  const given = req.headers.get("x-revalidate-secret") ?? "";
  if (!secret || !timingSafeEqual(digest(given), digest(secret))) return new Response(null, { status: 404 });

  let tags: unknown;
  try {
    tags = ((await req.json()) as { tags?: unknown }).tags;
  } catch {
    return Response.json({ error: "Expected JSON { tags: string[] }" }, { status: 400 });
  }
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > 200 || !tags.every((t) => typeof t === "string" && TAG.test(t)))
    return Response.json({ error: "tags must be 1–200 store tags" }, { status: 400 });

  // expire: 0 = the next request renders fresh data rather than serving the stale copy once more.
  for (const tag of tags as string[]) revalidateTag(tag, { expire: 0 });
  return Response.json({ revalidated: tags.length });
}
