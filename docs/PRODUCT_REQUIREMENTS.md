# Product Requirements

## 1. Vision

ShopMint is a multi-tenant e-commerce SaaS for Indian D2C brands and small retailers. A merchant signs up,
gets a branded store on `<store>.shopmint.in` (or a custom domain), manages catalogue, inventory and
orders, takes UPI, card and COD payments, issues GST-compliant invoices, and pays ShopMint a monthly
subscription.

## 2. Personas and roles

| Persona | Realm | Roles | Key jobs |
|---|---|---|---|
| Platform operator | Platform | `PlatformAdmin`, `PlatformSupport` (read-only) | Manage tenants, plans and suspensions; support merchants; see platform health |
| Merchant team | Tenant | `Owner`, `Manager`, `Staff` | Run the store: catalogue, orders, customers, settings |
| Shopper | Tenant storefront | `Customer` (or anonymous guest) | Browse, buy, track orders, manage addresses |

**Permission matrix (MVP)**

| Capability | Owner | Manager | Staff |
|---|---|---|---|
| View dashboard and orders | ✓ | ✓ | ✓ |
| Manage products, inventory and coupons | ✓ | ✓ | ✓ (no delete) |
| Fulfil, cancel and refund orders | ✓ | ✓ | fulfil only |
| Manage staff | ✓ | ✓ (cannot grant Owner) | — |
| Store settings, payments and domains | ✓ | — | — |
| Billing and plan | ✓ | — | — |

Permissions are modelled as named permissions (`catalog.write`, `orders.refund`, and so on), which roles
group. This lets custom roles arrive later without a schema change.

## 3. Release scope

### MVP (release 1): "a merchant can sell and get paid"

1. **Platform:** tenant sign-up and onboarding wizard; platform admin console (tenants list, suspend or reactivate, plan assignment); audit log.
2. **Identity:** merchant email and password login, invitations, password reset, roles; customer accounts per store; guest checkout.
3. **Catalogue:** products with variants (option values such as size and colour, each variant with its own SKU, price, MRP and stock); categories (one level of nesting); product images (S3); draft, active and archived states; HSN and GST rate per product.
4. **Inventory:** stock per variant per location (single location in MVP, multi-location on Pro); adjustments with reasons; an immutable movement ledger; low-stock threshold; reservation at checkout.
5. **Storefront:** server-rendered home, collection/category, search, product, cart, checkout, account, order history and tracking; tenant branding (logo, colour, hero); SEO metadata and sitemap.
6. **Orders and payments:** Razorpay (UPI, card, netbanking) and COD; server-computed totals; idempotent order placement; webhook reconciliation; cancellations and full or partial refunds; GST tax invoices with a per-tenant invoice series.
7. **Shipping:** flat-rate and free-above-threshold methods; serviceable pincode list; manual shipment entry with carrier and AWB.
8. **Marketing:** coupons (percent with cap, or flat; minimum order; expiry; total and per-customer limits).
9. **Notifications:** transactional emails (order placed, shipped, delivered, refunded; staff invite; password reset).
10. **Merchant dashboard:** revenue, orders, AOV, top products and low stock, computed server-side over real data.
11. **SaaS billing:** plans with entitlements (product count, staff seats, locations, custom domain); 14-day trial; Razorpay Subscriptions; enforced server-side.

### Release 2

Purchase orders and suppliers, expenses and P&L (the mock's ERP), multi-location fulfilment routing,
shipping carrier integrations (Shiprocket, Delhivery), returns portal, wishlist, abandoned-cart email,
reports with CSV and PDF export, product reviews, custom roles, data export, Stripe adapter.

### Later

Multi-currency, marketplace channels, POS, public API and webhooks for merchants, app ecosystem,
dedicated-database tenants, AI merchandising.

## 4. Key workflows

1. **Merchant onboarding:** sign up (email, password, store name, subdomain) → email verification → wizard (business details and GSTIN, state, branding, first product, payments) → trial starts → store goes live.
2. **Checkout:** cart (server-side, keyed by an anonymous cart token) → address → shipping quote → `POST /checkout` creates an order in `PendingPayment` and **reserves stock** (15-minute TTL) → Razorpay order created → client pays → webhook `payment.captured` → order `Confirmed`, reservation committed, invoice issued, email sent. COD skips the gateway and confirms immediately, subject to the COD limit.
3. **Fulfilment:** Confirmed → Packed → Shipped (AWB) → Delivered. Cancellation is allowed before Shipped (releases stock, triggers a refund). Returns come after Delivered (release 2 portal; an MVP manual return exists).
4. **Subscription:** trial → active → past_due (payment failure, 7-day grace) → suspended (storefront shows "temporarily unavailable"; admin is read-only plus billing) → cancelled → data retained 30 days → deleted.

## 5. Non-functional requirements

| Area | Target |
|---|---|
| Storefront performance | LCP < 2.5 s at p75 on 4G mobile; product and category pages cached and revalidated on change |
| API latency | p95 < 300 ms for reads, < 800 ms for checkout (excluding the gateway) |
| Availability | 99.9% monthly for storefront and checkout |
| Scale (year 1) | 2,000 tenants, 50k products per large tenant, 100 orders per minute platform peak |
| Security | OWASP ASVS L2; no cross-tenant access; PCI scope limited to SAQ-A (no card data touches our servers) |
| Accessibility | WCAG 2.2 AA |
| Data | RPO 15 minutes, RTO 4 hours; data stored in India (DPDP Act 2023) |

## 6. Assumptions

- India-first (INR, GST, Razorpay). Prices are entered GST-inclusive, which matches the mock and Indian B2C convention.
- English UI in the MVP; copy is externalisable for Hindi later.
- Merchants are small (1 to 20 staff). Enterprise features are deferred.
