# Project Audit — ShopMint

_Audit date: 2026-11-03 · Scope: entire repository at commit `058e0a1`_

## 1. Executive summary

The repository is a **static, client-only clickable prototype** ("ShopMint") of a multi-tenant Indian
e-commerce SaaS. It is about 4,400 lines of hand-written vanilla JavaScript, CSS and one HTML shell, with no
build step, no backend, no database, no automated tests and no deployment pipeline beyond GitHub Pages.

It is a **useful product specification**. It covers storefront, merchant admin, ERP (inventory, purchase
orders, suppliers, GST invoices, expenses, P&L), reports and SaaS administration, and it already encodes a
number of correct Indian-market business rules (GST-inclusive pricing, CGST+SGST vs IGST split, COD limits
and fees, pincode checks, en-IN number formatting).

It is **not a foundation for production code**. Every rule runs in the browser, state lives in
`localStorage`, "authentication" is a dropdown, and tenant isolation is only a `localStorage` key prefix.
Nothing in it can be trusted server-side, and the rendering approach (string-concatenated `innerHTML`,
inline `onclick`) cannot be carried forward safely.

**Recommendation:** keep the mock as a frozen reference under `legacy/mock-ui/`, mine it for requirements and
business rules (captured in `PRODUCT_REQUIREMENTS.md`), and build the product fresh as a Next.js + ASP.NET
Core modular monolith on PostgreSQL. Reasoning is in `TECH_STACK_DECISION.md`.

## 2. Inventory

| Path | Lines | Role |
|---|---|---|
| `index.html` | 29 | Shell; loads Chart.js, jsPDF and jsPDF-autotable from cdnjs, then 8 classic scripts in order |
| `css/app.css` | 354 | Design tokens and every component and layout style |
| `js/data.js` | 469 | Deterministic seed generator: 3 tenants, catalogs, orders, customers, POs, expenses, staff, plans |
| `js/core.js` | 689 | Formatting, the state "store" (pricing, stock, orders, coupons), UI helpers, hash router, both layouts |
| `js/storefront.js` | 468 | Home, listing and search, PDP, cart, checkout, confirmation, login and signup, account |
| `js/admin.js` | 642 | Dashboard, products, categories, orders, customers, coupons; also injects its own CSS |
| `js/erp.js` | 1,030 | Inventory, purchase orders, suppliers, invoices, accounting, staff; also a second helper library (`XU`) |
| `js/reports.js` | 237 | Five reports with CSV and PDF export |
| `js/saas.js` | 360 | Stores, plans and billing, store settings |
| `js/boot.js` | 18 | Chart defaults; starts the router |

Dependencies: Chart.js 4.4.1, jsPDF 2.5.1 and jspdf-autotable 3.8.2, all from a CDN with no integrity
hashes. There is no `package.json`, lockfile, `.gitignore`, `.editorconfig`, licence, CI or test.

## 3. Findings

Priority key: **P0** blocks production or is a security issue · **P1** needed for a commercial MVP ·
**P2** quality or maintainability · **P3** nice to have.

### Architecture

| # | Current situation | Problem | Proposed solution | Priority |
|---|---|---|---|---|
| A1 | There is no backend. All business logic (`S.totals`, `S.placeOrder`, `S.validateCoupon`, stock) runs in the browser. | Prices, discounts, stock and payment status can all be changed by the client. Nothing can be enforced. | Move every rule to an ASP.NET Core API. The browser only displays server-computed values. | P0 |
| A2 | State is one JSON blob per tenant in `localStorage`. | There is no persistence, no concurrency control, no multi-user use and no audit trail. Data is lost when site data is cleared. | PostgreSQL with migrations, constraints, transactions and optimistic concurrency. | P0 |
| A3 | A single global `App` object with mutable `App.state` is read and written by every module. | Modules are tightly coupled, nothing can be tested in isolation, and changes have no clear boundaries. | Modular monolith with explicit modules (Catalog, Orders, Inventory, and so on) and a typed API contract. | P1 |
| A4 | There are two parallel helper libraries: `App.fmt`/`App.store` in core.js and `XU` in erp.js (`XU.inr`, `XU.uid`, `XU.can`, `XU.syncStock` and others). | Rules are duplicated, for example stock recalculation exists twice and role checks exist twice. | One shared formatting library on the frontend; business rules live only on the server. | P2 |
| A5 | The hash router renders by setting `#content.innerHTML` from concatenated strings. | Pages can't be server-rendered, links can't be shared for SEO, and accessibility suffers (focus is lost on every render). | Next.js App Router with server rendering for the storefront. | P1 |
| A6 | `admin.js` injects a `<style>` block at runtime. | Styles are split across files and the cascade is hard to follow. | Tailwind with a design-token layer. | P2 |

### Security

