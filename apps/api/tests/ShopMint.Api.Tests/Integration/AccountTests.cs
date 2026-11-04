using System.Net;
using System.Net.Http.Json;
using Npgsql;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class AccountTests(ApiFactory f)
{
    private static string Email(System.Text.Json.Nodes.JsonNode me) => me["user"]!["email"]!.GetValue<string>();

    [Fact]
    public async Task Signup_queues_a_verification_email_and_the_link_confirms_the_address()
    {
        var (c, me) = await f.NewMerchantAsync();
        Assert.False(me["user"]!["emailVerified"]!.GetValue<bool>());

        var token = await f.TokenFromEmailAsync(Email(me), "verify_email");
        Assert.Equal(HttpStatusCode.NoContent, (await f.Client().PostAsJsonAsync("/api/auth/email/verify", new { token })).StatusCode);
        Assert.True((await (await c.GetAsync("/api/auth/me")).Json())["user"]!["emailVerified"]!.GetValue<bool>());

        var reuse = await f.Client().PostAsJsonAsync("/api/auth/email/verify", new { token });
        Assert.Equal(HttpStatusCode.BadRequest, reuse.StatusCode);
        Assert.EndsWith("/invalid-token", (await reuse.Json())["type"]!.ToString());
        // Already verified: resending is refused.
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsync("/api/auth/email/resend", null)).StatusCode);
    }

    [Fact]
    public async Task Resending_verification_is_throttled()
    {
        var (c, _) = await f.NewMerchantAsync();
        // Signup sent one a moment ago.
        Assert.Equal((HttpStatusCode)429, (await c.PostAsync("/api/auth/email/resend", null)).StatusCode);
    }

    [Fact]
    public async Task Email_links_use_the_configured_public_url_not_the_request_host()
    {
        var sub = "h" + Guid.NewGuid().ToString("N")[..10];
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/signup")
        {
            Content = JsonContent.Create(new { name = "Host Test", email = $"{sub}@example.com", password = ApiFactory.Password, storeName = "Host Test", subdomain = sub }),
        };
        req.Headers.Host = "evil.example";
        req.Headers.Add("X-Forwarded-Host", "evil.example");
        Assert.Equal(HttpStatusCode.Created, (await f.Client().SendAsync(req)).StatusCode);

        var mail = await f.LastEmailAsync($"{sub}@example.com", "verify_email");
        Assert.NotNull(mail);
        Assert.DoesNotContain("evil.example", mail!.TextBody);
        Assert.Contains(ApiFactory.PublicUrl + "/verify-email?token=", mail.TextBody);
    }

    [Fact]
    public async Task Forgot_password_gives_the_same_answer_for_unknown_accounts_and_sends_nothing()
    {
        var (_, me) = await f.NewMerchantAsync();
        var anon = f.Client();
        var known = await anon.PostAsJsonAsync("/api/auth/password/forgot", new { email = Email(me) });
        var unknownAddress = $"nobody-{Guid.NewGuid():N}@example.com";
        var unknown = await anon.PostAsJsonAsync("/api/auth/password/forgot", new { email = unknownAddress });

        Assert.Equal(HttpStatusCode.Accepted, known.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, unknown.StatusCode);
        Assert.Equal(await known.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
        Assert.NotNull(await f.LastEmailAsync(Email(me), "password_reset"));
        Assert.Null(await f.LastEmailAsync(unknownAddress));
    }

    [Fact]
    public async Task Forgot_password_does_not_flood_the_inbox()
    {
        var (_, me) = await f.NewMerchantAsync();
        var anon = f.Client();
        await anon.PostAsJsonAsync("/api/auth/password/forgot", new { email = Email(me) });
        await anon.PostAsJsonAsync("/api/auth/password/forgot", new { email = Email(me) });
        await using var conn = new NpgsqlConnection(f.PlatformCs);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("select count(*) from email_outbox where to_address = @a and template = 'password_reset'", conn);
        cmd.Parameters.AddWithValue("a", Email(me));
        Assert.Equal(1L, (long)(await cmd.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Password_reset_changes_the_password_signs_out_sessions_and_is_single_use()
    {
        var (session, me) = await f.NewMerchantAsync();
        await f.Client().PostAsJsonAsync("/api/auth/password/forgot", new { email = Email(me) });
        var token = await f.TokenFromEmailAsync(Email(me), "password_reset");

        const string newPassword = "Brand-New-Secret-42";
        var reset = await f.Client().PostAsJsonAsync("/api/auth/password/reset", new { token, password = newPassword });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await session.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Client().PostAsJsonAsync("/api/auth/login", new { email = Email(me), password = ApiFactory.Password })).StatusCode);
        var login = await f.Client().PostAsJsonAsync("/api/auth/login", new { email = Email(me), password = newPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        // The link proved the inbox, so the address counts as confirmed.
        Assert.True((await login.Json())["user"]!["emailVerified"]!.GetValue<bool>());

        var again = await f.Client().PostAsJsonAsync("/api/auth/password/reset", new { token, password = "Another-Secret-77" });
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
    }

    [Fact]
    public async Task Password_reset_validates_the_new_password_and_rejects_bad_or_expired_tokens()
    {
        var (_, me) = await f.NewMerchantAsync();
        var anon = f.Client();
        await anon.PostAsJsonAsync("/api/auth/password/forgot", new { email = Email(me) });
        var token = await f.TokenFromEmailAsync(Email(me), "password_reset");

        var weak = await anon.PostAsJsonAsync("/api/auth/password/reset", new { token, password = "short" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.NotNull((await weak.Json())["errors"]!["password"]);

        Assert.Equal(HttpStatusCode.BadRequest, (await anon.PostAsJsonAsync("/api/auth/password/reset", new { token = "not-a-token", password = "Valid-Password-1" })).StatusCode);

        await using (var conn = new NpgsqlConnection(f.OwnerCs))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("update user_tokens set expires_at = now() - interval '1 minute' where token_hash = @h", conn);
            cmd.Parameters.AddWithValue("h", SecureToken.Hash(token));
            Assert.Equal(1, await cmd.ExecuteNonQueryAsync());
        }
        var expired = await anon.PostAsJsonAsync("/api/auth/password/reset", new { token, password = "Valid-Password-1" });
        Assert.Equal(HttpStatusCode.BadRequest, expired.StatusCode);
        Assert.EndsWith("/invalid-token", (await expired.Json())["type"]!.ToString());
    }

    [Fact]
    public async Task Tokens_are_stored_only_as_hashes()
    {
        var (_, me) = await f.NewMerchantAsync();
        var token = await f.TokenFromEmailAsync(Email(me), "verify_email");
        await using var conn = new NpgsqlConnection(f.OwnerCs);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("select count(*) filter (where token_hash = @raw), count(*) filter (where token_hash = @hash) from user_tokens", conn);
        cmd.Parameters.AddWithValue("raw", token);
        cmd.Parameters.AddWithValue("hash", SecureToken.Hash(token));
        await using var r = await cmd.ExecuteReaderAsync();
        await r.ReadAsync();
        Assert.Equal(0L, r.GetInt64(0));
        Assert.Equal(1L, r.GetInt64(1));
    }

    [Fact]
    public async Task Password_reset_unlocks_a_locked_account()
    {
        var (_, me) = await f.NewMerchantAsync();
        var anon = f.Client();
        for (var i = 0; i < AuthEndpoints.MaxFailedLogins; i++)
            await anon.PostAsJsonAsync("/api/auth/login", new { email = Email(me), password = "wrong-password" });
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsJsonAsync("/api/auth/login", new { email = Email(me), password = ApiFactory.Password })).StatusCode);

        await anon.PostAsJsonAsync("/api/auth/password/forgot", new { email = Email(me) });
        var token = await f.TokenFromEmailAsync(Email(me), "password_reset");
        await anon.PostAsJsonAsync("/api/auth/password/reset", new { token, password = "Unlocked-Again-8" });
        Assert.Equal(HttpStatusCode.OK, (await anon.PostAsJsonAsync("/api/auth/login", new { email = Email(me), password = "Unlocked-Again-8" })).StatusCode);
    }

    [Fact]
    public async Task Change_password_requires_the_current_one_and_signs_out_other_sessions_only()
    {
        var (here, me) = await f.NewMerchantAsync();
        var elsewhere = f.Client();
        (await elsewhere.PostAsJsonAsync("/api/auth/login", new { email = Email(me), password = ApiFactory.Password })).EnsureSuccessStatusCode();

        var wrong = await here.PostAsJsonAsync("/api/auth/password/change", new { currentPassword = "nope-nope-nope", newPassword = "Changed-Secret-55" });
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.NotNull((await wrong.Json())["errors"]!["currentPassword"]);

        var ok = await here.PostAsJsonAsync("/api/auth/password/change", new { currentPassword = ApiFactory.Password, newPassword = "Changed-Secret-55" });
        Assert.Equal(HttpStatusCode.NoContent, ok.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await here.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await elsewhere.GetAsync("/api/auth/me")).StatusCode);

        var audit = await (await here.GetAsync("/api/admin/audit?area=auth")).Json();
        Assert.Contains(audit["items"]!.AsArray(), e => e!["action"]!.ToString() == "auth.password_changed");
    }
}
