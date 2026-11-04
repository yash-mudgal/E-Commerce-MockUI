using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Npgsql;
using ShopMint.Api.Modules;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class StaffTests(ApiFactory f)
{
    private static string NewEmail() => $"inv-{Guid.NewGuid():N}@example.com";

    private async Task<string> InviteAsync(HttpClient owner, string email, string role = "Staff")
    {
        var res = await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email, role });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return await f.TokenFromEmailAsync(email, "staff_invitation");
    }

    private static async Task<JsonNode> Staff(HttpClient c) => await (await c.GetAsync("/api/admin/staff")).Json();

    [Fact]
    public async Task Invited_person_joins_with_a_new_account()
    {
        var (owner, me) = await f.NewMerchantAsync();
        var email = NewEmail();
        var token = await InviteAsync(owner, email);

        var mail = await f.LastEmailAsync(email, "staff_invitation");
        Assert.Contains(ApiFactory.PublicUrl + "/invite/", mail!.TextBody);
        Assert.Equal(ApiFactory.TenantId(me), mail.TenantId);

        var preview = await (await f.Client().GetAsync($"/api/auth/invitations/{token}")).Json();
        Assert.Equal(me["tenant"]!["name"]!.ToString(), preview["storeName"]!.ToString());
        Assert.Equal("Staff", preview["role"]!.ToString());
        Assert.False(preview["accountExists"]!.GetValue<bool>());

        var invitee = f.Client();
        var missing = await invitee.PostAsJsonAsync("/api/auth/invitations/accept", new { token });
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.NotNull((await missing.Json())["errors"]!["password"]);

        var accepted = await invitee.PostAsJsonAsync("/api/auth/invitations/accept", new { token, name = "New Hire", password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var inviteeMe = await accepted.Json();
        Assert.Equal("Staff", inviteeMe["role"]!.ToString());
        Assert.Equal(ApiFactory.TenantId(me), ApiFactory.TenantId(inviteeMe));
        Assert.True(inviteeMe["user"]!["emailVerified"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.OK, (await invitee.GetAsync("/api/admin/products")).StatusCode);

        var staff = await Staff(owner);
        Assert.Contains(staff["members"]!.AsArray(), m => m!["email"]!.ToString() == email && m["role"]!.ToString() == "Staff");
        Assert.Empty(staff["invitations"]!.AsArray());

        // Single use.
        Assert.Equal(HttpStatusCode.NotFound, (await f.Client().GetAsync($"/api/auth/invitations/{token}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await f.Client().PostAsJsonAsync("/api/auth/invitations/accept", new { token, name = "X", password = ApiFactory.Password })).StatusCode);

        var audit = await (await owner.GetAsync("/api/admin/audit?area=staff")).Json();
        var actions = audit["items"]!.AsArray().Select(e => e!["action"]!.ToString()).ToList();
        Assert.Contains("staff.invited", actions);
        Assert.Contains("staff.invitation_accepted", actions);
        // The token never reaches the audit log.
        Assert.DoesNotContain(token, audit.ToJsonString());
    }

    [Fact]
    public async Task Existing_account_must_be_signed_in_as_the_invited_address()
    {
        var (ownerA, meA) = await f.NewMerchantAsync();
        var (ownerB, meB) = await f.NewMerchantAsync();
        var token = await InviteAsync(ownerA, meB["user"]!["email"]!.ToString(), "Manager");

        Assert.True((await (await f.Client().GetAsync($"/api/auth/invitations/{token}")).Json())["accountExists"]!.GetValue<bool>());

        var anon = await f.Client().PostAsJsonAsync("/api/auth/invitations/accept", new { token, name = "Hijack", password = "Some-Other-Pass-1" });
        Assert.Equal(HttpStatusCode.Unauthorized, anon.StatusCode);
        Assert.EndsWith("/sign-in-required", (await anon.Json())["type"]!.ToString());

        var (stranger, _) = await f.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.PostAsJsonAsync("/api/auth/invitations/accept", new { token })).StatusCode);

        var ok = await ownerB.PostAsJsonAsync("/api/auth/invitations/accept", new { token });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var now = await ok.Json();
        Assert.Equal(ApiFactory.TenantId(meA), ApiFactory.TenantId(now));
        Assert.Equal("Manager", now["role"]!.ToString());
        Assert.Equal(2, now["memberships"]!.AsArray().Count);
    }

    [Fact]
    public async Task Resend_replaces_the_link_and_revoke_invalidates_it()
    {
        var (owner, _) = await f.NewMerchantAsync();
        var email = NewEmail();
        var first = await InviteAsync(owner, email);
        var id = (await Staff(owner))["invitations"]![0]!["id"]!.ToString();

        // Resend is throttled to one a minute; age the invitation instead of waiting. Forced RLS applies even to the
        // table owner, so this uses the platform role (BYPASSRLS).
        await using (var conn = new NpgsqlConnection(f.PlatformCs))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("update invitations set last_sent_at = now() - interval '2 minutes' where id = @id", conn);
            cmd.Parameters.AddWithValue("id", Guid.Parse(id));
            Assert.Equal(1, await cmd.ExecuteNonQueryAsync());
        }
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PostAsync($"/api/admin/staff/invitations/{id}/resend", null)).StatusCode);
        Assert.Equal((HttpStatusCode)429, (await owner.PostAsync($"/api/admin/staff/invitations/{id}/resend", null)).StatusCode);
        var second = await f.TokenFromEmailAsync(email, "staff_invitation");
        Assert.NotEqual(first, second);
        Assert.Equal(HttpStatusCode.NotFound, (await f.Client().GetAsync($"/api/auth/invitations/{first}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await f.Client().GetAsync($"/api/auth/invitations/{second}")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/admin/staff/invitations/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await f.Client().GetAsync($"/api/auth/invitations/{second}")).StatusCode);
    }

    [Fact]
    public async Task Duplicate_invitations_and_existing_members_are_rejected()
    {
        var (owner, me) = await f.NewMerchantAsync();
        var email = NewEmail();
        await InviteAsync(owner, email);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email = email.ToUpperInvariant(), role = "Staff" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email = me["user"]!["email"]!.ToString(), role = "Staff" })).StatusCode);
        var owner2 = await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email = NewEmail(), role = "Owner" });
        Assert.Equal(HttpStatusCode.BadRequest, owner2.StatusCode);
    }

    [Fact]
    public async Task Plan_seat_limit_counts_members_and_pending_invitations()
    {
        var (owner, _) = await f.NewMerchantAsync(); // trial plan: 2 seats besides the owner
        await InviteAsync(owner, NewEmail());
        await InviteAsync(owner, NewEmail());
        var third = await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email = NewEmail(), role = "Staff" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, third.StatusCode);
        Assert.EndsWith("/entitlement-exceeded", (await third.Json())["type"]!.ToString());

        var overview = await Staff(owner);
        Assert.Equal(2, overview["seats"]!["used"]!.GetValue<int>());
        Assert.Equal(2, overview["seats"]!["max"]!.GetValue<int>());

        await owner.DeleteAsync($"/api/admin/staff/invitations/{overview["invitations"]![0]!["id"]}");
        Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email = NewEmail(), role = "Staff" })).StatusCode);
    }

    [Fact]
    public async Task Roles_limit_who_can_manage_whom()
    {
        var (owner, me) = await f.NewMerchantAsync();
        var tid = ApiFactory.TenantId(me);
        var manager = await f.AddMemberAsync(tid, MemberRole.Manager);
        var staff = await f.AddMemberAsync(tid, MemberRole.Staff);

        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/admin/staff")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.PostAsJsonAsync("/api/admin/staff/invitations", new { email = NewEmail(), role = "Manager" })).StatusCode);

        var list = await Staff(manager);
        var ownerId = list["members"]!.AsArray().Single(m => m!["role"]!.ToString() == "Owner")!["userId"]!.ToString();
        var managerId = list["members"]!.AsArray().Single(m => m!["isYou"]!.GetValue<bool>())!["userId"]!.ToString();
        var staffId = list["members"]!.AsArray().Single(m => m!["role"]!.ToString() == "Staff")!["userId"]!.ToString();

        Assert.Equal(HttpStatusCode.Forbidden, (await manager.DeleteAsync($"/api/admin/staff/{ownerId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.PatchAsJsonAsync($"/api/admin/staff/{staffId}", new { role = "Manager" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PatchAsJsonAsync($"/api/admin/staff/{ownerId}", new { role = "Staff" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.DeleteAsync($"/api/admin/staff/{managerId}")).StatusCode);

        // A manager may remove staff.
        Assert.Equal(HttpStatusCode.NoContent, (await manager.DeleteAsync($"/api/admin/staff/{staffId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await staff.GetAsync("/api/admin/products")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.DeleteAsync($"/api/admin/staff/{staffId}")).StatusCode);
    }

    [Fact]
    public async Task Role_change_takes_effect_and_the_old_session_is_rejected()
    {
        var (owner, me) = await f.NewMerchantAsync();
        var staff = await f.AddMemberAsync(ApiFactory.TenantId(me), MemberRole.Staff);
        var staffId = (await Staff(owner))["members"]!.AsArray().Single(m => m!["role"]!.ToString() == "Staff")!["userId"]!.ToString();

        var res = await owner.PatchAsJsonAsync($"/api/admin/staff/{staffId}", new { role = "Manager" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains((await res.Json())["members"]!.AsArray(), m => m!["userId"]!.ToString() == staffId && m["role"]!.ToString() == "Manager");
        // The session still claims Staff, so it is rejected; signing in again picks up the new role.
        Assert.Equal(HttpStatusCode.Unauthorized, (await staff.GetAsync("/api/auth/me")).StatusCode);
        var audit = await (await owner.GetAsync("/api/admin/audit?area=staff")).Json();
        Assert.Contains(audit["items"]!.AsArray(), e => e!["action"]!.ToString() == "staff.role_changed");
    }

    [Fact]
    public async Task Invitations_are_isolated_between_stores()
    {
        var (a, meA) = await f.NewMerchantAsync();
        var (b, meB) = await f.NewMerchantAsync();
        await InviteAsync(a, NewEmail());
        var aInvitation = (await Staff(a))["invitations"]![0]!["id"]!.ToString();

        Assert.Empty((await Staff(b))["invitations"]!.AsArray());
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/admin/staff/invitations/{aInvitation}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsync($"/api/admin/staff/invitations/{aInvitation}/resend", null)).StatusCode);
        var aOwner = (await Staff(a))["members"]![0]!["userId"]!.ToString();
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/admin/staff/{aOwner}")).StatusCode);

        // Database layer: the app role scoped to B sees none of A's invitations.
        await using var conn = new NpgsqlConnection(f.AppCs);
        await conn.OpenAsync();
        await using (var set = new NpgsqlCommand("select set_config('app.tenant_id', @t, false)", conn))
        {
            set.Parameters.AddWithValue("t", ApiFactory.TenantId(meB).ToString());
            await set.ExecuteNonQueryAsync();
        }
        await using var cmd = new NpgsqlCommand("select count(*) from invitations where tenant_id = @a", conn);
        cmd.Parameters.AddWithValue("a", ApiFactory.TenantId(meA));
        Assert.Equal(0L, (long)(await cmd.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Invitations_to_a_suspended_store_cannot_be_used()
    {
        var (owner, me) = await f.NewMerchantAsync();
        var token = await InviteAsync(owner, NewEmail());
        var admin = await f.AddMemberAsync(Guid.Empty, MemberRole.Owner, platformAdmin: true);
        await admin.PostAsJsonAsync($"/api/platform/tenants/{ApiFactory.TenantId(me)}/suspend", new { reason = "test" });
        Assert.Equal(HttpStatusCode.NotFound, (await f.Client().GetAsync($"/api/auth/invitations/{token}")).StatusCode);
    }
}
