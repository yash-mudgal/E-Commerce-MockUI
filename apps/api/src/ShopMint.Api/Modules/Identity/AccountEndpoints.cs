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
using ShopMint.Api.Modules.Notifications;

namespace ShopMint.Api.Modules.Identity;

/// <summary>Random link tokens. Only the SHA-256 hash is stored; the raw token exists only in the email.</summary>
public static class SecureToken
{
    public static (string Token, string Hash) Create()
    {
        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        return (token, Hash(token));
    }

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>Cheap shape check before touching the database (43 base64url characters).</summary>
    public static bool LooksValid(string? token) =>
        token is { Length: 43 } && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public static class PasswordRules
{
    public static IRuleBuilderOptions<T, string> StrongPassword<T>(this IRuleBuilder<T, string> rule) =>
        rule.NotEmpty().MinimumLength(10).WithMessage("Use at least 10 characters.").MaximumLength(128)
            .Must(p => p is null || p.Distinct().Count() >= 4).WithMessage("Choose a less predictable password.");
}

public sealed record ForgotPasswordRequest(string Email);
public sealed record ResetPasswordRequest(string Token, string Password);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public sealed record TokenRequest(string Token);

public sealed class ForgotPasswordValidator : AbstractValidator<ForgotPasswordRequest>
{
    public ForgotPasswordValidator() => RuleFor(x => x.Email).NotEmpty().MaximumLength(254);
}

public sealed class ResetPasswordValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Password).StrongPassword();
    }
}

public sealed class ChangePasswordValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty().MaximumLength(128);
        RuleFor(x => x.NewPassword).StrongPassword()
            .NotEqual(x => x.CurrentPassword).WithMessage("Choose a password you haven't used for this account.");
    }
}

public sealed class TokenRequestValidator : AbstractValidator<TokenRequest>
{
    public TokenRequestValidator() => RuleFor(x => x.Token).NotEmpty().MaximumLength(100);
}

