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
| POST | `/password/forgot`, `/password/reset` | Reset flow | Phase 4b |

### Merchant admin (`/api/admin`)

| Method | Path | Permission | |
|---|---|---|---|
| GET | `/store` | any member | ✓ |
| PATCH | `/store` | `settings.write` | ✓ |
| GET/POST | `/categories` | `catalog.read` / `catalog.write` | ✓ |
| PUT/DELETE | `/categories/{id}` | `catalog.write` / `catalog.delete` | ✓ |
| GET | `/products?q=&status=&categoryId=&page=&pageSize=&sort=` | `catalog.read` | ✓ |
| POST | `/products` | `catalog.write` (+ entitlement `products.max`) | ✓ |
| GET/PUT | `/products/{id}` | `catalog.read` / `catalog.write` | ✓ |
| POST | `/products/{id}/archive` | `catalog.write` | ✓ |
| DELETE | `/products/{id}` | `catalog.delete`; only if never ordered, otherwise archive | ✓ |
| GET | `/dashboard/summary?days=30` | `reports.read` | ✓ (catalogue counts; sales metrics arrive with Orders) |
| GET/POST | `/members`, `/invitations` | `staff.manage` | Phase 5 |
| POST | `/media/uploads` | `catalog.write`: returns a presigned PUT URL | Phase 6 |
| GET/PATCH | `/inventory/levels`, POST `/inventory/adjustments` | `inventory.write` | Phase 6 |
| GET | `/orders`, `/orders/{id}`; POST `/orders/{id}/transitions`, `/orders/{id}/refunds` | `orders.*` | Phase 8 |
| GET/POST/PUT | `/coupons` | `marketing.write` | Phase 8 |
| GET | `/audit-log` | `audit.read` | Phase 10 |

### Storefront (`/api/storefront`, tenant from host)

| Method | Path | |
|---|---|---|
| GET | `/store`: name, branding, policies | ✓ |
| GET | `/categories` | ✓ |
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
