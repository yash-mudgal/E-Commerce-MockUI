using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ShopMint.Api.Infrastructure.Persistence;

/// <summary>
/// <c>dotnet ShopMint.Api.dll verify-db</c>: checks that a database (typically one just restored from a backup) is
/// usable and still safe before traffic is pointed at it. Used by the restore drill (docs/runbooks/restore.md) and
/// after every restore. Prints a report; exit code 0 only if every check passes. Reads only.
/// </summary>
public static class DbVerifier
{
    public sealed record Check(string Name, bool Ok, string Detail);

    private static readonly string[] CountedTables =
        ["tenants", "users", "memberships", "products", "product_variants", "customers", "orders", "order_lines", "refunds",
         "subscriptions", "audit_log", "data_protection_keys"];

    public static async Task<IReadOnlyList<Check>> RunAsync(string ownerCs, string appCs, string platformCs, CancellationToken ct = default)
    {
        var checks = new List<Check>();

        async Task<bool> Connects(string role, string cs)
        {
            try
            {
                await using var c = new NpgsqlConnection(cs);
                await c.OpenAsync(ct);
                checks.Add(new($"connect as {role}", true, "ok"));
                return true;
            }
            catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException)
            {
                checks.Add(new($"connect as {role}", false, ex.Message));
                return false;
            }
        }
        var ownerOk = await Connects(Roles.Owner, ownerCs);
        var appOk = await Connects(Roles.App, appCs);
        var platformOk = await Connects(Roles.Platform, platformCs);

        if (ownerOk)
        {
            var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(ownerCs).UseSnakeCaseNamingConvention().Options;
            await using var db = new AppDbContext(options, new Tenancy.TenantContext());
            var applied = (await db.Database.GetAppliedMigrationsAsync(ct)).Count();
            var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
            checks.Add(new("migrations", pending.Count == 0,
                pending.Count == 0 ? $"{applied} applied, none pending" : $"{pending.Count} pending: {string.Join(", ", pending)}"));

            await using var c = new NpgsqlConnection(ownerCs);
            await c.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand("""
                SELECT c.relname FROM pg_class c
                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
                JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
                WHERE c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
                ORDER BY 1
                """, c);
            var unprotected = new List<string>();
            await using (var r = await cmd.ExecuteReaderAsync(ct))
                while (await r.ReadAsync(ct)) unprotected.Add(r.GetString(0));
            checks.Add(new("row-level security forced on every tenant table", unprotected.Count == 0,
                unprotected.Count == 0 ? "ok" : $"not forced: {string.Join(", ", unprotected)}"));
        }

        if (appOk)
        {
            // Without a tenant set, the request-path role must see nothing, and must not see the session keys at all.
            await using var c = new NpgsqlConnection(appCs);
            await c.OpenAsync(ct);
            await using var products = new NpgsqlCommand("SELECT count(*) FROM products", c);
            var visible = (long)(await products.ExecuteScalarAsync(ct))!;
            checks.Add(new("app role sees no rows without a tenant", visible == 0, $"{visible} product rows visible"));
            await using var keys = new NpgsqlCommand("SELECT count(*) FROM data_protection_keys", c);
            try
            {
                await keys.ExecuteScalarAsync(ct);
                checks.Add(new("app role can't read session keys", false, "SELECT on data_protection_keys succeeded"));
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.InsufficientPrivilege)
            {
                checks.Add(new("app role can't read session keys", true, "permission denied, as intended"));
            }
        }

        if (platformOk)
        {
            await using var c = new NpgsqlConnection(platformCs);
            await c.OpenAsync(ct);
            var counts = new List<string>();
            foreach (var table in CountedTables)
            {
                await using var cmd = new NpgsqlCommand($"SELECT count(*) FROM {table}", c);
                counts.Add($"{table}={(long)(await cmd.ExecuteScalarAsync(ct))!}");
            }
            // Informational: compare with the counts recorded before the backup.
            checks.Add(new("row counts", true, string.Join(" ", counts)));
        }
        return checks;
    }

    public static void Print(IReadOnlyList<Check> checks, TextWriter output)
    {
        foreach (var c in checks) output.WriteLine($"{(c.Ok ? "PASS" : "FAIL")}  {c.Name}: {c.Detail}");
        output.WriteLine(checks.All(c => c.Ok) ? "Database verified." : "Database verification FAILED.");
    }
}
