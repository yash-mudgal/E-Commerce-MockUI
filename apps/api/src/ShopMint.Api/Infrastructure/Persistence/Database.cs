using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;
using ShopMint.Api.Infrastructure.Tenancy;

namespace ShopMint.Api.Infrastructure.Persistence;

public static class Roles
{
    public const string Owner = "shopmint_owner";       // owns schema, runs migrations
    public const string App = "shopmint_app";           // request traffic; RLS enforced
    public const string Platform = "shopmint_platform"; // platform console and system jobs; BYPASSRLS
}

/// <summary>
/// SQL applied by migrations: helper functions and RLS policies. Every table with a tenant_id column must
/// appear here; <c>RowLevelSecurityTests</c> fails if one is missing.
/// </summary>
public static class RlsSql
{
    private static readonly string[] InitialTenantTables =
        ["categories", "products", "product_variants", "locations", "stock_levels", "stock_movements", "audit_log"];

    /// <summary>Every tenant-owned table with the standard isolation policy. Add new tables here and in a new method.</summary>
    // Declared before TenantTables: static fields initialise in textual order.
    private static readonly string[] Phase7TenantTables = ["customers", "customer_tokens", "customer_addresses", "carts", "cart_lines"];
    private static readonly string[] Phase8TenantTables =
        ["orders", "order_lines", "payment_attempts", "refunds", "shipments", "coupons", "tenant_counters", "webhook_events", "tenant_payment_settings"];

    private static readonly string[] Phase9TenantTables = ["subscriptions", "billing_invoices"];

    public static readonly string[] TenantTables = [.. InitialTenantTables, "invitations", "email_outbox", "product_media",
        .. Phase7TenantTables, .. Phase8TenantTables, .. Phase9TenantTables, "feedback"];

    /// <summary>
    /// Applied by the Phase13Feedback migration. Frozen: never edit. Merchants' feedback: the app role may only insert
    /// rows for its own store (it can't read any back); the platform role triages them.
    /// </summary>
    public static string Phase13Feedback() => $"""
        ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
        ALTER TABLE feedback FORCE ROW LEVEL SECURITY;
        CREATE POLICY feedback_send ON feedback FOR INSERT WITH CHECK (tenant_id = app_current_tenant());
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.App}') THEN
            GRANT INSERT ON feedback TO {Roles.App};
            REVOKE SELECT, UPDATE, DELETE ON feedback FROM {Roles.App};
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Platform}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON feedback TO {Roles.Platform};
          END IF;
        END $$;
        """;

    /// <summary>
    /// Applied by the Phase11Security migration. Frozen: never edit. The data-protection key ring is readable only by
    /// the platform role (which the key-ring service uses); request traffic under the app role can't read the keys.
    /// </summary>
    public static string Phase11Security() => $"""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.App}') THEN
            REVOKE ALL ON data_protection_keys FROM {Roles.App};
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Platform}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON data_protection_keys TO {Roles.Platform};
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {Roles.Platform};
          END IF;
        END $$;
        """;

    /// <summary>
    /// Applied by the Phase9Billing migration. Frozen: never edit. Subscriptions and billing invoices get the standard
    /// policy. <c>plans</c> is platform data: the app role may only read it; the platform role edits it.
    /// </summary>
    public static string Phase9Billing() => StandardPolicies(Phase9TenantTables) + $"""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.App}') THEN
            REVOKE INSERT, UPDATE, DELETE ON plans FROM {Roles.App};
            GRANT SELECT ON plans TO {Roles.App};
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Platform}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON plans TO {Roles.Platform};
          END IF;
        END $$;
        """;

    /// <summary>Applied by the Phase8Orders migration. Frozen: never edit.</summary>
    public static string Phase8Orders() => StandardPolicies(Phase8TenantTables);

    /// <summary>Applied by the Phase7Customers migration. Frozen: never edit.</summary>
    public static string Phase7Customers() => StandardPolicies(Phase7TenantTables);

    /// <summary>Standard tenant isolation policy and grants for a set of new tables.</summary>
    private static string StandardPolicies(string[] tables)
    {
        var sql = new System.Text.StringBuilder();
        foreach (var t in tables)
            sql.AppendLine($"""
                ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
                ALTER TABLE {t} FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON {t}
                  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
                """);
        var list = string.Join(", ", tables);
        sql.AppendLine($"""
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.App}') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON {list} TO {Roles.App};
              END IF;
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Platform}') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON {list} TO {Roles.Platform};
              END IF;
            END $$;
            """);
        return sql.ToString();
    }

