using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class MfaTests(ApiFactory f)
{
    private static string Now(string secret, int stepOffset = 0) => Totp.Code(secret, Totp.Step(DateTimeOffset.UtcNow) + stepOffset);

    /// <summary>A merchant who turned on two-step verification: returns the client, email, secret and recovery codes.</summary>
    private async Task<(HttpClient Client, string Email, string Secret, string[] Codes)> EnrolledAsync()
    {
        var (c, me) = await f.NewMerchantAsync();
        var email = me["user"]!["email"]!.ToString();
        var setup = await (await c.PostAsync("/api/auth/mfa/setup", null)).Json();
        var secret = setup["secret"]!.ToString();
        Assert.StartsWith("otpauth://totp/ShopMint:", setup["uri"]!.ToString());
        var enable = await c.PostAsJsonAsync("/api/auth/mfa/enable", new { code = Now(secret) });
        Assert.Equal(HttpStatusCode.OK, enable.StatusCode);
        var codes = (await enable.Json())["recoveryCodes"]!.AsArray().Select(x => x!.ToString()).ToArray();
        return (c, email, secret, codes);
    }

    private async Task<(HttpClient Client, string Challenge)> PasswordStepAsync(string email)
    {
        var c = f.Client();
        var res = await c.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Json();
        Assert.True(body["mfaRequired"]!.GetValue<bool>());
        return (c, body["challenge"]!.ToString());
    }

    private static Task<HttpResponseMessage> CodeStepAsync(HttpClient c, string challenge, string code) =>
        c.PostAsJsonAsync("/api/auth/mfa/verify", new { challenge, code });

    [Fact]
    public void Totp_matches_the_rfc_6238_test_vectors()
    {
        var secret = Base32.Encode("12345678901234567890"u8.ToArray());
        Assert.Equal("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", secret);
        Assert.Equal("287082", Totp.Code(secret, 59 / 30));
        Assert.Equal("081804", Totp.Code(secret, 1111111109 / 30));
        Assert.Equal("005924", Totp.Code(secret, 1234567890 / 30));
        var at = DateTimeOffset.FromUnixTimeSeconds(1234567890);
        Assert.Equal(1234567890 / 30, Totp.Match(secret, "005 924", at, null));
        Assert.Null(Totp.Match(secret, "005924", at, 1234567890 / 30)); // replay refused
        Assert.Null(Totp.Match(secret, "123456", at, null));
    }

    [Fact]
    public async Task Enrolling_needs_a_valid_code_signs_out_other_sessions_and_gives_recovery_codes()
    {
        var (c, me) = await f.NewMerchantAsync();
        var email = me["user"]!["email"]!.ToString();
        var other = f.Client();
        (await other.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password })).EnsureSuccessStatusCode();
        Assert.False((await (await c.GetAsync("/api/auth/mfa")).Json())["enabled"]!.GetValue<bool>());

        var secret = (await (await c.PostAsync("/api/auth/mfa/setup", null)).Json())["secret"]!.ToString();
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/auth/mfa/enable", new { code = "000000" })).StatusCode);
        var enable = await c.PostAsJsonAsync("/api/auth/mfa/enable", new { code = Now(secret) });
        Assert.Equal(HttpStatusCode.OK, enable.StatusCode);
        Assert.Equal(10, (await enable.Json())["recoveryCodes"]!.AsArray().Count);

        Assert.True((await (await c.GetAsync("/api/auth/me")).Json())["user"]!["mfaEnabled"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsync("/api/auth/mfa/setup", null)).StatusCode);

        // The secret is stored encrypted, never in clear.
        await using var scope = f.Services.CreateAsyncScope();
        var stored = await scope.ServiceProvider.GetRequiredService<PlatformDbContext>().Users.Where(u => u.Email == email).Select(u => u.TotpSecretEnc).FirstAsync();
        Assert.StartsWith("v1:", stored);
        Assert.DoesNotContain(secret, stored);
    }

    [Fact]
    public async Task Sign_in_needs_the_code_which_cant_be_replayed_and_recovery_codes_work_once()
    {
        var (_, email, secret, codes) = await EnrolledAsync();
        var (c1, ch1) = await PasswordStepAsync(email);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c1.GetAsync("/api/auth/me")).StatusCode); // password alone isn't a session
        Assert.Equal(HttpStatusCode.Unauthorized, (await CodeStepAsync(c1, ch1, "111111")).StatusCode);
        // The enrolment already used the current step, so wait for the next code rather than replaying it.
        var code = Now(secret, 1);
        Assert.Equal(HttpStatusCode.OK, (await CodeStepAsync(c1, ch1, code)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c1.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await CodeStepAsync(c1, ch1, code)).StatusCode); // challenge is single-use

        var (c2, ch2) = await PasswordStepAsync(email);
        Assert.Equal(HttpStatusCode.Unauthorized, (await CodeStepAsync(c2, ch2, code)).StatusCode); // same code again: replay
        Assert.Equal(HttpStatusCode.OK, (await CodeStepAsync(c2, ch2, codes[0].ToUpperInvariant())).StatusCode);
        Assert.Equal(9, (await (await c2.GetAsync("/api/auth/mfa")).Json())["recoveryCodesLeft"]!.GetValue<int>());
        var (c3, ch3) = await PasswordStepAsync(email);
        Assert.Equal(HttpStatusCode.Unauthorized, (await CodeStepAsync(c3, ch3, codes[0])).StatusCode); // used up
    }

    [Fact]
    public async Task Wrong_codes_lock_the_account_like_wrong_passwords()
    {
        var (_, email, secret, _) = await EnrolledAsync();
        var (c, ch) = await PasswordStepAsync(email);
        for (var i = 0; i < AuthEndpoints.MaxFailedLogins; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await CodeStepAsync(c, ch, "000000")).StatusCode);
        // Locked: even the right code fails now, and the password step stops issuing challenges.
        Assert.Equal(HttpStatusCode.Unauthorized, (await CodeStepAsync(c, ch, Now(secret, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Client().PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password })).StatusCode);
    }

    [Fact]
    public async Task Platform_tools_require_a_two_step_verified_session()
    {
        var (_, me) = await f.NewMerchantAsync();
        var email = me["user"]!["email"]!.ToString();
        await using (var scope = f.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<PlatformDbContext>().Users.Where(u => u.Email == email)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.IsPlatformAdmin, true));
        var c = f.Client();
        (await c.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password })).EnsureSuccessStatusCode();
        var denied = await c.GetAsync("/api/platform/tenants");
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.EndsWith("/mfa-required", (await denied.Json())["type"]!.ToString());

        var secret = (await (await c.PostAsync("/api/auth/mfa/setup", null)).Json())["secret"]!.ToString();
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/auth/mfa/enable", new { code = Now(secret) })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/platform/tenants")).StatusCode); // the session was re-issued as verified

        // Changing the password keeps the verified session.
        var change = await c.PostAsJsonAsync("/api/auth/password/change", new { currentPassword = ApiFactory.Password, newPassword = "Another-Strong-9" });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/platform/tenants")).StatusCode);
    }

    [Fact]
    public async Task Turning_off_needs_the_password_and_a_code()
    {
        var (c, email, secret, codes) = await EnrolledAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/auth/mfa/disable", new { password = "wrong-password-1", code = codes[1] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/auth/mfa/disable", new { password = ApiFactory.Password, code = "000000" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsJsonAsync("/api/auth/mfa/disable", new { password = ApiFactory.Password, code = codes[1] })).StatusCode);
        Assert.False((await (await c.GetAsync("/api/auth/me")).Json())["user"]!["mfaEnabled"]!.GetValue<bool>());
        var plain = await f.Client().PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
        Assert.Null((await plain.Json())["mfaRequired"]);
        Assert.NotEmpty(secret);
    }

    [Fact]
    public async Task An_operator_reset_clears_two_step_and_signs_the_person_out()
    {
        var (c, email, _, _) = await EnrolledAsync();
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
            var output = new StringWriter();
            Assert.True(await MfaOperator.ResetAsync(db, email.ToUpperInvariant(), output, TestContext.Current.CancellationToken));
            Assert.DoesNotContain(email, output.ToString()); // the log line carries the user ID, not the address
            Assert.False(await MfaOperator.ResetAsync(db, "nobody@example.com", TextWriter.Null, TestContext.Current.CancellationToken));
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/auth/me", TestContext.Current.CancellationToken)).StatusCode);
        var again = f.Client();
        var login = await again.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Null((await login.Json())["mfaRequired"]);
        Assert.False((await (await again.GetAsync("/api/auth/mfa", TestContext.Current.CancellationToken)).Json())["enabled"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Platform_admins_are_granted_by_an_operator_and_still_need_two_step()
    {
        var (c, me) = await f.NewMerchantAsync();
        var email = me["user"]!["email"]!.ToString();
        var ct = TestContext.Current.CancellationToken;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
            Assert.True(await PlatformAdminOperator.SetAsync(db, email, grant: true, TextWriter.Null, ct));
            Assert.False(await PlatformAdminOperator.SetAsync(db, "nobody@example.com", grant: true, TextWriter.Null, ct));
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/auth/me", ct)).StatusCode); // signed out

        var again = f.Client();
        (await again.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password }, ct)).EnsureSuccessStatusCode();
        var refused = await again.GetAsync("/api/platform/tenants", ct);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.EndsWith("mfa-required", (await refused.Json())["type"]!.ToString());

        using (var scope = f.Services.CreateScope())
            Assert.True(await PlatformAdminOperator.SetAsync(scope.ServiceProvider.GetRequiredService<PlatformDbContext>(), email, grant: false, TextWriter.Null, ct));
        Assert.Equal(HttpStatusCode.Unauthorized, (await again.GetAsync("/api/platform/tenants", ct)).StatusCode);
    }
}
