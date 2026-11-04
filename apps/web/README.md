# ShopMint web

Next.js 16 (App Router, Cache Components, React 19), TypeScript strict, Tailwind CSS v4.

> This Next.js version has breaking changes from older releases (e.g. `middleware.ts` is now `proxy.ts`, and
> Cache Components require runtime data behind `<Suspense>`). The bundled docs in
> `node_modules/next/dist/docs/` are the reference. See `AGENTS.md`.

## Surfaces

| Route | Rendering | Notes |
|---|---|---|
| `/` | Static | Marketing and pricing |
| `/login`, `/signup` | Static shell + client forms | React Hook Form + Zod; server field errors mapped onto inputs |
| `/admin/**` | Static shell + client data (TanStack Query) | Merchant dashboard, products, product editor, categories, settings |
| `/platform` | Static shell + client data | Platform operators only (enforced by the API) |
| any other host → `/store/[host]/**` | Partial prerender + cached server fetches (`"use cache"`) | Public storefront resolved by host in `proxy.ts` |

All browser API calls go to same-origin `/api/*`. `next.config.ts` rewrites these to the API, so the
httpOnly session cookie stays first-party. Every request sends the `X-ShopMint-Csrf` header.

## Structure

```
app/                 routes (see table above)
components/ui/       design system primitives: Button, Field/Input/Select/Textarea, Card, Badge, Alert,
                     EmptyState, Skeleton, Stat, PageHeader, Table, Pagination, Dialog, Toast
components/admin/    admin shell, product form
components/store/    storefront components
lib/api.ts           fetch client + ApiError (RFC 9457 problems → form errors)
lib/storefront.ts    server-only cached storefront data access
lib/schemas.ts       Zod schemas (UX validation; the API is authoritative)
app/globals.css      design tokens (colour, radius, type, elevation)
e2e/                 browser walkthroughs per phase + axe accessibility scan (needs a running stack and Playwright; CI runs them)
```

## Scripts

```bash
npm run dev          # http://localhost:3000 (API expected at API_URL, default http://localhost:5080)
npm run lint && npm run typecheck && npm test && npm run build
node e2e/walkthrough.cjs   # requires Playwright + Chromium, API seeded, web running
node e2e/a11y.cjs
node e2e/phase5.cjs        # signup → confirm email → launch, invite → accept → role change, password reset.
                           # Reads email from Mailpit (http://localhost:8025) or MAIL_DIR=<dir of .eml files>
node e2e/phase6.cjs        # images (real presigned uploads), storefront gallery, inventory, locations, transfers.
                           # Needs media storage configured (MinIO in docker-compose)
node e2e/phase7.cjs        # guest cart → sign up (merge) → addresses → second device → instant refresh, SEO, 404s,
                           # shopper password reset. Needs REVALIDATE_SECRET shared with the API
node e2e/phase8.cjs        # delivery/COD settings, coupon, checkout (COD and test-mode online), invoice, idempotency,
                           # cancel, pack/ship/deliver/refund, dashboard sales. Needs the API's Payments__AllowTestMode=true
node e2e/phase10.cjs       # orders in two states and GST rates → reports and CSV add up to them; GST summary,
                           # date ranges, email preferences, abandoned-cart switch, unsubscribe page
node e2e/phase9.cjs        # trial, plan limits, test-mode subscription, signed billing webhooks (charge, failed, halted),
                           # 503 storefront while closed, cancel, platform plans/assignment/suspension. API in Development
node e2e/phase11.cjs       # two-step verification (enable, code and recovery-code sign-in, disable), platform console
                           # behind MFA, security headers and CSP on live pages
node e2e/totp.cjs          # prints the dev platform admin's current two-step code (local development only)
```

Environment variables: see `.env.example`.

## Design system rules

- Colours, radii and shadows come only from tokens in `globals.css`. Text tokens meet WCAG AA on every surface.
- Every data view handles loading (skeleton), empty (explanation + primary action), error (message + retry) and success.
- No placeholder metrics or decorative charts. A section whose data doesn't exist yet shows an explicit empty state.
- Navigation lists only screens that exist.
- Forms use `<Field>`, which wires label, hint, error, `aria-invalid` and `aria-describedby`. Its child must be the control itself.
