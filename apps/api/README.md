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

## Adding a tenant-owned table

1. Implement `ITenantOwned` on the entity (EF filter and write guard apply automatically).
2. Add a migration and, in it, enable and force RLS with a `tenant_isolation` policy (see `RlsSql`).
3. `RowLevelSecurityTests.Every_table_with_tenant_id_has_forced_rls` fails until step 2 is done.
