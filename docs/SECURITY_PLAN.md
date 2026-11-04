# Security Plan

Target: OWASP ASVS Level 2. PCI DSS scope SAQ-A: card data is entered only in Razorpay Checkout and
never touches ShopMint servers.

## 1. Threat model (top risks)

| Threat | Control | Verified by |
|---|---|---|
| Cross-tenant data access | Two layers: EF global filters + PostgreSQL RLS with a non-owner app role; tenant only from host or session; composite FKs; 404 (not 403) for foreign IDs | `TenantIsolationTests` (API) and `RowLevelSecurityTests` (raw SQL as app role) |
| Privilege escalation inside a tenant | Permission-based policies on every endpoint; role changes audited; Manager cannot grant Owner | `AuthorizationTests` |
| Client tampering with price, discount, stock or payment status | Server recomputes all totals from the database; payment status changes only via verified webhook or server-side fetch | Checkout tests (Phase 8) |
| Account takeover | PBKDF2-SHA512 (ASP.NET Core Identity v3 hasher, 100k iterations), lockout after 5 failures, per-IP and per-account rate limits on login, generic "invalid email or password" message, session rotation on login; TOTP two-step verification (required for platform admins) | `AuthTests`, `MfaTests` |
| Session theft | `__Host-` prefixed cookie, `HttpOnly`, `Secure`, `SameSite=Lax`, 12-hour sliding expiry, server-side revocation via a security stamp | |
| CSRF | SameSite cookies + required `X-ShopMint-Csrf` header on unsafe methods; CORS closed | `CsrfTests` |
| XSS | React escaping; no `dangerouslySetInnerHTML` for user content (product descriptions are rendered as plain text or sanitised Markdown); Content-Security-Policy limiting scripts, frames, connections and images to ShopMint, Razorpay and the media origins (inline scripts allowed, ADR-037); API responses carry `default-src 'none'` | `e2e/phase11.cjs`, `SecurityTests` |
| Webhook forgery and replay | HMAC verification on the raw body; inbox de-duplication by event ID; amount and currency cross-checked against our records | Phase 8 tests |
| Malicious uploads | Presigned PUT limited to `image/jpeg, png, webp` up to 5 MB; key namespaced `tenants/{tid}/…`; server re-encodes and strips EXIF; served from a separate media domain | Phase 6 |
| Enumeration and abuse | Rate limiting (fixed window per IP on auth, token bucket per tenant on writes); signup throttled | |
| Secrets leakage | No secrets in the repository; `.env.example` only; development values labelled "LOCAL DEVELOPMENT ONLY"; production secrets in AWS Secrets Manager injected as environment variables; gitleaks over the full history in CI (`.gitleaks.toml`) | CI `secrets` job |
| Information disclosure | ProblemDetails without stack traces outside Development; logs exclude passwords, tokens and full addresses; no `X-Powered-By` | Exception handler test, `e2e/phase11.cjs` |
| Oversized requests | Kestrel refuses bodies over 1 MB (413); uploads go straight to object storage | Live check |

## 2. Authentication design

