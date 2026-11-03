# Testing Strategy

## Pyramid

| Level | Tooling | Scope | Runs |
|---|---|---|---|
| Unit | xUnit (API), Vitest (web) | Pure domain rules: GST calculator, coupon rules, order state machine, permission map, formatters, zod schemas | Every PR, < 30 s |
| Integration | xUnit + `WebApplicationFactory` + **real PostgreSQL** | HTTP → handler → EF → database, including RLS, constraints, transactions and concurrency | Every PR |
| Tenant isolation | Dedicated `TenantIsolation*` test classes | For each tenant-owned resource: tenant B cannot list, read, update or delete tenant A's records (expects 404); RLS blocks raw SQL as the app role; no tenant set → zero rows | Every PR, **merge-blocking** |
| Contract | OpenAPI snapshot test | Detects accidental breaking API changes | Every PR |
| End-to-end | Playwright | Critical journeys: merchant signup → add product → storefront shows it; shopper checkout (Razorpay test mode, mocked in CI); refund | Every PR (smoke); nightly (full) |
| Accessibility | `@axe-core/playwright` | Zero serious or critical violations on key pages | Every PR on the E2E set |
| Performance | k6 | Storefront product list and checkout at 100 RPS; p95 targets from `PRODUCT_REQUIREMENTS.md` | Before release, nightly on staging |
| Security | gitleaks, dependency audit, OWASP ZAP baseline | | CI / nightly |

## Why real PostgreSQL rather than in-memory

RLS, `citext`, check constraints, conditional `UPDATE … WHERE on_hand - reserved >= q` and
serialisation behaviour cannot be emulated. Tests read `SHOPMINT_TEST_DB` (default
`Host=localhost;Username=postgres`). Each test run creates a uniquely named database, applies
migrations, runs the tests and drops it. CI provides PostgreSQL as a service container.

## Required failure scenarios (by phase)

- **Phase 4:** wrong password, lockout, missing CSRF header, expired session, a member removed mid-session, switching to a tenant without membership, a Staff user calling Owner-only endpoints, cross-tenant ID guessing.
- **Phase 6:** duplicate SKU (409), MRP below price (400), deleting a category with products (409), stale `If-Match` (409), plan product limit (422).
- **Phase 8:** two concurrent checkouts for the last unit (exactly one succeeds), duplicate `Idempotency-Key`, webhook delivered twice, out of order, or with a bad signature; payment captured after reservation expiry triggers an auto-refund; partial refund larger than the remainder is rejected.
- **Phase 9:** subscription `past_due` → grace → suspended storefront; downgrade below current usage blocked.

## Definition of done (testing)

A phase is done only when its new endpoints have integration tests covering the success path,
validation, authorisation and tenant isolation, and the full suite passes in CI.
