using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class SecurityTests(ApiFactory f)
{
    [Theory]
    [InlineData("/api/auth/me")]
    [InlineData("/health/live")]
    [InlineData("/api/does-not-exist")]
    public async Task Every_response_carries_the_security_headers(string path)
    {
        var res = await f.Client().GetAsync(path);
        string Header(string name) => string.Join(",", res.Headers.TryGetValues(name, out var v) ? v : []);

        Assert.Equal("nosniff", Header("X-Content-Type-Options"));
        Assert.Equal("DENY", Header("X-Frame-Options"));
        Assert.Equal("default-src 'none'; frame-ancestors 'none'", Header("Content-Security-Policy"));
        Assert.Equal("same-origin", Header("Cross-Origin-Resource-Policy"));
        Assert.Equal("strict-origin-when-cross-origin", Header("Referrer-Policy"));
        // Outside Development (tests run as "Testing").
        Assert.StartsWith("max-age=63072000", Header("Strict-Transport-Security"));
        Assert.Contains("no-store", res.Headers.CacheControl?.ToString() ?? "");
    }

    [Fact]
    public async Task Session_keys_live_in_the_database_and_a_second_api_instance_accepts_the_session()
    {
        // Sign up without a cookie jar so the session cookie can be replayed against another instance.
        var first = f.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
        first.DefaultRequestHeaders.Add("X-ShopMint-Csrf", "1");
        var sub = "dp" + Guid.NewGuid().ToString("N")[..10];
        var signup = await first.PostAsJsonAsync("/api/auth/signup", new
        {
            name = "Keys Owner", email = $"{sub}@example.com", password = ApiFactory.Password, storeName = $"Store {sub}", subdomain = sub,
        });
        signup.EnsureSuccessStatusCode();
        var cookie = string.Join("; ", signup.Headers.GetValues("Set-Cookie").Select(c => c.Split(';')[0]));

        await using (var platform = new NpgsqlConnection(f.PlatformCs))
        {
            await platform.OpenAsync(TestContext.Current.CancellationToken);
            await using var count = new NpgsqlCommand("select count(*) from data_protection_keys", platform);
            Assert.True((long)(await count.ExecuteScalarAsync(TestContext.Current.CancellationToken))! >= 1);
        }

        // A separate host (new DI container, new key ring loaded from the database), as after a redeploy or on another task.
        await using var second = f.WithWebHostBuilder(_ => { });
        var other = second.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
        using var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        req.Headers.Add("Cookie", cookie);
        var me = await other.SendAsync(req, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Equal($"{sub}@example.com", (await me.Json())["user"]!["email"]!.ToString());
    }

    [Fact]
    public async Task The_app_role_cannot_read_the_session_keys()
    {
        await using var app = new NpgsqlConnection(f.AppCs);
        await app.OpenAsync(TestContext.Current.CancellationToken);
        await using var cmd = new NpgsqlCommand("select count(*) from data_protection_keys", app);
        var ex = await Assert.ThrowsAsync<PostgresException>(() => cmd.ExecuteScalarAsync(TestContext.Current.CancellationToken));
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
    }
}
