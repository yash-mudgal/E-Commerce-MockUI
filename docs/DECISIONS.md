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
**Consequences:** Fast static shells everywhere. A not-found page under streaming returns HTTP 200, so missing stores and products are detected in `proxy.ts` instead (ADR-022).

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

## ADR-017 Direct-to-storage image uploads, verified after upload
**Context:** Product photos are the largest payloads the platform handles. Streaming them through the API costs memory and bandwidth; trusting the browser's claims about a file is unsafe.
**Decision:** `IObjectStorage` port with an S3 adapter (AWS S3 in production, MinIO locally, in-memory in tests). The API issues presigned PUT URLs bound to a key and content type; the browser uploads directly; a `complete` call makes the API measure the stored object and sniff its magic bytes before the image becomes visible. Only JPEG, PNG and WebP. URLs are derived from keys at read time (`Media:PublicBaseUrl`), never stored.
**Consequences:** The bucket needs CORS for PUT. Images are served at original size unless Next.js image optimisation is enabled for a public CDN host (`MEDIA_PUBLIC_URL`). Server-side resizing and thumbnail generation can be added later without changing the API contract.

## ADR-018 Stock changes are ledger entries under row locks
**Context:** Stock must never go negative or below what is reserved for orders, and every change must be explainable.
**Decision:** Adjustments and transfers lock the affected `stock_levels` rows (`SELECT … FOR UPDATE`, ordered to avoid deadlocks) inside a transaction, validate every line, and write one `stock_movements` row per change with reason, note, actor and batch. Requests are all-or-nothing. People choose from receipt, return, correction, damaged and lost; the system writes initial, sale and transfer rows. The product editor only sets opening stock for new variants.
**Consequences:** Checkout reservations in Phase 8 use the same locks. A 12-way concurrent test shows no overselling.

## ADR-019 Deleted images stay in storage for two hours
**Context:** Storefront pages are cached for up to an hour. Deleting an image's file immediately would show broken images on cached pages.
**Decision:** Removing an image (or its product) hides it at once and queues the file in `storage_deletions`, in the same transaction. The media janitor deletes due files every 10 minutes. Files from rejected or abandoned uploads were never public and are deleted immediately.
**Consequences:** A removed image's URL keeps working for up to about two hours. If a merchant needs a file gone immediately (for example a legal takedown), a platform admin can delete the object directly; a tool for that is future work.

## ADR-020 The API tells the web app when a storefront changes
**Context:** Storefront data is cached per store (`"use cache"` with `cacheTag("store:<host>")`). Waiting for caches to expire meant launches, price changes and stock changes took about a minute to appear.
**Decision:** An admin route filter (and platform suspend/reactivate) queues the tenant after every successful write. A background service coalesces bursts, looks up the store's hosts and calls the web app's `POST /internal/revalidate` with a shared secret; the route calls `revalidateTag(tag, { expire: 0 })`. Best effort: if the call fails, caches still expire on their own schedule.
**Consequences:** Changes are visible in under a second (measured 0.7 s). Every admin write triggers a refresh, including ones shoppers can't see, which is cheap: the next visit re-fetches a few cached API responses.

## ADR-021 Shopper accounts: per store, separate scheme, server-side cart
**Context:** Shoppers buy from a store, not from ShopMint (PROJECT_AUDIT §6, decision 4). Carts must follow a signed-in shopper across devices, and prices must never come from the browser.
**Decision:** `customers` are tenant-owned with their own cookie scheme and their own reset tokens. A cart is a server row: the customer's cart, or a guest cart found by a hashed cookie token; signing in merges the guest cart. Lines hold variant and quantity only.
**Consequences:** The same email can register at two stores with different passwords. Email verification for shoppers isn't required yet (deferred again in Phase 8; see PROJECT_PROGRESS known issues).

## ADR-022 Real 404s are decided in the proxy
**Context:** With streaming, a page can't change its status after it starts rendering, so unknown stores and products returned 200 with a not-found message, which is bad for SEO.
**Decision:** `proxy.ts` asks the API whether the store (and, for `/products/<slug>`, the product) exists, caching answers in memory (found 60 s, missing 30 s), and rewrites misses to a route handler that returns a store-branded 404 page. If the API can't be reached, it fails open and lets the page render its own error state.
**Consequences:** One extra cached API call per uncached page. A suspended store can keep answering 200 (with a not-found body) for up to 60 seconds.