| # | Current situation | Problem | Proposed solution | Priority |
|---|---|---|---|---|
| S1 | Login is a mock. The admin "current user" is a dropdown and any visitor can become Owner. | There is no authentication. | Server-side identity with hashed passwords, httpOnly session cookies, lockout and rate limits. | P0 |
| S2 | Roles are checked only in the UI (`S.can`, `XU.can`). | Authorisation that only exists in the UI can be bypassed. | Policy-based authorisation in the API on every endpoint. Tested. | P0 |
| S3 | Tenant isolation is a `localStorage` key prefix, and the tenant switcher lists every tenant. | There is no isolation at all. | `tenant_id` on every tenant-owned row, EF Core global filters and PostgreSQL row-level security as a second layer. Tested. | P0 |
| S4 | Payments are a simulated "Razorpay test-mode" dialog that marks the order `Paid` on the client. | The client is trusted to report payment success. | A server-created gateway order, signature verification and webhooks as the source of truth. | P0 |
| S5 | HTML is built from strings. Most values are escaped with `esc()`, but `render()` output is raw and there are 47 inline `onclick=` handlers. | XSS risk grows with every new string, and inline handlers block a strict CSP. | React's escaping by default plus a strict Content-Security-Policy. | P1 |
| S6 | CDN scripts load without Subresource Integrity. | This is a supply-chain risk. | Bundle dependencies through npm with a lockfile. | P1 |
| S7 | The logo upload stores a data-URL in `localStorage` without validating type or size. | In production this would allow arbitrary uploads. | Presigned S3 uploads with content-type and size allow-lists, and server-side re-encoding. | P1 |

### Business logic worth keeping (as requirements, not as code)

| Rule (source) | Assessment |
|---|---|
| Prices include GST, and tax is extracted as `price × g/(100+g)`, pro-rated after discount (`S.totals`). | Correct for Indian B2C. It will be ported to the server using `decimal` and line-level rounding. |
| CGST+SGST when the buyer's state equals the seller's, otherwise IGST (`S.gstSplit`). | Correct. It will be ported. Place of supply must use the **shipping** address. |
| Coupon: active, not expired, minimum order, percent with a cap or flat, never more than the subtotal (`S.validateCoupon`). | It will be ported. Per-customer limits, a total usage cap and a concurrency-safe usage counter will be added. |
| COD fee and COD order-value limit; free-shipping threshold per method. | It will be ported as tenant settings. |
| An order snapshots name, SKU, HSN, GST, price and cost per line (`S.placeOrder`). | The correct pattern. It will be kept as `order_lines` snapshots. |
| Status flow pending → shipped → delivered → returned, and a return restocks. | Too simple. It will become an explicit state machine (see `DATABASE_DESIGN.md`) with separate payment, fulfilment and return records. |
| Stock is per product per warehouse. | The mock admits it doesn't track per variant. **Stock must be tracked per variant (SKU).** |
| Order numbers are the maximum existing number plus one (`S.placeOrder`). | Races under concurrency. Will use a per-tenant database sequence. |
| Stock is decremented without a reservation and clamped at 0 (`adjustStock`). | Can oversell. Will use a reservation model with conditional updates (see `SYSTEM_ARCHITECTURE.md`). |

### Quality, testing and operations

| # | Current situation | Problem | Proposed solution | Priority |
|---|---|---|---|---|
| Q1 | There are no tests. | Changes can't be verified. | xUnit (API), Vitest (web), Playwright (end-to-end) and dedicated tenant-isolation tests. | P0 |
| Q2 | There is no CI or linting. | Nothing stops a regression. | GitHub Actions: build, lint, type-check and tests on every PR. | P1 |
| Q3 | Charts depend on a CDN. Offline, every dashboard card shows "Charts need an internet connection". | The dashboard is blank in restricted networks; this was confirmed during the audit. | Bundle a charting library. | P2 |
| Q4 | Monetary values are JS `Number` floats. | Rounding drift on tax and totals. | `numeric(14,2)` in PostgreSQL and `decimal` in C#. Integer minor units go to the gateway. | P0 |
| Q5 | There is no observability. | Production issues can't be diagnosed. | Structured JSON logs, correlation IDs, health checks and OpenTelemetry-ready hooks. | P1 |

## 4. What is reusable

- **Requirements and workflows.** All screens, flows and seed scenarios. They define the MVP surface.
- **Business rules** listed above, to be ported to C# with tests.
- **Seed data concepts.** Three realistic Indian tenants make good development fixtures; the API seeder is modelled on them.
- **Information architecture.** Nav groups (Overview, Catalog, Sales, Inventory, Reports, Settings) are sensible. ERP and Accounting are deferred (see `PRODUCT_REQUIREMENTS.md`).

## 5. What will be rebuilt

The UI, rendering, state management, routing, styling, auth, persistence and payments. None of the
JavaScript is carried over. The mock is preserved unchanged in `legacy/mock-ui/` for reference.

## 6. Decisions that need product-owner approval

These are proceeding on the stated assumption unless overridden.

1. **Target market: India first.** INR, GST and Razorpay for both storefront payments and SaaS billing. Stripe is a later adapter behind the same `IPaymentGateway` port.
2. **ERP scope.** Purchase orders, suppliers, expenses and P&L are **deferred to release 2**. GST tax invoices stay in the MVP because they are a legal requirement.
3. **Tenant model.** Shared database, shared schema, `tenant_id` with RLS. A dedicated database per tenant is an Enterprise option later.
4. **Customer accounts are per store.** The same email can register at two stores as two separate accounts, which matches how shoppers think about a brand.
5. **One merchant user can belong to several stores** with different roles (Owner, Manager, Staff, matching the mock).
6. **Hosting.** Containerised and cloud-agnostic. AWS ap-south-1 (Mumbai) is the reference target for data residency and latency (see `DEPLOYMENT_PLAN.md`).
