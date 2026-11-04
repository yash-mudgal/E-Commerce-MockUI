# ShopMint API

ASP.NET Core 10 modular monolith. See `/docs/SYSTEM_ARCHITECTURE.md` for the design.

## Layout

```
src/ShopMint.Api/
  Program.cs                      composition root, pipeline, CLI commands (setup-db | migrate | seed)
  Common/                         errors (ProblemDetails), correlation id, CSRF, JSON, paging, validation
  Infrastructure/Persistence/     AppDbContext (tenant-scoped) + PlatformDbContext, migrations, RLS SQL, bootstrap
  Infrastructure/Tenancy/         TenantContext + connection interceptor that sets app.tenant_id for RLS
  Modules/<Module>/               endpoints, contracts, services, domain rules per module
  Seeding/                        local demo data (clearly labelled "Demo store")
tests/ShopMint.Api.Tests/         xUnit v3: unit + integration against real PostgreSQL
```

## Run locally

Prerequisites: .NET 10 SDK and PostgreSQL 16+ (or `docker compose up postgres` from the repo root).

```bash
# 1. Create roles + database (local superuser). Skip if you use docker compose: its init script does this.
ConnectionStrings__Admin="Host=localhost;Username=postgres" dotnet run --project src/ShopMint.Api -- setup-db
# 2. Migrate and load demo data (3 stores from the original mock; password from appsettings.Development.json)
dotnet run --project src/ShopMint.Api -- seed
# 3. Start on http://localhost:5080 (OpenAPI at /openapi/v1.json)
dotnet run --project src/ShopMint.Api
```

## Test

```bash
dotnet test        # needs a PostgreSQL superuser; override with SHOPMINT_TEST_DB="Host=...;Username=...;Password=..."
```

Each run creates a uniquely named database, applies migrations as `shopmint_owner`, runs the tests as
`shopmint_app` (RLS enforced) and drops the database afterwards.

## Configuration

| Key | Purpose |
|---|---|
| `ConnectionStrings__App` | Request traffic, role `shopmint_app` (RLS enforced) |
| `ConnectionStrings__Platform` | Platform console, role `shopmint_platform` (BYPASSRLS) |
| `ConnectionStrings__Migrations` | Schema owner, role `shopmint_owner`, used only for migrations |
| `Platform__StorefrontDomain` | Base domain for store subdomains (`shopmint.in`; `localhost` in development) |
| `Proxy__KnownNetworks__0` | CIDR of the reverse proxy allowed to set `X-Forwarded-*` |
| `Database__MigrateOnStartup` | Development convenience only; production runs `migrate` as a separate job |
| `App__PublicUrl` | Base URL of the web app for links in emails (required in production) |
| `Email__Smtp__Host`, `__Port`, `__Security`, `__Username`, `__Password` | SMTP delivery (Mailpit `localhost:1025`/`None` in development). Empty host = mail stays queued. Credentials only via environment |
| `Email__FromAddress`, `Email__FromName` | Sender |
| `Email__Dispatcher__Enabled`, `__IntervalSeconds` | Background delivery of the email outbox |
| `Media__Bucket`, `__Region`, `__ServiceUrl`, `__ForcePathStyle` | Product image storage (S3 or MinIO). Empty bucket = uploads disabled (503) |
| `Media__PublicServiceUrl` | Host browsers upload to, when it differs from `ServiceUrl` (docker-compose) |
| `Media__PublicBaseUrl` | Public URL that serves objects by key (CDN or bucket URL). Required when a bucket is set |
| `Media__AccessKey`, `Media__SecretKey` | Local MinIO only, via environment. In AWS use the task role |
| `Platform__StorefrontUrlTemplate` | Store links in shopper emails, e.g. `https://{host}` (`http://{host}:3000` in development) |
| `Payments__SecretsKey` | 32 random bytes, base64, from the secrets manager. Encrypts merchants' Razorpay secrets. Empty = connecting Razorpay is refused (503) |
| `Payments__AllowTestMode` | `true` only for local development/demos: simulated payments while a store has no Razorpay keys. The API refuses to start in Production with it on |
| `Payments__Razorpay__BaseUrl` | Override the Razorpay API base URL (tests). Default `https://api.razorpay.com/v1/` |
| `RateLimiting__CheckoutPerMinute` | Order placements per IP per minute (default 20) |
| `Web__RevalidateUrl`, `Web__RevalidateSecret` | Where to tell the web app a store changed, and the shared secret (environment only). Empty = no instant refresh |

## Adding a tenant-owned table

1. Implement `ITenantOwned` on the entity (EF filter and write guard apply automatically).
2. Add a migration and, in it, enable and force RLS with a `tenant_isolation` policy (see `RlsSql`).
3. `RowLevelSecurityTests.Every_table_with_tenant_id_has_forced_rls` fails until step 2 is done.