- **Merchant users:** global `users` table; sessions carry `sub`, `tid` (active tenant), `role` and a `sstamp` (security stamp). On each request the membership is re-validated (cached `Auth:SessionCacheSeconds`, 30 s). Role changes, removals and password changes evict that cache, so they take effect on the next request on the same API instance (other instances within 30 s). A role change rejects the member's old session; they sign in again to get the new role.
- **Account recovery and verification (Phase 5):** reset and verification links carry 32 random bytes; only the SHA-256 hash is stored, tokens are single-use and short-lived (1 h reset, 48 h verification, 7 days invitation). Links are built from `App:PublicUrl`, never the request `Host` header, so a forged host can't redirect reset links. Forgot-password answers identically whether or not the account exists. Token pages send `Referrer-Policy: no-referrer`. A reset rotates the security stamp (signs out everywhere) and clears lockout.
- **Invitations:** a leaked invitation link can't attach a store to someone else's existing login: accepting for an existing account requires being signed in as that address. Nobody can grant Owner or manage people at or above their own rank. The token lookup is the only place the request path uses the platform role, and it returns one invitation by hash.
- **Customers (Phase 7):** per-tenant `customers`; a separate cookie (`__Host-sm_c`) and a separate authentication scheme, so a customer cookie can never authorise an admin endpoint and a merchant cookie is never a shopper session. Cookies are host-only, and the API also checks the session's store against the store resolved from the request host, so a cookie replayed on another store's domain is ignored. Password reset links are built from the store's registered domain. Lockout and rate limits match merchant sign-in. Marketing consent is recorded with its timestamp (DPDP).
- **Carts:** guest carts are found by the SHA-256 hash of a random HttpOnly, SameSite=Lax cookie token. Cart lines store only variant and quantity; prices, totals and availability are recomputed from the database on every read, so nothing the browser sends about price is ever used.
- **Storefront routing:** the internal `/store/<host>/…` routes are reachable only through the host-based rewrite in `proxy.ts`; requesting them directly returns 404. (Before Phase 7 a crafted path could show one store's pages on another store's domain.)
- **Cache refresh hook:** `POST /internal/revalidate` on the web app requires a shared secret (`REVALIDATE_SECRET`, compared in constant time) and accepts only well-formed store tags.
- **Platform admins:** `users.is_platform_admin`. Every `/api/platform` endpoint needs a session that passed two-step
  verification (403 `mfa-required` otherwise), so a stolen platform password alone opens nothing.
- **Two-step verification (Phase 11, any merchant user; required for platform admins):** TOTP (RFC 6238, SHA-1,
  6 digits, 30 s, ±1 step). The secret is encrypted with `Payments__SecretsKey` (AES-256-GCM); the last accepted step
  is stored so a code works once. Ten recovery codes, single-use, stored as SHA-256 hashes; regenerating needs the
  password. Sign-in: password → 5-minute single-use challenge token (hashed, purpose `MfaChallenge`) → code. Wrong
  codes count toward the same 5-failure lockout as passwords and use up the challenge at lockout. Turning it on or off
  needs the password and a code, rotates the security stamp (other sessions end) and is written to the store's activity log when the user is signed in to a store.
- **Session keys:** cookies are protected by ASP.NET Core Data Protection keys stored in `data_protection_keys`
  (platform role only), so sessions survive redeploys and work across instances. The table relies on RDS encryption at
  rest; KMS key wrapping is a later step.

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

## 5c. Payments

- **Prices are never taken from the browser.** Checkout accepts an address, a coupon code and a payment method; the API
  recomputes every price, discount, delivery fee and tax from the database inside the order transaction.
- **Merchant keys:** each store's Razorpay key secret and webhook secret are encrypted with AES-256-GCM using a
  platform key (`Payments__SecretsKey`, 32 bytes from the secrets manager) before storage. They are never returned by
  the API, logged or written to the activity log (which records only a masked key ID). Without the platform key the
  API refuses to save keys (503) rather than storing them in clear.
- **Confirmation needs proof:** the browser's success callback is checked with an HMAC over `order_id|payment_id`
  using the store's secret, then the payment is fetched from Razorpay and its status, order and amount must match.
  Webhooks are verified with the store's webhook secret over the raw body, de-duplicated, and processed idempotently.
  An amount mismatch never confirms an order; a capture for an expired or cancelled order is refunded automatically.
- **Test mode** simulates payments for local development and demos. It is off by default, the API refuses to start in
  Production with it on, it is used only while a store has no Razorpay keys, and the UI labels it on every screen.
- **Abuse:** order placement is rate-limited per IP (`RateLimiting__CheckoutPerMinute`) and requires a signed-in shopper
  and an idempotency key; refunds need `orders.refund` and are capped by the refundable balance under a row lock.

## 5e. Reports, exports and marketing email

- Exports that contain customer details (orders CSV) need `orders.read` as well as `reports.read`. CSV text cells that
  begin with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'` (CSV/formula injection).
