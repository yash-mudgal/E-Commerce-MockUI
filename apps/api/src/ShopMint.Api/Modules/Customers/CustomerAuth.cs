using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;

namespace ShopMint.Api.Modules.Customers;

/// <summary>
/// Shopper sessions: a separate cookie scheme from merchant sessions, so a shopper cookie can never authorise an
/// admin endpoint (admin endpoints only accept the merchant scheme) and vice versa. Cookies are host-only, so a
/// session set on one store's domain is never sent to another; the API also checks the session's store matches the
/// store resolved from the request host.
/// </summary>
public static class CustomerAuth
{
    public const string Scheme = "customer";
    public const string CustomerIdClaim = "cid";
    public const string TenantIdClaim = "ctid";
    public const string StampClaim = "cstamp";

    public static IServiceCollection AddCustomerSessions(this IServiceCollection services, IConfiguration config, IHostEnvironment env)
    {
        services.AddAuthentication().AddCookie(Scheme, o =>
        {
            o.Cookie.Name = config["Auth:CustomerCookieName"] ?? (env.IsDevelopment() ? "sm_c" : "__Host-sm_c");
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Lax;
            o.Cookie.SecurePolicy = env.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            o.Cookie.Path = "/";
            o.ExpireTimeSpan = TimeSpan.FromDays(30);
            o.SlidingExpiration = true;
            o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
            o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
        });
        services.AddScoped<CustomerSession>();
        return services;
    }

    public static ClaimsPrincipal Principal(Customer c) => new(new ClaimsIdentity(
    [
        new Claim(CustomerIdClaim, c.Id.ToString()),
        new Claim(TenantIdClaim, c.TenantId.ToString()),
        new Claim(StampClaim, c.SecurityStamp),
    ], Scheme));
}

/// <summary>
/// The signed-in shopper for this request, if any. Valid only when the cookie's store is the store resolved from the
/// host and the customer's security stamp still matches (a password reset or change signs out other sessions).
/// </summary>
public sealed class CustomerSession(IHttpContextAccessor accessor, AppDbContext db, TenantContext tenant)
{
    private bool _loaded;
    private Customer? _customer;

    private HttpContext Http => accessor.HttpContext ?? throw new InvalidOperationException("No HTTP context.");

    public async Task<Customer?> CurrentAsync(CancellationToken ct)
    {
        if (_loaded) return _customer;
        _loaded = true;
        var result = await Http.AuthenticateAsync(CustomerAuth.Scheme);
        if (!result.Succeeded || tenant.TenantId is not { } tid) return null;
        var p = result.Principal!;
        if (!Guid.TryParse(p.FindFirstValue(CustomerAuth.TenantIdClaim), out var claimTid) || claimTid != tid) return null;
        if (!Guid.TryParse(p.FindFirstValue(CustomerAuth.CustomerIdClaim), out var cid)) return null;
        // The tenant query filter (and RLS) means a customer of another store can't be found here.
        var c = await db.Customers.FirstOrDefaultAsync(x => x.Id == cid, ct);
        if (c is null || c.SecurityStamp != p.FindFirstValue(CustomerAuth.StampClaim)) return null;
        return _customer = c;
    }

    public async Task<Customer> RequireAsync(CancellationToken ct) =>
        await CurrentAsync(ct) ?? throw new AppException(401, ProblemTypes.Unauthenticated, "Please sign in to continue.");

    public async Task SignInAsync(Customer c)
    {
        await Http.SignInAsync(CustomerAuth.Scheme, CustomerAuth.Principal(c));
        _customer = c;
        _loaded = true;
    }

    public async Task SignOutAsync()
    {
        await Http.SignOutAsync(CustomerAuth.Scheme);
        _customer = null;
        _loaded = true;
    }
}
