using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Notifications;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class OnboardingTests(ApiFactory f)
{
    private static HttpRequestMessage Get(string host, string path)
    {
        var r = new HttpRequestMessage(HttpMethod.Get, path);
        r.Headers.Host = host;
        return r;
    }

    private static object StoreBody(string name, string? supportEmail = null, string? tagline = null) =>
        new { name, supportEmail, tagline, brandColor = "#4f46e5", lowStockThreshold = 10 };

    private static bool Step(JsonNode status, string key) =>
        status["steps"]!.AsArray().Single(s => s!["key"]!.ToString() == key)!["done"]!.GetValue<bool>();

    [Fact]
    public async Task New_store_stays_unpublished_until_the_required_steps_are_done()
    {
        var (owner, me) = await f.NewMerchantAsync();
        var host = ApiFactory.Host(me);
        var anon = f.Client();

        var status = await (await owner.GetAsync("/api/admin/onboarding")).Json();
        Assert.False(status["isLive"]!.GetValue<bool>());
        Assert.False(status["canLaunch"]!.GetValue<bool>());
        Assert.False(me["tenant"]!["isLive"]!.GetValue<bool>());

        // Before launch: the store profile answers (for a "coming soon" page) but the catalogue does not.
        var profile = await (await anon.SendAsync(Get(host, "/api/storefront/store"))).Json();
        Assert.False(profile["isLive"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.NotFound, (await anon.SendAsync(Get(host, "/api/storefront/products"))).StatusCode);

        var early = await owner.PostAsync("/api/admin/onboarding/launch", null);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, early.StatusCode);
        var problem = await early.Json();
        Assert.EndsWith("/launch-requirements", problem["type"]!.ToString());
        Assert.Contains("Confirm the owner's email", problem["detail"]!.ToString());

        // Work through the required steps.
        await f.Client().PostAsJsonAsync("/api/auth/email/verify", new { token = await f.TokenFromEmailAsync(me["user"]!["email"]!.ToString(), "verify_email") });
        Assert.Equal(HttpStatusCode.OK, (await owner.PatchAsJsonAsync("/api/admin/store", StoreBody(me["tenant"]!["name"]!.ToString(), "help@example.com"))).StatusCode);
        await owner.CreateProductAsync(Http.Product("Draft only", "DR-" + Guid.NewGuid().ToString("N")[..6], status: "draft"));
        await owner.CreateProductAsync(Http.Product("No stock", "NS-" + Guid.NewGuid().ToString("N")[..6], stock: 0));
        status = await (await owner.GetAsync("/api/admin/onboarding")).Json();
        Assert.True(Step(status, "verify_email"));
        Assert.True(Step(status, "store_details"));
        Assert.False(Step(status, "first_product")); // a draft or an out-of-stock product isn't sellable
        Assert.False(status["canLaunch"]!.GetValue<bool>());

        await owner.CreateProductAsync(Http.Product("Ready to sell", "RS-" + Guid.NewGuid().ToString("N")[..6]));
        status = await (await owner.GetAsync("/api/admin/onboarding")).Json();
        Assert.True(status["canLaunch"]!.GetValue<bool>());

        var launched = await owner.PostAsync("/api/admin/onboarding/launch", null);
        Assert.Equal(HttpStatusCode.OK, launched.StatusCode);
        Assert.True((await launched.Json())["isLive"]!.GetValue<bool>());
        Assert.True((await (await owner.GetAsync("/api/auth/me")).Json())["tenant"]!["isLive"]!.GetValue<bool>());

        var products = await (await anon.SendAsync(Get(host, "/api/storefront/products"))).Json();
        Assert.Contains(products["items"]!.AsArray(), p => p!["title"]!.ToString() == "Ready to sell");
        var audit = await (await owner.GetAsync("/api/admin/audit?area=store")).Json();
        Assert.Contains(audit["items"]!.AsArray(), e => e!["action"]!.ToString() == "store.launched");
    }

    [Fact]
    public async Task Only_people_with_settings_permission_can_launch()
    {
        var (_, me) = await f.NewMerchantAsync();
        var manager = await f.AddMemberAsync(ApiFactory.TenantId(me), MemberRole.Manager);
        Assert.Equal(HttpStatusCode.OK, (await manager.GetAsync("/api/admin/onboarding")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.PostAsync("/api/admin/onboarding/launch", null)).StatusCode);
    }

    [Fact]
    public async Task Optional_steps_reflect_store_state()
    {
        var (owner, me) = await f.NewMerchantAsync();
        await owner.PatchAsJsonAsync("/api/admin/store", StoreBody("Renamed", tagline: "Handmade in Jaipur"));
        await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email = $"t-{Guid.NewGuid():N}@example.com", role = "Staff" });
        var status = await (await owner.GetAsync("/api/admin/onboarding")).Json();
        Assert.True(Step(status, "branding"));
        Assert.True(Step(status, "team"));
        Assert.False(Step(status, "tax"));
        _ = me;
    }
}

