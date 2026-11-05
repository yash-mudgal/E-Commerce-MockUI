# Project Progress

_Last updated: 2026-11-05_

## Current status

| Phase | Status | Notes |
|---|---|---|
| 0 Audit & requirements | ✅ Done | `PROJECT_AUDIT.md`, `CURRENT_STATE_ANALYSIS.md`, `PRODUCT_REQUIREMENTS.md` |
| 1 Architecture | ✅ Done, **awaiting product-owner sign-off** on `PROJECT_AUDIT.md` §6 | ADRs in `DECISIONS.md` |
| 2 Design system | 🟡 Core done | Tokens, primitives and representative screens built and verified. Dark mode and the full screen inventory come with later phases |
| 3 Foundation | ✅ Done | Monorepo, API skeleton, migrations, logging, ProblemDetails, health, OpenAPI, CI, docker-compose |
| 4 Auth & multi-tenancy | ✅ Done | Password reset and email verification delivered in Phase 5 |
| 5 Onboarding & platform admin | ✅ Done | Launch checklist and launch, invitations and team management, password reset and change, email confirmation, email outbox, activity log. Exit criterion verified end to end by `apps/web/e2e/phase5.cjs` |
| 6 Catalogue | ✅ Done | Product images (direct S3 uploads, verified), inventory with adjustments, transfers, locations and ledger, category ETags. Verified end to end by `apps/web/e2e/phase6.cjs` |
| 7 Storefront | ✅ Done | Shopper accounts, addresses, server-side cart (cross-device), SEO (metadata, JSON-LD, sitemap, robots), real 404s, instant cache refresh. Lighthouse ≥ 90 on all categories; verified end to end by `apps/web/e2e/phase7.cjs` |
| 8 Orders & payments | ✅ Done (Razorpay live-sandbox run pending, see below) | Checkout with 15-minute stock reservations, Razorpay (merchant's own keys, encrypted), webhooks, COD, GST invoices, cancellations, refunds, shipments, coupons, order emails, real dashboard sales. Concurrency and webhook suites pass; verified end to end by `apps/web/e2e/phase8.cjs` using the labelled test gateway |
| 9 SaaS billing | ✅ Done (live Razorpay Subscriptions run pending, see below) | Plans in the database with enforced limits, 14-day trial, Razorpay Subscriptions on ShopMint's own account, upgrades/downgrades, cancellation, failed-payment grace (7 days), suspension (503 storefront, read-only admin with billing open), platform plan editing and plan assignment. Plan enforcement and lifecycle suites pass; verified end to end by `apps/web/e2e/phase9.cjs` using the labelled test gateway |
| 10 Reporting & notifications | ✅ Done | Sales and GST reports with CSV exports that add up to the orders exactly (exit criterion, tested and verified in the browser), per-member email preferences, daily low-stock digest, opt-in abandoned-cart reminders with one-click unsubscribe. The audit-log UI shipped in Phase 5 |
| 11 QA & security | ✅ Engineering done; **release checklist open** (staging and sign-off items) | Two-step verification (TOTP + recovery codes) required for platform admins, security headers and CSP, shared session keys, request-size limit, gitleaks and a full browser E2E + axe + ZAP + load job in CI. `RELEASE_CHECKLIST.md` lists what is verified and what needs staging |
| 12 Production | ✅ Engineering done; **not yet deployed to AWS** (no AWS account in this environment) | Infrastructure as code (AWS CDK) with assertion tests, release pipeline with migrations as a one-off task and automatic rollback, smoke test, operator commands, backups with cross-region copies in India, alarms and dashboard, runbooks. Restore drill and production-mode smoke passed locally; the first AWS deployment, the RDS restore drill and smoke on staging/production are open |
| 13 Post-launch | ✅ Instruments built; **targets wait for real data** (not launched) | Platform metrics from the database (lifecycle, MRR, onboarding funnel, net sales, payment and email health, weekly series), merchant feedback with a triage inbox, SLO burn-rate alarms, AWS Budgets, a priced cost estimate (`npm run cost`, ADR-046), operating review process. The exit criterion "targets set from real metrics" needs four weeks of production traffic (`OPERATING_REVIEW.md`) |
| 14 Storefront redesign | ✅ Done | Premium storefront theme (scoped tokens, serif display face), two-row header with search, mobile menu, mini cart with free-shipping progress, image-led home (hero, store terms, category tiles with covers, new arrivals, sale), listing with filter sidebar (category, availability, on sale, price) and chips, product page with gallery, sticky buy box, colour swatches, terms, accordions and related products, redesigned cart and footer. All terms come from store settings (ADR-047). Demo product photos not added: image hosts are blocked in this environment |
| 15 Reviews and wishlist | ✅ Done | Verified-buyer reviews (delivered orders only) with store moderation and replies, ratings on cards, product pages and structured data, wishlist for signed-in shoppers, recently viewed (on device). Verified end to end by `apps/web/e2e/phase15.cjs` (ADR-048) |

## Phases 14–15: storefront redesign, reviews and wishlist (2026-11-05)

Requested: "make it professional and complete e-commerce". Order agreed with the user: storefront redesign (premium
lifestyle style), then reviews/ratings/wishlist, filters and homepage, returns and delivery, gift cards and newsletter.

- **Phase 14, storefront redesign.** Storefront-only theme in `globals.css` (`.storefront`), Fraunces display serif.
  New header (search toggle, category navigation, wishlist, cart opening a mini cart), announcement bar and footer from
  the store's settings, image-led home page, listing with a filter sidebar (mobile: a panel) and removable chips,
  product page with desktop thumbnails / mobile swipe gallery, colour swatches, terms box, accordions and "You may also
  like", redesigned cart with a free-shipping progress hint. API: store terms on `/storefront/store`, category covers,
  card hover images, `onSale` and `exclude` filters.
- **Phase 15, reviews and wishlist.** `product_reviews` and `wishlist_items` (forced RLS). Reviews only from delivered
  orders, moderated by the store (admin → Reviews: publish, hide, reply), shown with first name and last initial,
  ratings on cards and product pages and in JSON-LD. Wishlist with heart buttons and an account page; recently viewed
  kept in the browser.
- **Not done:** demo product photos. Wikimedia Commons, Unsplash and Pexels are blocked by this environment's network
  policy; products without photos show a labelled placeholder. Merchants' own uploads work as before.
- **Verified:** API 254/254 (12 new: store terms, hover images and covers, sale/exclude filters, review eligibility,
  moderation, isolation, masking, wishlist, slugs); web unit 94/94 (7 new); e2e `phase15.cjs` 32/32 and the existing
  suites (phase 5–13) pass after selector updates for the mini cart and gallery; axe 51 pages with 0 serious/critical.

## After Phase 13: cost estimate (2026-11-04)

- `infra/lib/cost.ts` + `npm run cost`: reads what each environment creates from the synthesised templates and prices
  it with AWS list prices for Mumbai (Price List API, retrieved 2026-11-04) and stated launch-stage usage. Estimate
  before tax: staging ~$218, production ~$838 a month (78% of it fixed; the Multi-AZ database is 42%). Suggested
  budgets 300 and 1050 (`COST_REVIEW.md`, ADR-046). Not verified against a real bill: nothing is deployed.
- The AWS budget now excludes tax, credits and refunds, matching the estimate.
- Infra tests: 26 (5 new: inventory from templates, list-price lines, usage-only sensitivity, budget rounding,
  budget cost types). Vitest now ignores compiled tests in `dist/`.

## Phase 13 (2026-11-04)

ShopMint hasn't launched, so Phase 13 builds the instruments the post-launch loop needs and leaves the targets
explicitly open (`OPERATING_REVIEW.md`).

**Platform metrics** (`GET /api/platform/metrics`, Platform → Metrics): stores by status; MRR from stores active on a
paid plan, by plan, with past-due MRR shown as at risk; the onboarding funnel for stores created in the range (signed
up → confirmed email → added a product → launched → first order, plus "on a paid plan now"); orders and net sales across
stores using the sales-report rule; online payment success; email delivery health; a weekly series (Indian weeks).
Computed from the database on request; nothing is sampled (ADR-043). The page has KPI tiles, tables, two weekly charts
with a table view, and the funnel with counts and percentages.

**Feedback loop**: "Send feedback" in the merchant admin (category, message, consent to be contacted; the page is
recorded). Platform → Feedback lists it by status with counts, category filter and search; the team sets status
(New, Triaged, Planned, Done, Declined) and an internal note. Write-only for the request path under RLS, consent-gated
contact email, 10 per user per hour (ADR-044). Migration `Phase13Feedback`.

**Platform console** gains section navigation (Stores, Metrics, Feedback, Plans).

**Reliability and cost**: a 99.9% availability SLO with fast and slow burn-rate alarms replaces the fixed 5xx alarm;
an SLO graph on the dashboard; AWS Budgets per environment with a required `monthlyBudgetUsd` (ADR-045).
`docs/SLO.md`, `docs/COST_REVIEW.md` (usage model from the CDK config, to be priced in the AWS calculator; the earlier
unsourced cost estimate was removed) and `docs/OPERATING_REVIEW.md` (weekly, monthly and quarterly reviews; the
metrics whose targets are to be set).

**CI fixes**: the CDK entry point (`infra/bin/`) and `apps/web/.env.example` were never committed because ignore rules
excluded them; the `infra` job failed type-checking until they were. The e2e job now passes in CI (first full run).

## Phase 12 (2026-11-04)

**Infrastructure as code (`infra/`, AWS CDK in TypeScript)**: one app per environment, six stacks: Foundation (ECR,
GitHub OIDC deploy role scoped to the GitHub environment), Edge (WAF in us-east-1), Dr (locked backup vault in
Hyderabad), Core (VPC with isolated data subnets and flow logs; RDS PostgreSQL 16, encrypted, TLS-only, Multi-AZ and
35-day point-in-time recovery in production; generated role passwords; media bucket and CDN; ECS cluster; load
balancer that refuses anything without CloudFront's origin header; app CDN with an edge function; AWS Backup with
cross-region copies; 5xx and database alarms), Migrate (the release's `deploy-db` task) and Services (API and web on
Fargate, rolling with automatic rollback, autoscaling, service discovery, latency/health/error-log alarms,
dashboard). 18 assertion tests check the security-relevant properties of the synthesised templates (ADR-039 to 042).

**Edge**: CloudFront drops browser-supplied `X-Forwarded-Host`, writes the viewer's IP into `X-ShopMint-Client-Ip`
(the API rate-limits on it), and answers 404 for `/internal/*`. Only CloudFront's IP ranges reach the load balancer.

**Release pipeline** (`.github/workflows/deploy.yml`): merge → staging; `v*` tag → production after approval. API
image built once and promoted; web image per environment (its CSP is fixed at build time); `deploy-db` runs before the
services change; smoke test after. Manual rollback input redeploys earlier images without touching the database.
Off until an admin sets `DEPLOY_ENABLED`. CI gained an `infra` job (type-check, tests, synth of both environments).

**API for production**
- Configuration from parts (`Database__Host`, role passwords from Secrets Manager); TLS `VerifyFull` with the RDS CA
  bundle shipped in the image.
- `deploy-db` creates roles and the database as a non-superuser master user (PostgreSQL 16 gives a role's creator no
  `SET` on it; found by simulating a managed database and fixed), then migrates. Idempotent.
- Operator commands for a database nobody can log in to: `verify-db` (post-restore safety check), `reset-mfa`,
  `platform-admin grant|revoke` (the only way to create a platform admin).
- Production refuses `Proxy:TrustAll` and a missing `Payments:SecretsKey`, in addition to test mode.
- Storefront cache refresh reaches every web task (fan-out over service discovery); fixes known issue 3 for several
  web tasks.
- `origin`, `staging` and `internal` are reserved store subdomains. HttpClient request logs quietened in production.

**Web**: `/internal/health` for the load balancer.

**Fix from the Phase 11 CI run:** the new `e2e` job failed at its first step because the MinIO images are no longer
published on Docker Hub (`pull access denied for minio/minio`), which also broke `docker compose up` for local
development. Both now use moto's S3 server image (`motoserver/moto:5.2.5`), the server all upload checks were
verified against; verified locally (compose healthcheck, bucket creation, presigned PUT and public GET). The other
Phase 11 CI jobs (API, web, gitleaks) passed.

**Ops**: `ops/smoke.cjs` (read-only post-deploy checks, including edge behaviour), `ops/restore-drill-local.sh`, and
runbooks in `docs/runbooks/` (first deploy, deploy and rollback, one-off tasks, restore, secret rotation, incident
response, two-step reset).

## Phase 11 (2026-11-04)

**Security**
- **Two-step verification (TOTP, RFC 6238)** for any merchant or platform user, **required for platform admins**:
  platform endpoints answer 403 `mfa-required` unless the session passed a code. Sign-in becomes password → a
  5-minute, single-use challenge → code. Codes are accepted ±30 s and can't be replayed (last used step stored);
  10 single-use recovery codes are stored hashed; 5 wrong codes lock the account like wrong passwords. The secret is
  encrypted with the platform secrets key. Turning it on or off needs the password and a code, rotates the security
  stamp (other sessions end) and keeps the current one. Switching store, changing password and accepting an
  invitation keep the session's verified state.
- **Session keys persisted** in `data_protection_keys` (platform role only; the app role is refused), so sessions
  survive redeploys and work across API instances. Fixes known issue 21.
- **Headers:** the API sends `default-src 'none'` CSP, `Cross-Origin-Resource-Policy`, HSTS outside Development;
  the web app sends a Content-Security-Policy (Razorpay Checkout, the media CDN and the upload bucket allowed;
  `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`), HSTS in production, COOP and a
  Permissions-Policy (ADR-037). Request bodies over 1 MB are refused (413).
- Dependency audit (`dotnet list package --vulnerable`, `npm audit`) clean; code review of the remaining
  security-sensitive paths (revalidation secret, CSV export, tokens) found nothing new to fix.

**Frontend**
- Login asks for the authenticator or a recovery code when needed. **Your account → Two-step verification**: QR code
  and manual key, confirm with a code, recovery codes shown once (copy/download), regenerate, turn off. Platform
  pages explain how to turn it on instead of failing.

**QA and tooling**
- **CI `e2e` job:** PostgreSQL, Mailpit and MinIO, the API (migrated and seeded) and a production web build, then
  every browser walkthrough (original, Phases 5–11), the axe scan (fails on any serious or critical issue), an
  OWASP ZAP baseline and the load test (both informational; reports uploaded). **CI `secrets` job:** gitleaks over
  the full history with `.gitleaks.toml` (labelled development and test values allowed by path or pattern).
- `perf/load.cjs` (dependency-free load test with p50/p95/p99 against the NFRs) and `perf/k6-storefront.js` (for
  staging). Results in `RELEASE_CHECKLIST.md` §3.
- `docs/RELEASE_CHECKLIST.md`: the Phase 11 exit criterion, with evidence for each item and the open staging items.
- Migration `Phase11Security`. The development platform admin has a labelled dev-only authenticator secret so the
  walkthroughs can sign in to the platform console.

## Phase 10 (2026-11-04)

**Backend**
- **Sales report** (`/api/admin/reports/sales`): orders placed in a range of Indian calendar days that were confirmed
  and not cancelled (the dashboard's rule), with totals (item sales, discounts, delivery, taxable value, CGST/SGST/IGST,
  sales, refunds, net sales, average order), a day/week/month series with empty periods filled, and breakdowns by
  payment method, delivery state and top products. Cancelled orders are reported separately. Ranges up to 366 days.
- **GST report** (`/api/admin/reports/gst`): tax invoices issued in the range (cancelled ones listed separately for
  credit notes), by place of supply and rate, plus an HSN summary. Delivery appears at the rate it was taxed (SAC 9965).
- Both are computed from the amounts stored on orders and lines, so every total and breakdown adds up to the orders
  themselves (ADR-033); tests check each figure against the orders.
- **CSV exports**: orders (every order in the range, any status; needs order access), GST and HSN. UTF-8 with BOM for
  Excel; text cells that start with `=`, `+`, `-` or `@` are prefixed with `'` to stop formula injection.
- **Email preferences** per member and store (new-order alerts, low-stock digest), defaulting by role. New-order alerts
  go to the store's support address plus members who opted in (owners if nobody would get one).
- **Low-stock digest**: daily at 9 am IST, only when the list of low variants has changed.
- **Abandoned-cart reminders**: off by default per store; one email per cart change, about 4 hours after a signed-in
  shopper's last cart change, only to shoppers who currently agree to marketing email; each carries a one-click
  unsubscribe link. Customer tokens now have a purpose, so an unsubscribe link can never be used to reset a password.
- Migration `Phase10Notifications`.

**Frontend**
- **Reports** page: period presets (including Indian financial years) and custom dates, grouping, KPIs, a net-sales
  chart with tooltips and a table view, top products, payment and state breakdowns, GST summary with HSN details, and
  CSV downloads.
- Notification preferences on Your account; abandoned-cart switch in Store settings; storefront unsubscribe page (the
  opt-out needs a click, so link-scanning email filters can't unsubscribe people).

## Phase 9 (2026-11-04)

**Backend**
- **Plans** moved from code to a `plans` table (Trial, Basic ₹999, Pro ₹2,499, Enterprise ₹7,999 a month, excluding 18%
  GST), editable by platform operators; the app role can only read it. Limits on products, team seats and stock
  locations are checked under a lock on the store's row, so parallel requests can't exceed them (verified with six
  concurrent creates against a limit of three). Bringing an archived product back also counts.
- **Lifecycle derived, not set** (ADR-030): a store's status and plan are computed from its subscriptions, its trial and
  any platform suspension. Trial → Active → Past due (7-day grace after a failed charge) → Suspended (unpaid or trial
  ended) → Cancelled (subscription ended). A platform suspension is separate: paying doesn't lift it, and reactivating
  returns the store to its billing state instead of forcing "Active".
- **Razorpay Subscriptions** with ShopMint's own Razorpay account (ADR-029): checkout during the trial schedules the
  first charge for the trial's end; the Checkout callback is verified by HMAC and by reading the subscription back from
  Razorpay; upgrades apply at once, downgrades at the end of the period and only if the store's data fits the smaller
  plan; cancellation at period end; paying again after a failure replaces the old subscription.
- **Webhook** `/api/webhooks/razorpay-billing`: signed with the platform webhook secret, de-duplicated, matched to a
  store by stored subscription ID, and the subscription is read back from Razorpay (so out-of-order deliveries can't
  move it backwards). Charge and invoice events record receipts with Razorpay's hosted invoice link.
- **Billing job** (every 15 minutes): trial-ending reminder (3 days before), trial expiry, grace expiry, reconciliation
  of Razorpay subscriptions (missed webhooks), and renewals in test mode.
- **While closed:** the admin is read-only except Billing, so the owner can always pay; the storefront answers **503**
  "temporarily unavailable" (with `Retry-After`) rather than 404, so search engines keep the store.
- **Emails:** trial ending, payment failed (with the grace date), store closed, subscription active.
- **Platform:** plan editor (limits, prices, Razorpay plan IDs, with `If-Match`), manual plan assignment for contracts
  paid outside Razorpay, and billing state in the store list.
- **Test gateway** for billing in development (same switch as Phase 8: `Payments__AllowTestMode`), labelled everywhere.
- Migration `Phase9Billing`: `plans`, `subscriptions`, `billing_invoices` (RLS) and store billing fields. Existing paid
  stores keep their plan through a platform-assigned subscription; stores suspended before billing are marked as
  platform suspensions. **Bug caught before release:** the first version of this backfill selected stores while forced
  RLS hid them from the migration role, so it silently inserted nothing; a migration test that upgrades a Phase 8
  database with existing stores now covers it.

**Frontend**
- Admin **Billing** page (owner only): current plan and status, usage against limits, plan cards with
  choose/upgrade/switch (with reasons when a plan can't be chosen), Razorpay Checkout for subscriptions or a labelled
  simulator, cancel, and payment receipts.
- Banners for trial days left, failed payment (with the date the store would close), and closed stores (with the reason
  and a link to Billing, or "ask the owner" for staff).
- Platform console: Plans page with an editor; store list shows plan, billing and suspension reason; Assign plan
  dialog; Reactivate only for platform suspensions.
- Storefront "temporarily unavailable" page with a 503 status, decided in `proxy.ts`.

**What "Razorpay Subscriptions" verification means here.** As in Phase 8, Razorpay isn't reachable from this
environment. Subscriptions were exercised against the fake Razorpay in the API tests (create, read, plan change,
cancel, real HMAC signatures for checkout and webhooks) and through the test gateway in the browser, with webhooks
signed using the development secret. **Before launch, run one subscription with ShopMint's Razorpay test keys**
(`DEPLOYMENT_PLAN.md` → Billing).

## Phase 8 (2026-11-04)

Razorpay was approved by the product owner as the storefront payment gateway (`PROJECT_AUDIT.md` §6, decision 2).

**Backend**
- **Checkout** (signed-in shoppers only): `quote` prices the cart on the server (catalogue prices, coupon, delivery fee,
  GST split CGST+SGST or IGST by the seller's and delivery state). Placing an order needs an `Idempotency-Key`; retries
  and double clicks return the same order. Browser-sent prices, discounts and totals are ignored.
- **Stock reservations:** stock rows are locked in a fixed order and reserved inside the order transaction; two shoppers
  racing for the last unit can't both get it. Unpaid online orders hold stock for 15 minutes, then a background job asks
  the gateway once more (catching a missed webhook) and otherwise expires the order and releases the stock.
- **Payments port** `IPaymentGateway` with a Razorpay adapter. Each store connects its **own** Razorpay account; keys are
  checked against Razorpay, then the key secret and webhook secret are stored encrypted (AES-256-GCM, platform key
  `Payments__SecretsKey`) and never returned. Checkout success is confirmed by HMAC signature **and** by reading the
  payment back from Razorpay; amounts must match exactly or the order isn't confirmed.
- **Webhooks** at `/api/webhooks/razorpay/{storeId}`: signature checked against that store's webhook secret, events
  de-duplicated in an inbox table, every handler idempotent (`payment.captured`, `order.paid`, `payment.failed`,
  `refund.processed`, `refund.failed`). A payment that arrives after its order expired or was cancelled is refunded
  automatically.
- **Test gateway** for development and demos (`Payments__AllowTestMode`, refused at startup in Production): used only
  while a store hasn't connected Razorpay; every screen labels it.
- **Cash on delivery** with a per-store switch and order-value limit; payment recorded on delivery.
- **Orders:** per-store numbers, a state machine (awaiting payment → confirmed → packed → shipped → delivered; cancelled,
  expired) with row locks; shipments with tracking (https links only); cancellations restock and refund automatically;
  partial refunds capped by the refundable balance under a lock; COD refunds are recorded as paid back by the store.
- **GST tax invoices:** numbered per store per Indian financial year (`26-27/000001`), with seller, buyer, place of
  supply, HSN, rates and amounts snapshotted at the time of sale.
- **Coupons:** percent (with cap) or fixed, minimum order, dates, total and per-customer limits; usage claimed with a
  conditional update so a limited coupon can't be over-used by parallel checkouts.
- **Emails** (outbox): order confirmation to the shopper, new-order alert to the store, shipped (with tracking),
  cancelled.
- **Store settings:** delivery fee, free-delivery threshold, COD switch and limit, registered business address.
- **Dashboard:** sales for the last 30 days from confirmed orders, net of refunds; null until the first order.
- Products and variants that appear on orders can no longer be deleted (archive instead), closing the gap noted in Phase 7.
- **Bug fix (Phase 6):** images whose uploads finished at the same moment could share a position, making their order
  unstable. Completion now locks the product row; a parallel-upload test covers it.
- Migration `Phase8Orders`: nine tenant tables with RLS (`orders`, `order_lines`, `payment_attempts`, `refunds`,
  `shipments`, `coupons`, `tenant_counters`, `tenant_payment_settings`, `webhook_events`) and the new store settings.

**Frontend**
- Storefront: "Check out" from the cart (guests are asked to sign in first); checkout page with address choice or
  creation, coupon, payment method (online or COD, with reasons when unavailable) and a server-computed summary;
  Razorpay Checkout for connected stores, a clearly labelled simulator in test mode; order confirmation, orders list,
  order page with progress, tracking, refunds, "Pay now" for unpaid orders and cancellation; printable GST invoice.
- Admin: Orders (filters, search) and order detail with pack, ship, deliver, cancel and refund, payment attempts and
  refund history; printable invoice; Coupons; store settings for delivery, COD, business address and the Razorpay
  connection (webhook URL and setup steps); dashboard sales card with a 30-day revenue chart, tooltips and a table view.

**What "sandbox E2E" means here.** This environment can't reach Razorpay, so no live sandbox payment was made. Online
payment was exercised two ways: (1) API integration tests against a fake Razorpay HTTP server that checks credentials
and implements orders, payments and refunds, with real HMAC signatures for checkout and webhooks; (2) the browser
walkthrough using the test gateway. **Before going live, run one order with Razorpay test keys** (see
`DEPLOYMENT_PLAN.md` → Payments).

## Phase 7 (2026-11-04)

**Backend**
- **Shopper accounts** per store with their own cookie scheme: signup, login with lockout, logout, profile with recorded marketing consent, password change and reset (links on the store's own domain). A session is valid only on its store and never authorises admin endpoints.
- **Addresses:** Indian mobile, 6-digit PIN code and GST state code validated; one default.
- **Server-side cart:** guest carts via a hashed HttpOnly cookie token; customer carts follow the shopper across devices; the guest cart merges on sign-in. Prices, totals and availability come from the database on every read; quantities are capped by stock (10 per item, 30 items); lines report later stock or price changes.
- **Admin customers list**; storefront **sitemap** endpoint.
- **Instant storefront refresh:** successful admin writes and platform status changes call the web app's revalidation hook (ADR-020).
- Migration `Phase7Customers` (five tenant tables with RLS).

**Frontend**
- Add to cart with quantity on the product page; header account link and cart count; cart page with quantity changes, stock notes, savings and an honest "checkout opening soon" notice (no fake checkout button).
- Shopper sign in, sign up, forgot and reset password, and an account page (details, password, addresses).
- SEO: store-branded titles, descriptions, canonical URLs, Open Graph, Product JSON-LD, `noindex` on cart, account and filtered listings, per-store `robots.txt` and `sitemap.xml`.
- Real 404 status for unknown stores and products (store-branded page), decided in `proxy.ts` (ADR-022).
- **Security fix:** the internal `/store/<host>/…` routes can no longer be requested directly (previously a crafted path could show one store's pages on another domain).
- Admin Customers page.

## Phase 6 (2026-11-04)

**Backend**
- **Product images:** presigned uploads straight to S3-compatible storage (MinIO in docker-compose). The API checks the stored file (size, real format by magic bytes) before showing it; only JPEG, PNG and WebP; 10 per product; alt text, ordering, deletion. Images appear in admin responses, list thumbnails and the storefront. Abandoned uploads are swept; deleted files are kept 2 hours for cached storefront pages, then removed.
- **Inventory:** stock per variant and location; adjustments with reasons (received, customer return, correction, damaged, lost) and notes, all-or-nothing, under row locks, never below reserved; transfers between locations; a ledger with who, why and when.
- **Locations:** add, rename, change default, delete when empty; plan limits (1 on Trial/Basic, 3 on Pro).
- **Product editor:** existing variants' stock is no longer overwritten when a product is saved; new variants get opening stock at the default location.
- **Categories:** `If-Match` optimistic concurrency.
- Migrations `Phase6Catalog` (product_media with RLS, ledger notes and batches, category version) and `Phase6StorageDeletions`.

**Frontend**
- Product editor image manager: multiple upload with progress, drag and drop, client-side checks, per-file errors, alt text, keyboard-accessible reordering, delete.
- Product list thumbnails; storefront cards and a product-page gallery.
- Inventory page (search, location and stock filters, per-location breakdown) with Adjust, Move and History dialogs; Locations page with plan-limit messaging.
- Shared table fix: visually hidden labels no longer widen the page on phones.

## Phase 5 (2026-11-04)

**Backend**
- **Email outbox:** emails are written in the same transaction as the change and sent over SMTP by a background dispatcher (MailKit, retries with backoff, bodies deleted after delivery). Mailpit is now a default docker-compose service. The app role may only insert into the outbox (RLS + grants).
- **Account recovery:** forgot/reset password (1-hour single-use tokens stored as SHA-256 hashes, no account enumeration, inbox-flood throttle, signs out everywhere and clears lockout); change password (keeps this session, signs out others); email confirmation on signup with resend.
- **Team:** invite by email with a role, resend (rotates the link), revoke, change role, remove. Rank rules: nobody grants Owner or manages people at or above their own role. Plan seat limits count pending invitations. Existing accounts must be signed in as the invited address to accept. Session cache is evicted on role change, removal and password change.
- **Launch:** checklist computed from store state (required: confirmed owner email, support email, a sellable product; optional: branding, GST details, team). Storefront catalogue stays private until launch; `/store` reports `isLive` for a "coming soon" page.
- **Activity log API** with area filter and pagination, isolated per tenant.
- Migration `Phase5Identity` (`user_tokens`, `invitations`, `email_outbox`, `users.email_verified_at`, `tenants.launched_at`) with RLS.

**Frontend**
- Forgot password, reset password, confirm email (click to confirm, so link scanners can't use the token) and accept invitation pages. Token pages send no Referer.
- Admin: Launch checklist page with inline support-email step and Launch button; dashboard card driven by the same checklist; Team page (members, roles, pending invitations, invite dialog, seat usage); Activity log page; Your account page (email status, change password). Nav shows Team and Activity log only to people who can use them. A banner prompts unconfirmed users to confirm their email.
- Storefront "opening soon" page before launch.

## Completed in the first iteration

**Backend (`apps/api`)**
- ASP.NET Core 10 modular monolith with RFC 9457 errors, correlation IDs, JSON logs, security headers, health checks and an OpenAPI document.
- Two-layer tenant isolation: EF global filters plus a write guard, and forced PostgreSQL RLS under a non-owner role. Cross-tenant reads by platform use a separate BYPASSRLS role.
- Cookie sessions (`__Host-`, HttpOnly, Secure, SameSite=Lax) re-validated on each request, CSRF header, account lockout, auth rate limiting, permission-based policies (Owner/Manager/Staff).
- Signup creates tenant, owner, domain and default location in one transaction; login, logout, me, store switching.
- Store settings with GSTIN format/state validation and brand-colour contrast enforcement.
- Catalogue: categories (one level of nesting), products with up to 3 option axes and 100 variants, unique SKUs per tenant, stock ledger, search, filtering, sorting, pagination, `If-Match` optimistic concurrency, archive and delete.
- Storefront read API resolved by host, which hides drafts and exact stock counts.
- Platform: tenant list, suspend and reactivate, with audit entries.
- GST calculator ported from the mock (decimal maths, proportional discount allocation, CGST/SGST/IGST split).
- Demo seeder based on the mock's three stores.

**Frontend (`apps/web`)**
- Design tokens and an owned component library (Radix-based dialog, accessible form fields, toasts, tables).
- Marketing page, login, signup, admin shell (responsive drawer, store switcher, trial and suspension banners), dashboard with real catalogue metrics and honest empty states, product list (URL-synced search, filters and pagination), product editor (variants, options, server error mapping, concurrency conflict handling, archive and delete), categories, store settings (contrast preview), platform console, and storefront (home, listing, product page).

## Verification performed (not just compiled)

| Check | Result |
|---|---|
| `dotnet build` (warnings as errors, analyzers on) | ✅ |
| `dotnet test`: 242 tests on real PostgreSQL 16, including the Phase 13 tests (platform metrics move by exactly the known changes: funnel stages, store counts, orders and net sales equal to the order and to the store's sales report, MRR and past-due MRR, payment success rate, stuck email; Monday weeks; access and range validation; feedback sending, consent-gated email, triage and counts, validation, per-user rate limit, RLS: no read and no cross-store insert by the app role), the Phase 12 tests (configuration from parts, cache-refresh targets, `verify-db` passing and failing on a table without forced RLS or a role that can't connect, operator two-step reset, platform-admin grant/revoke still needing two-step), the Phase 11 suites (RFC 6238 vectors, enrolment, replay refused, recovery codes single-use, lockout after 5 wrong codes, platform endpoints need a verified session and password change keeps it, turning off; API security headers; session keys stored in the database, accepted by a second API instance and unreadable by the app role), the Phase 10 suites (sales and GST reports equal to the orders across COD/online, two states, two rates, refunds, cancellations and unpaid orders; IST day boundaries and week starts; range validation; store isolation; CSV exports with formula injection neutralised; member email preferences and new-order recipients; low-stock digest once per change and only after 9 am IST; abandoned-cart reminders only with consent, once per change, unsubscribe on its own store only, and unsubscribe tokens refused as password resets), the Phase 9 suites (plan limits from the database under concurrency, trial limits, subscribing during the trial, downgrades blocked by usage and applied at period end, upgrades at once, forged and cross-store checkout signatures, trial expiry closing the store and payment reopening it, 7-day grace then suspension, halted subscriptions replaced, cancellation at period end, platform suspension not liftable by paying, owner-only billing, signed/de-duplicated/read-back webhooks with receipts, platform plan editing and assignment, the test gateway, lifecycle rules, and the Phase 9 data migration on a database with existing stores) and the Phase 8 suites: server-side pricing and GST split, COD flow and limits, idempotent placement (concurrent retries → one order), 12 concurrent checkouts for the last unit (exactly one wins), reservation expiry and reconciliation, Razorpay signature and amount checks against a fake Razorpay, encrypted secrets, webhook redelivery, wrong amount, cross-store webhooks, late capture auto-refund, cancellation restock and refund, refund caps and permissions, coupon limits, order isolation, real dashboard sales, ordered products can't be deleted, parallel image uploads | ✅ 242/242 |
| `npm run lint`, `tsc --noEmit`, `next build` | ✅ (3 informational React Compiler warnings about `react-hook-form` `watch`) |
| `vitest`: 87 tests (incl. metrics ranges, funnel percentages, payment and email health, count axes, feedback form; incl. amount in words, Phase 8 schemas, Idempotency-Key header, sales chart helpers, platform plan form, report date ranges and financial years, MFA-required detection) | ✅ 87/87 |
| Browser walkthrough (`apps/web/e2e/walkthrough.cjs`) against the running stack: login failure and success, search, client and server validation, product create, duplicate SKU 409, settings save, storefront filter/sort, product page variant availability, logout | ✅ |
| Responsive: no horizontal overflow at 390 px on 6 key pages; screenshots reviewed at 1280 and 390 px | ✅ |
| Phase 5 browser walkthrough (`apps/web/e2e/phase5.cjs`), 26 checks: signup → coming-soon storefront → confirm email from a **real SMTP-delivered** message → launch checklist validation → launch → catalogue visible; invite → accept on a 390 px phone → staff nav limits → single-use link → role change signs the member out → activity log entries and filter; forgot/reset password; account page | ✅ 26/26, no browser errors |
| Phase 6 browser walkthrough (`apps/web/e2e/phase6.cjs`), 38 checks, against an S3-compatible server (moto) with real presigned uploads: images upload and render in admin and storefront; a disguised SVG and an oversized file are refused; alt text and order persist; saving a product leaves stock alone; receipt, refusal below zero, history with notes; locations with plan limit; transfer keeps totals; stocked location can't be deleted; stale category edit refused; deleted image hidden while its file is kept; no overflow at 390 px | ✅ 38/38, no browser errors |
| Phase 7 browser walkthrough (`apps/web/e2e/phase7.cjs`), 34 checks: guest add to cart, catalogue pricing, no fake checkout; sign up keeps the guest cart; address validation; a second device (390 px) sees the same cart; session not valid on another store; sign out; merchant change visible on the storefront in 0.7 s; titles, canonical, JSON-LD, Open Graph, `noindex`; 404 for unknown product, unknown store and internal paths; shopper password reset by email | ✅ 34/34, no browser errors |
| Phase 8 browser walkthrough (`apps/web/e2e/phase8.cjs`), 60 checks: merchant delivery/COD settings, payments card and webhook URL, malformed key refused; coupon validation; sign-up returns to checkout; address; server quote with CGST+SGST; coupon errors and discount; COD order, confirmation email, cart cleared, GST invoice (number series, GSTIN, amount in words); test-mode payment declined then paid with "Pay now"; concurrent retries → one order; missing key refused; browser-sent prices ignored; shopper cancel; admin filters and search, pack, ship (insecure link refused, tracking email), deliver, over-refund refused, partial refund; dashboard sales and table view; unsigned webhook refused; another shopper can't read or pay the order | ✅ 60/60, no browser errors |
| Lighthouse (mobile) on 4 storefront pages | ✅ Performance 93–95, Accessibility 100, Best practices 100, SEO 91–92 |
| Phase 9 browser walkthrough (`apps/web/e2e/phase9.cjs`), 46 checks: trial banner and one-location limit; billing page in test mode with GST prices and usage; declined then successful subscription during the trial (first charge at trial end, Pro limits at once); charge webhook → active with receipt and email; downgrade blocked by usage; failed payment → past-due banner and email, store open; halted → closed banner, read-only admin, storefront 503 "temporarily unavailable"; paying again reopens it; cancel at period end; platform plans (bad Razorpay ID refused), plan assignment, platform suspension not liftable by the merchant, reactivation back to the billing state | ✅ 46/46, no browser errors |
| Phase 10 browser walkthrough (`apps/web/e2e/phase10.cjs`), 35 checks: a new store takes COD and online orders in two states at two GST rates, one below free delivery, a partial refund, a cancellation and an unpaid order; the report's orders, sales, refunds, net sales and GST equal the sums over the orders; the page shows them; GST rows per state and rate, cancelled-invoice note, delivery under SAC 9965; the orders CSV has one row per order and its totals add up; empty and financial-year ranges; new-order email preference takes effect; abandoned-cart switch; unsubscribe page errors | ✅ 35/35, no browser errors |
| Infrastructure: `tsc`, 21 assertion tests on the synthesised templates (incl. budget notifications and burn-rate alarm windows), `cdk synth` of staging and production (6 stacks each, no AWS calls) | ✅ 21/21; both synthesise |
| Phase 13 browser walkthrough (`apps/web/e2e/phase13.cjs`), 26 checks: merchant sends feedback (empty form refused with reasons), can't read the inbox; platform admin finds it with store, page and consented email, sets Planned with a note, filters by status; section navigation; metrics page MRR, store count and net sales equal the API, funnel count, one bar per week in both charts, table view equal to the API, period change; no overflow at 390 px. Run twice in a row | ✅ 26/26 both runs, no browser errors |
| axe-core on 49 pages (adds Platform → Metrics and Feedback) | ✅ 0 serious or critical |
| `deploy-db` on a fresh PostgreSQL 16 server as a **non-superuser** master user (simulating RDS), configuration from parts, run twice | ✅ roles and database created, 9 migrations, forced RLS on all 28 tenant tables, database owned by `shopmint_owner`; second run a no-op |
| Production mode locally (API `ASPNETCORE_ENVIRONMENT=Production`, configuration from parts, web production build): `ops/smoke.cjs` | ✅ 14/14 |
| Production guards: missing `Payments:SecretsKey`, `Proxy:TrustAll`, test mode on | ✅ each refused at startup with its message |
| Rate limits key on `X-ShopMint-Client-Ip` (limit 3/min) | ✅ same client: 401 401 401 429; four clients: all 401 |
| Cache refresh in production mode: tagline changed through the API → storefront title updated within 1.5 s (call made to the resolved address with the original host) | ✅ |
| **Restore drill** (`ops/restore-drill-local.sh`): back up roles and database, restore into a brand-new PostgreSQL 16 server, `verify-db` on both, compare row counts; then point the production-mode API at the restored server with the original stopped | ✅ all checks pass, counts match, restore 4 s; a session created **before** the backup still works, new sign-in works, smoke 14/14 |
| Operator commands in production mode: `reset-mfa` (platform admin signs in without a code afterwards; unknown email exit 2), `verify-db` from the **container image** | ✅ |
| API image with the CA bundle (non-root, uid 1654) | ✅ built (sandbox proxy CA added only to a scratch copy of the Dockerfile) |
| Phase 11 browser walkthrough (`apps/web/e2e/phase11.cjs`), 28 checks: turn on two-step verification from the account page (QR and key, wrong code refused, 10 recovery codes shown once), sign in with a code and with a recovery code, a used recovery code refused, the enabling browser stays signed in, turn it off; the platform admin reaches the console only after the code step; CSP, HSTS, no `X-Powered-By` and `nosniff` on live responses; storefront, product editor and reports work under the CSP with no browser errors | ✅ 28/28, no browser errors |
| Phase 10, 9, 8, 7, 6, 5 and original walkthroughs (regression, after Phase 11, with MFA and the CSP on) | ✅ 35/35, 46/46, 60/60, 33/33, 38/38, 26/26; original walkthrough passes (its 401/409 are its own wrong-password and duplicate-SKU steps) |
| Load test (`perf/load.cjs`, 20 clients × 15 s, local) | API reads p95 37–47 ms, checkout quote p95 57 ms, 0 errors ✅. Storefront HTML p95 302–402 ms ❌ against ShopMint's own 300 ms page target: one Next.js process tops out at ~70 pages/s, so at 20 clients requests queue (p95 20–24 ms with 1 client, 82–98 ms with 5). See known issue 24 |
| Docker images (`apps/api/Dockerfile`, `apps/web/Dockerfile`) | ✅ Both built (in this sandbox via a copy that adds its proxy CA as a build secret; the committed Dockerfiles are unchanged) |
| Phase 9, 8, 7, 6, 5 and original walkthroughs (regression, after Phase 10) | ✅ 46/46, 60/60, 33/33, 38/38, 26/26; original walkthrough passes |
| Phase 8, 7, 6, 5 and original walkthroughs (regression, after Phase 9) | ✅ 60/60, 33/33, 38/38, 26/26; original walkthrough passes |
| Phase 7, Phase 6, Phase 5 and original walkthroughs (regression, after Phase 8) | ✅ 33/33, 38/38, 26/26; original walkthrough passes (its two logged 401/409 responses are its own wrong-password and duplicate-SKU steps) |
| axe-core WCAG 2.1 A/AA on 47 pages, re-run after Phase 11 with the CSP and the two-step card (incl. reports and the shopper unsubscribe page; checkout, order, invoice and orders pages for shoppers; orders, order detail, invoice, coupons and billing (active and trial) for merchants; platform stores and plans) | ✅ 0 serious or critical |
| No horizontal overflow at 390 px on the 8 new pages | ✅ |
| `npm audit --omit=dev`, `dotnet list package --vulnerable` | ✅ 0 known vulnerabilities |
| `docker compose config` | ✅ valid |

**Not verified in this environment (Phase 12):** nothing was deployed to AWS (no account or credentials here), so
`cdk deploy`, the deploy workflow, CloudFront (edge function, header handling, the origin-header dynamic reference),
WAF, RDS (TLS `VerifyFull` with the CA bundle, whether the master user may create a `BYPASSRLS` role), AWS Backup
copies, alarms and the RDS point-in-time restore drill are untested. These are the first items on staging
(`RELEASE_CHECKLIST.md` §4). `cdk-nag` and `actionlint` weren't run.

**Not verified in this environment (earlier):** running the whole docker-compose stack (the images build, but the sandbox's
TLS proxy needs a build-time CA the committed Dockerfiles don't have); uploads were verified against moto, an
S3-compatible test server. gitleaks, the ZAP baseline and k6 couldn't be run here (downloading and running those
binaries wasn't permitted in this sandbox); they run in CI (gitleaks, ZAP) or on staging (k6). A regex scan of the
full git history found only two labelled placeholders. CI results are checked on the pull request.

## Known issues and limitations

1. **Metadata placement:** Next.js streams page metadata into the body for browsers and JavaScript-capable crawlers (Googlebot reads it); non-JS crawlers such as link previewers get it in `<head>`. Lighthouse's description check only looks at `<head>`, which is the remaining SEO deduction.
2. **Session revocation delay:** role changes, removals and password changes now evict the session cache on the API instance that handled them (immediate there). Other instances, and platform suspension, still take up to `Auth:SessionCacheSeconds` (30 s). Revisit with a shared cache when the API runs on several instances.
3. **Storefront freshness:** changes appear within a second when the refresh hook is configured (ADR-020). With several web tasks the API calls each one (Phase 12 fan-out); a task that misses the call (starting up, network error) serves its cached page until it expires. The 404 check in `proxy.ts` caches answers for up to 60 s.
4. **Razorpay live sandbox** not exercised from this environment (no network access to Razorpay), for either shoppers' payments or ShopMint's subscriptions. Covered by a fake Razorpay in tests; one test-key order and one test-key subscription must be run before launch.
5. **Images** are served at their uploaded size unless `MEDIA_PUBLIC_URL` points at a public CDN (then Next.js resizes them). There is no server-side thumbnail generation yet. A removed image's URL keeps working for up to 2 hours (ADR-019).
6. **Billing gaps:** no proration (an upgrade is charged the new plan's amount by Razorpay; a downgrade waits for the period end); no annual plans or coupons for ShopMint plans; GST invoices for ShopMint's fees rely on Razorpay's invoices (configure GST in ShopMint's Razorpay account); the custom-domain entitlement exists but custom domains aren't built; after a store is cancelled its data is kept indefinitely (the 30-day deletion workflow isn't built).
7. **End-to-end tests** are plain Playwright scripts (one per phase) run by the CI `e2e` job against a real stack. They run sequentially and share the seeded data; moving them to `@playwright/test` with parallel, isolated workers is a later improvement.
8. **Dark mode** is not implemented.
9. Login failures and password resets are recorded in structured logs, not in the tenant activity log (they have no tenant).
10. **Ownership transfer** and **unpublishing a launched store** are not available yet. A store's owner can't be removed or demoted through the Team page.
11. **Email templates** are fixed in code (English), including order emails. Merchant-branded templates are a later improvement.
12. The email dispatcher runs inside the API process. It is safe across several instances (row locking) and can move to a worker later without code changes.
13. Changing a member's role signs them out (their session carries the old role); they sign in again to pick up the new one.
14. **Delivery** is one flat fee per order with an optional free-delivery threshold; no weight or zone rates, and no courier integration (tracking is entered by hand).
15. Shopper **email addresses aren't verified** (deferred from Phase 8: checkout needs a signed-in account, and the confirmation email goes to that address). Shopper sign-ups and logins aren't in the activity log.
16. **Returns and credit notes** aren't modelled: refunds are recorded against the original invoice. Partial cancellation of some items isn't supported.
17. **Invoices** are printed or saved as PDF from the browser; no PDF file is generated or stored by the server.
18. **Test mode** (`Payments__AllowTestMode`) is on in `appsettings.Development.json` and docker-compose for local use, for shoppers' payments and ShopMint billing. The API refuses to start in Production with it on.
19. **Plan limits apply to new additions.** Lowering a plan's limits (platform edit) or a downgrade when usage has grown since doesn't remove anything; it blocks adding more until usage is under the limit.
20. The storefront's "temporarily unavailable" decision is cached by `proxy.ts` for up to 60 s, so a store can take up to a minute to close or reopen on the storefront (the admin and API change at once).
21. ~~Data protection keys aren't persisted or shared~~ Fixed in Phase 11: the key ring is in `data_protection_keys`. It isn't encrypted at rest beyond RDS encryption; wrapping it with KMS is a later hardening step.
22. **Reports** count orders by the date they were placed (sales) or invoiced (GST), in Indian time; a refund reduces the sale it belongs to, even if it happens in a later period. Reports cover up to 366 days and 50,000 orders per request.
23. **Abandoned-cart reminders** only reach signed-in shoppers (guest carts have no email address), and the timing (4 hours, once per change) isn't configurable yet.
24. **Storefront HTML throughput:** one Next.js process renders about 70 storefront pages a second on one vCPU (pages are about 80 KB with a prerendered shell). Size web tasks from this (see `RELEASE_CHECKLIST.md` §3) and confirm with k6 on staging; a CDN cache for anonymous storefront HTML would cut it further.
25. **CSP allows inline scripts** (`'unsafe-inline'`) because Next.js inlines its bootstrap scripts and nonces would make every page dynamic, losing the prerendered storefront (ADR-037). Other directives are strict.
26. **Two-step verification** is TOTP only (no passkeys/WebAuthn yet). Required for platform admins; optional for merchants. Anyone who loses both the authenticator and the recovery codes can't sign in until an operator runs `reset-mfa` after checking their identity out of band (runbook `mfa-reset.md`); a password reset doesn't remove it (by design). A self-service recovery flow is a later item.
27. **Not deployed yet.** Everything in Phase 12 is verified locally and by template tests only; see "Not verified in this environment (Phase 12)" above.
28. **`Payments__SecretsKey` can't be rotated in place** (no re-encryption job). It now protects two-step secrets as well as merchants' Razorpay keys. Back it up offline (runbook `first-deploy.md`).
29. **Custom merchant domains** aren't wired into CloudFront (one certificate covers `*.shopmint.in`); custom domains need a certificate per domain or CloudFront's multi-tenant distributions.
30. **Hardening still open:** read-only root filesystems for the containers, KMS customer-managed keys (AWS-managed keys are used), CloudFront access logs, `cdk-nag` in CI, VPC interface endpoints (traffic to AWS APIs goes through NAT).
31. **Local images are not persistent:** docker-compose's S3 server (moto) keeps uploaded images in memory, so they disappear when the `media` container restarts.
32. **Metrics are computed per request** from the operational database and describe a sign-up cohort's current state (no history of when a store churned). Fine at launch scale; move to snapshots or a replica as data grows (ADR-043).
33. **Merchants can't see their own past feedback** or its status; replies happen by email when they consented.
34. **No targets yet** for the business metrics or confirmed SLOs: they need four weeks of production data (`OPERATING_REVIEW.md`).

## Next actionable tasks (in order)

1. Product-owner review of the remaining `PROJECT_AUDIT.md` §6 decisions (ERP deferral, shared database, per-store shopper accounts). Razorpay is approved.
2. On a staging host reachable by Razorpay: one shopper order with a store's Razorpay test keys, and one ShopMint subscription with the platform's test keys (steps in `DEPLOYMENT_PLAN.md` → Payments and Billing).
3. Product owner: confirm plan prices and limits (currently the mock's), and whether prices are shown excluding GST (current) or including it.
4. **First AWS deployment of staging** (`docs/runbooks/first-deploy.md`): confirm `deploy-db` on RDS (BYPASSRLS), TLS `VerifyFull`, the edge function and origin header, smoke with `--edge`; then the RDS restore drill and the Razorpay test-key runs.
5. Work through the remaining items in `RELEASE_CHECKLIST.md` (ZAP review, k6 on staging, external penetration test, sign-off), then production.
6. Before launch: set `MONTHLY_BUDGET_USD` in each GitHub environment (suggested 300 staging, 1050 production, `COST_REVIEW.md`); agree the error-budget policy (`SLO.md`).
7. After four weeks of production traffic: first monthly operating review sets the targets in `OPERATING_REVIEW.md`.
