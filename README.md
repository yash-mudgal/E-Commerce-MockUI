# ShopMint: SaaS e-commerce, ERP and admin mock UI

ShopMint is a clickable, static mock of a multi-tenant Indian e-commerce SaaS. It has a storefront, an admin panel and a built-in ERP. There is no build step and no npm install: it is plain HTML, CSS and vanilla JS.

## How to open

- **Simplest:** double-click `index.html`. It works over `file://`.
- **Optional:** serve the folder, for example with `npx serve .` or `python -m http.server`, then open `http://localhost:8000`.
- **Internet:** Chart.js and jsPDF load from cdnjs. Without internet the app still works, but charts show a placeholder and PDF export falls back to the browser's print dialog.
- **Saved data:** all data is saved in `localStorage`, separately for each store. To restore the seed data, go to **Admin → Store Settings → Reset demo data**. You can also clear site data in the browser.
- **Website colour:** use the 🎨 button in the top bar (storefront or admin), or **Admin → Store Settings → Branding**. There are 10 presets plus a custom colour picker. The colour re-themes buttons, navigation, the hero and focus rings, and each store keeps its own.

## Switching views

- **Storefront or Admin:** use the toggle in the dark platform bar (storefront) or in the admin top bar.
- **Store (tenant):** use the store dropdown. There are three stores, each with its own catalog, orders and settings:
  - Desi Threads (`desithreads.shopmint.in`)
  - Masala Box (`masalabox.shopmint.in`)
  - Kaarigar Home (`kaarigar.shopmint.in`)
- **Admin user and role:** use the user dropdown in the admin top bar (Owner, Manager or Staff). The sidebar hides the pages that role can't access. If you open a restricted URL directly, you see a "Restricted" screen.

## Feature map

| Area | Route | What's there |
|---|---|---|
| Storefront home | `#/` | Hero, categories, bestsellers, top deals |
| Listing and search | `#/shop`, `#/shop?q=tea`, `#/category/:id` | Category, price-band, min/max, in-stock and sort filters, all kept in the URL |
| Product | `#/product/:id` | Size and colour picker, stock status (in, low or out), quantity, add to cart / buy now, pincode delivery check, related products |
| Cart | `#/cart` | Quantity limited by stock, coupon apply (with one-tap coupon chips), MRP savings |
| Checkout | `#/checkout` | Contact, address (Indian states), shipping options from settings, UPI/Card/COD (from settings, COD hidden above the COD limit), coupon, live totals with GST shown. Paying by UPI or card opens a simulated Razorpay test-mode dialog |
| Order confirmation | `#/order/:id` | Status timeline and payment summary. Includes a link to the same order in Admin |
| Customer auth | `#/login`, `#/account` | Mock login and signup (demo email shown on the page). My Orders shows statuses and timelines |
| Admin: Overview | `#/admin` | KPIs (revenue, orders, profit, AOV, low stock), sales trend, top products, category split and order status charts; 7/30/90-day filter |
| Admin: Catalog | `#/admin/products`, `#/admin/categories` | Product create/edit/delete (price, MRP, SKU, HSN, GST, stock, variants, colour) and category create/edit/delete |
| Admin: Sales | `#/admin/orders[/:id]`, `#/admin/customers[/:id]`, `#/admin/coupons` | Order status flow pending → shipped → delivered → returned (a return restocks the items), customer detail, coupon create/edit/delete |
| ERP | `#/admin/inventory`, `#/admin/purchases`, `#/admin/suppliers`, `#/admin/invoices` | Stock by warehouse (Bhiwandi, Gurugram, Bengaluru), low-stock alerts, stock adjustments, purchase orders with "Receive stock", and GST invoices: CGST+SGST for same-state orders, IGST for other states. Invoices are printable |
| Accounting | `#/admin/accounting` | Expenses, an income vs expense chart and a simple P&L |
| Reports | `#/admin/reports` | Sales, Inventory, Purchases, P&L and Customer reports, each with a date range and CSV/PDF export |
| SaaS | `#/admin/staff`, `#/admin/stores`, `#/admin/billing`, `#/admin/settings` | Staff and roles, the tenant list, plans (Basic ₹999, Pro ₹2,499, Enterprise ₹7,999) with a feature comparison, and store settings (logo, subdomain, GSTIN, payments, shipping, reset) |

Placing an order on the storefront creates a real order in state. It also reduces warehouse stock, counts the coupon use and adds (or logs in) the customer. The order appears immediately in the admin Orders, Dashboard, Inventory and Invoices pages.

## Files

```
index.html          shell + script order (CDN libs → data → core → modules → boot)
css/app.css         design tokens + all shared components, layouts and storefront styles
js/data.js          seed generator for all tenants (products, orders, customers, POs, expenses, …)
js/core.js          App.fmt / App.store (state, pricing, stock, orders) / App.ui / App.router + layouts
js/storefront.js    customer-facing screens
js/admin.js         dashboard, products, categories, orders, customers, coupons
js/erp.js           inventory, purchases, suppliers, invoicing, accounting, staff (+ shared XU helpers)
js/reports.js       reports with CSV/PDF export
js/saas.js          stores, plans & billing, store settings
js/boot.js          Chart.js defaults, router start
```

## Seed data

The seed data is generated deterministically. Dates are relative to today, so the last 90 days always have data.

| | Desi Threads | Masala Box | Kaarigar Home |
|---|---|---|---|
| Categories | 8 | 5 | 4 |
| Products | 40 | 18 | 15 |
| Orders | 60 | 48 | 42 |

Each store also has:

- 25 customers
- 3 warehouses
- 6 suppliers
- 10 purchase orders
- about 28 expenses
- 6 coupons
- 6 staff users

Prices include GST (5/12/18%) and are formatted en-IN (for example ₹1,24,999).

## Simplifications

- Stock is tracked per product per warehouse, not per variant.
- Payments, login and passwords are simulated. No data leaves the browser.
- PDF exports write "Rs." instead of "₹" because the jsPDF core fonts lack the glyph.
