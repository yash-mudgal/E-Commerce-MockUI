# ShopMint

A multi-tenant e-commerce SaaS for Indian brands: merchants get a branded, GST-ready storefront with
catalogue and inventory management; ShopMint operates the platform.

| | |
|---|---|
| `apps/api` | ASP.NET Core 10 modular monolith, PostgreSQL 16 with row-level security ([README](apps/api/README.md)) |
| `apps/web` | Next.js 16 (App Router, React 19, Tailwind v4): marketing site, merchant admin, platform console and storefronts ([README](apps/web/README.md)) |
| `docs/` | Audit, requirements, architecture, API/DB design, security, testing, deployment, roadmap, decisions, progress |
| `legacy/mock-ui/` | The original static clickable mock, kept unchanged as a reference ([live demo](https://yash-mudgal.github.io/E-Commerce-MockUI/legacy/mock-ui/)) |

**Status:** foundation, multi-tenancy, auth and catalogue are implemented and tested. Checkout, payments
and billing are next. See [`docs/PROJECT_PROGRESS.md`](docs/PROJECT_PROGRESS.md).

## Quick start (local)

Prerequisites: .NET 10 SDK, Node 22, PostgreSQL 16 (or Docker).

```bash
# Database: either docker…
cp .env.example .env && docker compose up -d postgres
# …or an existing local PostgreSQL superuser:
ConnectionStrings__Admin="Host=localhost;Username=postgres" dotnet run --project apps/api/src/ShopMint.Api -- setup-db
```

```bash
# API on :5080: migrate and load three demo stores, then run
cd apps/api && dotnet run --project src/ShopMint.Api -- seed && dotnet run --project src/ShopMint.Api
```

```bash
# Web on :3000 (in another terminal)
cd apps/web && npm install && npm run dev
```

- Merchant admin: http://localhost:3000/login with `owner@desithreads.demo` / `Demo-Passw0rd!` (also `staff@…`, and `masalabox`, `kaarigar` stores)
- Platform console: `admin@shopmint.local` / `Demo-Passw0rd!`, then open http://localhost:3000/platform
- Storefronts: http://desithreads.localhost:3000, http://masalabox.localhost:3000, http://kaarigar.localhost:3000
  (`*.localhost` resolves to your machine in Chrome, Edge and Firefox)

Demo data is clearly labelled "Demo store" and exists only in development.

## Tests

```bash
cd apps/api && dotnet test      # 72 tests: unit + integration on real PostgreSQL, incl. tenant isolation and RLS
cd apps/web && npm test         # 24 unit/component tests
cd apps/web && npm run lint && npm run typecheck && npm run build
```

CI (`.github/workflows/ci.yml`) runs all of the above on every pull request.
