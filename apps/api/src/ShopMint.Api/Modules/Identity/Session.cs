using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;

namespace ShopMint.Api.Modules.Identity;

public static class Session
{
    public const string Scheme = "merchant";
    public const string TenantMemberPolicy = "tenant-member";
    public const string PlatformAdminPolicy = "platform-admin";
    public static string PolicyFor(string permission) => "perm:" + permission;

    public static ClaimsPrincipal Principal(User user, Membership? membership)
    {
        var claims = new List<Claim>
        {
            new(SessionClaims.UserId, user.Id.ToString()),
            new(SessionClaims.SecurityStamp, user.SecurityStamp),
        };
        if (user.IsPlatformAdmin) claims.Add(new(SessionClaims.PlatformAdmin, "1"));
        if (membership is not null)
        {
            claims.Add(new(SessionClaims.TenantId, membership.TenantId.ToString()));
            claims.Add(new(SessionClaims.Role, membership.Role.ToString()));
        }
        return new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme, SessionClaims.UserId, SessionClaims.Role));
    }

    public static IServiceCollection AddMerchantSessions(this IServiceCollection services, IConfiguration config, IHostEnvironment env)
    {
        services.AddAuthentication(Scheme).AddCookie(Scheme, o =>
        {
            // __Host- prefix requires Secure + Path=/ + no Domain: the cookie can't be set or read by subdomains,
            // which matters because merchant storefronts live on subdomains.
            o.Cookie.Name = config["Auth:CookieName"] ?? (env.IsDevelopment() ? "sm_session" : "__Host-sm_session");
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Lax;
            o.Cookie.SecurePolicy = env.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            o.Cookie.Path = "/";
            o.ExpireTimeSpan = TimeSpan.FromHours(12);
            o.SlidingExpiration = true;
            o.Events.OnRedirectToLogin = ctx => Problem(ctx.HttpContext, 401, ProblemTypes.Unauthenticated, "Authentication is required.");
            o.Events.OnRedirectToAccessDenied = ctx => Problem(ctx.HttpContext, 403, ProblemTypes.Forbidden, "You do not have permission to perform this action.");
            o.Events.OnValidatePrincipal = ValidateAsync;
        });

        services.AddAuthorization(o =>
        {
            o.AddPolicy(TenantMemberPolicy, p => p.RequireAuthenticatedUser().RequireClaim(SessionClaims.TenantId));
            o.AddPolicy(PlatformAdminPolicy, p => p.RequireAuthenticatedUser().RequireClaim(SessionClaims.PlatformAdmin, "1"));
            foreach (var perm in Permissions.All)
                o.AddPolicy(PolicyFor(perm), p => p.RequireAuthenticatedUser().RequireClaim(SessionClaims.TenantId)
                    .RequireAssertion(ctx => ctx.User.GetRole() is { } r && Permissions.Has(r, perm)));
        });
        return services;
    }

    public static TBuilder RequirePermission<TBuilder>(this TBuilder b, string permission) where TBuilder : IEndpointConventionBuilder =>
        b.RequireAuthorization(PolicyFor(permission));

    private static async Task Problem(HttpContext http, int status, string type, string title)
    {
        http.Response.StatusCode = status;
        await http.RequestServices.GetRequiredService<IProblemDetailsService>()
            .WriteAsync(new ProblemDetailsContext { HttpContext = http, ProblemDetails = new() { Status = status, Type = type, Title = title } });
    }

    private static (string, Guid?, Guid?) CacheKey(Guid? userId, Guid? tenantId) => ("session", userId, tenantId);

    /// <summary>
    /// Drops the cached session state for a user in one store, so a role change or removal takes effect on the
    /// next request on this instance. Other instances pick it up within Auth:SessionCacheSeconds.
    /// </summary>
    public static void Invalidate(IMemoryCache cache, Guid userId, Guid? tenantId) => cache.Remove(CacheKey(userId, tenantId));

    /// <summary>Drops cached session state of every member of a store (after its status or plan changes), on this instance.</summary>
    public static async Task InvalidateTenantAsync(AppDbContext db, IMemoryCache cache, Guid tenantId, CancellationToken ct)
    {
        foreach (var uid in await db.Memberships.AsNoTracking().Where(m => m.TenantId == tenantId).Select(m => m.UserId).ToListAsync(ct))
            Invalidate(cache, uid, tenantId);
    }

    /// <summary>Drops cached session state for every store the user belongs to (after a password or stamp change).</summary>
    public static async Task InvalidateAllAsync(AppDbContext db, IMemoryCache cache, Guid userId, CancellationToken ct)
    {
        Invalidate(cache, userId, null);
        foreach (var tid in await db.Memberships.AsNoTracking().Where(m => m.UserId == userId).Select(m => m.TenantId).ToListAsync(ct))
            Invalidate(cache, userId, tid);
    }

    private sealed record SessionState(string Stamp, bool UserActive, MemberRole? Role, TenantStatus? TenantStatus);

    /// <summary>
    /// Runs on every authenticated request. It re-checks that the user still exists, the security stamp matches,
    /// and the membership in the session's tenant is still active with the same role. Results are cached for a
    /// short time. On success it populates the request's <see cref="TenantContext"/>.
    /// </summary>
    private static async Task ValidateAsync(CookieValidatePrincipalContext ctx)
    {
        var principal = ctx.Principal!;
        var userId = principal.GetUserId();
        if (userId is null) { await Reject(ctx); return; }
        var tenantId = principal.GetTenantId();
        var sp = ctx.HttpContext.RequestServices;
        var cache = sp.GetRequiredService<IMemoryCache>();
        var tenantCtx = sp.GetRequiredService<TenantContext>();
        var ttl = TimeSpan.FromSeconds(sp.GetRequiredService<IConfiguration>().GetValue("Auth:SessionCacheSeconds", 30));

        var state = ttl > TimeSpan.Zero
            ? await cache.GetOrCreateAsync(CacheKey(userId, tenantId), entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = ttl;
                return Load();
            })
            : await Load();

        var stampOk = state!.UserActive && state.Stamp == principal.FindFirst(SessionClaims.SecurityStamp)?.Value;
        var memberOk = tenantId is null || (state.Role is not null && state.Role == principal.GetRole());
        if (!stampOk || !memberOk) { await Reject(ctx); return; }
        tenantCtx.Set(tenantId, userId, state.TenantStatus);

        async Task<SessionState> Load()
        {
            tenantCtx.Set(tenantId, userId);
            var db = sp.GetRequiredService<AppDbContext>();
            var user = await db.Users.AsNoTracking().Where(u => u.Id == userId)
                .Select(u => new { u.SecurityStamp }).FirstOrDefaultAsync();
            if (user is null) return new SessionState("", false, null, null);
            if (tenantId is null) return new SessionState(user.SecurityStamp, true, null, null);
            var m = await db.Memberships.AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.UserId == userId && x.Status == MembershipStatus.Active)
                .Select(x => new { x.Role, x.Tenant!.Status }).FirstOrDefaultAsync();
            return new SessionState(user.SecurityStamp, true, m?.Role, m?.Status);
        }
    }

    private static async Task Reject(CookieValidatePrincipalContext ctx)
    {
        ctx.RejectPrincipal();
        await ctx.HttpContext.SignOutAsync(Scheme);
    }
}

/// <summary>Admin route-group filter: requires a resolved tenant and blocks writes while it is suspended.</summary>
public sealed class AdminTenantFilter(TenantContext tenant) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        if (tenant.TenantId is null)
            throw AppException.Forbidden("Select a store to continue.");
        // A suspended or cancelled store is read-only, except billing: paying is how the owner restores it.
        if (tenant.TenantStatus is TenantStatus.Suspended or TenantStatus.Cancelled && !HttpMethods.IsGet(ctx.HttpContext.Request.Method)
            && !ctx.HttpContext.Request.Path.StartsWithSegments(Billing.BillingEndpoints.Prefix, StringComparison.OrdinalIgnoreCase))
            throw AppException.Forbidden("This store is closed and read-only. Choose a plan under Billing, or contact support, to reopen it.",
                ProblemTypes.TenantSuspended);
        return await next(ctx);
    }
}
