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
| 8–13 | ⏳ Not started | See `IMPLEMENTATION_ROADMAP.md` |

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
| `dotnet test`: 160 tests on real PostgreSQL 16 (shopper sessions bound to their store, cart pricing from the database, guest-cart merge and cross-device cart, stock caps, addresses, customer and cart RLS, storefront refresh triggers, plus everything from earlier phases) | ✅ 160/160 |
| `npm run lint`, `tsc --noEmit`, `next build` | ✅ (3 informational React Compiler warnings about `react-hook-form` `watch`) |
| `vitest`: 50 tests | ✅ 50/50 |
| Browser walkthrough (`apps/web/e2e/walkthrough.cjs`) against the running stack: login failure and success, search, client and server validation, product create, duplicate SKU 409, settings save, storefront filter/sort, product page variant availability, logout | ✅ |
| Responsive: no horizontal overflow at 390 px on 6 key pages; screenshots reviewed at 1280 and 390 px | ✅ |
| Phase 5 browser walkthrough (`apps/web/e2e/phase5.cjs`), 26 checks: signup → coming-soon storefront → confirm email from a **real SMTP-delivered** message → launch checklist validation → launch → catalogue visible; invite → accept on a 390 px phone → staff nav limits → single-use link → role change signs the member out → activity log entries and filter; forgot/reset password; account page | ✅ 26/26, no browser errors |
| Phase 6 browser walkthrough (`apps/web/e2e/phase6.cjs`), 38 checks, against an S3-compatible server (moto) with real presigned uploads: images upload and render in admin and storefront; a disguised SVG and an oversized file are refused; alt text and order persist; saving a product leaves stock alone; receipt, refusal below zero, history with notes; locations with plan limit; transfer keeps totals; stocked location can't be deleted; stale category edit refused; deleted image hidden while its file is kept; no overflow at 390 px | ✅ 38/38, no browser errors |
| Phase 7 browser walkthrough (`apps/web/e2e/phase7.cjs`), 34 checks: guest add to cart, catalogue pricing, no fake checkout; sign up keeps the guest cart; address validation; a second device (390 px) sees the same cart; session not valid on another store; sign out; merchant change visible on the storefront in 0.7 s; titles, canonical, JSON-LD, Open Graph, `noindex`; 404 for unknown product, unknown store and internal paths; shopper password reset by email | ✅ 34/34, no browser errors |
| Lighthouse (mobile) on 4 storefront pages | ✅ Performance 93–95, Accessibility 100, Best practices 100, SEO 91–92 |
| Phase 6, Phase 5 and original walkthroughs (regression) | ✅ (Phase 5's launch-to-visible time dropped from 61 s to immediate) |
| axe-core WCAG 2.1 A/AA on 32 pages (incl. shopper sign-in, sign-up, cart and account pages) | ✅ 0 serious or critical |
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
4. **Product deletion** is a hard delete (there are no orders yet). Phase 8 must block deletion of ordered variants and archive instead.
5. **Images** are served at their uploaded size unless `MEDIA_PUBLIC_URL` points at a public CDN (then Next.js resizes them). There is no server-side thumbnail generation yet. A removed image's URL keeps working for up to 2 hours (ADR-019).
6. **Plans and entitlements** are defined in code (`Plans.cs`) until the Billing module (Phase 9).
7. **End-to-end tests** are a script run against a local stack, not yet a CI job. They become a `@playwright/test` suite with a compose-based CI job in Phase 11.
8. **Dark mode** is not implemented.
9. Login failures and password resets are recorded in structured logs, not in the tenant activity log (they have no tenant).
10. **Ownership transfer** and **unpublishing a launched store** are not available yet. A store's owner can't be removed or demoted through the Team page.
11. **Email templates** are fixed in code (English). Merchant-branded templates come with order emails in Phase 8.
12. The email dispatcher runs inside the API process. It is safe across several instances (row locking) and can move to a worker later without code changes.
13. Changing a member's role signs them out (their session carries the old role); they sign in again to pick up the new one.
14. **Checkout** isn't built yet: shoppers can fill a cart and are told to email the store to order. Phase 8 adds checkout, payments and orders.
15. Shopper **email addresses aren't verified** yet; verification will be required at checkout (Phase 8). Shopper sign-ups and logins aren't in the activity log.

## Next actionable tasks (in order)

1. Product-owner review of `PROJECT_AUDIT.md` §6 decisions (ERP deferral, Razorpay, India-first, tenant model).
2. **Phase 8:** checkout with stock reservations, Razorpay adapter and webhooks (inbox/outbox), COD, GST invoices, order state machine, refunds, transactional emails.
