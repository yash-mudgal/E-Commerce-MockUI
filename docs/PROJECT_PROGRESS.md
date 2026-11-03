# Project Progress

_Last updated: 2026-11-03_

## Current status

| Phase | Status | Notes |
|---|---|---|
| 0 Audit & requirements | ✅ Done | `PROJECT_AUDIT.md`, `CURRENT_STATE_ANALYSIS.md`, `PRODUCT_REQUIREMENTS.md` |
| 1 Architecture | ✅ Done, **awaiting product-owner sign-off** on `PROJECT_AUDIT.md` §6 | ADRs in `DECISIONS.md` |
| 2 Design system | 🟡 Core done | Tokens, primitives and representative screens built and verified. Dark mode and the full screen inventory come with later phases |
| 3 Foundation | ✅ Done | Monorepo, API skeleton, migrations, logging, ProblemDetails, health, OpenAPI, CI, docker-compose |
| 4 Auth & multi-tenancy | ✅ Done (4b pending) | Password reset, email verification and invitations move to Phase 5 |
| 5 Onboarding & platform admin | 🟡 Partial | Self-serve signup and platform tenant list/suspend done. Onboarding wizard, invitations and staff UI to do |
| 6 Catalogue | 🟡 Partial | Products, variants, categories, stock-on-hand with ledger done. Media uploads, inventory adjustments UI and multi-location to do |
| 7 Storefront | 🟡 Partial | SSR home, listing, search, filters and product page done. Cart, customer accounts and SEO metadata/sitemap to do |
| 8–13 | ⏳ Not started | See `IMPLEMENTATION_ROADMAP.md` |

## Completed in this iteration

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
| `dotnet test`: 72 tests on real PostgreSQL 16 (auth, authorisation, catalogue, tenant isolation via API, RLS via raw SQL, storefront, platform, unit rules) | ✅ 72/72 |
| `npm run lint`, `tsc --noEmit`, `next build` | ✅ (3 informational React Compiler warnings about `react-hook-form` `watch`) |
| `vitest`: 24 tests | ✅ 24/24 |
| Browser walkthrough (`apps/web/e2e/walkthrough.cjs`) against the running stack: login failure and success, search, client and server validation, product create, duplicate SKU 409, settings save, storefront filter/sort, product page variant availability, logout | ✅ |
| Responsive: no horizontal overflow at 390 px on 6 key pages; screenshots reviewed at 1280 and 390 px | ✅ |
| axe-core WCAG 2.1 A/AA on 11 pages | ✅ 0 serious or critical (after fixing a low-contrast text token) |
| `npm audit --omit=dev`, `dotnet list package --vulnerable` | ✅ 0 known vulnerabilities |
| `docker compose config` | ✅ valid |

**Not verified in this environment:** building the Docker images (no container registry access), and the
GitHub Actions run, which first runs on the pull request.

## Known issues and limitations

1. **Storefront not-found status:** with streaming (Partial Prerendering), an unknown store host renders the not-found page with HTTP 200 (and `noindex`). Fix in Phase 7: resolve the host in `proxy.ts` (cached) and return a real 404.
2. **Session revocation delay:** membership, role and suspension changes take effect within `Auth:SessionCacheSeconds` (30 s default). Security-stamp rotation is immediate only after the cache expires; acceptable for the MVP, revisit with Redis.
3. **Storefront freshness:** catalogue edits appear on storefronts within about a minute (`cacheLife("minutes")`). Tag-based revalidation from API events is planned for Phase 7.
4. **Product deletion** is a hard delete (there are no orders yet). Phase 8 must block deletion of ordered variants and archive instead.
5. **Stock** is edited as on-hand per variant at the default location through the product editor. A dedicated adjustments UI with reasons and multi-location arrives in Phase 6.
6. **Plans and entitlements** are defined in code (`Plans.cs`) until the Billing module (Phase 9).
7. **End-to-end tests** are a script run against a local stack, not yet a CI job. They become a `@playwright/test` suite with a compose-based CI job in Phase 11.
8. **Dark mode** is not implemented.
9. Login failures are recorded in structured logs, not in the tenant audit log (they have no tenant).

## Next actionable tasks (in order)

1. Product-owner review of `PROJECT_AUDIT.md` §6 decisions (ERP deferral, Razorpay, India-first, tenant model).
2. **Phase 5:** invitations and staff management (API + UI), password reset and email verification (SMTP abstraction + Mailpit), onboarding wizard, audit-log viewer.
3. **Phase 6:** S3 media uploads (presigned, validated), inventory adjustments with reasons, locations, `If-Match` on categories.
4. **Phase 7:** server cart, customer accounts (separate auth scheme), addresses, SEO metadata and sitemap, real 404s by host, tag revalidation.
5. **Phase 8:** checkout with stock reservations, Razorpay adapter and webhooks (inbox/outbox), COD, GST invoices, order state machine, refunds, transactional emails.
