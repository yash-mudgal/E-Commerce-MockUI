# Implementation Roadmap

Estimates assume 2 full-stack engineers plus 1 designer (part-time). "Exit criteria" are the gate to the
next phase.

| Phase | Goal | Key deliverables | Exit criteria | Est. |
|---|---|---|---|---|
| 0 Audit | Understand the mock | `docs/*` audit, requirements, decisions | Docs reviewed ✅ | done |
| 1 Architecture | Agree the design | Architecture, ER, API conventions, ADRs | Product-owner sign-off on `PROJECT_AUDIT.md` §6 | done (pending sign-off) |
| 2 Design system | One visual language | Tokens, primitives, app shell, representative screens (login, dashboard, products, product editor, storefront home and listing) | Screens responsive at 375, 768 and 1280 px; axe clean | 1 wk (started) |
| 3 Foundation | Reproducible development | Monorepo, API skeleton, database, migrations, logging, ProblemDetails, health, OpenAPI, CI, docker-compose | `ci.yml` green; `/health/ready` OK | done |
| 4 Auth + tenancy | Secure multi-tenant core | Signup creates tenant, login, sessions, CSRF, lockout, permissions, RLS, isolation tests | Isolation suite passes | done (password reset → 4b) |
| 5 Onboarding + platform | Merchants self-serve | Onboarding wizard, invitations, staff management, platform console (tenants, suspend), entitlement framework | A new merchant goes live without help | done (verified by `e2e/phase5.cjs`) |
| 6 Catalogue | Merchant catalogue | Products and variants ✅, categories ✅, media upload ✅, inventory levels, adjustments, transfers and locations ✅, ETags ✅ | Product CRUD E2E; plan limits enforced | done (verified by `e2e/phase6.cjs`) |
| 7 Storefront | Shopping experience | SSR storefront by host ✅, PDP ✅, server cart ✅, customer accounts ✅, addresses ✅, SEO ✅, real 404s ✅, instant cache refresh ✅ | Lighthouse ≥ 90; cart persists across devices for logged-in customers | done (Lighthouse 93–95 / 100 / 100 / 91–92; cross-device cart verified by `e2e/phase7.cjs`) |
| 8 Orders + payments | Get paid | Checkout with reservations, Razorpay, webhooks, COD, invoices, cancellations, refunds, shipments, coupons, emails | Concurrency and webhook suite passes; sandbox E2E | done (suites pass; E2E via fake Razorpay + labelled test gateway, `e2e/phase8.cjs`; one live test-key order still to run on staging) |
| 9 SaaS billing | ShopMint gets paid | Plans, trials, Razorpay Subscriptions, dunning, suspension | Plan enforcement tests | 1.5 wk |
| 10 Reporting + notifications | Insight | Sales reports and exports, audit-log UI, abandoned cart (stretch) | Reports match order totals | 1.5 wk |
| 11 QA + security | Release-ready | Full E2E, axe, k6, ZAP, pentest fixes, MFA for platform admins | Release checklist signed | 1.5 wk |
| 12 Production | Live | IaC, CD, backups, alarms, runbooks | Restore drill passed; production smoke | 1.5 wk |
| 13 Post-launch | Improve from evidence | Dashboards, feedback loop, cost review | Targets set from real metrics | ongoing |

The **MVP** is the end of phase 12, about 18 weeks with this team. ERP features (purchase orders,
suppliers, P&L) come in release 2 (see `PRODUCT_REQUIREMENTS.md` §3).

## Risk register

| # | Risk | Likelihood | Impact | Priority | Mitigation |
|---|---|---|---|---|---|
| R1 | Cross-tenant data leak | Low | Critical | **P0** | Two-layer isolation (EF filter + RLS), composite FKs, merge-blocking isolation tests, security review on every new tenant table |
| R2 | Overselling under concurrent checkouts | Medium | High | **P0** | Conditional atomic reservation update, reservation TTL, concurrency tests |
| R3 | Payment marked paid without capture, or lost webhooks | Medium | Critical | **P0** | Webhook signature + inbox de-duplication + a reconciliation job that polls Razorpay for stale `PendingPayment` orders |
| R4 | GST calculation errors creating legal exposure | Medium | High | P1 | `decimal` maths, line-level rounding, unit tests from CA-verified examples, invoice immutability |
| R5 | Scope creep (ERP, marketplace) delays the MVP | High | Medium | P1 | Explicit MVP list; release-2 backlog; phase gates |
| R6 | Next.js / RSC complexity slows the team | Medium | Medium | P2 | Storefront uses RSC; admin is client-rendered with TanStack Query; documented patterns |
| R7 | Custom-domain TLS automation is complex | Medium | Medium | P2 | Subdomains in the MVP; custom domains in Phase 7b using CloudFront SaaS or Caddy on-demand TLS |
| R8 | Noisy-neighbour tenants | Low | Medium | P2 | Per-tenant rate limits, query timeouts, pagination caps; a dedicated database option later |
| R9 | Data residency and DPDP compliance | Low | High | P1 | ap-south-1 only; data export and erasure workflows; a DPA for merchants |
| R10 | Vendor lock-in to Razorpay | Low | Medium | P3 | `IPaymentGateway` port; gateway IDs stored generically |

## First implementation tasks (this iteration)

| # | Task | Acceptance criteria | Status |
|---|---|---|---|
| T1 | Preserve the mock in `legacy/mock-ui` | Opens unchanged from the new path | ✅ |
| T2 | API skeleton: ProblemDetails, correlation ID, JSON logs, health, OpenAPI | `GET /health/ready` 200 with database up, 503 without; unknown errors return ProblemDetails without stack traces | ✅ |
| T3 | Schema + migration + RLS + database roles | Migration applies on an empty database; the app role cannot read rows without `app.tenant_id` | ✅ |
| T4 | Signup, login, logout, me, switch-tenant with cookie session + CSRF + lockout + rate limit | Tests for each failure scenario in `TESTING_STRATEGY.md` Phase 4 | ✅ |
| T5 | Catalogue API (categories, products with variants), validation, pagination, search | Integration tests incl. duplicate SKU, MRP < price, and cross-tenant 404 | ✅ |
| T6 | Storefront read API resolved by host | Tenant A's host never returns tenant B's products; draft products hidden | ✅ |
| T7 | Platform tenants list, suspend and reactivate | Non-platform user gets 403; a suspended tenant's storefront returns 404 and its admin writes return 403 | ✅ |
| T8 | Web: design system, auth pages, admin shell, dashboard, products list and editor, storefront home and listing | Builds with strict TypeScript, lint clean, responsive at 375 and 1280 px | ✅ |
| T9 | docker-compose + CI | `docker compose config` valid; CI builds and tests both apps | ✅ config valid; CI first runs on the PR. Image builds not verified locally |
