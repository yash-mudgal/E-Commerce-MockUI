using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Orders;

namespace ShopMint.Api.Modules.Identity;

/// <summary>RFC 4648 base32 (no padding), as used by authenticator apps.</summary>
public static class Base32
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static string Encode(byte[] data)
    {
        var sb = new StringBuilder((data.Length * 8 + 4) / 5);
        int buffer = 0, bits = 0;
        foreach (var b in data)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5) { sb.Append(Alphabet[(buffer >> (bits - 5)) & 31]); bits -= 5; }
        }
        if (bits > 0) sb.Append(Alphabet[(buffer << (5 - bits)) & 31]);
        return sb.ToString();
    }

    public static byte[] Decode(string s)
    {
        var clean = s.Trim().TrimEnd('=').Replace(" ", "", StringComparison.Ordinal).ToUpperInvariant();
        var bytes = new List<byte>(clean.Length * 5 / 8);
        int buffer = 0, bits = 0;
        foreach (var c in clean)
        {
            var v = Alphabet.IndexOf(c, StringComparison.Ordinal);
            if (v < 0) throw new FormatException("Not base32.");
            buffer = (buffer << 5) | v;
            bits += 5;
            if (bits >= 8) { bytes.Add((byte)((buffer >> (bits - 8)) & 0xFF)); bits -= 8; }
        }
        return [.. bytes];
    }
}

/// <summary>Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits, 30-second steps).</summary>
public static class Totp
{
    public const int StepSeconds = 30;

    public static string NewSecret() => Base32.Encode(RandomNumberGenerator.GetBytes(20));

    public static long Step(DateTimeOffset t) => t.ToUnixTimeSeconds() / StepSeconds;

    public static string Code(string secret, long step)
    {
        Span<byte> counter = stackalloc byte[8];
        System.Buffers.Binary.BinaryPrimitives.WriteInt64BigEndian(counter, step);
#pragma warning disable CA5350 // RFC 6238 TOTP is defined over HMAC-SHA1; authenticator apps expect it.
        var hash = HMACSHA1.HashData(Base32.Decode(secret), counter);
#pragma warning restore CA5350
        var offset = hash[^1] & 0x0F;
        var bin = ((hash[offset] & 0x7F) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        return (bin % 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The matching time step (allowing one step of clock drift either way), or null. Steps at or before
    /// <paramref name="lastUsedStep"/> are refused, so a code can't be replayed.
    /// </summary>
    public static long? Match(string secret, string? code, DateTimeOffset now, long? lastUsedStep)
    {
        var digits = new string((code ?? "").Where(char.IsDigit).ToArray());
        if (digits.Length != 6) return null;
        var current = Step(now);
        for (var s = current - 1; s <= current + 1; s++)
        {
            if (lastUsedStep is { } last && s <= last) continue;
            if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Code(secret, s)), Encoding.ASCII.GetBytes(digits))) return s;
        }
        return null;
    }

    public static string Uri(string secret, string account, string issuer = "ShopMint") =>
        $"otpauth://totp/{System.Uri.EscapeDataString(issuer)}:{System.Uri.EscapeDataString(account)}?secret={secret}&issuer={System.Uri.EscapeDataString(issuer)}&algorithm=SHA1&digits=6&period={StepSeconds}";
}

public static class RecoveryCodes
{
    public const int Count = 10;
    private const string Alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes

    public static List<string> Generate() => Enumerable.Range(0, Count).Select(_ =>
    {
        var chars = Enumerable.Range(0, 10).Select(_ => Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)]).ToArray();
        return $"{new string(chars, 0, 5)}-{new string(chars, 5, 5)}";
    }).ToList();

    public static string Normalize(string code) => new string(code.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
    public static string Hash(string code) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Normalize(code))));
}

public sealed record MfaChallengeResponse(bool MfaRequired, string Challenge);
public sealed record MfaVerifyRequest(string Challenge, string Code);
public sealed record MfaCodeRequest(string Code);
public sealed record MfaDisableRequest(string Password, string Code);
public sealed record MfaPasswordRequest(string Password);
public sealed record MfaStatus(bool Enabled, int RecoveryCodesLeft, DateTimeOffset? EnabledAt);
public sealed record MfaSetup(string Secret, string Uri);
public sealed record MfaRecoveryCodes(IReadOnlyList<string> RecoveryCodes);

public sealed class MfaVerifyValidator : AbstractValidator<MfaVerifyRequest>
{
    public MfaVerifyValidator()
    {
        RuleFor(x => x.Challenge).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Code).NotEmpty().MaximumLength(20);
    }
}