public static class AccountEndpoints
{
    public static readonly TimeSpan ResetLifetime = TimeSpan.FromHours(1);
    public static readonly TimeSpan VerifyLifetime = TimeSpan.FromHours(48);
    /// <summary>Minimum gap between emails of the same kind to one user, to stop inbox flooding.</summary>
    public static readonly TimeSpan ResendGap = TimeSpan.FromSeconds(60);
    private static readonly PasswordHasher<User> Hasher = new();

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth").WithTags("Account");
        g.MapPost("/password/forgot", Forgot).Validate<ForgotPasswordRequest>().RequireRateLimiting("auth").AllowAnonymous();
        g.MapPost("/password/reset", Reset).Validate<ResetPasswordRequest>().RequireRateLimiting("auth").AllowAnonymous();
        g.MapPost("/password/change", Change).Validate<ChangePasswordRequest>().RequireRateLimiting("auth").RequireAuthorization();
        g.MapPost("/email/verify", Verify).Validate<TokenRequest>().RequireRateLimiting("auth").AllowAnonymous();
        g.MapPost("/email/resend", Resend).RequireRateLimiting("auth").RequireAuthorization();
    }

    /// <summary>Always 202 with the same body, whether or not the account exists (no account enumeration).</summary>
    private static async Task<IResult> Forgot(ForgotPasswordRequest req, AppDbContext db, EmailOutbox email, ILoggerFactory lf, CancellationToken ct)
    {
        var normalized = AuthEndpoints.Normalize(req.Email);
        var user = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == normalized, ct);
        if (user is not null && !await RecentlySent(db, user.Id, UserTokenPurpose.PasswordReset, ct))
        {
            var token = Issue(db, user.Id, UserTokenPurpose.PasswordReset, ResetLifetime);
            email.PasswordReset(db, user, token);
            await db.SaveChangesAsync(ct);
            lf.CreateLogger("ShopMint.Auth").LogInformation("Password reset requested for {UserId}", user.Id);
        }
        return Results.Accepted(value: new { message = "If an account exists for that email, we've sent a link to reset the password." });
    }

    private static async Task<IResult> Reset(ResetPasswordRequest req, AppDbContext db, TenantContext tenant, IMemoryCache cache,
        ILoggerFactory lf, CancellationToken ct)
    {
        var (token, user) = await Redeem(db, req.Token, UserTokenPurpose.PasswordReset, ct);
        var now = DateTimeOffset.UtcNow;
        user.PasswordHash = Hasher.HashPassword(user, req.Password);
        user.SecurityStamp = Guid.NewGuid().ToString("N"); // signs out every existing session
        user.FailedLogins = 0;
        user.LockedUntil = null;
        user.EmailVerifiedAt ??= now; // the reset link proved control of the inbox
        token.UsedAt = now;
        await db.UserTokens.Where(t => t.UserId == user.Id && t.Purpose == UserTokenPurpose.PasswordReset && t.UsedAt == null && t.Id != token.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, now), ct);
        await db.SaveChangesAsync(ct);

        tenant.Set(null, user.Id);
        await Session.InvalidateAllAsync(db, cache, user.Id, ct);
        lf.CreateLogger("ShopMint.Auth").LogInformation("Password reset completed for {UserId}", user.Id);
        return Results.NoContent();
    }

    /// <summary>Changes the password, signs out other sessions and keeps this one signed in.</summary>
    private static async Task<IResult> Change(ChangePasswordRequest req, HttpContext http, AppDbContext db, TenantContext tenant,
        AuditWriter audit, IMemoryCache cache, CancellationToken ct)
    {
        var userId = http.User.GetUserId()!.Value;
        var user = await db.Users.FirstAsync(u => u.Id == userId, ct);
        if (Hasher.VerifyHashedPassword(user, user.PasswordHash, req.CurrentPassword) == PasswordVerificationResult.Failed)
            throw AppException.Invalid("currentPassword", "Your current password is incorrect.");
        user.PasswordHash = Hasher.HashPassword(user, req.NewPassword);
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        if (tenant.TenantId is not null) audit.Record(db, "auth.password_changed", "user", user.Id);
        await db.SaveChangesAsync(ct);

        await Session.InvalidateAllAsync(db, cache, user.Id, ct);
        Membership? membership = tenant.TenantId is { } tid
            ? await db.Memberships.AsNoTracking().FirstOrDefaultAsync(m => m.TenantId == tid && m.UserId == userId, ct)
            : null;
        await http.SignInAsync(Session.Scheme, Session.Principal(user, membership));
        return Results.NoContent();
    }

    private static async Task<IResult> Verify(TokenRequest req, AppDbContext db, CancellationToken ct)
    {
        var (token, user) = await Redeem(db, req.Token, UserTokenPurpose.EmailVerification, ct);
        var now = DateTimeOffset.UtcNow;
        user.EmailVerifiedAt ??= now;
        token.UsedAt = now;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Resend(HttpContext http, AppDbContext db, EmailOutbox email, CancellationToken ct)
    {
        var userId = http.User.GetUserId()!.Value;
        var user = await db.Users.FirstAsync(u => u.Id == userId, ct);
        if (user.EmailVerifiedAt is not null)
            throw AppException.Conflict("Your email address is already confirmed.");
        if (await RecentlySent(db, user.Id, UserTokenPurpose.EmailVerification, ct))
            throw new AppException(429, ProblemTypes.RateLimited, "Please wait a minute before requesting another email.");
        SendVerification(db, email, user);
        await db.SaveChangesAsync(ct);
        return Results.Accepted();
    }

    /// <summary>Queues a verification email in the caller's unit of work.</summary>
    public static void SendVerification(AppDbContext db, EmailOutbox email, User user) =>
        email.VerifyEmail(db, user, Issue(db, user.Id, UserTokenPurpose.EmailVerification, VerifyLifetime));

    private static string Issue(AppDbContext db, Guid userId, UserTokenPurpose purpose, TimeSpan lifetime)
    {
        var (token, hash) = SecureToken.Create();
        var now = DateTimeOffset.UtcNow;
        db.UserTokens.Add(new UserToken { Id = Guid.CreateVersion7(), UserId = userId, Purpose = purpose, TokenHash = hash, CreatedAt = now, ExpiresAt = now.Add(lifetime) });
        return token;
    }

    private static Task<bool> RecentlySent(AppDbContext db, Guid userId, UserTokenPurpose purpose, CancellationToken ct)
    {
        var since = DateTimeOffset.UtcNow - ResendGap;
        return db.UserTokens.AnyAsync(t => t.UserId == userId && t.Purpose == purpose && t.CreatedAt > since, ct);
    }

    /// <summary>Finds an unused, unexpired token. Every failure gives the same answer so tokens can't be probed.</summary>
    private static async Task<(UserToken Token, User User)> Redeem(AppDbContext db, string raw, UserTokenPurpose purpose, CancellationToken ct)
    {
        var invalid = new AppException(400, ProblemTypes.InvalidToken, "This link is invalid or has expired.",
            purpose == UserTokenPurpose.PasswordReset ? "Request a new password reset email and try again." : "Request a new confirmation email and try again.");
        if (!SecureToken.LooksValid(raw)) throw invalid;
        var hash = SecureToken.Hash(raw);
        var now = DateTimeOffset.UtcNow;
        var token = await db.UserTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.Purpose == purpose && t.UsedAt == null && t.ExpiresAt > now, ct)
            ?? throw invalid;
        var user = await db.Users.FirstAsync(u => u.Id == token.UserId, ct);
        return (token, user);
    }
}