    /// <summary>Applied by the Initial migration. Frozen: never edit; add a new method for later migrations.</summary>
    public static string Initial()
    {
        var sql = new System.Text.StringBuilder("""
            CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
              $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
            CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid LANGUAGE sql STABLE AS
              $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

            -- tenants: the current tenant, plus tenants the current user belongs to (for the store switcher).
            ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
            ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
            CREATE POLICY tenant_access ON tenants
              USING (id = app_current_tenant() OR id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = app_current_user()))
              WITH CHECK (id = app_current_tenant());

            -- memberships: rows of the current tenant, or the current user's own rows across tenants.
            ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
            ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
            CREATE POLICY membership_access ON memberships
              USING (tenant_id = app_current_tenant() OR user_id = app_current_user())
              WITH CHECK (tenant_id = app_current_tenant());

            -- tenant_domains: readable by host for storefront resolution; writable only for the current tenant.
            ALTER TABLE tenant_domains ENABLE ROW LEVEL SECURITY;
            ALTER TABLE tenant_domains FORCE ROW LEVEL SECURITY;
            CREATE POLICY domain_read ON tenant_domains FOR SELECT USING (true);
            CREATE POLICY domain_write ON tenant_domains FOR ALL
              USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

            """);
        foreach (var t in InitialTenantTables)
            sql.AppendLine($"""
                ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
                ALTER TABLE {t} FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON {t}
                  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
                """);
        sql.AppendLine($"""
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.App}') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {Roles.App};
                REVOKE UPDATE, DELETE ON audit_log FROM {Roles.App};
                REVOKE ALL ON "__EFMigrationsHistory" FROM {Roles.App};
              END IF;
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Platform}') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {Roles.Platform};
                REVOKE UPDATE, DELETE ON audit_log FROM {Roles.Platform};
              END IF;
            END $$;
            """);
        return sql.ToString();
    }

    /// <summary>Applied by the Phase5Identity migration. Frozen: never edit.</summary>
    public static string Phase5Identity() => $"""
        ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON invitations
          USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

        -- email_outbox: the app role may only enqueue mail, for its own tenant or with no tenant (account mail).
        -- It cannot read the outbox, which holds live links until delivery. The dispatcher uses the platform role.
        ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
        ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
        CREATE POLICY outbox_enqueue ON email_outbox FOR INSERT
          WITH CHECK (tenant_id IS NULL OR tenant_id = app_current_tenant());

        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.App}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON user_tokens, invitations TO {Roles.App};
            GRANT INSERT ON email_outbox TO {Roles.App};
            REVOKE SELECT, UPDATE, DELETE ON email_outbox FROM {Roles.App};
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Platform}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON user_tokens, invitations, email_outbox TO {Roles.Platform};
          END IF;
        END $$;
        """;
    /// <summary>Applied by the Phase6StorageDeletions migration. Frozen: never edit.</summary>
    public static string Phase6StorageDeletions() => $"""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.App}') THEN
            GRANT INSERT ON storage_deletions TO {Roles.App};
            REVOKE SELECT, UPDATE, DELETE ON storage_deletions FROM {Roles.App};
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Platform}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON storage_deletions TO {Roles.Platform};
          END IF;
        END $$;
        """;

    /// <summary>Applied by the Phase6Catalog migration. Frozen: never edit.</summary>
    public static string Phase6Catalog() => $"""
        ALTER TABLE product_media ENABLE ROW LEVEL SECURITY;
        ALTER TABLE product_media FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON product_media
          USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.App}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON product_media TO {Roles.App};
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Platform}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON product_media TO {Roles.Platform};
          END IF;
        END $$;
        """;
}

/// <summary>
/// Creates the three database roles and a database owned by <c>shopmint_owner</c>. It runs with a superuser
/// connection and is used by tests and the local <c>setup-db</c> command. In docker-compose,
/// <c>apps/api/db/init/01-init.sh</c> does the same. In production the roles are provisioned by
/// infrastructure-as-code.
/// </summary>
public static class DatabaseBootstrapper
{
    public sealed record Passwords(string Owner, string App, string Platform);

