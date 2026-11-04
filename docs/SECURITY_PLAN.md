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

- **Merchant users:** global `users` table; sessions carry `sub`, `tid` (active tenant), `role` and a `sstamp` (security stamp). On each request the membership is re-validated (cached `Auth:SessionCacheSeconds`, 30 s). Role changes, removals and password changes evict that cache, so they take effect on the next request on the same API instance (other instances within 30 s). A role change rejects the member's old session; they sign in again to get the new role.
- **Account recovery and verification (Phase 5):** reset and verification links carry 32 random bytes; only the SHA-256 hash is stored, tokens are single-use and short-lived (1 h reset, 48 h verification, 7 days invitation). Links are built from `App:PublicUrl`, never the request `Host` header, so a forged host can't redirect reset links. Forgot-password answers identically whether or not the account exists. Token pages send `Referrer-Policy: no-referrer`. A reset rotates the security stamp (signs out everywhere) and clears lockout.
- **Invitations:** a leaked invitation link can't attach a store to someone else's existing login: accepting for an existing account requires being signed in as that address. Nobody can grant Owner or manage people at or above their own rank. The token lookup is the only place the request path uses the platform role, and it returns one invitation by hash.
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

Sensitive actions are written to `audit_log` in the same transaction: login success, password changes,
invitations (sent, resent, revoked, accepted), role changes, removals, settings changes, launch, product
and category changes, tenant suspension. Failed logins and password resets have no tenant, so they go to
structured logs instead. The app role cannot `UPDATE`/`DELETE` audit rows. Owners and managers read the log
at **Admin → Activity log**; secrets and tokens are never written to it.

## 5b. Uploaded files

- Browsers upload straight to object storage with a presigned PUT URL that is valid for 10 minutes, bound to one key
  and one content type. The API never streams file bodies.
- Nothing is shown until the API has checked the **stored** object: size ≤ 5 MB, and the first bytes must be a real JPEG,
  PNG or WebP matching the declared type. SVG and other formats are refused because they can carry script. Rejected
  files are deleted immediately.
- Keys contain the tenant and product IDs plus a random ID; the bucket is read-only to the public through the CDN.
  Images of draft products are reachable only by their unguessable URL.
- Per-product limit (10) counts uploads in progress, so parallel requests can't exceed it. Abandoned uploads are swept
  after an hour.

## 5a. Email

Transactional email goes through an outbox table written in the same transaction as the change. The app role
may only `INSERT` into it (RLS limits inserts to its own tenant or tenant-less account mail), so request code
can't read other people's pending links. A background dispatcher (platform role) delivers via SMTP and deletes
message bodies once sent or permanently failed. SMTP credentials come from `Email__Smtp__*` environment
variables. Store and inviter names are HTML-encoded in email bodies.

## 6. Secure SDLC

PR review required; CI runs build, tests, `dotnet list package --vulnerable`, `npm audit --omit=dev`
(high and above fail) and gitleaks; Dependabot weekly; a pre-launch external penetration test.
