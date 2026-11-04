using FluentValidation;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Notifications;
using ShopMint.Api.Modules.Platform;

namespace ShopMint.Api.Modules.Identity;

public sealed record SignupRequest(string Name, string Email, string Password, string StoreName, string Subdomain);
public sealed record LoginRequest(string Email, string Password);
public sealed record SwitchTenantRequest(Guid TenantId);

public sealed record MeResponse(MeUser User, MeTenant? Tenant, string? Role, IReadOnlyCollection<string> Permissions,
    IReadOnlyList<MeMembership> Memberships);
public sealed record MeUser(Guid Id, string Name, string Email, bool EmailVerified, bool IsPlatformAdmin, bool MfaEnabled = false);
public sealed record MeTenant(Guid Id, string Name, string Slug, string Host, string Status, string Plan, DateTimeOffset? TrialEndsAt, bool IsLive,
    DateTimeOffset? GraceEndsAt = null, string? SuspensionReason = null);
public sealed record MeMembership(Guid TenantId, string TenantName, string Role);

public sealed class SignupValidator : AbstractValidator<SignupRequest>
{
    public static readonly HashSet<string> Reserved =
    [
        "app", "www", "api", "admin", "platform", "mail", "static", "cdn", "assets", "media", "shop", "store",
        "stores", "help", "support", "docs", "status", "billing", "auth", "login", "signup", "shopmint",
        // Infrastructure names: the load balancer origin and the staging environment's domain.
        "origin", "staging", "internal",
    ];

    public SignupValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
        RuleFor(x => x.Password).StrongPassword();
        RuleFor(x => x.StoreName).NotEmpty().MinimumLength(2).MaximumLength(80);
        RuleFor(x => x.Subdomain).NotEmpty().Length(3, 30)
            .Matches(Slug.Pattern()).WithMessage("Use lowercase letters, numbers and single hyphens.")
            .Must(s => !Reserved.Contains(s ?? "")).WithMessage("This store address is reserved.");
    }
}

public sealed class LoginValidator : AbstractValidator<LoginRequest>
{
    public LoginValidator()
    {
        RuleFor(x => x.Email).NotEmpty().MaximumLength(254);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(128);
    }
}

