using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Tests.Infrastructure;

/// <summary>
/// Boots the real API against a throwaway PostgreSQL database (created and dropped per test run). RLS,
/// constraints and roles are therefore exercised for real. The admin connection comes from SHOPMINT_TEST_DB,
/// which defaults to a local superuser.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string StoreDomain = "test.local";
    public const string Password = "Correct-Horse-9";

    private readonly string _adminCs = Environment.GetEnvironmentVariable("SHOPMINT_TEST_DB") ?? "Host=localhost;Username=postgres";
    private readonly string _db = "shopmint_test_" + Guid.NewGuid().ToString("N")[..12];
    // Role passwords are cluster-wide; defaults match local development so running tests doesn't break a dev API.
    private static readonly DatabaseBootstrapper.Passwords Pw = new(
        Environment.GetEnvironmentVariable("SHOPMINT_TEST_OWNER_PW") ?? "dev_owner_pw",
        Environment.GetEnvironmentVariable("SHOPMINT_TEST_APP_PW") ?? "dev_app_pw",
        Environment.GetEnvironmentVariable("SHOPMINT_TEST_PLATFORM_PW") ?? "dev_platform_pw");

    public string ConnectionString(string role, string password) =>
        new NpgsqlConnectionStringBuilder(_adminCs) { Database = _db, Username = role, Password = password }.ConnectionString;
    public string AppCs => ConnectionString(Roles.App, Pw.App);
    public string PlatformCs => ConnectionString(Roles.Platform, Pw.Platform);
    public string OwnerCs => ConnectionString(Roles.Owner, Pw.Owner);

    public async ValueTask InitializeAsync()
    {
        await DatabaseBootstrapper.EnsureAsync(_adminCs, _db, Pw);
        await Migrator.MigrateAsync(OwnerCs);
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await DatabaseBootstrapper.DropAsync(_adminCs, _db);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:App", AppCs);
        builder.UseSetting("ConnectionStrings:Platform", PlatformCs);
        builder.UseSetting("ConnectionStrings:Migrations", OwnerCs);
        builder.UseSetting("Platform:StorefrontDomain", StoreDomain);
        builder.UseSetting("Auth:SessionCacheSeconds", "0");
        builder.UseSetting("RateLimiting:AuthPerMinute", "10000");
        builder.UseSetting("Logging:LogLevel:Default", "Warning");
    }

    /// <summary>An HTTPS client with a cookie jar and the CSRF header (production cookie settings require HTTPS).</summary>
    public HttpClient Client(bool csrf = true)
    {
        var c = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = true, AllowAutoRedirect = false });
        if (csrf) c.DefaultRequestHeaders.Add("X-ShopMint-Csrf", "1");
        return c;
    }

    /// <summary>Signs up a new merchant with a unique store and returns the authenticated client plus the /me payload.</summary>
    public async Task<(HttpClient Client, JsonNode Me)> NewMerchantAsync(string? subdomain = null)
    {
        subdomain ??= "s" + Guid.NewGuid().ToString("N")[..10];
        var c = Client();
        var res = await c.PostAsJsonAsync("/api/auth/signup", new
        {
            name = "Test Owner", email = $"{subdomain}@example.com", password = Password, storeName = $"Store {subdomain}", subdomain,
        });
        res.EnsureSuccessStatusCode();
        return (c, (await res.Content.ReadFromJsonAsync<JsonNode>())!);
    }

    /// <summary>Adds a user with the given role to a tenant directly in the database (invitations ship in Phase 5).</summary>
    public async Task<HttpClient> AddMemberAsync(Guid tenantId, MemberRole role, bool platformAdmin = false)
    {
        var email = $"m{Guid.NewGuid():N}@example.com";
        await using (var scope = Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
            var user = new User { Id = Guid.CreateVersion7(), Email = email, NormalizedEmail = AuthEndpoints.Normalize(email), Name = role.ToString(),
                IsPlatformAdmin = platformAdmin, CreatedAt = DateTimeOffset.UtcNow };
            user.PasswordHash = new PasswordHasher<User>().HashPassword(user, Password);
            db.Users.Add(user);
            if (tenantId != Guid.Empty)
                db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), TenantId = tenantId, UserId = user.Id, Role = role, CreatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }
        var c = Client();
        (await c.PostAsJsonAsync("/api/auth/login", new { email, password = Password })).EnsureSuccessStatusCode();
        return c;
    }

    public static Guid TenantId(JsonNode me) => Guid.Parse(me["tenant"]!["id"]!.GetValue<string>());
    public static string Host(JsonNode me) => me["tenant"]!["host"]!.GetValue<string>();
}

[CollectionDefinition("api")]
public sealed class ApiCollection : ICollectionFixture<ApiFactory>;

public static class Http
{
    public static async Task<JsonNode> Json(this HttpResponseMessage res) =>
        JsonNode.Parse(await res.Content.ReadAsStringAsync()) ?? throw new JsonException("Empty body");

    public static object Product(string title, string sku, decimal price = 499, decimal mrp = 699, int stock = 10,
        string status = "active", Guid? categoryId = null) => new
    {
        title, status, gstRate = 12, hsnCode = "6204", categoryId, optionNames = Array.Empty<string>(),
        variants = new[] { new { sku, optionValues = Array.Empty<string>(), price, mrp, stockOnHand = stock } },
    };

    public static async Task<JsonNode> CreateProductAsync(this HttpClient c, object body)
    {
        var res = await c.PostAsJsonAsync("/api/admin/products", body);
        Assert.Equal(System.Net.HttpStatusCode.Created, res.StatusCode);
        return await res.Json();
    }
}
