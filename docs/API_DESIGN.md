# API Design

## Conventions

- **Base paths by surface:** `/api/auth`, `/api/admin` (merchant; tenant from the session), `/api/storefront` (public; tenant from the host), `/api/platform` (platform admins), `/api/webhooks/{provider}`.
- **Versioning:** URL-free. Breaking changes get a new resource or an `Api-Version` header. The OpenAPI document lives at `/openapi/v1.json` (development and staging).
- **JSON:** camelCase; money as **strings** with 2 decimals (`"1299.00"`) to avoid float issues in clients; timestamps in ISO-8601 UTC; IDs as UUID strings.
- **Pagination:** `?page=1&pageSize=25` (maximum 100). Responses use `{ items: [], page, pageSize, totalCount }`. Cursor pagination is used for high-volume feeds such as audit and movements.
- **Filtering and sorting:** explicit query parameters (`q`, `status`, `categoryId`, `sort=-createdAt`); sort fields are allow-listed.
- **Errors:** RFC 9457 `application/problem+json`:

```json
{ "type": "https://docs.shopmint.in/errors/validation", "title": "One or more validation errors occurred.",
  "status": 400, "traceId": "…", "errors": { "variants[0].price": ["Price must be greater than 0."] } }
```

  | Status | `type` slug | When |
  |---|---|---|
  | 400 | `validation` | Body or query invalid |
  | 401 | `unauthenticated` | No or expired session |
  | 403 | `forbidden` | Authenticated but lacks permission |
  | 404 | `not-found` | Missing **or belongs to another tenant** (never reveal existence) |
  | 409 | `conflict` / `out-of-stock` / `invalid-state-transition` / `concurrency` | Business conflicts |
  | 422 | `entitlement-exceeded` | Plan limit reached |
  | 429 | `rate-limited` | Includes `Retry-After` |

- **Idempotency:** the `Idempotency-Key` header is **required** on checkout, refund and capture endpoints, and accepted on all POSTs.
- **Concurrency:** mutable resources return `ETag` (row version). `PUT`/`PATCH` require `If-Match`; a stale value returns 409 `concurrency`. (Phase 6+.)
- **CSRF:** cookie-authenticated unsafe methods require the `X-ShopMint-Csrf: 1` header (browsers cannot set custom headers cross-site without CORS preflight, and CORS is closed) plus `SameSite=Lax` cookies.

## Endpoints

✓ = implemented in this repository, with tests.

### Auth (`/api/auth`)

| Method | Path | Description | |
|---|---|---|---|
| POST | `/signup` | Create a merchant user, tenant (trialing) and owner membership in one transaction | ✓ |
| POST | `/login` | Email and password → session cookie. Lockout after 5 failures for 15 minutes; rate-limited | ✓ |
| POST | `/logout` | Clear the session | ✓ |
| GET | `/me` | Current user, active tenant, role, permissions, memberships | ✓ |
| POST | `/switch-tenant` | Re-issue the session for another tenant the user belongs to | ✓ |
| POST | `/password/forgot` | Always 202 with the same body (no account enumeration); at most one email a minute per account; rate-limited | ✓ |
| POST | `/password/reset` | `{token, password}`: single-use, 1-hour token; signs out every session and clears lockout | ✓ |
| POST | `/password/change` | `{currentPassword, newPassword}`: signs out other sessions, keeps this one | ✓ |
| POST | `/email/verify` | `{token}`: confirms the address (48-hour token). The page requires a click, so link scanners don't use it up | ✓ |
| POST | `/email/resend` | New confirmation link; 409 if already confirmed; 429 within a minute of the last one | ✓ |
| GET | `/invitations/{token}` | Invitation preview: store, role, inviter, whether an account exists | ✓ |
| POST | `/invitations/accept` | `{token, name?, password?}`. New people set a name and password. An existing account must be signed in as the invited address (401 `sign-in-required`, 403 if signed in as someone else) | ✓ |

### Merchant admin (`/api/admin`)

