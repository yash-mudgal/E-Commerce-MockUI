using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>
/// Data migrations run against stores that already exist (the real upgrade path), not only an empty database.
/// In the "api" collection so its database bootstrap (cluster-wide role grants) never runs alongside the shared one.
/// </summary>
[Collection("api")]
public class MigrationTests
{
    private static readonly DatabaseBootstrapper.Passwords Pw = new(
        Environment.GetEnvironmentVariable("SHOPMINT_TEST_OWNER_PW") ?? "dev_owner_pw",
        Environment.GetEnvironmentVariable("SHOPMINT_TEST_APP_PW") ?? "dev_app_pw",
        Environment.GetEnvironmentVariable("SHOPMINT_TEST_PLATFORM_PW") ?? "dev_platform_pw");

    [Fact]
    public async Task Phase9_keeps_existing_paid_stores_on_their_plan_and_marks_platform_suspensions()
    {
        var admin = Environment.GetEnvironmentVariable("SHOPMINT_TEST_DB") ?? "Host=localhost;Username=postgres";
        var name = "shopmint_mig_" + Guid.NewGuid().ToString("N")[..12];
        string Cs(string role, string pw) => new NpgsqlConnectionStringBuilder(admin) { Database = name, Username = role, Password = pw }.ConnectionString;
        await DatabaseBootstrapper.EnsureAsync(admin, name, Pw);
        try
        {
            await using (var db = new AppDbContext(Migrator.OwnerOptions(Cs(Roles.Owner, Pw.Owner)), new TenantContext()))
                await db.GetService<IMigrator>().MigrateAsync("20261104065812_Phase8Orders");

            var active = Guid.NewGuid();
            var suspended = Guid.NewGuid();
            var trial = Guid.NewGuid();
            await using (var conn = new NpgsqlConnection(Cs(Roles.Platform, Pw.Platform)))
            {
                await conn.OpenAsync();
                foreach (var (id, status, plan) in new[] { (active, "Active", "pro"), (suspended, "Suspended", "basic"), (trial, "Trialing", "trial") })
                {
                    await using var cmd = new NpgsqlCommand("""
                        INSERT INTO tenants (id, slug, name, status, plan_code, brand_color, low_stock_threshold, created_at, updated_at)
                        VALUES (@id, @slug, 'Old store', @status, @plan, '#4f46e5', 10, now(), now())
                        """, conn);
                    cmd.Parameters.AddWithValue("id", id);
                    cmd.Parameters.AddWithValue("slug", "old" + id.ToString("N")[..8]);
                    cmd.Parameters.AddWithValue("status", status);
                    cmd.Parameters.AddWithValue("plan", plan);
                    await cmd.ExecuteNonQueryAsync();
                }
            }

            await Migrator.MigrateAsync(Cs(Roles.Owner, Pw.Owner));

            await using var check = new NpgsqlConnection(Cs(Roles.Platform, Pw.Platform));
            await check.OpenAsync();
            async Task<string?> Scalar(string sql, Guid id)
            {
                await using var cmd = new NpgsqlCommand(sql, check);
                cmd.Parameters.AddWithValue("id", id);
                var r = await cmd.ExecuteScalarAsync();
                return r is null or DBNull ? null : r.ToString();
            }
            Assert.Equal("manual:Active:pro", await Scalar("SELECT gateway || ':' || status || ':' || plan_code FROM subscriptions WHERE tenant_id = @id", active));
            Assert.Equal("manual:Active:basic", await Scalar("SELECT gateway || ':' || status || ':' || plan_code FROM subscriptions WHERE tenant_id = @id", suspended));
            Assert.Null(await Scalar("SELECT id FROM subscriptions WHERE tenant_id = @id", trial));
            Assert.Equal("Platform", await Scalar("SELECT suspension_reason FROM tenants WHERE id = @id", suspended));
            Assert.Null(await Scalar("SELECT suspension_reason FROM tenants WHERE id = @id", active));
            Assert.Equal("4", await Scalar("SELECT count(*) FROM plans WHERE @id IS NOT NULL", active));
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await DatabaseBootstrapper.DropAsync(admin, name);
        }
    }
}
