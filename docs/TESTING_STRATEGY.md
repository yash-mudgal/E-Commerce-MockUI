# Testing Strategy

## Pyramid

| Level | Tooling | Scope | Runs |
|---|---|---|---|
| Unit | xUnit (API), Vitest (web) | Pure domain rules: GST calculator, coupon rules, order state machine, permission map, formatters, zod schemas | Every PR, < 30 s |
| Integration | xUnit + `WebApplicationFactory` + **real PostgreSQL** | HTTP → handler → EF → database, including RLS, constraints, transactions and concurrency | Every PR |
| Tenant isolation | Dedicated `TenantIsolation*` test classes | For each tenant-owned resource: tenant B cannot list, read, update or delete tenant A's records (expects 404); RLS blocks raw SQL as the app role; no tenant set → zero rows | Every PR, **merge-blocking** |
| Contract | OpenAPI snapshot test | Detects accidental breaking API changes | Every PR |
| End-to-end | Playwright scripts (`apps/web/e2e/*.cjs`) | Every phase's journeys against a real stack (API, web production build, PostgreSQL, MinIO, Mailpit): signup → launch, catalogue and uploads, storefront and cart, checkout with the labelled test gateway, refunds, billing, reports, MFA | Every PR (CI `e2e` job) |
| Accessibility | axe-core in Playwright (`e2e/a11y.cjs`) | Zero serious or critical violations on 47 pages | Every PR (fails the `e2e` job) |
| Performance | `perf/load.cjs` (Node, no dependencies); k6 (`perf/k6-storefront.js`) | API reads and checkout quote, storefront pages; p95 targets from `PRODUCT_REQUIREMENTS.md` | Every PR (informational); k6 before release on staging |
| Infrastructure | CDK assertions (`infra/test`), `cdk synth` of both environments | Security-relevant template properties: private encrypted TLS-only database, load balancer reachable only from CloudFront with the origin header, edge function behaviour, no plaintext secrets, rollback on failed deploys, environment-scoped deploy role | Every PR (`infra` job) |
| Operations | `ops/smoke.cjs` after every deploy; `verify-db` and `ops/restore-drill-local.sh` for restores | Live checks of a deployed environment; restored databases are safe before traffic | Every deploy; quarterly drill |
| Security | gitleaks (full history), dependency audit, OWASP ZAP baseline | Secrets, vulnerable packages, passive web findings | Every PR (gitleaks and audit fail the build; ZAP report reviewed before release) |

## Why real PostgreSQL rather than in-memory

RLS, `citext`, check constraints, conditional `UPDATE … WHERE on_hand - reserved >= q` and
serialisation behaviour cannot be emulated. Tests read `SHOPMINT_TEST_DB` (default
`Host=localhost;Username=postgres`). Each test run creates a uniquely named database, applies
migrations, runs the tests and drops it. CI provides PostgreSQL as a service container.

## Required failure scenarios (by phase)

- **Phase 4:** wrong password, lockout, missing CSRF header, expired session, a member removed mid-session, switching to a tenant without membership, a Staff user calling Owner-only endpoints, cross-tenant ID guessing.
- **Phase 6:** duplicate SKU (409), MRP below price (400), deleting a category with products (409), stale `If-Match` (409), plan product limit (422).
- **Phase 8 (✓ covered in `OrderTests.cs`):** concurrent checkouts for the last unit (exactly one succeeds), concurrent retries with one `Idempotency-Key` (one order), webhook delivered twice, with a bad signature, for the wrong amount or another store; a missed webhook reconciled by the expiry job; payment captured after reservation expiry triggers an auto-refund; partial refund larger than the remainder is rejected; coupon limits; ordered products can't be deleted. Razorpay is replaced by an in-process fake HTTP server (`FakeRazorpay`) that checks credentials and signatures are real HMACs.
- **Phase 10 (✓ covered in `ReportTests.cs` and `StoreNotificationTests`):** sales and GST reports equal to the orders (refunds, cancellations, unpaid orders, two states and rates); IST day boundaries; CSV exports and formula injection; notification preferences; low-stock digest once per change; abandoned-cart consent, once per change, unsubscribe scoping and token purpose. End to end: `e2e/phase10.cjs` checks the page and the CSV against the orders.
- **Phase 11 (✓ covered in `MfaTests.cs`, `SecurityTests.cs`):** RFC 6238 vectors; wrong, replayed and expired codes; recovery codes single-use; lockout after 5 wrong codes; platform endpoints refused without a verified session; enabling/disabling ends other sessions; security headers; session keys shared across instances and hidden from the app role. End to end: `e2e/phase11.cjs`.
- **Phase 9 (✓ covered in `BillingTests.cs`, `MigrationTests.cs`, `BillingRuleTests`):** subscription `past_due` → grace → suspended storefront (503); downgrade below current usage blocked; plan limits under concurrency; trial expiry; platform suspension not liftable by paying; forged checkout signatures; webhook signature, duplicates and read-back; the data migration run against existing stores.

## Definition of done (testing)

A phase is done only when its new endpoints have integration tests covering the success path,
validation, authorisation and tenant isolation, and the full suite passes in CI.
