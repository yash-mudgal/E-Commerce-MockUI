# Project Progress

_Last updated: 2026-11-04_

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
| 9–13 | ⏳ Not started | See `IMPLEMENTATION_ROADMAP.md` |

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
| `dotnet test`: 186 tests on real PostgreSQL 16, including the Phase 8 suites: server-side pricing and GST split, COD flow and limits, idempotent placement (concurrent retries → one order), 12 concurrent checkouts for the last unit (exactly one wins), reservation expiry and reconciliation, Razorpay signature and amount checks against a fake Razorpay, encrypted secrets, webhook redelivery, wrong amount, cross-store webhooks, late capture auto-refund, cancellation restock and refund, refund caps and permissions, coupon limits, order isolation, real dashboard sales, ordered products can't be deleted, parallel image uploads | ✅ 186/186 |
| `npm run lint`, `tsc --noEmit`, `next build` | ✅ (3 informational React Compiler warnings about `react-hook-form` `watch`) |
| `vitest`: 71 tests (incl. amount in words, Phase 8 schemas, Idempotency-Key header, sales chart helpers) | ✅ 71/71 |
| Browser walkthrough (`apps/web/e2e/walkthrough.cjs`) against the running stack: login failure and success, search, client and server validation, product create, duplicate SKU 409, settings save, storefront filter/sort, product page variant availability, logout | ✅ |
| Responsive: no horizontal overflow at 390 px on 6 key pages; screenshots reviewed at 1280 and 390 px | ✅ |
| Phase 5 browser walkthrough (`apps/web/e2e/phase5.cjs`), 26 checks: signup → coming-soon storefront → confirm email from a **real SMTP-delivered** message → launch checklist validation → launch → catalogue visible; invite → accept on a 390 px phone → staff nav limits → single-use link → role change signs the member out → activity log entries and filter; forgot/reset password; account page | ✅ 26/26, no browser errors |
| Phase 6 browser walkthrough (`apps/web/e2e/phase6.cjs`), 38 checks, against an S3-compatible server (moto) with real presigned uploads: images upload and render in admin and storefront; a disguised SVG and an oversized file are refused; alt text and order persist; saving a product leaves stock alone; receipt, refusal below zero, history with notes; locations with plan limit; transfer keeps totals; stocked location can't be deleted; stale category edit refused; deleted image hidden while its file is kept; no overflow at 390 px | ✅ 38/38, no browser errors |
| Phase 7 browser walkthrough (`apps/web/e2e/phase7.cjs`), 34 checks: guest add to cart, catalogue pricing, no fake checkout; sign up keeps the guest cart; address validation; a second device (390 px) sees the same cart; session not valid on another store; sign out; merchant change visible on the storefront in 0.7 s; titles, canonical, JSON-LD, Open Graph, `noindex`; 404 for unknown product, unknown store and internal paths; shopper password reset by email | ✅ 34/34, no browser errors |
| Phase 8 browser walkthrough (`apps/web/e2e/phase8.cjs`), 60 checks: merchant delivery/COD settings, payments card and webhook URL, malformed key refused; coupon validation; sign-up returns to checkout; address; server quote with CGST+SGST; coupon errors and discount; COD order, confirmation email, cart cleared, GST invoice (number series, GSTIN, amount in words); test-mode payment declined then paid with "Pay now"; concurrent retries → one order; missing key refused; browser-sent prices ignored; shopper cancel; admin filters and search, pack, ship (insecure link refused, tracking email), deliver, over-refund refused, partial refund; dashboard sales and table view; unsigned webhook refused; another shopper can't read or pay the order | ✅ 60/60, no browser errors |
| Lighthouse (mobile) on 4 storefront pages | ✅ Performance 93–95, Accessibility 100, Best practices 100, SEO 91–92 |
| Phase 7, Phase 6, Phase 5 and original walkthroughs (regression, after Phase 8) | ✅ 33/33, 38/38, 26/26; original walkthrough passes (its two logged 401/409 responses are its own wrong-password and duplicate-SKU steps) |
| axe-core WCAG 2.1 A/AA on 41 pages (incl. checkout, order, invoice and orders pages for shoppers; orders, order detail, invoice and coupons for merchants) | ✅ 0 serious or critical |
| No horizontal overflow at 390 px on the 8 new pages | ✅ |
| `npm audit --omit=dev`, `dotnet list package --vulnerable` | ✅ 0 known vulnerabilities |
| `docker compose config` | ✅ valid |

**Not verified in this environment:** building the Docker images and running docker-compose (Docker isn't available
here), so the MinIO bucket set-up in compose is untested; uploads were verified against moto, an S3-compatible test
server. CI results are checked on the pull request.

## Known issues and limitations

1. **Metadata placement:** Next.js streams page metadata into the body for browsers and JavaScript-capable crawlers (Googlebot reads it); non-JS crawlers such as link previewers get it in `<head>`. Lighthouse's description check only looks at `<head>`, which is the remaining SEO deduction.
2. **Session revocation delay:** role changes, removals and password changes now evict the session cache on the API instance that handled them (immediate there). Other instances, and platform suspension, still take up to `Auth:SessionCacheSeconds` (30 s). Revisit with a shared cache when the API runs on several instances.
3. **Storefront freshness:** changes appear within a second when the refresh hook is configured (ADR-020). With several web servers each keeps its own cache until a shared cache handler is configured (see `DEPLOYMENT_PLAN.md`). The 404 check in `proxy.ts` caches answers for up to 60 s.
4. **Razorpay live sandbox** not exercised from this environment (no network access to Razorpay). Covered by a fake Razorpay in tests; one test-key order must be run before launch.
5. **Images** are served at their uploaded size unless `MEDIA_PUBLIC_URL` points at a public CDN (then Next.js resizes them). There is no server-side thumbnail generation yet. A removed image's URL keeps working for up to 2 hours (ADR-019).
6. **Plans and entitlements** are defined in code (`Plans.cs`) until the Billing module (Phase 9).
7. **End-to-end tests** are a script run against a local stack, not yet a CI job. They become a `@playwright/test` suite with a compose-based CI job in Phase 11.
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
18. **Test mode** (`Payments__AllowTestMode`) is on in `appsettings.Development.json` and docker-compose for local use. The API refuses to start in Production with it on.

## Next actionable tasks (in order)

1. Product-owner review of the remaining `PROJECT_AUDIT.md` §6 decisions (ERP deferral, shared database, per-store shopper accounts). Razorpay is approved.
2. Run one order with Razorpay **test keys** on a staging host reachable by Razorpay webhooks (steps in `DEPLOYMENT_PLAN.md` → Payments).
3. **Phase 9:** SaaS billing (plans, trials, Razorpay Subscriptions, dunning, suspension).