public static class AuthEndpoints
{
    public const int MaxFailedLogins = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);
    private static readonly PasswordHasher<User> Hasher = new();
    // Used to keep timing similar for unknown emails (mitigates account enumeration).
    private static readonly string DummyHash = Hasher.HashPassword(new User(), "not-a-real-password-" + Guid.NewGuid());

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth").WithTags("Auth");
        g.MapPost("/signup", Signup).Validate<SignupRequest>().RequireRateLimiting("auth").AllowAnonymous();
        g.MapPost("/login", Login).Validate<LoginRequest>().RequireRateLimiting("auth").AllowAnonymous();
        g.MapPost("/logout", async (HttpContext http) => { await http.SignOutAsync(Session.Scheme); return Results.NoContent(); });
        g.MapGet("/me", Me).RequireAuthorization();
        g.MapPost("/switch-tenant", SwitchTenant).RequireAuthorization();
    }

    public static string Normalize(string email) => email.Trim().ToUpperInvariant();

    private static async Task<IResult> Signup(SignupRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit,
        EmailOutbox email, IConfiguration config, HttpContext http, CancellationToken ct)
    {
        var normalized = Normalize(req.Email);
        if (await db.Users.AnyAsync(u => u.NormalizedEmail == normalized, ct))
            throw AppException.Conflict("An account with this email already exists. Sign in instead.");

        var host = $"{req.Subdomain}.{config["Platform:StorefrontDomain"] ?? "shopmint.in"}";
        if (await db.TenantDomains.AnyAsync(d => d.Host == host, ct))
            throw AppException.Invalid("subdomain", "This store address is already taken.");

        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.CreateVersion7(), Email = req.Email.Trim(), NormalizedEmail = normalized, Name = req.Name.Trim(),
            CreatedAt = now, LastLoginAt = now,
        };
        user.PasswordHash = Hasher.HashPassword(user, req.Password);
        var t = new Tenant
        {
            Id = Guid.CreateVersion7(), Slug = req.Subdomain, Name = req.StoreName.Trim(), Status = TenantStatus.Trialing,
            PlanCode = Plans.TrialCode, TrialEndsAt = now.AddDays(Plans.TrialDays), CreatedAt = now, UpdatedAt = now,
        };
        t.Domains.Add(new TenantDomain { Id = Guid.CreateVersion7(), Host = host, Kind = DomainKind.Subdomain, VerifiedAt = now, CreatedAt = now });
        var membership = new Membership { Id = Guid.CreateVersion7(), TenantId = t.Id, UserId = user.Id, Role = MemberRole.Owner, CreatedAt = now };

        // RLS WITH CHECK requires the new tenant to be the current one before the connection opens.
        tenant.Set(t.Id, user.Id, t.Status);
        db.Users.Add(user);
        db.Tenants.Add(t);
        db.Memberships.Add(membership);
        db.Locations.Add(new Location { Id = Guid.CreateVersion7(), Name = "Primary warehouse", Code = "MAIN", IsDefault = true, CreatedAt = now });
        audit.Record(db, "tenant.created", "tenant", t.Id, new { t.Slug, plan = t.PlanCode });
        AccountEndpoints.SendVerification(db, email, user);
        await db.SaveChangesAsync(ct);

        await http.SignInAsync(Session.Scheme, Session.Principal(user, membership));
        return Results.Created("/api/auth/me", await BuildMe(db, user.Id, membership, ct));
    }

    private static async Task<IResult> Login(LoginRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit,
        HttpContext http, ILoggerFactory lf, CancellationToken ct)
    {
        var log = lf.CreateLogger("ShopMint.Auth");
        var normalized = Normalize(req.Email);
        var user = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == normalized, ct);
        var now = DateTimeOffset.UtcNow;

        if (user is null)
        {
            Hasher.VerifyHashedPassword(new User(), DummyHash, req.Password);
            log.LogWarning("Login failed: unknown account");
            return InvalidCredentials();
        }
        if (user.LockedUntil > now)
        {
            log.LogWarning("Login rejected: account {UserId} locked until {Until}", user.Id, user.LockedUntil);
            return InvalidCredentials();
        }

        var result = Hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password);
        if (result == PasswordVerificationResult.Failed)
        {
            user.FailedLogins++;
            if (user.FailedLogins >= MaxFailedLogins)
            {
                user.LockedUntil = now.Add(LockoutDuration);
                user.FailedLogins = 0;
                log.LogWarning("Account {UserId} locked after repeated failures", user.Id);
            }
            await db.SaveChangesAsync(ct);
            log.LogWarning("Login failed: bad password for {UserId}", user.Id);
            return InvalidCredentials();
        }

        if (result == PasswordVerificationResult.SuccessRehashNeeded)
            user.PasswordHash = Hasher.HashPassword(user, req.Password);
        // With two-step verification the password alone doesn't sign in, and failed counts aren't reset until the
        // code is right (otherwise a known password would allow unlimited code guesses).
        if (MfaEndpoints.Enabled(user))
        {
            var challenge = MfaEndpoints.Challenge(db, user, now);
            await db.SaveChangesAsync(ct);
            return Results.Ok(challenge);
        }
        user.FailedLogins = 0;
        user.LockedUntil = null;
        user.LastLoginAt = now;

        tenant.Set(null, user.Id);
        var membership = await db.Memberships.AsNoTracking()
            .Where(m => m.UserId == user.Id && m.Status == MembershipStatus.Active)
            .OrderBy(m => m.CreatedAt).FirstOrDefaultAsync(ct);
        if (membership is not null)
        {
            tenant.Set(membership.TenantId, user.Id);
            audit.Record(db, "auth.login", "user", user.Id);
        }
        await db.SaveChangesAsync(ct);

        await http.SignInAsync(Session.Scheme, Session.Principal(user, membership));
        return Results.Ok(await BuildMe(db, user.Id, membership, ct));
    }

    private static IResult InvalidCredentials() =>
        Results.Problem(statusCode: 401, type: ProblemTypes.Unauthenticated, title: "Invalid email or password.",
            detail: "Check your details and try again. After several failed attempts the account is locked for 15 minutes.");

    private static async Task<IResult> Me(HttpContext http, AppDbContext db, CancellationToken ct)
    {
        var userId = http.User.GetUserId()!.Value;
        var tid = http.User.GetTenantId();
        Membership? m = tid is null ? null : await db.Memberships.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tid && x.UserId == userId, ct);
        return Results.Ok(await BuildMe(db, userId, m, ct));
    }

    private static async Task<IResult> SwitchTenant(SwitchTenantRequest req, HttpContext http, AppDbContext db,
        TenantContext tenant, CancellationToken ct)
    {
        var userId = http.User.GetUserId()!.Value;
        tenant.Set(req.TenantId, userId);
        var membership = await db.Memberships.AsNoTracking()
            .FirstOrDefaultAsync(m => m.TenantId == req.TenantId && m.UserId == userId && m.Status == MembershipStatus.Active, ct)
            ?? throw AppException.NotFound("Store");
        var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId, ct);
        await http.SignInAsync(Session.Scheme, Session.Principal(user, membership, http.User.HasMfa()));
        return Results.Ok(await BuildMe(db, userId, membership, ct));
    }

    internal static async Task<MeResponse> BuildMe(AppDbContext db, Guid userId, Membership? current, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId, ct);
        var memberships = await db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.Status == MembershipStatus.Active)
            .OrderBy(m => m.CreatedAt)
            .Select(m => new MeMembership(m.TenantId, m.Tenant!.Name, m.Role.ToString()))
            .ToListAsync(ct);

        MeTenant? tenant = null;
        if (current is not null)
        {
            tenant = await db.Tenants.AsNoTracking().Where(t => t.Id == current.TenantId)
                .Select(t => new MeTenant(t.Id, t.Name, t.Slug,
                    t.Domains.OrderBy(d => d.Kind).Select(d => d.Host).FirstOrDefault() ?? "",
                    t.Status.ToString(), t.PlanCode, t.TrialEndsAt, t.LaunchedAt != null, t.GraceEndsAt,
                    t.SuspensionReason == null ? null : t.SuspensionReason.ToString()))
                .FirstOrDefaultAsync(ct);
        }

        return new MeResponse(new MeUser(user.Id, user.Name, user.Email, user.EmailVerifiedAt != null, user.IsPlatformAdmin, MfaEndpoints.Enabled(user)), tenant,
            current?.Role.ToString(), current is null ? [] : Permissions.For(current.Role), memberships);
    }
}