- Abandoned-cart reminders are marketing: sent only to signed-in shoppers whose consent is recorded at send time, never
  to guests, off by default per store, and each includes a one-click unsubscribe link. Unsubscribe tokens are random,
  stored hashed with a purpose, expire after 90 days, work only on the store that issued them, and can't be used as
  password-reset tokens. The unsubscribe page needs a click, so link scanners can't opt people out.

## 5d. ShopMint billing

- ShopMint's Razorpay keys and webhook secret (`Billing__Razorpay__*`) come from the secrets manager and are separate
  from merchants' keys. Merchants never see them; the browser receives only the public key ID for Checkout.
- A subscription is accepted only after the Checkout signature (HMAC of `payment_id|subscription_id` with ShopMint's
  key secret) is valid **and** Razorpay confirms the subscription's state. Webhooks are verified, de-duplicated and
  matched to stores only through stored subscription IDs; each store's billing routes see only its own subscriptions.
- Billing is owner-only (`billing.manage`). A suspended store's admin stays read-only except Billing.
- Plan limits are enforced on the server under a row lock; the `plans` table can't be changed by the app role.
- A platform suspension (abuse, fraud) can't be lifted by paying; only an operator can reactivate the store.

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
(high and above fail), gitleaks, every browser walkthrough, an axe scan (serious/critical fail) and an OWASP ZAP
baseline (report reviewed before release); Dependabot weekly; a pre-launch external penetration test. Release
readiness is tracked in `RELEASE_CHECKLIST.md`.

## 5f. Platform metrics and feedback (Phase 13)

- Metrics and the feedback inbox are platform endpoints: platform admin **and** a two-step-verified session.
- Feedback is write-only for the request path (ADR-044); the sender's email is shown only with their consent, and
  the form asks people not to include passwords or card details. Rendered as plain text. Rate-limited per user.
- Metrics expose aggregates only (no shopper names or addresses).

## 6a. Infrastructure (Phase 12)

- **Network:** the database is in isolated subnets (no route to the internet) and accepts only the API's security
  group; tasks run in private subnets without public IPs; the load balancer accepts only CloudFront's origin-facing IP
  ranges and requests carrying a secret origin header; VPC flow logs record rejected traffic.
- **Edge:** AWS WAF (IP reputation, common rules, known bad inputs, SQL injection, rate limits for `/api/auth/*` and
  overall); TLS 1.2+; the edge function strips `X-Forwarded-Host` and sets the client IP header (ADR-040).
- **Database:** encrypted at rest, `rds.force_ssl=1`, the API verifies the server certificate (`VerifyFull`, RDS CA
  bundle in the image), deletion protection and retained snapshots in production.
- **Secrets:** generated by Secrets Manager (role passwords, origin and revalidation secrets) or entered once by an
  operator (`shopmint/<env>/app`); CDK never holds or overwrites secret values; templates only reference them.
- **Access:** GitHub Actions assumes an environment-scoped role via OIDC (no stored AWS keys); production deploys need
  two reviewers; image tags are immutable and scanned on push; no shell access to containers (ECS Exec off) and no
  bastion: operator actions are reviewed commands run as one-off tasks (ADR-042).
- **Startup guards in Production:** test payments, `Proxy:TrustAll` and a missing secrets key all stop the API.

## 7. HTTP headers

| Header | Web app | API |
|---|---|---|
| Content-Security-Policy | `default-src 'self'`; scripts `'self' 'unsafe-inline'` + Razorpay Checkout; images self, data/blob, HTTPS and the media origin; connect self, Razorpay and the upload bucket; frames Razorpay only; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'` | `default-src 'none'; frame-ancestors 'none'` |
| Strict-Transport-Security | 2 years, subdomains (production) | 2 years, subdomains (outside Development) |
| X-Frame-Options / nosniff / Referrer-Policy | `DENY` / on / `strict-origin-when-cross-origin` (token pages `no-referrer`) | same |
| Others | `Permissions-Policy` (camera, microphone, geolocation off; payment for Razorpay), `Cross-Origin-Opener-Policy: same-origin-allow-popups` | `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store` |

`MEDIA_PUBLIC_URL` and `MEDIA_UPLOAD_ORIGIN` are read at build time to allow the image CDN and upload bucket.
