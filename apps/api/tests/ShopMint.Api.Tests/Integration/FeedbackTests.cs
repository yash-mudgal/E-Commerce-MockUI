using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Npgsql;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Feedback;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class FeedbackTests(ApiFactory f)
{
    private async Task<HttpClient> AdminAsync()
    {
        var (_, me) = await f.NewMerchantAsync();
        return await f.AddMemberAsync(ApiFactory.TenantId(me), MemberRole.Staff, platformAdmin: true);
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient c, string message, string category = "idea", bool mayContact = false, string? page = "/admin/products") =>
        c.PostAsJsonAsync("/api/admin/feedback", new { category, message, page, mayContact });

    private static async Task<JsonNode> FindAsync(HttpClient admin, string marker)
    {
        var page = await (await admin.GetAsync($"/api/platform/feedback?q={Uri.EscapeDataString(marker)}")).Json();
        return Assert.Single(page["items"]!.AsArray())!;
    }

    [Fact]
    public async Task Any_member_can_send_feedback_and_the_team_sees_it_with_the_store_and_contact_only_if_allowed()
    {
        var (owner, me) = await f.NewMerchantAsync();
        var staff = await f.AddMemberAsync(ApiFactory.TenantId(me), MemberRole.Staff);
        var marker = Guid.NewGuid().ToString("N")[..12];

        var sent = await SendAsync(staff, $"Bulk price edit would save us hours {marker}a", "idea", mayContact: false);
        Assert.Equal(HttpStatusCode.Created, sent.StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(owner, $"Invoice PDF shows the wrong state {marker}b", "problem", mayContact: true, page: "/admin/orders")).StatusCode);

        var admin = await AdminAsync();
        var idea = await FindAsync(admin, marker + "a");
        var idea2 = (await (await admin.GetAsync($"/api/platform/feedback?q={marker}&category=idea")).Json())["items"]!.AsArray().Single()!;
        Assert.Equal(idea["id"]!.ToString(), idea2["id"]!.ToString());
        Assert.Equal("Idea", idea["category"]!.ToString());
        Assert.Equal("New", idea["status"]!.ToString());
        Assert.Equal("/admin/products", idea["page"]!.ToString());
        Assert.Equal(me["tenant"]!["name"]!.ToString(), idea["storeName"]!.ToString());
        Assert.Null(idea["contactEmail"]);                               // didn't agree to be contacted

        var problem = await FindAsync(admin, marker + "b");
        Assert.Equal(me["user"]!["email"]!.ToString(), problem["contactEmail"]!.ToString());
    }

    [Fact]
    public async Task The_team_triages_feedback_and_the_counts_follow()
    {
        var (merchant, _) = await f.NewMerchantAsync();
        var marker = Guid.NewGuid().ToString("N")[..12];
        await SendAsync(merchant, $"Please add WhatsApp order updates {marker}");
        var admin = await AdminAsync();
        var item = await FindAsync(admin, marker);
        var before = (await (await admin.GetAsync("/api/platform/feedback")).Json())["counts"]!;

        var patch = await admin.PatchAsJsonAsync($"/api/platform/feedback/{item["id"]}", new { status = "planned", teamNote = "Q1 roadmap" });
        Assert.Equal(HttpStatusCode.NoContent, patch.StatusCode);
        var updated = await FindAsync(admin, marker);
        Assert.Equal("Planned", updated["status"]!.ToString());
        Assert.Equal("Q1 roadmap", updated["teamNote"]!.ToString());
        var after = (await (await admin.GetAsync("/api/platform/feedback")).Json())["counts"]!;
        Assert.Equal(before["new"]!.GetValue<int>() - 1, after["new"]!.GetValue<int>());
        Assert.Equal(before["planned"]!.GetValue<int>() + 1, after["planned"]!.GetValue<int>());
        Assert.Contains((await (await admin.GetAsync("/api/platform/feedback?status=planned")).Json())["items"]!.AsArray(),
            x => x!["id"]!.ToString() == item["id"]!.ToString());

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PatchAsJsonAsync($"/api/platform/feedback/{item["id"]}", new { status = "shipped" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PatchAsJsonAsync($"/api/platform/feedback/{Guid.NewGuid()}", new { status = "done" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await merchant.PatchAsJsonAsync($"/api/platform/feedback/{item["id"]}", new { status = "done" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await merchant.GetAsync("/api/platform/feedback")).StatusCode);
    }

    [Fact]
    public async Task Feedback_is_validated_and_rate_limited_per_person()
    {
        var (merchant, _) = await f.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(merchant, "too short")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(merchant, "A perfectly fine message", category: "complaint")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(merchant, "A perfectly fine message", page: "/admin?token=abc")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(merchant, new string('x', 2001))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(f.Client(), "Signed-out people can't send this")).StatusCode);

        // The limiter counts rejected requests too (it runs before validation), so the limit is checked with new people.
        var (fresh, _) = await f.NewMerchantAsync();
        for (var i = 0; i < FeedbackEndpoints.PerUserPerHour; i++)
            Assert.Equal(HttpStatusCode.Created, (await SendAsync(fresh, $"Feedback number {i} for the limit")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await SendAsync(fresh, "One more than the hourly limit")).StatusCode);
        var (other, _) = await f.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(other, "Someone else is not limited by it")).StatusCode);
    }

    [Fact]
    public async Task The_request_path_role_can_insert_only_for_its_own_store_and_never_read_feedback()
    {
        var (_, a) = await f.NewMerchantAsync();
        var (_, b) = await f.NewMerchantAsync();
        var ct = TestContext.Current.CancellationToken;
        await using var app = new NpgsqlConnection(f.AppCs);
        await app.OpenAsync(ct);
        await using (var set = new NpgsqlCommand($"SELECT set_config('app.tenant_id', '{ApiFactory.TenantId(a)}', false)", app))
            await set.ExecuteNonQueryAsync(ct);

        await using var read = new NpgsqlCommand("SELECT count(*) FROM feedback", app);
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, (await Assert.ThrowsAsync<PostgresException>(() => read.ExecuteScalarAsync(ct))).SqlState);

        await using var foreign = new NpgsqlCommand("""
            INSERT INTO feedback (id, tenant_id, user_id, category, message, may_contact, status, created_at, updated_at)
            VALUES (gen_random_uuid(), @t, @u, 'Idea', 'Planted in another store', false, 'New', now(), now())
            """, app);
        foreign.Parameters.AddWithValue("t", ApiFactory.TenantId(b));
        foreign.Parameters.AddWithValue("u", Guid.Parse(b["user"]!["id"]!.ToString()));
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, (await Assert.ThrowsAsync<PostgresException>(() => foreign.ExecuteNonQueryAsync(ct))).SqlState);
    }
}
