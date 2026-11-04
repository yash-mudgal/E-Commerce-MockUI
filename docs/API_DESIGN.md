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

**Two-step verification (`/api/auth/mfa`, Phase 11).** When it's on, `POST /login` answers `{mfaRequired: true, challenge}`
instead of a session; the challenge is single-use and lasts 5 minutes.

| Method | Path | Description | |
|---|---|---|---|
| POST | `/verify` | `{challenge, code}`: an authenticator code (±30 s, never twice) or a recovery code → session marked verified. 5 wrong codes lock the account for 15 minutes; rate-limited | ✓ |
| GET | `/` | `{enabled, recoveryCodesLeft, enabledAt}` | ✓ |
| POST | `/setup` | New pending secret and `otpauth://` URI (QR); nothing changes until confirmed | ✓ |
| POST | `/enable` | `{code}` for the pending secret → 10 recovery codes (shown once); other sessions end, this one stays and is verified | ✓ |
| POST | `/recovery-codes` | `{password}` → 10 new codes; old ones stop working | ✓ |
| POST | `/disable` | `{password, code}`; other sessions end | ✓ |

All `/api/platform/*` endpoints also need a verified session: 403 `mfa-required` otherwise.

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
| DELETE | `/products/{id}` | `catalog.delete`; 409 if any variant was ordered (archive instead). Removing an ordered variant in PUT is also 409 | ✓ |
| GET | `/dashboard/summary` | `reports.read` | ✓ catalogue counts, low stock, and `sales` (last 30 days: orders, revenue net of refunds, average order, to fulfil, awaiting payment, daily series; null before the first order) |
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
| GET | `/orders?q=&status=&payment=&page=&pageSize=`: `q` is an order number or name/email/mobile; `status` an order status or `open` (confirmed or packed) | `orders.read` | ✓ |
| GET | `/orders/{id}`: lines, totals, seller snapshot, payment attempts, refunds (with reasons), shipments, invoice, allowed `actions` | `orders.read` | ✓ |
| POST | `/orders/{id}/pack`, `/orders/{id}/deliver` (COD → paid), `/orders/{id}/ship` `{carrier, trackingNumber, trackingUrl?}` (https only; emails the shopper) | `orders.fulfil` | ✓ |
| POST | `/orders/{id}/cancel` `{reason?}`: restocks; refunds online payments in full | `orders.refund` | ✓ |
| POST | `/orders/{id}/refunds` `{amount, reason}`: capped by the refundable balance; Razorpay refund for online orders, recorded as `Manual` for COD | `orders.refund` | ✓ |
| GET | `/coupons` | `orders.read` | ✓ |
| POST/PUT/DELETE | `/coupons[/{id}]` `{code, kind: percent\|fixed, value, minSubtotal, maxDiscount?, startsAt?, endsAt?, usageLimit?, perCustomerLimit, isActive}`. PUT takes `If-Match`; a used coupon can't be deleted (turn it off) | `settings.write` | ✓ |
| GET | `/payments`: Razorpay connection (masked key ID, live/test keys), this store's webhook URL, whether test mode is available | `settings.write` | ✓ |
| PUT/DELETE | `/payments/razorpay` `{keyId, keySecret, webhookSecret}`: keys are checked against Razorpay, secrets stored encrypted and never returned | `settings.write` | ✓ |
| GET | `/audit?area=&actorId=&page=&pageSize=`: activity log, newest first, with actor | `audit.read` | ✓ |
| GET | `/customers?q=&page=`: shopper accounts of this store (name, email, mobile, marketing consent) | `orders.read` | ✓ |
| GET | `/billing`: status, plan and limits, usage, trial/grace dates, current subscription, plan options (with the action allowed and why not), receipts | `billing.manage` | ✓ |
| POST | `/billing/checkout` `{planCode}`: creates a Razorpay subscription (first charge at the trial's end, or when a cancelled plan ends) and returns what Razorpay Checkout needs. 422 when the store's data doesn't fit the plan | `billing.manage` | ✓ |
| POST | `/billing/verify` `{razorpayPaymentId, razorpaySubscriptionId, razorpaySignature}`: HMAC check plus a read-back of the subscription | `billing.manage` | ✓ |
| POST | `/billing/change-plan` `{planCode}`: upgrade now, downgrade at period end (422 if data doesn't fit) | `billing.manage` | ✓ |
| POST | `/billing/cancel`: at period end for an active subscription, at once otherwise | `billing.manage` | ✓ |
| POST | `/billing/test-payment` `{subscriptionId, outcome}`: test mode only (404 otherwise) | `billing.manage` | ✓ |
| | While a store is suspended or cancelled every admin write returns 403 `tenant-suspended`, **except** `/billing/*` | | ✓ |

| GET | `/reports/sales?from=&to=&groupBy=day\|week\|month`: dates are `yyyy-MM-dd` in Indian time, inclusive, up to 366 days (default: last 30). Totals, series, by payment, top products, by state, cancelled | `reports.read` | ✓ |
| GET | `/reports/gst?from=&to=`: invoices issued in the range by place of supply and rate, HSN summary, cancelled invoices | `reports.read` | ✓ |
| GET | `/reports/orders.csv`, `/reports/gst.csv`, `/reports/hsn.csv` (same `from`/`to`): CSV with BOM; formula-like text is neutralised. The orders file needs `orders.read` too | `reports.read` | ✓ |
| GET/PUT | `/me/notifications` `{newOrders, lowStock}`: the signed-in member's email preferences for this store | any member | ✓ |

### Storefront (`/api/storefront`, tenant from host)

| Method | Path | |
|---|---|---|
| GET | `/store`: name, branding, policies, `isLive`. Answers before launch (for the “coming soon” page). A suspended store answers **503** `store-unavailable` on every storefront route; a cancelled one 404 | ✓ |
| GET | `/categories` (404 until the store launches, like every catalogue endpoint) | ✓ |
| GET | `/products?q=&category=&minPrice=&maxPrice=&inStock=&sort=&page=` (active only) | ✓ |
| GET | `/products/{slug}` | ✓ |
| GET | `/sitemap`: active product and category slugs with update times (feeds `/sitemap.xml`) | ✓ |
| GET | `/cart`: the shopper's cart (signed-in customer's, else the guest cart from the `sm_cart` cookie). Prices, availability and totals are computed from the database on every read; each line reports `ok`, `limited`, `out_of_stock` or `unavailable` | ✓ |
| POST | `/cart/lines` `{variantId, quantity}`: only variant and quantity are accepted (any price sent is ignored). Max 10 per item and 30 items; 409 `insufficient-stock` beyond what's available | ✓ |
| PATCH/DELETE | `/cart/lines/{id}` `{quantity}` (0 removes). Lowering is always allowed; raising needs stock | ✓ |
| POST | `/account/signup`, `/account/login` (lockout, rate-limited), `/account/logout`. Sign-in merges the guest cart into the customer's cart | ✓ |
| GET/PATCH | `/account/me`: profile (name, mobile, marketing consent). GET returns 204 when nobody is signed in | ✓ |
| POST | `/account/password/forgot`, `/reset`, `/change` (links use the store's registered domain) | ✓ |
| GET/POST/PUT/DELETE | `/account/addresses[/{id}]`: Indian mobile, 6-digit PIN code, GST state code; one default; up to 10 | ✓ |
| POST | `/account/unsubscribe` `{token}`: turns off marketing email for the shopper the token was issued to (this store only; rate-limited; no sign-in) | ✓ |
| POST | `/checkout/quote` `{addressId, couponCode?}`: lines, discount, delivery, GST split, total and payment options (online / COD with reason). Signed-in shopper, own address | ✓ |
| POST | `/checkout/orders` `{addressId, couponCode?, paymentMethod: online\|cod}` + `Idempotency-Key` header (8–100 chars; same key → same order). Rate-limited. Totals are recomputed; 409 `cart-changed` / `insufficient-stock` when stock moved. Online orders return the gateway order for Razorpay Checkout | ✓ |
| POST | `/checkout/orders/{id}/pay`: payment details again for an unpaid order | ✓ |
| POST | `/checkout/orders/{id}/verify` `{razorpayOrderId, razorpayPaymentId, razorpaySignature}`: HMAC check with the store's secret, then the payment is read back from Razorpay (status and amount) | ✓ |
| POST | `/checkout/orders/{id}/test-payment` `{outcome: success\|failure}`: test mode only (404 otherwise) | ✓ |
| GET | `/account/orders?page=`, `/account/orders/{id}` (own orders only; no gateway IDs or refund reasons) | ✓ |
| POST | `/account/orders/{id}/cancel` `{reason?}`: while awaiting payment or confirmed | ✓ |

### Platform (`/api/platform`)

| Method | Path | |
|---|---|---|
| GET | `/tenants?status=&q=` | ✓ |
| POST | `/tenants/{id}/suspend`, `/tenants/{id}/reactivate` | ✓ |
| GET | `/plans`: all plans with limits, prices (with GST), Razorpay plan IDs and store counts | ✓ |
| PUT | `/plans/{code}` (`If-Match`): name, price, limits (null = unlimited), public flag, Razorpay plan ID (unique, `plan_…`). The trial stays free and unsold | ✓ |
| POST | `/tenants/{id}/plan` `{planCode \| null, note}`: assign a plan without online payment (contracts), or end it. 409 while the store pays through a subscription | ✓ |
| | Suspend sets a **platform** suspension (paying can't lift it); reactivate removes it and re-derives the billing state | ✓ |

### Webhooks

`POST /api/webhooks/razorpay/{storeId}` ✓: one URL per store. The ID only selects which store's webhook secret to
check; the HMAC-SHA256 signature over the raw body (`X-Razorpay-Signature`) proves the sender. Orders are found by
the stored gateway order ID, never from payload notes. Events are recorded in `webhook_events`
(`X-Razorpay-Event-Id`, or the body hash) so redeliveries return `{duplicate: true}`; handlers are idempotent.
Handled: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed`.

`POST /api/webhooks/razorpay-billing` ✓: ShopMint's own Razorpay account (subscription fees). Signed with the platform
webhook secret; matched to a store by stored subscription ID; de-duplicated; the subscription is read back from
Razorpay before applying. Handled: `subscription.*` (authenticated, activated, charged, pending, halted, cancelled,
completed, updated, paused, resumed) and `invoice.paid` (receipt link).

### Health

`GET /health/live` (process up), `GET /health/ready` (database reachable). Both ✓.