## ADR-023 Payments behind a gateway port; each store uses its own Razorpay account
**Context:** Razorpay is approved for storefront payments (PROJECT_AUDIT §6). Money should go straight to the merchant, and ShopMint should not become a payment aggregator. Stripe or another gateway may follow.
**Decision:** `IPaymentGateway` with a Razorpay adapter (HttpClient, basic auth with the store's keys). Merchants connect their own Razorpay keys in Store settings; the API checks them against Razorpay, encrypts the key secret and webhook secret with AES-256-GCM under a platform key, and never returns them. Each store has its own webhook URL; the store ID only selects the secret to check.
**Consequences:** Merchants complete Razorpay KYC themselves. Losing the platform key means merchants must reconnect. Platform-level split payments (Razorpay Route) would be a later, separate decision.

## ADR-024 Order confirmation trusts only server-verified payment facts
**Context:** The mock marked orders paid on the client (S4). Callbacks can be forged, webhooks can be late, duplicated or lost.
**Decision:** An order is confirmed only by (a) the checkout callback after an HMAC signature check **and** a server-side read of the payment from Razorpay, or (b) a signed webhook, or (c) the expiry job's reconciliation query. All three call one idempotent `MarkPaid` that locks the order and requires the exact amount. Late captures for expired or cancelled orders are refunded automatically.
**Consequences:** Some confirmations arrive seconds later (the order page polls while awaiting payment). Duplicate events are harmless.

## ADR-025 Reserve stock at order placement, for 15 minutes
**Context:** Overselling the last unit is a P0 risk (R2), but holding stock for abandoned payments hurts sales.
**Decision:** Placing an order locks the stock rows (fixed order: variant, location) and moves quantity to `reserved`. Online orders hold it for 15 minutes; a minutely job reconciles with the gateway and then expires unpaid orders, releasing stock. COD orders commit immediately. Cancellations restock with ledger rows.
**Consequences:** A shopper who takes longer than 15 minutes to pay loses the hold (a late capture is refunded). Stock shown on the storefront excludes reserved units.

## ADR-026 Checkout requires a shopper account
**Context:** Orders need a durable owner for order history, cancellation and invoices, and abuse controls work better with accounts. Guest checkout is common in India but adds email-link order access and more abuse surface.
**Decision:** Checkout needs a signed-in shopper of that store (ADR-021). The cart survives sign-in, and sign-up returns the shopper straight to checkout.
**Consequences:** One extra step for first-time buyers. Guest checkout can be added later with signed order links.

## ADR-027 Delivery is taxed at the order's highest GST rate; flat delivery fee
**Context:** Delivery charged with goods is a composite supply; its GST follows the principal supply. Mixed-rate orders need one rule.
**Decision:** Delivery fees are GST-inclusive and taxed at the highest item rate in the order (SAC 9965 on the invoice). Stores set one delivery fee and an optional free-delivery threshold (after discounts).
**Consequences:** Simple and conservative. Weight or zone-based rates and per-item delivery tax allocation are later work; merchants should confirm the treatment with their accountant.

## ADR-028 A labelled test gateway for development and demos
**Context:** Checkout must be demonstrable and testable without Razorpay credentials or network access, without ever risking fake "paid" orders in production.
**Decision:** A `TestGateway` behind the same port, enabled only by `Payments__AllowTestMode` (the API refuses to start in Production with it on) and used only while a store has no Razorpay keys. The storefront shows a "Test mode — no real payment" badge and a simulator dialog; admin shows "Test mode" on payment attempts.
**Consequences:** End-to-end tests run without Razorpay. A real sandbox run with Razorpay test keys is still required before launch.

## ADR-029 ShopMint bills stores through its own Razorpay account, behind a billing port
**Context:** Stores pay ShopMint a monthly fee (PRODUCT_REQUIREMENTS §3.11). This money is ShopMint's and must stay separate from the merchant's own payment gateway (ADR-023).
**Decision:** `IBillingGateway` with a Razorpay Subscriptions adapter using platform keys (`Billing:Razorpay:*`), and a labelled test gateway allowed only with `Payments:AllowTestMode`. Plans map to Razorpay plans by ID; the store's subscription is matched to webhooks only by our stored subscription ID.
**Consequences:** Razorpay manages mandates, retries and card updates. Prices shown exclude GST; the Razorpay plan amount includes it. Changing a price needs a new Razorpay plan.

## ADR-030 A store's status and plan are derived from its subscriptions
**Context:** Trial, payment failures, cancellations, platform suspensions and webhooks can arrive in any order. Setting `tenants.status` directly from each event would drift and is hard to test.
**Decision:** One pure function (`BillingRules.Derive`) computes status, plan, suspension reason and grace date from the trial end, the platform-suspension flag and the open subscriptions (priority Active > Pending > Authenticated > Halted). Every billing event updates subscriptions under the store's row lock and then re-derives; transitions trigger emails, session refresh and storefront refresh.
**Consequences:** The lifecycle is unit-tested in one place. Platform suspension is an overlay, not a status, so reactivation returns the right state. Razorpay webhooks are treated as triggers and the subscription is read back.

## ADR-031 Plan limits block additions, under a row lock; downgrades must fit
**Context:** Limits must hold when requests race, and changing plans mustn't delete merchant data.
**Decision:** Creating products, locations and invitations (and unarchiving products) locks the store row, counts and inserts in one transaction. A plan can be chosen or downgraded to only if the store's current data fits; lower limits from a platform edit block new additions but never remove data.
**Consequences:** Slight serialisation of these writes per store (cheap). A store can sit above a lowered limit until it removes data.

## ADR-032 Suspended storefronts answer 503, not 404
**Context:** Closing a store for an unpaid plan is temporary; a 404 would make search engines drop its pages.
**Decision:** The storefront API returns 503 `store-unavailable` for suspended stores; `proxy.ts` rewrites all of the store's pages to a plain "temporarily unavailable" page with status 503 and `Retry-After`. Cancelled stores return 404.
**Consequences:** Store details aren't shown while suspended. The proxy caches the decision for up to 60 s.

## ADR-033 Reports read the stored order amounts, not recomputed prices
**Context:** Reports must match order totals exactly (Phase 10 exit criterion) and stay right when prices, tax rates or settings change later.
**Decision:** Sales and GST reports aggregate the amounts stored on orders and order lines when they were placed (totals, discounts, delivery, CGST/SGST/IGST, refunds). Sales use the dashboard's rule (confirmed, not cancelled, by placement date in Indian time, net of refunds); GST uses invoice dates and leaves cancelled invoices out (listed for credit notes). Delivery tax is the order's tax minus its lines' tax, at the order's highest rate.
**Consequences:** Reports always add up to the orders and to each other. They're computed per request (up to 366 days / 50,000 orders); a reporting replica or materialised summaries can come later without changing the numbers.

## ADR-034 Marketing email is opt-in, per store, and always unsubscribable
**Context:** Abandoned-cart reminders improve sales but are marketing under India's DPDP Act and email best practice.
**Decision:** Stores turn reminders on (off by default). Only signed-in shoppers with recorded marketing consent at send time get one, once per cart change, with a one-click unsubscribe link backed by a purpose-bound hashed token. Transactional order emails are unaffected.
**Consequences:** Guest carts get no reminders. Consent changes take effect on the next send.

## ADR-035 Two-step verification: TOTP with recovery codes, required for platform admins
**Context:** Platform admins can see and suspend every store; a phished password must not be enough. Merchants should be able to opt in.
**Decision:** TOTP (RFC 6238) implemented in-house (a few dozen lines, tested against the RFC vectors) rather than an SMS or email code. Secrets are encrypted with the platform secrets key; replay is blocked by storing the last accepted step; ten hashed single-use recovery codes. Login becomes password → short-lived single-use challenge → code, and the session carries an `mfa` claim. Platform endpoints require that claim (403 `mfa-required`), so an unenrolled admin is guided to enrol rather than locked out.
**Consequences:** No SMS cost or SIM-swap risk. Passkeys/WebAuthn can be added later as another second factor. A user who loses the authenticator and all recovery codes needs an operator reset.

## ADR-036 Session keys in PostgreSQL
**Context:** Data Protection keys on each container's filesystem sign everyone out on redeploy and break with several API tasks (known issue 21).
**Decision:** Persist the key ring with `PersistKeysToDbContext` in `data_protection_keys`, reachable only by the platform role (the request-path app role has no grant).
**Consequences:** No new infrastructure. Keys rely on RDS encryption at rest; wrapping them with KMS (`ProtectKeysWith…`) is a later hardening step.

## ADR-037 Content-Security-Policy without nonces
**Context:** A nonce-based CSP needs a per-request nonce in every page, which makes every route dynamic and would give up the prerendered storefront shells (Cache Components) that keep storefront pages fast and cacheable.
**Decision:** Ship a strict allow-list CSP (`default-src 'self'`, Razorpay only for scripts/frames/connections, media origins for images and uploads, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`) but allow `'unsafe-inline'` scripts. `'unsafe-eval'` only outside production (React dev tools).
**Consequences:** The CSP still blocks loading scripts from other origins, framing and plugin content, but doesn't stop an injected inline script; React escaping and no raw HTML from users remain the primary XSS defence. Revisit when Next.js supports hashes for prerendered pages.

## ADR-038 Browser E2E, accessibility, ZAP and load checks run on every pull request
**Context:** The phase walkthroughs had only been run by hand against a local stack.
**Decision:** A CI job starts PostgreSQL, Mailpit and MinIO, migrates and seeds the API, builds and starts the web app, then runs every walkthrough and the axe scan (failing the build on errors or serious/critical issues), an OWASP ZAP baseline and the load test (informational, reports uploaded). Payments use the labelled test gateway; Razorpay itself is covered by the fake Razorpay in API tests and by the staging runs in `RELEASE_CHECKLIST.md`.
**Consequences:** Pull requests take longer (about 20–30 minutes for this job). The scripts share seeded data and run sequentially; moving to `@playwright/test` with isolated stores would allow parallel runs.

## ADR-039 Infrastructure as code with AWS CDK (TypeScript)
**Context:** Phase 12 needs reproducible staging and production environments, reviewed in pull requests and testable without an AWS account.
**Decision:** AWS CDK in TypeScript (`infra/`), one app per environment with six stacks split by change rate: Foundation (admin-only), Edge (us-east-1 WAF), Dr (ap-south-2 vault), Core (long-lived data and network), Migrate and Services (per release). Assertion tests check the security-relevant template properties in CI, and synthesis never calls AWS (pinned availability zones, no lookups).
**Consequences:** One language with the web app; higher-level constructs than raw CloudFormation or Terraform with less code. CloudFormation limits (stack updates, cross-region references via SSM) apply. A bad release can't modify the database or network, because releases only touch Migrate and Services.

## ADR-040 CloudFront in front of everything; the load balancer only answers CloudFront
**Context:** Every store is a subdomain (and later a custom domain); the API trusts `X-Forwarded-Host` from inside the network, and rate limits need the shopper's real IP.
**Decision:** One CloudFront distribution serves the app and all storefronts, with AWS WAF. A viewer-request function drops browser-supplied `X-Forwarded-Host`, writes the viewer IP to `X-ShopMint-Client-Ip` (the API's `Proxy:ClientIpHeader`) and hides `/internal/*`. The load balancer accepts only CloudFront's IP ranges and a secret origin header; `/api/*` goes straight to the API service, pages to the web service.
**Consequences:** No caching of dynamic pages at the edge (they are per user and per store); static build assets are cached for a year. Rotating the origin secret needs one deploy of Core and Services. Custom merchant domains will need per-domain certificates on CloudFront.

## ADR-041 Releases run migrations as a one-off task before services change
**Context:** Several API tasks must not race to migrate, and a failed migration must not leave new code running against an old schema.
**Decision:** The pipeline deploys the Migrate stack (a task definition for the new image), runs `deploy-db` as a one-off Fargate task and waits for exit code 0; only then does it deploy the services, which roll with the ECS circuit breaker. Migrations stay expand/contract, so rollback is redeploying earlier images and never touches the database.
**Consequences:** A destructive schema change takes two releases. `deploy-db` also creates roles and sets their passwords from Secrets Manager, so password rotation is "update secret, run deploy-db, restart".

## ADR-042 Operator commands instead of database access
**Context:** The database is in isolated subnets with no bastion host, and ECS Exec is off; operators still need to verify restores, reset two-step verification and appoint platform admins.
**Decision:** Such actions are commands in the API binary (`verify-db`, `reset-mfa`, `platform-admin grant|revoke`, `deploy-db`), run as one-off tasks with the release's image and configuration, logged to CloudWatch. There is no API endpoint for granting platform admin.
**Consequences:** Every operator action is code-reviewed and repeatable, and no human holds database credentials day to day. Ad-hoc SQL needs a temporary, audited exception (for example a one-off task with an extra command added in a reviewed change).

## ADR-043 Platform metrics are computed from the database on request
**Context:** Phase 13 needs product and business metrics (funnel, MRR, GMV, payment success) for the team, before there is any traffic to justify an analytics pipeline or a third-party product-analytics tool (which would also mean sending merchant and shopper data to another processor).
**Decision:** `GET /api/platform/metrics` computes them from the operational database under the platform role, for a range of Indian calendar days (up to 366), using the same order-counting rule as merchants' sales reports (ADR-033). MRR counts stores currently active on a paid plan (prices exclude GST); past-due stores are shown separately. Weekly buckets are Indian weeks starting Monday.
**Consequences:** Numbers always agree with the source records and with merchants' reports; no tracking scripts. Each request scans the range's orders, which is fine at launch scale; move to a reporting replica or nightly snapshots when it isn't. Historical values that aren't stored (e.g. when a store churned) can't be reconstructed, so the funnel describes a cohort's current state.

## ADR-044 Merchant feedback is write-only for the request path
**Context:** Merchants need a low-effort way to report problems and ideas; the team needs one inbox. Feedback can contain anything a merchant types.
**Decision:** A `feedback` table with RLS: the app role may only insert rows for its own store and can't read any (like the email outbox); platform admins (with two-step verification) triage under the platform role. The sender's email is shown to the team only if they ticked "may contact me". Rate-limited per user (10 an hour).
**Consequences:** A compromised merchant session can't read anyone's feedback, including its own store's. Merchants don't see their past feedback or its status yet (a later improvement would need a read policy limited to the sender).

## ADR-045 Alert on error-budget burn, and require a budget per environment
**Context:** A fixed "5xx over 1% for 5 minutes" alarm pages on short blips and misses slow, sustained failure.
**Decision:** A 99.9% availability SLO with multi-window burn-rate alarms (14.4× over 1 h and 5 min; 6× over 6 h and 30 min), replacing the fixed alarm. Each environment also gets an AWS Budget whose amount is a required deploy parameter, so it is set deliberately from the cost model rather than defaulted.
**Consequences:** Fewer, more meaningful pages. The SLO and thresholds are initial (`SLO.md`) and are revisited with real data in the monthly operating review.

## ADR-046 The cost estimate is code, read from the templates
**Context:** The budget per environment (ADR-045) needs a cost estimate, and a spreadsheet or calculator export drifts from the infrastructure as soon as a size or a resource changes.
**Decision:** `infra/lib/cost.ts` synthesises the CDK app, counts what it would create (tasks and sizes, database class and Multi-AZ, NAT gateways, WAF rules, alarm metrics, secrets…), and prices it with on-demand list prices taken from the AWS Price List API (each with its usage type and offer version) and explicit usage assumptions. `npm run cost` prints the table in `COST_REVIEW.md`; tests check the inventory and key prices. The AWS budget excludes tax, credits and refunds so it compares directly with the estimate.
**Consequences:** Changing infrastructure changes the estimate automatically; prices need a manual refresh (quarterly) and the usage assumptions must be replaced with measured values after the first month. Free tiers and GST are not modelled.

## ADR-047 Storefront theme and terms come from the store, never from copy
**Context:** The storefront needed to look like a premium shop, not an admin screen, and premium shops usually advertise shipping, payment and returns promises. ShopMint must not show a promise a store doesn't keep, or fake imagery.
**Decision:** A scoped storefront theme (warm neutrals, a serif display face, finer corners; text contrast checked to WCAG AA) leaves the merchant admin unchanged. Every shopping term shown (announcement bar, home strip, product page, mini cart, footer) is derived from the store's own settings by one function (`lib/store-terms.ts`), the same values checkout applies; the test payment gateway is labelled as such. Products without photos get a typographic placeholder that says so, never a stock image. The "on sale" section appears only when it adds products not already shown.
**Consequences:** Stores get a polished look without configuring anything, and every claim is true by construction. Store-specific content (banners, pages, returns policy) needs its own settings, which later phases add.

## ADR-048 Reviews are from delivered orders and moderated; wishlists need an account
**Context:** Reviews drive conversion but are easy to fake, and shoppers' names are personal data.
**Decision:** Only a signed-in shopper with a delivered order containing the product may review it (one review per product, editable). Every new or edited review is Pending until the store publishes it; stores can hide reviews and reply publicly. Public reviews show first name and last initial only. Ratings are computed from published reviews at read time and added to product structured data. Wishlists are stored per shopper account (guests are asked to sign in); recently viewed stays in the browser's own storage and never reaches the server except as product slugs to draw cards.
**Consequences:** "Verified buyer" is true by construction and nothing appears without the store's approval. Stores with few delivered orders will have few reviews at first. Rating aggregation at read time is fine at launch scale; cache or denormalise it if product listings get slow.