    public static async Task EnsureAsync(string adminConnectionString, string database, Passwords pw, CancellationToken ct = default)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(database, "^[a-z0-9_]+$"))
            throw new ArgumentException("Database name must be lowercase alphanumeric/underscore.", nameof(database));

        await using (var admin = new NpgsqlConnection(adminConnectionString))
        {
            await admin.OpenAsync(ct);
            try
            {
                await Exec(admin, $"""
                    DO $$ BEGIN
                      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Owner}') THEN CREATE ROLE {Roles.Owner} LOGIN; END IF;
                      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.App}') THEN CREATE ROLE {Roles.App} LOGIN NOBYPASSRLS; END IF;
                      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{Roles.Platform}') THEN CREATE ROLE {Roles.Platform} LOGIN BYPASSRLS; END IF;
                    END $$;
                    """, ct);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.InsufficientPrivilege)
            {
                throw new InvalidOperationException(
                    $"The administrative user can't create ShopMint's roles ({ex.MessageText}). On a managed database, check that the master " +
                    $"user may create roles with BYPASSRLS, or create {Roles.Platform} once by hand (see docs/runbooks/first-deploy.md).", ex);
            }
            await Exec(admin, $"""
                -- Managed databases don't make the master user a superuser. To create a database owned by the owner role
                -- and set default privileges for it, the master user must be able to SET ROLE to it. On PostgreSQL 16 the
                -- creator of a role only gets ADMIN on it (no SET), so grant SET explicitly.
                DO $$ BEGIN
                  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
                    IF current_setting('server_version_num')::int >= 160000 THEN
                      IF NOT pg_has_role(current_user, '{Roles.Owner}', 'SET') THEN
                        EXECUTE format('GRANT {Roles.Owner} TO %I WITH INHERIT TRUE, SET TRUE', current_user);
                      END IF;
                    ELSIF NOT pg_has_role(current_user, '{Roles.Owner}', 'MEMBER') THEN
                      EXECUTE format('GRANT {Roles.Owner} TO %I', current_user);
                    END IF;
                  END IF;
                END $$;
                ALTER ROLE {Roles.Owner} PASSWORD {Quote(pw.Owner)};
                ALTER ROLE {Roles.App} PASSWORD {Quote(pw.App)};
                ALTER ROLE {Roles.Platform} PASSWORD {Quote(pw.Platform)};
                """, ct);
            var exists = await Scalar(admin, $"SELECT 1 FROM pg_database WHERE datname = '{database}'", ct) is not null;
            if (!exists) await Exec(admin, $"CREATE DATABASE {database} OWNER {Roles.Owner}", ct);
        }

        var inDb = new NpgsqlConnectionStringBuilder(adminConnectionString) { Database = database }.ConnectionString;
        await using var conn = new NpgsqlConnection(inDb);
        await conn.OpenAsync(ct);
        await Exec(conn, $"""
            GRANT CONNECT ON DATABASE {database} TO {Roles.App}, {Roles.Platform};
            GRANT USAGE ON SCHEMA public TO {Roles.App}, {Roles.Platform};
            ALTER DEFAULT PRIVILEGES FOR ROLE {Roles.Owner} IN SCHEMA public
              GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {Roles.App}, {Roles.Platform};
            ALTER DEFAULT PRIVILEGES FOR ROLE {Roles.Owner} IN SCHEMA public
              GRANT USAGE, SELECT ON SEQUENCES TO {Roles.App}, {Roles.Platform};
            """, ct);
    }

    public static async Task DropAsync(string adminConnectionString, string database)
    {
        NpgsqlConnection.ClearAllPools();
        await using var admin = new NpgsqlConnection(adminConnectionString);
        await admin.OpenAsync();
        await Exec(admin, $"DROP DATABASE IF EXISTS {database} WITH (FORCE)", default);
    }

    private static string Quote(string s) => "'" + s.Replace("'", "''") + "'";

    private static async Task Exec(NpgsqlConnection c, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, c);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task<object?> Scalar(NpgsqlConnection c, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, c);
        return await cmd.ExecuteScalarAsync(ct);
    }
}

public static class Migrator
{
    public static DbContextOptions<AppDbContext> OwnerOptions(string connectionString) =>
        new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).UseSnakeCaseNamingConvention().Options;

    /// <summary>Applies migrations as the schema owner (never as the app role).</summary>
    public static async Task MigrateAsync(string ownerConnectionString, CancellationToken ct = default)
    {
        await using var db = new AppDbContext(OwnerOptions(ownerConnectionString), new TenantContext());
        await db.Database.MigrateAsync(ct);
    }
}

/// <summary>Used by <c>dotnet ef</c>. It reads SHOPMINT_MIGRATIONS_CS and falls back to a local development database.</summary>
public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args) =>
        new(Migrator.OwnerOptions(Environment.GetEnvironmentVariable("SHOPMINT_MIGRATIONS_CS")
            ?? "Host=localhost;Database=shopmint;Username=shopmint_owner"), new TenantContext());
}

/// <summary>Readiness check: the app role can connect and run a query.</summary>
public sealed class DatabaseHealthCheck(AppDbContext db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        try
        {
            return await db.Database.CanConnectAsync(ct)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("Database unreachable");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("Database unreachable", ex);
        }
    }
}