/// <summary>
/// Two-step verification for merchant and platform accounts (ADR-035). Secrets are encrypted with the platform secrets
/// key. Sign-in with MFA is two requests: the password returns a single-use 5-minute challenge, then a code (or a
/// one-time recovery code) completes the session, which then carries an <c>mfa</c> claim. Wrong codes count towards
/// the same lockout as wrong passwords. Platform operator endpoints require that claim.
/// </summary>
public static class MfaEndpoints
{
    public static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(5);
    private static readonly PasswordHasher<User> Hasher = new();

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth/mfa").WithTags("Account");
        g.MapPost("/verify", Verify).Validate<MfaVerifyRequest>().RequireRateLimiting("auth").AllowAnonymous();
        g.MapGet("/", Status).RequireAuthorization();
        g.MapPost("/setup", Setup).RequireAuthorization();
        g.MapPost("/enable", Enable).RequireRateLimiting("auth").RequireAuthorization();
        g.MapPost("/disable", Disable).RequireRateLimiting("auth").RequireAuthorization();
        g.MapPost("/recovery-codes", Regenerate).RequireRateLimiting("auth").RequireAuthorization();
    }

    public static bool Enabled(User u) => u.TotpEnabledAt is not null && u.TotpSecretEnc is not null;

    /// <summary>Called by login once the password is right: a single-use challenge instead of a session.</summary>
    public static MfaChallengeResponse Challenge(AppDbContext db, User user, DateTimeOffset now)
    {
        var (token, hash) = SecureToken.Create();
        db.UserTokens.Add(new UserToken { Id = Guid.CreateVersion7(), UserId = user.Id, Purpose = UserTokenPurpose.MfaChallenge, TokenHash = hash, CreatedAt = now, ExpiresAt = now.Add(ChallengeLifetime) });
        return new MfaChallengeResponse(true, token);
    }

    /// <summary>Checks an authenticator code or a recovery code, consuming whichever was used.</summary>
    private static bool CheckCode(User user, SecretBox box, string code, DateTimeOffset now, out bool usedRecovery)
    {
        usedRecovery = false;
        if (user.TotpSecretEnc is null) return false;
        if (Totp.Match(box.Open(user.TotpSecretEnc), code, now, user.TotpLastStep) is { } step)
        {
            user.TotpLastStep = step;
            return true;
        }
        var hash = RecoveryCodes.Hash(code);
        if (RecoveryCodes.Normalize(code).Length == 10 && user.RecoveryCodeHashes.Contains(hash))
        {
            user.RecoveryCodeHashes = user.RecoveryCodeHashes.Where(h => h != hash).ToList();
            usedRecovery = true;
            return true;
        }
        return false;
    }

    private static async Task<IResult> Verify(MfaVerifyRequest req, AppDbContext db, TenantContext tenant, SecretBox box, AuditWriter audit,
        HttpContext http, ILoggerFactory lf, CancellationToken ct)
    {
        var log = lf.CreateLogger("ShopMint.Auth");
        var now = DateTimeOffset.UtcNow;
        var invalid = Results.Problem(statusCode: 401, type: ProblemTypes.Unauthenticated, title: "That code didn't work.",
            detail: "That code didn't work. Enter the current code from your authenticator app, or one of your recovery codes.");
        if (!SecureToken.LooksValid(req.Challenge)) return invalid;
        var hash = SecureToken.Hash(req.Challenge);
        var token = await db.UserTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.Purpose == UserTokenPurpose.MfaChallenge && t.UsedAt == null && t.ExpiresAt > now, ct);
        if (token is null)
            return Results.Problem(statusCode: 401, type: ProblemTypes.InvalidToken, title: "Your sign-in has timed out.", detail: "Enter your email and password again.");
        var user = await db.Users.FirstAsync(u => u.Id == token.UserId, ct);
        if (user.LockedUntil > now) return Results.Problem(statusCode: 401, type: ProblemTypes.Unauthenticated, title: "This account is temporarily locked.",
            detail: "Too many wrong attempts. Try again in 15 minutes.");
        if (!box.Available || !CheckCode(user, box, req.Code, now, out var usedRecovery))
        {
            user.FailedLogins++;
            if (user.FailedLogins >= AuthEndpoints.MaxFailedLogins) { user.LockedUntil = now.Add(AuthEndpoints.LockoutDuration); user.FailedLogins = 0; token.UsedAt = now; }
            await db.SaveChangesAsync(ct);
            log.LogWarning("MFA code rejected for {UserId}", user.Id);
            return invalid;
        }
        token.UsedAt = now;
        user.FailedLogins = 0;
        user.LockedUntil = null;
        user.LastLoginAt = now;
        tenant.Set(null, user.Id);
        var membership = await db.Memberships.AsNoTracking().Where(m => m.UserId == user.Id && m.Status == MembershipStatus.Active)
            .OrderBy(m => m.CreatedAt).FirstOrDefaultAsync(ct);
        if (membership is not null)
        {
            tenant.Set(membership.TenantId, user.Id);
            audit.Record(db, "auth.login", "user", user.Id, new { mfa = true });
            if (usedRecovery) audit.Record(db, "auth.recovery_code_used", "user", user.Id, new { left = user.RecoveryCodeHashes.Count });
        }
        await db.SaveChangesAsync(ct);
        await http.SignInAsync(Session.Scheme, Session.Principal(user, membership, mfa: true));
        return Results.Ok(await AuthEndpoints.BuildMe(db, user.Id, membership, ct));
    }

    private static async Task<User> CurrentAsync(AppDbContext db, HttpContext http, CancellationToken ct) =>
        await db.Users.FirstAsync(u => u.Id == http.User.GetUserId(), ct);

    private static async Task<IResult> Status(AppDbContext db, HttpContext http, CancellationToken ct)
    {
        var u = await CurrentAsync(db, http, ct);
        return Results.Ok(new MfaStatus(Enabled(u), u.RecoveryCodeHashes.Count, u.TotpEnabledAt));
    }

    private static async Task<IResult> Setup(AppDbContext db, HttpContext http, SecretBox box, CancellationToken ct)
    {
        if (!box.Available) throw new AppException(503, ProblemTypes.Internal, "Two-step verification isn't available right now.", "The platform's secrets key isn't configured.");
        var u = await CurrentAsync(db, http, ct);
        if (Enabled(u)) throw AppException.Conflict("Two-step verification is already on. Turn it off first to use a new device.");
        var secret = Totp.NewSecret();
        u.TotpPendingSecretEnc = box.Seal(secret);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new MfaSetup(secret, Totp.Uri(secret, u.Email)));
    }

    /// <summary>Finishes setup with a code from the app. Other sessions are signed out; this one is re-issued as MFA-verified.</summary>
    private static async Task<IResult> Enable(MfaCodeRequest req, AppDbContext db, HttpContext http, SecretBox box, TenantContext tenant, AuditWriter audit,
        IMemoryCache cache, CancellationToken ct)
    {
        var u = await CurrentAsync(db, http, ct);
        if (Enabled(u)) throw AppException.Conflict("Two-step verification is already on.");
        if (u.TotpPendingSecretEnc is null || !box.Available) throw AppException.Invalid("code", "Start the setup again.");
        var secret = box.Open(u.TotpPendingSecretEnc);
        var now = DateTimeOffset.UtcNow;
        if (Totp.Match(secret, req.Code, now, null) is not { } step) throw AppException.Invalid("code", "That code didn't match. Check the time on your phone and try the newest code.");
        var codes = RecoveryCodes.Generate();
        u.TotpSecretEnc = u.TotpPendingSecretEnc;
        u.TotpPendingSecretEnc = null;
        u.TotpEnabledAt = now;
        u.TotpLastStep = step;
        u.RecoveryCodeHashes = codes.Select(RecoveryCodes.Hash).ToList();
        u.SecurityStamp = Guid.NewGuid().ToString("N");
        if (tenant.TenantId is not null) audit.Record(db, "auth.mfa_enabled", "user", u.Id);
        await db.SaveChangesAsync(ct);
        await ReissueAsync(db, http, cache, u, mfa: true, ct);
        return Results.Ok(new MfaRecoveryCodes(codes));
    }

    private static async Task<IResult> Disable(MfaDisableRequest req, AppDbContext db, HttpContext http, SecretBox box, TenantContext tenant, AuditWriter audit,
        IMemoryCache cache, CancellationToken ct)
    {
        var u = await CurrentAsync(db, http, ct);
        if (!Enabled(u)) return Results.NoContent();
        if (Hasher.VerifyHashedPassword(u, u.PasswordHash, req.Password ?? "") == PasswordVerificationResult.Failed)
            throw AppException.Invalid("password", "Your password is incorrect.");
        if (!box.Available || !CheckCode(u, box, req.Code ?? "", DateTimeOffset.UtcNow, out _)) throw AppException.Invalid("code", "That code didn't work.");
        u.TotpSecretEnc = null;
        u.TotpPendingSecretEnc = null;
        u.TotpEnabledAt = null;
        u.TotpLastStep = null;
        u.RecoveryCodeHashes = [];
        u.SecurityStamp = Guid.NewGuid().ToString("N");
        if (tenant.TenantId is not null) audit.Record(db, "auth.mfa_disabled", "user", u.Id);
        await db.SaveChangesAsync(ct);
        await ReissueAsync(db, http, cache, u, mfa: false, ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Regenerate(MfaPasswordRequest req, AppDbContext db, HttpContext http, TenantContext tenant, AuditWriter audit, CancellationToken ct)
    {
        var u = await CurrentAsync(db, http, ct);
        if (!Enabled(u)) throw AppException.Conflict("Turn on two-step verification first.");
        if (Hasher.VerifyHashedPassword(u, u.PasswordHash, req.Password ?? "") == PasswordVerificationResult.Failed)
            throw AppException.Invalid("password", "Your password is incorrect.");
        var codes = RecoveryCodes.Generate();
        u.RecoveryCodeHashes = codes.Select(RecoveryCodes.Hash).ToList();
        if (tenant.TenantId is not null) audit.Record(db, "auth.recovery_codes_regenerated", "user", u.Id);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new MfaRecoveryCodes(codes));
    }

    private static async Task ReissueAsync(AppDbContext db, HttpContext http, IMemoryCache cache, User u, bool mfa, CancellationToken ct)
    {
        await Session.InvalidateAllAsync(db, cache, u.Id, ct);
        var tid = http.User.GetTenantId();
        var membership = tid is null ? null : await db.Memberships.AsNoTracking().FirstOrDefaultAsync(m => m.TenantId == tid && m.UserId == u.Id, ct);
        await http.SignInAsync(Session.Scheme, Session.Principal(u, membership, mfa));
    }
}

