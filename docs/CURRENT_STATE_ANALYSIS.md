# Current State Analysis

Companion to `PROJECT_AUDIT.md`. This document describes **what the mock does today**, screen by screen,
and assesses the UI and UX.

## 1. Runtime model

```
index.html ─► CDN libs (Chart.js, jsPDF) ─► data.js (seed) ─► core.js (store, router, layouts)
          ─► storefront.js / admin.js / erp.js / reports.js / saas.js (register routes + nav)
          ─► boot.js (router.start)
State: localStorage["shopmint.v1.t.<tenantId>"] = whole tenant JSON; ["shopmint.v1.session"] = cart + customer per tenant
```

There is no server. Switching tenant replaces `App.state` with another blob.

## 2. Existing features

| Area | Feature | Status in mock | Production gap |
|---|---|---|---|
| Storefront | Home: hero, categories, bestsellers, deals | Works | No CMS or merchandising control; "bestseller" is computed client-side |
| | Listing with category, price band, in-stock and sort filters in the URL | Works | No server pagination; filters scan the whole array |
| | Product page: size and colour selection, stock badge, quantity, pincode check | Works | Variants aren't SKUs, stock isn't per variant, the pincode check is a fake rule |
| | Cart with stock cap and coupon chips | Works | Cart is in localStorage only; no guest-to-customer merge |
| | Checkout: address, shipping method, UPI, card or COD, GST shown | Works | Simulated payment; client computes totals |
| | Order confirmation and timeline | Works | — |
| | Customer login, signup and My Orders | Mock | No real auth, password or reset |
| | Wishlist, addresses book, order tracking link, reviews | **Missing** | |
| Merchant admin | Dashboard with KPIs, 4 charts and a 7/30/90 range | Works (charts need CDN) | Computed client-side over all orders |
| | Products CRUD (price, MRP, SKU, HSN, GST, stock, variants) | Works | No images, no draft or archived states, no per-variant SKU and price |
| | Categories CRUD | Works | Flat only; no collections |
| | Orders list, detail and status flow | Works | Free status jumps; no fulfilment or shipment entities |
| | Customers list and detail | Works | — |
| | Coupons CRUD | Works | No per-customer limit or usage cap |
| | Staff and roles (Owner, Manager, Staff) | UI only | No invitations or real permissions |
| | Store settings: logo, colour, domain, GSTIN, payments, shipping | Works | Not validated server-side |
| ERP | Inventory by warehouse, adjustments, low-stock alerts | Works | No reservations, no movement ledger integrity |
| | Purchase orders with "receive", suppliers | Works | Deferred to release 2 |
| | GST invoices (CGST/SGST/IGST), printable | Works | No invoice numbering series or immutability |
| | Expenses and P&L | Works | Deferred to release 2 |
| Reports | 5 reports with CSV and PDF export | Works | Will become server-generated |
| SaaS | Tenant list, "create store" | Mock | No onboarding, provisioning or lifecycle |
| | Plans (Basic ₹999 / Pro ₹2,499 / Enterprise ₹7,999) and feature matrix | Display only | No enforcement or billing |
| | **Platform super-admin** (cross-tenant console) | **Missing** | The mock's "Stores" page is merchant-scoped |
| Cross-cutting | Notifications (email), audit log, file storage, search, webhooks | **Missing** | |

## 3. UI/UX assessment

These observations come from screenshots taken at 1280 px and 390 px during the audit.

### What works

- The palette is clean and neutral, the type size is readable and density is reasonable on desktop.
- Admin navigation groups are logical.
- Indian formatting (₹1,24,999) and GST visibility build trust for the target market.
- Filters are kept in the URL, so they are shareable.

### What should be redesigned

| Issue | Evidence | Direction |
|---|---|---|
| Emoji are used as icons and as product imagery | Navigation (📊🧾📦), product thumbnails and the hero | A consistent icon set (Lucide), real product photography and a neutral placeholder |
| Demo controls are mixed into product chrome | The tenant switcher, role switcher and colour picker sit in the admin top bar and storefront header | Remove them. Tenant comes from the domain or session, role from login, theme from Settings |
| The page title is duplicated | "Dashboard" appears in the top bar and again as the H1 | One title, with breadcrumbs only in deep pages |
| KPI cards are misaligned and oversized | The first KPI card is taller than the rest; on mobile, five full-width cards fill about 1.5 screens | An equal-height compact KPI row; two columns on mobile |
| Charts blank without the CDN | All four dashboard charts show a fallback message | Bundle the charting library and add skeleton loading states |
| The storefront hero is a generic gradient with an emoji | Large purple gradient | Merchant-controlled hero image and copy, restrained brand use |
| The colour picker re-themes everything with one hex | Contrast is not checked; a light brand colour fails contrast | Generate an accessible brand scale and check text contrast at save time |
| Tables collapse with `data-label` cards on mobile | Acceptable, but dense | Responsive data table with prioritised columns and a detail drawer |
| Focus is lost on navigation | `innerHTML` swaps the whole app | Real routing that manages focus |
| Forms are modals for everything | Product editing happens in a modal | Full-page editors for complex entities; modals only for quick actions |

### Rebuild verdict

Rebuild the UI from a fresh design system (see `SYSTEM_ARCHITECTURE.md` §7 and `apps/web`). Keep the
information architecture and copy tone. Discard the markup, CSS and interaction code.
