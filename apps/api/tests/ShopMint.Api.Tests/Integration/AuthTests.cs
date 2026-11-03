using System.Net;
using System.Net.Http.Json;
using ShopMint.Api.Modules;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class HealthAndPlumbingTests(ApiFactory f)
{
    [Fact]
    public async Task Ready_and_live_report_healthy()
    {
        var c = f.Client();
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/health/live")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/health/ready")).StatusCode);
    }

    [Fact]
    public async Task Correlation_id_is_echoed_and_used_as_trace_id()
    {
        var c = f.Client();
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        req.Headers.Add("X-Correlation-Id", "abc-123");
        var res = await c.SendAsync(req);
        Assert.Equal("abc-123", res.Headers.GetValues("X-Correlation-Id").Single());
        Assert.Equal("abc-123", (await res.Json())["traceId"]!.GetValue<string>());
    }

    [Fact]
    public async Task Problem_responses_use_problem_json()
    {
        var res = await f.Client().GetAsync("/api/admin/products");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task Security_headers_are_set()
    {
        var res = await f.Client().GetAsync("/health/live");
        Assert.Equal("nosniff", res.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", res.Headers.GetValues("X-Frame-Options").Single());
    }
}

[Collection("api")]
public class AuthTests(ApiFactory f)
{
    [Fact]
    public async Task Signup_creates_tenant_owner_session()
    {
        var (c, me) = await f.NewMerchantAsync();
        Assert.Equal("Owner", me["role"]!.GetValue<string>());
        Assert.Equal("Trialing", me["tenant"]!["status"]!.GetValue<string>());
        Assert.EndsWith("." + ApiFactory.StoreDomain, ApiFactory.Host(me));
        var again = await (await c.GetAsync("/api/auth/me")).Json();
        Assert.Equal(me["tenant"]!["id"]!.ToString(), again["tenant"]!["id"]!.ToString());
    }

    [Fact]
    public async Task Session_cookie_is_hardened()
    {
        // A client without a cookie jar, so the raw Set-Cookie header stays visible.
        var c = f.CreateClient(new() { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
        c.DefaultRequestHeaders.Add("X-ShopMint-Csrf", "1");
        var sub = "c" + Guid.NewGuid().ToString("N")[..10];
        var res = await c.PostAsJsonAsync("/api/auth/signup", new { name = "A", email = $"{sub}@example.com", password = ApiFactory.Password, storeName = "Store", subdomain = sub });
        var cookie = res.Headers.GetValues("Set-Cookie").Single(h => h.StartsWith("__Host-sm_session=", StringComparison.Ordinal)).ToLowerInvariant();
        Assert.Contains("httponly", cookie);
        Assert.Contains("secure", cookie);
        Assert.Contains("samesite=lax", cookie);
        Assert.Contains("path=/", cookie);
    }

    [Fact]
    public async Task Duplicate_email_and_subdomain_are_rejected()
    {
        var sub = "d" + Guid.NewGuid().ToString("N")[..10];
        await f.NewMerchantAsync(sub);
        var c = f.Client();
        var sameEmail = await c.PostAsJsonAsync("/api/auth/signup", new { name = "B", email = $"{sub}@example.com", password = ApiFactory.Password, storeName = "Store B", subdomain = sub + "x" });
        Assert.Equal(HttpStatusCode.Conflict, sameEmail.StatusCode);
        var sameSub = await c.PostAsJsonAsync("/api/auth/signup", new { name = "B", email = $"x{sub}@example.com", password = ApiFactory.Password, storeName = "Store B", subdomain = sub });
        Assert.Equal(HttpStatusCode.BadRequest, sameSub.StatusCode);
        Assert.NotNull((await sameSub.Json())["errors"]!["subdomain"]);
    }

    [Theory]
    [InlineData("admin", "Correct-Horse-9")]   // reserved
    [InlineData("Bad_Sub", "Correct-Horse-9")] // invalid characters
    [InlineData("goodsub1", "short")]           // weak password
    [InlineData("goodsub2", "aaaaaaaaaaaa")]    // low variety
    public async Task Signup_validation(string subdomain, string password)
    {
        var res = await f.Client().PostAsJsonAsync("/api/auth/signup", new { name = "A", email = $"{Guid.NewGuid():N}@example.com", password, storeName = "S", subdomain });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Missing_csrf_header_is_rejected_on_unsafe_methods()
    {
        var res = await f.Client(csrf: false).PostAsJsonAsync("/api/auth/login", new { email = "x@example.com", password = "whatever-123" });
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.EndsWith("/csrf", (await res.Json())["type"]!.GetValue<string>());
    }

    [Fact]
    public async Task Wrong_password_and_unknown_email_give_the_same_generic_401()
    {
        var (_, me) = await f.NewMerchantAsync();
        var email = me["user"]!["email"]!.GetValue<string>();
        var c = f.Client();
        var wrong = await c.PostAsJsonAsync("/api/auth/login", new { email, password = "Wrong-Password-1" });
        var unknown = await c.PostAsJsonAsync("/api/auth/login", new { email = "nobody@example.com", password = "Wrong-Password-1" });
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal((await wrong.Json())["title"]!.ToString(), (await unknown.Json())["title"]!.ToString());
    }

    [Fact]
    public async Task Account_locks_after_five_failures_even_for_correct_password()
    {
        var (_, me) = await f.NewMerchantAsync();
        var email = me["user"]!["email"]!.GetValue<string>();
        var c = f.Client();
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await c.PostAsJsonAsync("/api/auth/login", new { email, password = "Wrong-Password-1" })).StatusCode);
        var correct = await c.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.Unauthorized, correct.StatusCode);
    }

    [Fact]
    public async Task Login_then_logout_ends_session()
    {
        var (_, me) = await f.NewMerchantAsync();
        var c = f.Client();
        var login = await c.PostAsJsonAsync("/api/auth/login", new { email = me["user"]!["email"]!.ToString(), password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/admin/store")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Cannot_switch_to_a_store_without_membership()
    {
        var (a, _) = await f.NewMerchantAsync();
        var (_, meB) = await f.NewMerchantAsync();
        var res = await a.PostAsJsonAsync("/api/auth/switch-tenant", new { tenantId = ApiFactory.TenantId(meB) });
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Removing_membership_revokes_access_on_next_request()
    {
        var (_, owner) = await f.NewMerchantAsync();
        var tid = ApiFactory.TenantId(owner);
        var staff = await f.AddMemberAsync(tid, MemberRole.Staff);
        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync("/api/admin/products")).StatusCode);

        await using (var conn = new Npgsql.NpgsqlConnection(f.PlatformCs))
        {
            await conn.OpenAsync();
            await using var cmd = new Npgsql.NpgsqlCommand("UPDATE memberships SET status = 'Disabled' WHERE tenant_id = @t AND role = 'Staff'", conn);
            cmd.Parameters.AddWithValue("t", tid);
            await cmd.ExecuteNonQueryAsync();
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await staff.GetAsync("/api/admin/products")).StatusCode);
    }
}

[Collection("api")]
public class AuthorizationTests(ApiFactory f)
{
    [Fact]
    public async Task Staff_can_read_and_edit_catalog_but_not_delete_or_change_settings()
    {
        var (owner, me) = await f.NewMerchantAsync();
        var product = await owner.CreateProductAsync(Http.Product("Kurta", "K-" + Guid.NewGuid().ToString("N")[..6]));
        var staff = await f.AddMemberAsync(ApiFactory.TenantId(me), MemberRole.Staff);

        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync("/api/admin/products")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await staff.PostAsJsonAsync("/api/admin/products", Http.Product("Saree", "S-" + Guid.NewGuid().ToString("N")[..6]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.DeleteAsync($"/api/admin/products/{product["id"]}")).StatusCode);
        var patch = await staff.PatchAsJsonAsync("/api/admin/store", new { name = "Hacked", brandColor = "#4f46e5", lowStockThreshold = 5 });
        Assert.Equal(HttpStatusCode.Forbidden, patch.StatusCode);
    }

    [Fact]
    public async Task Manager_cannot_change_store_settings_but_owner_can()
    {
        var (owner, me) = await f.NewMerchantAsync();
        var manager = await f.AddMemberAsync(ApiFactory.TenantId(me), MemberRole.Manager);
        var body = new { name = "Renamed", brandColor = "#0f766e", lowStockThreshold = 5, gstin = "27AAGCD4821M1Z3" };
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.PatchAsJsonAsync("/api/admin/store", body)).StatusCode);
        var ok = await owner.PatchAsJsonAsync("/api/admin/store", body);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var store = await ok.Json();
        Assert.Equal("Renamed", store["name"]!.ToString());
        Assert.Equal("27", store["stateCode"]!.ToString());
    }

    [Fact]
    public async Task Store_settings_reject_low_contrast_brand_colour_and_bad_gstin()
    {
        var (owner, _) = await f.NewMerchantAsync();
        var res = await owner.PatchAsJsonAsync("/api/admin/store", new { name = "S", brandColor = "#fbbf24", lowStockThreshold = 5, gstin = "BADGSTIN" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var errors = (await res.Json())["errors"]!;
        Assert.NotNull(errors["brandColor"]);
        Assert.NotNull(errors["gstin"]);
    }
}
