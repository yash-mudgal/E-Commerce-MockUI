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
| 6 Catalogue | 🟡 Partial | Products, variants, categories, stock-on-hand with ledger done. Media uploads, inventory adjustments UI and multi-location to do |
| 7 Storefront | 🟡 Partial | SSR home, listing, search, filters and product page done. Cart, customer accounts and SEO metadata/sitemap to do |
| 8–13 | ⏳ Not started | See `IMPLEMENTATION_ROADMAP.md` |

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
| `dotnet test`: 112 tests on real PostgreSQL 16 (auth, account recovery, invitations and roles, onboarding and launch, activity log, email outbox RLS and dispatcher, catalogue, tenant isolation via API, RLS via raw SQL, storefront, platform, unit rules) | ✅ 112/112 |
| `npm run lint`, `tsc --noEmit`, `next build` | ✅ (3 informational React Compiler warnings about `react-hook-form` `watch`) |
| `vitest`: 32 tests | ✅ 32/32 |
| Browser walkthrough (`apps/web/e2e/walkthrough.cjs`) against the running stack: login failure and success, search, client and server validation, product create, duplicate SKU 409, settings save, storefront filter/sort, product page variant availability, logout | ✅ |
| Responsive: no horizontal overflow at 390 px on 6 key pages; screenshots reviewed at 1280 and 390 px | ✅ |
| Phase 5 browser walkthrough (`apps/web/e2e/phase5.cjs`), 26 checks: signup → coming-soon storefront → confirm email from a **real SMTP-delivered** message → launch checklist validation → launch → catalogue visible; invite → accept on a 390 px phone → staff nav limits → single-use link → role change signs the member out → activity log entries and filter; forgot/reset password; account page | ✅ 26/26, no browser errors |
| Original walkthrough (regression) | ✅ |
| axe-core WCAG 2.1 A/AA on 22 pages (incl. all Phase 5 pages, a new unlaunched store and its coming-soon storefront) | ✅ 0 serious or critical |
| No horizontal overflow at 390 px on the 8 new pages | ✅ |
| `npm audit --omit=dev`, `dotnet list package --vulnerable` | ✅ 0 known vulnerabilities |
| `docker compose config` | ✅ valid |

**Not verified in this environment:** building the Docker images (no container registry access), and the
GitHub Actions run, which first runs on the pull request.

## Known issues and limitations

1. **Storefront not-found status:** with streaming (Partial Prerendering), an unknown store host renders the not-found page with HTTP 200 (and `noindex`). Fix in Phase 7: resolve the host in `proxy.ts` (cached) and return a real 404.
2. **Session revocation delay:** role changes, removals and password changes now evict the session cache on the API instance that handled them (immediate there). Other instances, and platform suspension, still take up to `Auth:SessionCacheSeconds` (30 s). Revisit with a shared cache when the API runs on several instances.
3. **Storefront freshness:** catalogue edits and launching appear on storefronts after about a minute (measured 61 s after launch in the walkthrough), because store data is cached with `cacheLife("minutes")`. The launch screen says so. Tag-based revalidation from API events is planned for Phase 7.
4. **Product deletion** is a hard delete (there are no orders yet). Phase 8 must block deletion of ordered variants and archive instead.
5. **Stock** is edited as on-hand per variant at the default location through the product editor. A dedicated adjustments UI with reasons and multi-location arrives in Phase 6.
6. **Plans and entitlements** are defined in code (`Plans.cs`) until the Billing module (Phase 9).
7. **End-to-end tests** are a script run against a local stack, not yet a CI job. They become a `@playwright/test` suite with a compose-based CI job in Phase 11.
8. **Dark mode** is not implemented.
9. Login failures and password resets are recorded in structured logs, not in the tenant activity log (they have no tenant).
10. **Ownership transfer** and **unpublishing a launched store** are not available yet. A store's owner can't be removed or demoted through the Team page.
11. **Email templates** are fixed in code (English). Merchant-branded templates come with order emails in Phase 8.
12. The email dispatcher runs inside the API process. It is safe across several instances (row locking) and can move to a worker later without code changes.
13. Changing a member's role signs them out (their session carries the old role); they sign in again to pick up the new one.

## Next actionable tasks (in order)

1. Product-owner review of `PROJECT_AUDIT.md` §6 decisions (ERP deferral, Razorpay, India-first, tenant model).
2. **Phase 6:** S3 media uploads (presigned, validated), inventory adjustments with reasons, locations, `If-Match` on categories.
3. **Phase 7:** server cart, customer accounts (separate auth scheme), addresses, SEO metadata and sitemap, real 404s by host, tag revalidation.
4. **Phase 8:** checkout with stock reservations, Razorpay adapter and webhooks (inbox/outbox), COD, GST invoices, order state machine, refunds, transactional emails.