[Collection("api")]
public class AuditLogTests(ApiFactory f)
{
    [Fact]
    public async Task Owner_sees_store_activity_newest_first_with_the_actor()
    {
        var (owner, me) = await f.NewMerchantAsync();
        await owner.CreateProductAsync(Http.Product("Audited", "AU-" + Guid.NewGuid().ToString("N")[..6]));

        var all = await (await owner.GetAsync("/api/admin/audit")).Json();
        var items = all["items"]!.AsArray();
        Assert.Equal("product.created", items[0]!["action"]!.ToString());
        Assert.Equal("tenant.created", items[^1]!["action"]!.ToString());
        Assert.Equal(me["user"]!["email"]!.ToString(), items[0]!["actor"]!["email"]!.ToString());
        Assert.Equal("object", JsonValueKind(items[0]!["data"]));

        var products = await (await owner.GetAsync("/api/admin/audit?area=product")).Json();
        Assert.All(products["items"]!.AsArray(), e => Assert.StartsWith("product.", e!["action"]!.ToString()));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync("/api/admin/audit?area=nope")).StatusCode);

        var paged = await (await owner.GetAsync("/api/admin/audit?pageSize=1&page=2")).Json();
        Assert.Single(paged["items"]!.AsArray());
        Assert.Equal(all["totalCount"]!.GetValue<int>(), paged["totalCount"]!.GetValue<int>());
    }

    private static string JsonValueKind(JsonNode? n) => n?.GetValueKind().ToString().ToLowerInvariant() ?? "null";

    [Fact]
    public async Task Audit_log_is_permissioned_and_isolated()
    {
        var (a, meA) = await f.NewMerchantAsync();
        var (b, _) = await f.NewMerchantAsync();
        await a.CreateProductAsync(Http.Product("Secret A", "SA-" + Guid.NewGuid().ToString("N")[..6]));
        var staff = await f.AddMemberAsync(ApiFactory.TenantId(meA), MemberRole.Staff);

        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/admin/audit")).StatusCode);
        var bLog = await (await b.GetAsync("/api/admin/audit")).Json();
        Assert.DoesNotContain("Secret A", bLog.ToJsonString());
        Assert.All(bLog["items"]!.AsArray(), e => Assert.NotEqual("product.created", e!["action"]!.ToString()));
    }
}

[Collection("api")]
public class EmailOutboxTests(ApiFactory f)
{
    [Fact]
    public async Task App_role_can_enqueue_but_cannot_read_the_outbox()
    {
        var (_, me) = await f.NewMerchantAsync();
        await using var conn = new NpgsqlConnection(f.AppCs);
        await conn.OpenAsync();
        await using (var set = new NpgsqlCommand("select set_config('app.tenant_id', @t, false)", conn))
        {
            set.Parameters.AddWithValue("t", ApiFactory.TenantId(me).ToString());
            await set.ExecuteNonQueryAsync();
        }
        await using var read = new NpgsqlCommand("select count(*) from email_outbox", conn);
        var ex = await Assert.ThrowsAsync<PostgresException>(() => read.ExecuteScalarAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);

        // And it cannot enqueue mail attributed to another store.
        await using var insert = new NpgsqlCommand("""
            insert into email_outbox (id, tenant_id, template, to_address, subject, status, attempts, next_attempt_at, created_at)
            values (gen_random_uuid(), gen_random_uuid(), 't', 'x@example.com', 's', 'Pending', 0, now(), now())
            """, conn);
        var rls = await Assert.ThrowsAsync<PostgresException>(() => insert.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, rls.SqlState);
    }

    [Fact]
    public async Task Invitation_email_html_encodes_store_and_inviter_names()
    {
        var (owner, _) = await f.NewMerchantAsync();
        await owner.PatchAsJsonAsync("/api/admin/store", new { name = "Tea & <b>Co</b>", brandColor = "#4f46e5", lowStockThreshold = 10 });
        var email = $"enc-{Guid.NewGuid():N}@example.com";
        await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email, role = "Staff" });
        var mail = await f.LastEmailAsync(email, "staff_invitation");
        Assert.Contains("Tea &amp; &lt;b&gt;Co&lt;/b&gt;", mail!.HtmlBody);
        Assert.DoesNotContain("<b>Co</b>", mail.HtmlBody);
        Assert.Contains("Tea & <b>Co</b>", mail.Subject); // plain-text subject, not HTML
    }

    private sealed class FakeSender(Func<EmailMessage, bool> succeed) : IEmailSender
    {
        public List<EmailMessage> Sent { get; } = [];
        public Task SendAsync(EmailMessage message, CancellationToken ct)
        {
            if (!succeed(message)) throw new InvalidOperationException("SMTP unavailable");
            Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task Dispatcher_delivers_clears_bodies_and_backs_off_on_failure()
    {
        var (_, okMe) = await f.NewMerchantAsync();
        var (_, failMe) = await f.NewMerchantAsync();
        var okAddress = okMe["user"]!["email"]!.ToString();
        var failAddress = failMe["user"]!["email"]!.ToString();
        var sender = new FakeSender(m => m.ToAddress != failAddress);

        await using (var scope = f.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
            var options = new EmailOptions.DispatcherOptions { BatchSize = 1000, MaxAttempts = 2 };
            await EmailDispatcher.DispatchPendingAsync(db, sender, options, NullLogger.Instance, default);
        }
        Assert.Contains(sender.Sent, m => m.ToAddress == okAddress && m.TextBody.Contains("/verify-email?token="));

        var ok = await f.LastEmailAsync(okAddress);
        Assert.Equal(EmailStatus.Sent, ok!.Status);
        Assert.Null(ok.TextBody);
        Assert.Null(ok.HtmlBody);

        var failed = await f.LastEmailAsync(failAddress);
        Assert.Equal(EmailStatus.Pending, failed!.Status);
        Assert.Equal(1, failed.Attempts);
        Assert.True(failed.NextAttemptAt > DateTimeOffset.UtcNow);
        Assert.NotNull(failed.TextBody); // kept for the retry
        Assert.Contains("SMTP unavailable", failed.LastError);

        // Not due yet, so a second pass leaves it alone.
        await using (var scope = f.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
            await EmailDispatcher.DispatchPendingAsync(db, sender, new() { MaxAttempts = 2 }, NullLogger.Instance, default);
        }
        Assert.Equal(1, (await f.LastEmailAsync(failAddress))!.Attempts);
    }
}
