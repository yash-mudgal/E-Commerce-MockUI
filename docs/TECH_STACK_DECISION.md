# Technology Stack Decision

The existing repository has **no backend, no build system and no dependencies worth retaining**, so it
puts no constraint on the stack. The decision is therefore driven by product requirements and the
preferred baseline. Each choice is recorded as an ADR in `DECISIONS.md`.

## Final stack

| Layer | Choice | Why | Alternatives considered |
|---|---|---|---|
| Web framework | **Next.js (App Router) + React + TypeScript (strict)** | Server rendering and incremental static regeneration for SEO-critical storefront pages; one framework for storefront, merchant admin and platform console; large hiring pool | Remix (smaller ecosystem); a separate SPA for admin (two toolchains) |
| Styling | **Tailwind CSS v4** with CSS-variable design tokens | Tokens enable per-tenant theming at runtime without rebuilds | CSS Modules (slower to keep consistent) |
| Components | **shadcn/ui pattern**: owned components on Radix primitives | Accessible primitives (focus trap, ARIA) with code we own and can restyle | MUI (heavy, opinionated look) |
| Forms | React Hook Form + Zod | Typed schemas; server errors map onto fields | Formik (less active) |
| Server state | TanStack Query (admin only) | Caching, retries and invalidation for interactive admin screens. The storefront uses React Server Components fetches instead | SWR |
| Icons | lucide-react | Consistent, tree-shakeable | — |
| Charts | Recharts | Bundled (fixes the mock's CDN failure), composable, SSR-safe | Chart.js (imperative) |
| API | **ASP.NET Core 10 (LTS, supported to Nov 2028), C#** | Strong typing, performance, mature auth and data stack, first-class OpenAPI; the baseline preference | Node/NestJS (would mean a single language, but a weaker transactional and ORM story at our consistency needs) |
| API style | REST with minimal APIs grouped per module; RFC 9457 ProblemDetails errors | Clear resource boundaries, small surface | GraphQL (overkill for the MVP; harder per-tenant authorisation) |
| Validation | FluentValidation | Expressive, testable rules | DataAnnotations (too weak for cross-field rules) |
| ORM | EF Core 10 + Npgsql | Migrations, global query filters for tenancy, LINQ | Dapper (kept for hot read paths if measured) |
| Database | **PostgreSQL 16+** | Row-level security, `jsonb`, strong constraints, mature managed offerings | MySQL (no RLS) |
| Background jobs | Hosted service with an outbox table (MVP); Hangfire on PostgreSQL storage when scheduling needs grow | No new infrastructure in the MVP; the transactional outbox guarantees at-least-once delivery | RabbitMQ or SQS (later, when throughput demands it) |
| Cache | **None in the MVP**; Redis is introduced when we need distributed rate limiting across more than one instance, or measured cache wins | Avoids operating infrastructure we don't yet need | — |
| Object storage | S3-compatible (AWS S3 in production, MinIO locally) with presigned uploads | Standard, cheap, CDN-friendly | — |
| Auth | ASP.NET Core Identity primitives (hashing, lockout) + **cookie session**; Next.js proxies `/api` so cookies stay first-party | httpOnly cookies avoid tokens in JavaScript (XSS-resistant); no third-party IdP cost in the MVP | Auth0 or Clerk (cost, data residency); JWT in localStorage (rejected for XSS) |
| Payments | Razorpay (orders, payments, refunds, subscriptions) behind an `IPaymentGateway` port | India-first: UPI, cards, netbanking, subscriptions | Stripe (adapter later) |
| Email | SMTP abstraction (Amazon SES in production, Mailpit locally) | Cheap, swappable | — |
| Logging | Built-in `ILogger` with JSON console output, correlation-ID middleware, OpenTelemetry exporter-ready | No vendor lock-in | Serilog (a dependency to add only if we need its sinks) |
| Tests | xUnit + real PostgreSQL (API); Vitest + Testing Library (web); Playwright (end-to-end) | Isolation tests **must** run against real PostgreSQL to exercise RLS | SQLite in-memory (rejected: no RLS) |
| Containers | Docker and docker-compose (postgres, minio, mailpit, api, web) | Reproducible environments | — |
| CI/CD | GitHub Actions | Repository already lives on GitHub | — |
| Repository layout | Monorepo: `apps/web`, `apps/api`, `docs`, `legacy/mock-ui` | Atomic changes across API and UI; one CI | Polyrepo (coordination overhead) |

## Explicitly rejected for now

- **Microservices.** A modular monolith with enforced module boundaries gives the same separation without distributed-systems cost. Modules communicate in-process through interfaces and domain events, so extraction later is mechanical.
- **Multiple backend languages.** Next.js route handlers are used only as a BFF and proxy, never for business logic.
- **Kubernetes in the MVP.** A managed container service (ECS Fargate) is sufficient (see `DEPLOYMENT_PLAN.md`).
