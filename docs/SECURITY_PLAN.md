# Security Plan

Target: OWASP ASVS Level 2. PCI DSS scope SAQ-A: card data is entered only in Razorpay Checkout and
never touches ShopMint servers.

## 1. Threat model (top risks)

| Threat | Control | Verified by |
|---|---|---|
| Cross-tenant data access | Two layers: EF global filters + PostgreSQL RLS with a non-owner app role; tenant only from host or session; composite FKs; 404 (not 403) for foreign IDs | `TenantIsolationTests` (API) and `RowLevelSecurityTests` (raw SQL as app role) |
| Privilege escalation inside a tenant | Permission-based policies on every endpoint; role changes audited; Manager cannot grant Owner | `AuthorizationTests` |
| Client tampering with price, discount, stock or payment status | Server recomputes all totals from the database; payment status changes only via verified webhook or server-side fetch | Checkout tests (Phase 8) |
| Account takeover | PBKDF2-SHA512 (ASP.NET Core Identity v3 hasher, 100k iterations), lockout after 5 failures, per-IP and per-account rate limits on login, generic "invalid email or password" message, session rotation on login | `AuthTests` |
| Session theft | `__Host-` prefixed cookie, `HttpOnly`, `Secure`, `SameSite=Lax`, 12-hour sliding expiry, server-side revocation via a security stamp | |
| CSRF | SameSite cookies + required `X-ShopMint-Csrf` header on unsafe methods; CORS closed | `CsrfTests` |
| XSS | React escaping; no `dangerouslySetInnerHTML` for user content (product descriptions are rendered as plain text or sanitised Markdown); strict CSP with nonces | Lint rule + E2E |
| Webhook forgery and replay | HMAC verification on the raw body; inbox de-duplication by event ID; amount and currency cross-checked against our records | Phase 8 tests |
| Malicious uploads | Presigned PUT limited to `image/jpeg, png, webp` up to 5 MB; key namespaced `tenants/{tid}/…`; server re-encodes and strips EXIF; served from a separate media domain | Phase 6 |
| Enumeration and abuse | Rate limiting (fixed window per IP on auth, token bucket per tenant on writes); signup throttled | |
| Secrets leakage | No secrets in the repository; `.env.example` only; production secrets in AWS Secrets Manager injected as environment variables; gitleaks in CI | CI |
| Information disclosure | ProblemDetails without stack traces outside Development; logs exclude passwords, tokens and full addresses | Exception handler test |

## 2. Authentication design

- **Merchant users:** global `users` table; sessions carry `sub`, `tid` (active tenant), `role` and a `sstamp` (security stamp). On each request the membership is re-validated (cached 60 s), so removing a member takes effect within a minute; changing the stamp revokes every session immediately.
- **Customers:** per-tenant `customers`; a separate cookie (`__Host-sm_c`) and a separate authentication scheme, so a customer cookie can never authorise an admin endpoint.
- **Platform admins:** `users.is_platform_admin`; MFA (TOTP) is required before launch (Phase 11).

## 3. Authorisation

Permissions are constants (`catalog.read`, `catalog.write`, `catalog.delete`, `orders.read`,
`orders.fulfil`, `orders.refund`, `settings.write`, `staff.manage`, `billing.manage`, `reports.read`,
`audit.read`). A role-to-permission map lives in code (MVP). Endpoints declare
`.RequirePermission("catalog.write")`.

## 4. Data protection

- TLS 1.2+ everywhere and HSTS. RDS encryption at rest (KMS). S3 SSE.
- PII minimisation: logs carry IDs, not names or addresses.
- **DPDP Act:** consent recorded for marketing; customer data export and erasure on request (Phase 10); tenant deletion workflow: cancel → 30-day retention → hard delete per tenant (feasible because every row carries `tenant_id`), with tax invoices retained 8 years as required by GST law, in an archived bucket.
- **Backups:** RDS automated backups (35 days of point-in-time recovery) plus a weekly logical snapshot to another region.

## 5. Audit logging

Sensitive actions are written to `audit_log` in the same transaction: login success and failure, role
changes, settings changes, product deletes, refunds, tenant suspension. The app role cannot
`UPDATE`/`DELETE` audit rows.

## 6. Secure SDLC

PR review required; CI runs build, tests, `dotnet list package --vulnerable`, `npm audit --omit=dev`
(high and above fail) and gitleaks; Dependabot weekly; a pre-launch external penetration test.
