# Decision Log (ADRs)

Each entry gives context → decision → consequences. Status: Accepted unless noted.

## ADR-001 Rebuild rather than evolve the mock
**Context:** The mock is a client-only vanilla JS prototype with business rules in the browser (see `PROJECT_AUDIT.md`).
**Decision:** Freeze it in `legacy/mock-ui/` as a reference. Build new apps in `apps/`.
**Consequences:** No code reuse, but full reuse of requirements and rules. The GitHub Pages demo moves to `/legacy/mock-ui/`.

## ADR-002 Modular monolith on ASP.NET Core 10 LTS
**Context:** Small team; a strongly transactional domain (stock, money).
**Decision:** One API deployable, organised by module folders with explicit contracts.
**Consequences:** Simple operations; modules can be extracted later if needed. Starts as a single project (`ShopMint.Api`) for build speed; split into projects when a module exceeds about 5k lines or gets its own team.

## ADR-003 Shared-schema multi-tenancy with PostgreSQL RLS as defence in depth
**Context:** 2,000+ small tenants expected; isolation is critical.
**Decision:** `tenant_id` on every row + EF global filters + RLS with a non-owner app role, with the tenant set per pooled connection.
**Consequences:** Cheap per tenant. A missed filter is caught by RLS. Requires discipline: every new tenant table must get an RLS policy (the migration helper `EnableTenantRls()` makes that one line, and a test asserts that every table with `tenant_id` has RLS enabled).

## ADR-004 Cookie sessions over bearer tokens
**Context:** First-party web clients only in the MVP.
**Decision:** ASP.NET cookie authentication; Next.js proxies `/api` so cookies are first-party; CSRF header on unsafe methods.
**Consequences:** No tokens readable by JavaScript. When a mobile app or public API arrives, add a token scheme alongside.

## ADR-005 Razorpay first, behind a port
**Context:** India-first market (UPI, GST, INR).
**Decision:** `IPaymentGateway` with a Razorpay adapter for storefront payments; Razorpay Subscriptions for SaaS billing, in a separate Billing module.
**Consequences:** Stripe can be added for other markets without touching Orders.

## ADR-006 GST-inclusive pricing and decimal money
**Context:** The mock's pricing (GST-inclusive, extracted per line, pro-rated discount) is correct but uses floats.
**Decision:** `decimal`/`numeric(14,2)`, rounding half away from zero per line, with tax derived from the inclusive price. Ported as `GstCalculator` with unit tests.

## ADR-007 Stock per variant, with reservations
**Context:** The mock tracks stock per product and decrements without reservation.
**Decision:** `stock_levels(variant, location)` with `on_hand` and `reserved`; atomic conditional reservations at checkout.

## ADR-008 No Redis, queue or Kubernetes in the MVP
**Decision:** Outbox + hosted worker on PostgreSQL; ECS Fargate. Revisit when metrics justify it.

## ADR-009 Owned UI components (shadcn pattern) on Radix + Tailwind v4
**Decision:** Components live in `apps/web/components/ui`; tokens are CSS variables. Written by hand rather than via the shadcn CLI so the repository does not depend on a remote registry at build time.

## ADR-010 Money as strings in the JSON API
**Decision:** Serialise `decimal` money as strings (`"1299.00"`) to avoid float rounding in JS clients; accept numbers or strings on input.

## ADR-011 Deferred: ERP (purchase orders, suppliers, P&L) to release 2. _Status: Proposed, awaiting product-owner approval._