| Method | Path | Permission | |
|---|---|---|---|
| GET | `/store` | any member | ✓ |
| PATCH | `/store` | `settings.write` | ✓ |
| GET/POST | `/categories` | `catalog.read` / `catalog.write` | ✓ |
| PUT/DELETE | `/categories/{id}` (`If-Match` with the category's `version`; stale → 409 `concurrency`) | `catalog.write` / `catalog.delete` | ✓ |
| GET | `/products?q=&status=&categoryId=&page=&pageSize=&sort=` | `catalog.read` | ✓ |
| POST | `/products` | `catalog.write` (+ entitlement `products.max`) | ✓ |
| GET/PUT | `/products/{id}` | `catalog.read` / `catalog.write` | ✓ |
| POST | `/products/{id}/archive` | `catalog.write` | ✓ |
| DELETE | `/products/{id}` | `catalog.delete`; only if never ordered, otherwise archive | ✓ |
| GET | `/dashboard/summary?days=30` | `reports.read` | ✓ (catalogue counts; sales metrics arrive with Orders) |
| GET | `/staff`: members, pending invitations, seats used / plan limit | `staff.manage` | ✓ |
| POST | `/staff/invitations` `{email, role}`: role must be below the inviter's (Owner → Manager/Staff, Manager → Staff); counts against plan seats | `staff.manage` | ✓ |
| POST | `/staff/invitations/{id}/resend`: new token (old link stops working), new 7-day expiry; once a minute | `staff.manage` | ✓ |
| DELETE | `/staff/invitations/{id}`: revoke | `staff.manage` | ✓ |
| PATCH/DELETE | `/staff/{userId}`: change role or remove. Only people ranked below you; never yourself or the owner | `staff.manage` | ✓ |
| GET | `/onboarding`: launch checklist computed from store state | any member | ✓ |
| POST | `/onboarding/launch`: publishes the storefront; 422 `launch-requirements` lists missing steps | `settings.write` | ✓ |
| POST | `/products/{id}/media/uploads` `{contentType, sizeBytes, fileName}`: JPEG/PNG/WebP ≤ 5 MB, ≤ 10 per product (pending uploads count). Returns a presigned PUT URL valid 10 minutes and the headers to send | `catalog.write` | ✓ |
| POST | `/products/{id}/media/{mediaId}/complete`: the API measures and sniffs the stored file (magic bytes); a mismatch deletes it and returns 422 `invalid-media`; 409 if nothing was uploaded yet | `catalog.write` | ✓ |
| PATCH | `/products/{id}/media/{mediaId}` `{altText}` | `catalog.write` | ✓ |
| PUT | `/products/{id}/media/order` `{mediaIds}` (every image exactly once) | `catalog.write` | ✓ |
| DELETE | `/products/{id}/media/{mediaId}`: hidden at once; the file is removed 2 hours later (cached storefront pages) | `catalog.write` | ✓ |
| GET | `/locations`: locations with units on hand, plus the plan's `maxLocations` | `catalog.read` | ✓ |
| POST/PUT/DELETE | `/locations[/{id}]` `{name, code, stateCode, isDefault}`. Plan limit; the default location and locations holding stock can't be deleted | `settings.write` | ✓ |
| GET | `/inventory?q=&locationId=&stock=all\|low\|out&page=`: per variant, with per-location levels | `catalog.read` | ✓ |
| POST | `/inventory/adjustments` `{locationId, reason, note, lines:[{variantId, delta \| countedOnHand}]}`. Reasons: receipt, return (increase), damaged, lost (decrease), correction (either). All lines or none; 409 `insufficient-stock` names the failing lines; never below reserved | `inventory.write` | ✓ |
| POST | `/inventory/transfers` `{fromLocationId, toLocationId, note, lines:[{variantId, quantity}]}`: two ledger rows per line, one batch | `inventory.write` | ✓ |
| GET | `/inventory/movements?variantId=&locationId=&page=`: the stock ledger with reason, note and who | `catalog.read` | ✓ |
| GET | `/orders`, `/orders/{id}`; POST `/orders/{id}/transitions`, `/orders/{id}/refunds` | `orders.*` | Phase 8 |
| GET/POST/PUT | `/coupons` | `marketing.write` | Phase 8 |
| GET | `/audit?area=&actorId=&page=&pageSize=`: activity log, newest first, with actor | `audit.read` | ✓ |

### Storefront (`/api/storefront`, tenant from host)

| Method | Path | |
|---|---|---|
| GET | `/store`: name, branding, policies, `isLive`. Answers before launch (for the “coming soon” page) | ✓ |
| GET | `/categories` (404 until the store launches, like every catalogue endpoint) | ✓ |
| GET | `/products?q=&category=&minPrice=&maxPrice=&inStock=&sort=&page=` (active only) | ✓ |
| GET | `/products/{slug}` | ✓ |
| GET/POST/PATCH/DELETE | `/cart`, `/cart/lines` | Phase 7 |
| POST | `/customers/signup`, `/customers/login`; GET `/customers/me/orders` | Phase 7 |
| POST | `/checkout/quote`, `/checkout` (Idempotency-Key) | Phase 8 |

### Platform (`/api/platform`)

| Method | Path | |
|---|---|---|
| GET | `/tenants?status=&q=` | ✓ |
| POST | `/tenants/{id}/suspend`, `/tenants/{id}/reactivate` | ✓ |
| GET/PUT | `/plans` | Phase 9 |

### Webhooks

`POST /api/webhooks/razorpay`: HMAC-SHA256 signature verification against the raw body, inbox
de-duplication, 2xx returned only after a durable write. Phase 8.

### Health

`GET /health/live` (process up), `GET /health/ready` (database reachable). Both ✓.
