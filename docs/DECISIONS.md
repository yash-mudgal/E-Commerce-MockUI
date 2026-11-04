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

## ADR-012 Next.js 16 with Cache Components
**Context:** `create-next-app` now enables Cache Components and Partial Prerendering by default. Runtime data (`params`, `searchParams`, `usePathname`, uncached fetches) must sit behind `<Suspense>`.
**Decision:** Keep the defaults. Storefront data goes through `"use cache"` functions keyed by host (`cacheLife("minutes")`, tags per store). Admin and platform pages are static shells with client data. Route-level `<Suspense>` boundaries are used throughout.
**Consequences:** Fast static shells everywhere. A not-found page under streaming returns HTTP 200 (see `PROJECT_PROGRESS.md` known issues); host validation will move into `proxy.ts`.

## ADR-013 Accessible colour tokens enforced by tests
**Context:** An axe-core scan found the original "subtle text" token at 3:1.
**Decision:** Text tokens must reach ≥ 4.5:1 on every surface token. Tenant brand colours must reach ≥ 4.5:1 with white text (API validator + UI preview). axe-core scans run on key pages (`apps/web/e2e/a11y.cjs`).

## ADR-014 Transactional email through an outbox, delivered over SMTP
**Context:** Invitations, password resets and verification must not be lost if the mail server is down, and must not be sent if the change that caused them rolls back.
**Decision:** Emails are rows in `email_outbox`, written in the same transaction as the change. A hosted `EmailDispatcher` (in the API process) claims rows with `FOR UPDATE SKIP LOCKED`, sends with MailKit over SMTP (Mailpit locally, Amazon SES SMTP in production), retries with exponential backoff (8 attempts) and deletes bodies once sent. Links are built from `App:PublicUrl`.
**Consequences:** No queue infrastructure. Several API instances can dispatch safely. Moving the dispatcher to a separate worker later is a hosting change, not a code change. Templates live in code until merchants need to customise them.

## ADR-015 Storefronts are private until the merchant launches
**Context:** A new store has no products, support contact or confirmed owner. Publishing it immediately invites half-finished storefronts and throwaway spam stores.
**Decision:** `tenants.launched_at`. Before launch the storefront API answers only `/store` (with `isLive: false`) and the web shows a "coming soon" page. Launch requires a confirmed owner email, a support email and one active product with stock. The checklist is computed from real state on every request, so there is no per-step state to drift.
**Consequences:** One extra query per storefront request (on the same tenant row that is already read). Unpublishing after launch is not offered yet; suspension covers abuse.

## ADR-016 Invitation acceptance and role rules
**Context:** Invitation links travel by email and can leak. One person may work for several stores.
**Decision:** Accounts stay global; an invitation creates a membership. If the invited address already has an account, the person must be signed in as that account to accept. New people set a password on the invitation page, which also confirms their email. Roles are ranked Owner > Manager > Staff: you can only invite, re-role or remove people ranked below you, and only grant roles below your own. Ownership is never granted this way. Seats (plan `MaxStaff`) count members other than the owner plus pending invitations.
**Consequences:** Ownership transfer needs its own flow (later). A Manager can manage Staff only.