/// <summary>Platform operator endpoints need a session that passed two-step verification.</summary>
public sealed class RequireMfaFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        if (!ctx.HttpContext.User.HasMfa())
            throw new AppException(403, ProblemTypes.MfaRequired, "Two-step verification is required.",
                "Platform tools need two-step verification. Turn it on under Your account, then sign in again.");
        return await next(ctx);
    }
}

public static class MfaClaims
{
    public const string Mfa = "mfa";
    public static bool HasMfa(this ClaimsPrincipal p) => p.FindFirstValue(Mfa) == "1";
}

/// <summary>
/// Operator recovery for someone who lost both their authenticator and their recovery codes (runbook
/// docs/runbooks/mfa-reset.md). Run as a one-off task after verifying the person's identity out of band:
/// <c>dotnet ShopMint.Api.dll reset-mfa person@example.com</c>. Signs the person out everywhere.
/// </summary>
public static class MfaOperator
{
    public static async Task<bool> ResetAsync(PlatformDbContext db, string email, TextWriter output, CancellationToken ct = default)
    {
        var normalized = AuthEndpoints.Normalize(email);
        var user = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == normalized, ct);
        if (user is null)
        {
            output.WriteLine("No user has that email address. Nothing changed.");
            return false;
        }
        var wasOn = MfaEndpoints.Enabled(user);
        user.TotpSecretEnc = null;
        user.TotpPendingSecretEnc = null;
        user.TotpEnabledAt = null;
        user.TotpLastStep = null;
        user.RecoveryCodeHashes = [];
        user.FailedLogins = 0;
        user.LockedUntil = null;
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        await db.SaveChangesAsync(ct);
        // Structured line for the audit trail in CloudWatch (user ID only, no email address).
        output.WriteLine($"Two-step verification reset for user {user.Id} (was {(wasOn ? "on" : "off")}); all sessions signed out."
            + (user.IsPlatformAdmin ? " This is a platform admin: they must enrol again before using platform tools." : ""));
        return true;
    }
}

/// <summary>
/// <c>dotnet ShopMint.Api.dll platform-admin grant|revoke person@example.com</c>: the only way to make someone a platform
/// admin (there is no API for it). The person signs up normally first; after a grant they must turn on two-step
/// verification before any platform tool works. Signs the person out so the change applies at once.
/// </summary>
public static class PlatformAdminOperator
{
    public static async Task<bool> SetAsync(PlatformDbContext db, string email, bool grant, TextWriter output, CancellationToken ct = default)
    {
        var normalized = AuthEndpoints.Normalize(email);
        var user = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == normalized, ct);
        if (user is null)
        {
            output.WriteLine("No user has that email address. They must sign up first. Nothing changed.");
            return false;
        }
        if (user.IsPlatformAdmin == grant)
        {
            output.WriteLine($"User {user.Id} is already {(grant ? "a platform admin" : "not a platform admin")}. Nothing changed.");
            return true;
        }
        user.IsPlatformAdmin = grant;
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        await db.SaveChangesAsync(ct);
        output.WriteLine(grant
            ? $"User {user.Id} is now a platform admin and has been signed out. Platform tools open after they turn on two-step verification."
            : $"User {user.Id} is no longer a platform admin and has been signed out.");
        return true;
    }
}
