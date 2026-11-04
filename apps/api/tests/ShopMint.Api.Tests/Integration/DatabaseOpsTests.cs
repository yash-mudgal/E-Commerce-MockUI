using Npgsql;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class DatabaseOpsTests(ApiFactory f)
{
    [Fact]
    public async Task Verify_db_passes_on_a_healthy_database_and_reports_counts()
    {
        await f.NewMerchantAsync(); // at least one store, user and session key
        var checks = await DbVerifier.RunAsync(f.OwnerCs, f.AppCs, f.PlatformCs, TestContext.Current.CancellationToken);

        Assert.All(checks, c => Assert.True(c.Ok, $"{c.Name}: {c.Detail}"));
        Assert.Contains(checks, c => c.Name == "migrations" && c.Detail.EndsWith("none pending"));
        Assert.Contains(checks, c => c.Name == "app role sees no rows without a tenant");
        Assert.Matches(@"tenants=[1-9]\d* .*data_protection_keys=[1-9]", checks.Single(c => c.Name == "row counts").Detail);
    }

    [Fact]
    public async Task Verify_db_fails_when_a_tenant_table_loses_forced_row_level_security()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var owner = new NpgsqlConnection(f.OwnerCs);
        await owner.OpenAsync(ct);
        // A scratch tenant table without forced RLS, as a careless restore or manual change could leave behind.
        await using (var create = new NpgsqlCommand("CREATE TABLE verify_scratch (id int, tenant_id uuid)", owner))
            await create.ExecuteNonQueryAsync(ct);
        try
        {
            var checks = await DbVerifier.RunAsync(f.OwnerCs, f.AppCs, f.PlatformCs, ct);
            var rls = checks.Single(c => c.Name.StartsWith("row-level security", StringComparison.Ordinal));
            Assert.False(rls.Ok);
            Assert.Contains("verify_scratch", rls.Detail);
        }
        finally
        {
            await using var drop = new NpgsqlCommand("DROP TABLE verify_scratch", owner);
            await drop.ExecuteNonQueryAsync(ct);
        }
    }

    [Fact]
    public async Task Verify_db_reports_a_role_that_cannot_connect()
    {
        var wrong = new NpgsqlConnectionStringBuilder(f.AppCs) { Password = "not-the-password" }.ConnectionString;
        var checks = await DbVerifier.RunAsync(f.OwnerCs, wrong, f.PlatformCs, TestContext.Current.CancellationToken);
        Assert.False(checks.Single(c => c.Name == $"connect as {Roles.App}").Ok);
        Assert.DoesNotContain(checks, c => c.Name == "app role sees no rows without a tenant");
    }
}
