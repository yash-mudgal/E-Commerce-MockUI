# Release Checklist

Phase 11 exit criterion: "Release checklist signed". This file is the checklist. Each item says how it was checked
and where. **Verified** means the check was run and its result seen (date and place given). **To do** means it
can only be done on staging or production, or needs a person, and is not done yet.

The release is signed when every line is ✅ and the sign-off table at the end is filled in. As of 2026-11-04 the
engineering items that can be verified without staging are ✅; the staging and people items are open.

## 1. Automated quality gates (every pull request, `.github/workflows/ci.yml`)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1.1 | API builds with warnings as errors and analyzers on | ✅ Verified | Local 2026-11-04; CI `api` job |
| 1.2 | API integration suite on real PostgreSQL 16 (tenant isolation, RLS, payments, billing, reports, MFA) | ✅ 231/231 | Local 2026-11-04; CI `api` job |
| 1.3 | Web lint, type-check, unit tests (80), production build | ✅ Verified | Local 2026-11-04; CI `web` job |
| 1.3a | Infrastructure code: type-check, 18 assertion tests, `cdk synth` of staging and production | ✅ Verified | Local 2026-11-04; CI `infra` job |
| 1.4 | No known vulnerable packages (`dotnet list package --vulnerable`, `npm audit --omit=dev`) | ✅ 0 found | Local 2026-11-04; CI |
| 1.5 | Secret scan over the full git history (gitleaks, `.gitleaks.toml`) | 🟡 Job added | Runs in CI from this release. Locally a regex scan of all 25 commits found only two labelled test/doc placeholders (gitleaks itself couldn't be run in this sandbox) |
| 1.6 | Browser walkthroughs for every phase against a running stack (API, web, PostgreSQL, MinIO, Mailpit) | ✅ Locally | 2026-11-04: walkthrough ✅, Phase 5 26/26, 6 38/38, 7 33/33, 8 60/60, 9 46/46, 10 35/35, 11 28/28. New CI `e2e` job runs the same scripts on every PR |
| 1.7 | Accessibility: axe-core WCAG 2.1 A/AA, zero serious or critical issues | ✅ 47/47 pages | Local 2026-11-04; CI `e2e` job fails on any serious/critical issue |
| 1.8 | OWASP ZAP baseline (passive scan of the web app) | 🟡 Job added | Runs in CI (informational, report uploaded as an artifact). Review its findings before release (see 4.3) |
| 1.9 | Load test (`perf/load.cjs`) | ✅ Locally, see §3 | CI runs it as information only (shared runners vary) |

## 2. Security

| # | Item | Status | Evidence |
|---|---|---|---|
| 2.1 | Platform admins must use two-step verification (TOTP) before any platform tool works | ✅ Verified | `MfaTests` (API, 403 `mfa-required` without it), `e2e/phase11.cjs` |
| 2.2 | MFA codes can't be replayed; recovery codes are single-use and hashed; 5 wrong codes lock the sign-in | ✅ Verified | `MfaTests` |
| 2.3 | Turning MFA on or off needs the password and a current code, and signs out other sessions | ✅ Verified | `MfaTests`, `e2e/phase11.cjs` |
| 2.4 | Security headers on the web app (CSP, HSTS in production, `X-Frame-Options`/`frame-ancestors`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP) | ✅ Verified | `e2e/phase11.cjs` checks them on live responses; Razorpay Checkout allowed by the CSP |
| 2.5 | Security headers on the API (`default-src 'none'` CSP, CORP, `nosniff`, no-referrer, HSTS outside Development) | ✅ Verified | `SecurityTests` (API), `e2e/phase11.cjs` |
| 2.6 | Request bodies over 1 MB refused (413) | ✅ Verified | Live check 2026-11-04 (2 MB body → 413) |
| 2.7 | Session-cookie keys persisted and shared (`data_protection_keys`, readable only by the platform role) | ✅ Verified | `SecurityTests`: keys are stored in the database, a second API instance accepts the first one's session cookie, and the app role is refused access to the table |
| 2.8 | Tenant isolation: API filters plus forced PostgreSQL RLS; another store's IDs answer 404 | ✅ Verified | `TenantIsolationTests`, `RowLevelSecurityTests` (every PR) |
| 2.9 | Prices, discounts, stock and payment status never taken from the browser | ✅ Verified | Phase 8 suites; `e2e/phase8.cjs` sends forged prices and they're ignored |
| 2.10 | No secrets in the repository; development values labelled "LOCAL DEVELOPMENT ONLY" | ✅ Verified | Review plus history scan (1.5) |
| 2.11 | Revalidation hook needs its secret (constant-time compare) | ✅ Verified | Code review 2026-11-04 (`app/internal/revalidate/route.ts`); used by every walkthrough's storefront refresh |
| 2.12 | External penetration test | ⬜ To do | Book after staging is up; fix findings rated high or above before launch |

## 3. Performance (`perf/load.cjs`, local, 2026-11-04)

Machine: the 4-vCPU development sandbox, one API process and one Next.js process, PostgreSQL on the same host.
The p95 targets come from `PRODUCT_REQUIREMENTS.md` §5 (API reads < 300 ms, checkout < 800 ms).

| Scenario (20 concurrent clients, 15 s) | Throughput | p50 | p95 | p99 | Errors | Target |
|---|---|---|---|---|---|---|
| API product list | 651 req/s | 30 ms | 46 ms | 55 ms | 0 | ✅ < 300 ms |
| API product detail | 612 req/s | 32 ms | 47 ms | 54 ms | 0 | ✅ < 300 ms |
| API product search | 636 req/s | 31 ms | 45 ms | 53 ms | 0 | ✅ < 300 ms |
| API cart (signed in) | 780 req/s | 25 ms | 37 ms | 44 ms | 0 | ✅ < 300 ms |
| API checkout quote | 487 req/s | 40 ms | 57 ms | 67 ms | 0 | ✅ < 800 ms |
| Web storefront home (HTML) | 63 req/s | 309 ms | 402 ms | 462 ms | 0 | ❌ 300 ms (see below) |
| Web product page (HTML) | 80 req/s | 252 ms | 302 ms | 340 ms | 0 | ❌ 300 ms (see below) |

**Finding:** one Next.js process serves about 70 storefront pages per second on one core (pages are about 80 KB;
the static shell is prerendered and the per-visitor part is resumed on each request). With 1 client the p95 is
20–24 ms and with 5 clients 82–98 ms; at 20 clients the extra time is queueing, not slow rendering. The API is
not the bottleneck. **Action before launch:** size the web service from this figure (about 70 page views/s per
vCPU, at least 2 tasks), then confirm with `perf/k6-storefront.js` on staging (4.4). This page-HTML target is
ShopMint's own; the NFR for storefront pages is LCP < 2.5 s, which Lighthouse checked in Phase 7.

## 4. Staging (needs a host reachable from the internet; not available from the development sandbox)

| # | Item | Status |
|---|---|---|
| 4.1 | Infrastructure and pipeline exist and are tested | ✅ Phase 12: `infra/` (CDK, 18 assertion tests, both environments synthesise), `.github/workflows/deploy.yml`, images build. 🟡 Not yet deployed: first deployment per `docs/runbooks/first-deploy.md` |
| 4.1a | `deploy-db` on RDS: the master user can create the `BYPASSRLS` platform role; TLS `VerifyFull` works with the bundled CA | ⬜ To do on staging (verified locally against PostgreSQL 16 with a non-superuser master only) |
| 4.1b | Edge behaviour on staging: `ops/smoke.cjs --edge` (HTTPS redirect, `/internal/*` hidden, spoofed `X-Forwarded-Host` ignored); `origin.` answers 403 directly | ⬜ To do |
| 4.2 | Shopper order with a store's Razorpay **test** keys: callback and webhook both confirm; refund works (`DEPLOYMENT_PLAN.md` → Payments) | ⬜ To do |
| 4.3 | ZAP baseline against staging reviewed; anything Medium or above fixed or accepted in writing | ⬜ To do |
| 4.4 | k6 (`perf/k6-storefront.js`) on staging meets its thresholds at the planned task count | ⬜ To do |
| 4.5 | ShopMint subscription with the platform's Razorpay test keys: trial store and expired-trial store (`DEPLOYMENT_PLAN.md` → Billing) | ⬜ To do |
| 4.6 | Production secrets in the secrets manager: `Payments__SecretsKey`, `Billing__Razorpay__*`, `Web__RevalidateSecret`/`REVALIDATE_SECRET`, SMTP, database passwords. None in images or the repository | ⬜ To do |
| 4.7 | `Payments__AllowTestMode` is false (the API refuses to start in Production otherwise) and no `Seed:*` values are set | ⬜ To do |
| 4.8 | Every platform admin enrols two-step verification and stores recovery codes offline | ⬜ To do |
| 4.9 | Backups: point-in-time recovery on, one restore drill done | 🟡 Configured in `infra/` (PITR 35 days, daily AWS Backup with copies in ap-south-2). Local restore drill ✅ 2026-11-04 (`ops/restore-drill-local.sh`: `verify-db` passes on the restored copy, counts match, a pre-backup session still works, smoke 14/14). RDS point-in-time drill on staging ⬜ (`docs/runbooks/restore.md`) |
| 4.10 | Alerts and runbooks (`DEPLOYMENT_PLAN.md` → Observability) | 🟡 Alarms, dashboard and `docs/runbooks/` written; confirm the alarm subscription and a test alarm on staging ⬜ |
| 4.11 | Production smoke (`ops/smoke.cjs --edge`) after the first production deploy | ⬜ To do (passes 14/14 in local production mode) |

## 5. Product and legal

| # | Item | Status |
|---|---|---|
| 5.1 | Product owner signs off `PROJECT_AUDIT.md` §6 (ERP deferral, shared database, per-store shopper accounts) | ⬜ To do |
| 5.2 | Plan prices and limits confirmed (currently the mock's), and whether prices are shown with or without GST | ⬜ To do |
| 5.3 | Privacy policy and terms (DPDP Act), grievance officer contact | ⬜ To do |
| 5.4 | Known limitations in `PROJECT_PROGRESS.md` reviewed and accepted for launch | ⬜ To do |

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Engineering lead | | | |
| Product owner | | | |
| Security reviewer | | | |
