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

### Platform metrics and feedback (Phase 13)

| Method | Path | |
|---|---|---|
| GET | `/api/platform/metrics?from=&to=`: stores by status, MRR (by plan, past-due at risk), onboarding funnel for stores created in the range, orders and net sales (sales-report rule), payment success, email health, weekly series (Indian weeks). Up to 366 days | ✓ |
| GET | `/api/platform/feedback?status=&category=&q=&page=`: feedback with store name, contact email only if the sender agreed, and counts by status | ✓ |
| PATCH | `/api/platform/feedback/{id}` `{status, teamNote}`: New, Triaged, Planned, Done, Declined | ✓ |
| POST | `/api/admin/feedback` `{category, message, page?, mayContact}`: any member; 10 per user per hour; 201 | ✓ |

### Storefront redesign, reviews and wishlist (Phases 14–15)

| Method | Path | |
|---|---|---|
| GET | `/api/storefront/store`: now also `shippingFee`, `freeShippingThreshold`, `codEnabled`, `codMaxOrderValue`, `onlinePayments`, `onlinePaymentsTest`, `businessAddress` (the terms checkout applies, so the storefront can state them) | ✓ |
| GET | `/api/storefront/categories`: each with `cover` (first image of the newest active product that has one) | ✓ |
| GET | `/api/storefront/products?onSale=&exclude=&slugs=a,b`: on sale (cheapest variant below MRP), all but one product (related), a given set of up to 24 (recently viewed). Cards now carry `hoverImage`, `rating` and `reviewCount` | ✓ |
| GET | `/api/storefront/products/{slug}`: now with `ratings` `{average, count, distribution[1..5]}` from published reviews | ✓ |
| GET | `/api/storefront/products/{slug}/reviews?page=`: published reviews, newest first, 10 a page; author is first name + last initial | ✓ |
| GET | `/api/storefront/products/{slug}/reviews/mine`: shopper; `{canReview, reason, review}` | ✓ |
| PUT | `/api/storefront/products/{slug}/reviews/mine` `{rating, title?, body}`: shopper with a delivered order containing the product (403 otherwise); create or edit, always back to Pending; 20 per IP per hour | ✓ |
| GET / PUT / DELETE | `/api/storefront/account/wishlist[/{slug}]`: shopper's saved products (cards, newest first); save and remove are idempotent; up to 200 | ✓ |
| GET | `/api/admin/reviews?status=&page=`: catalog.write; with product, customer name and email, counts by status | ✓ |
| PATCH | `/api/admin/reviews/{id}` `{status?, reply?}`: Pending, Published, Hidden; empty reply removes it; audited; refreshes the storefront cache | ✓ |

### Home page, collections, pages and filters (Phase 16)

| Method | Path | |
|---|---|---|
| GET | `/api/storefront/home`: hero heading/text, hero image (one of the store's own product photos, only while that product is active) and its product slug, announcement override, section switches, featured collection, published collections (count, cover), published pages | ✓ |
| GET | `/api/storefront/pages/{slug}`: a published store page (title, body, updatedAt) | ✓ |
| GET | `/api/storefront/facets?category=&collection=&q=`: option values (size, colour…) with product counts from active variants, names grouped case-insensitively, sizes in size order; price min/max | ✓ |
| GET | `/api/storefront/products?collection=&opt=Size:M&opt=Colour:Indigo`: collection = every active product with its tag (case-insensitive); options OR within a name, AND across names | ✓ |
| GET / PUT | `/api/admin/storefront`: home page settings (settings.write); the hero image must be a ready image of this store; refreshes the storefront cache | ✓ |
| GET | `/api/admin/storefront/hero-images`: the store's ready product photos to pick from | ✓ |
| GET / POST / PUT / DELETE | `/api/admin/pages[/{id}]`: store pages (settings.write); slug from the title unless given; unique per store; publishing needs content; up to 20 | ✓ |
| GET / POST / PUT / DELETE | `/api/admin/collections[/{id}]`: collections (catalog.write) with live product counts; up to 30 | ✓ |

### Returns and delivery (Phase 17)

| Method | Path | |
|---|---|---|
| PATCH | `/api/admin/store`: also `returnWindowDays` (0–90; 0 = no online returns), `deliverOnlyToZones`, `deliveryMinDays`/`deliveryMaxDays` (both or `clearDeliveryDays`) | ✓ |
| GET / POST / PUT / DELETE | `/api/admin/shipping-zones[/{id}]`: settings.write; name, PIN prefixes (1–6 digits, not starting with 0), fee and free threshold (null = store's), days, COD; up to 50 | ✓ |
| GET | `/api/storefront/delivery?pincode=`: serviceable, fee, free threshold, COD (and its limit), days; longest matching prefix wins | ✓ |
| POST | `/api/storefront/checkout/quote` and `/orders`: shipping fee, free threshold and COD now come from the address's zone; unserviceable PIN codes are refused (400 on `addressId`) | ✓ |
| GET / POST | `/api/storefront/account/orders/{id}/returns`: shopper's returns for an order, eligibility (window from delivery), returnable quantity per line; request `{reason, resolution, note, lines[]}` (201) | ✓ |
| GET | `/api/admin/returns?status=&orderId=&page=`: orders.read; with order number, customer, lines and value | ✓ |
| POST | `/api/admin/returns/{id}/approve|reject|close` `{note}` (orders.fulfil; reject needs a note), `/receive` `{restock}` (orders.fulfil), `/refund` `{amount}` (orders.refund; at most the returned items' value, through the order refund flow). Each emails the shopper | ✓ |

### Gift cards and newsletter (Phase 18)

| Method | Path | |
|---|---|---|
| POST | `/api/admin/gift-cards` `{value, expiresAt?, recipientName?, recipientEmail?, note?, sendEmail}`: settings.write; returns the code once (201); only its SHA-256 and last 4 are stored; optional email to the recipient | ✓ |
| GET | `/api/admin/gift-cards?q=&page=` (with outstanding balance), `/api/admin/gift-cards/{id}` (with transactions): orders.read | ✓ |
| POST | `/api/admin/gift-cards/{id}/disable`: settings.write | ✓ |
| POST | `/api/storefront/gift-cards/check` `{code}`: signed-in shopper; balance; checkout rate limit | ✓ |
| POST | `/api/storefront/checkout/quote` and `/orders` with `giftCardCode`: the card pays first (up to the total); `giftCardApplied`, `giftCardLast4`, `amountDue`; cash on delivery refused with a card; fully covered orders are confirmed and paid at once; the card row is locked when placing | ✓ |
| POST | `/api/storefront/newsletter` `{email}` (202 whatever the address's state; confirmation email at most every 10 minutes), `/confirm` and `/unsubscribe` `{token}` | ✓ |
| GET | `/api/admin/newsletter?status=&page=` (counts), `/api/admin/newsletter/subscribers.csv` (confirmed only): orders.read | ✓ |

Orders now include `giftCardAmount`. Refunds of an order paid partly by gift card go to the online/cash part first and then
back onto the card (refund status `ToGiftCard`); cancelled or expired unpaid orders put the card amount back.

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
