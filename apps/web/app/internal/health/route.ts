/**
 * Liveness for the load balancer's health check (it calls targets directly by IP, so no store host is involved).
 * /internal/* is blocked at the CDN, and this answer carries no data.
 */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
