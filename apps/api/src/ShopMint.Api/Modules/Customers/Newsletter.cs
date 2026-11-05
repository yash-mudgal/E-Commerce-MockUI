using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Notifications;
using ShopMint.Api.Modules.Reports;

namespace ShopMint.Api.Modules.Customers;

public enum NewsletterStatus { Pending, Subscribed, Unsubscribed }

/// <summary>
/// Someone who asked for a store's newsletter. Double opt-in: the address is only "Subscribed" after its owner follows
/// the confirmation link (consent recorded with its time, as the DPDP Act expects). Every email carries an unsubscribe link.
/// </summary>
public sealed class NewsletterSubscriber : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Email { get; set; } = "";
    public string NormalizedEmail { get; set; } = "";
    public NewsletterStatus Status { get; set; }
    /// <summary>Hash of the token in confirmation and unsubscribe links (one per subscriber, rotated on each sign-up).</summary>
    public string TokenHash { get; set; } = "";
    public DateTimeOffset? ConfirmedAt { get; set; }
    public DateTimeOffset? UnsubscribedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed record NewsletterSignupRequest(string Email);
public sealed record NewsletterTokenRequest(string Token);
public sealed record SubscriberDto(string Email, string Status, DateTimeOffset? ConfirmedAt, DateTimeOffset CreatedAt);

public sealed class NewsletterSignupValidator : AbstractValidator<NewsletterSignupRequest>
{
    public NewsletterSignupValidator() => RuleFor(x => x.Email).NotEmpty().EmailAddress().WithMessage("Enter a valid email address.").MaximumLength(254);
}

public sealed class NewsletterTokenValidator : AbstractValidator<NewsletterTokenRequest>
{
    public NewsletterTokenValidator() => RuleFor(x => x.Token).NotEmpty().MaximumLength(100);
}

public static class Newsletter
{
    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static void Map(RouteGroupBuilder storefront, RouteGroupBuilder admin)
    {
        var s = storefront.MapGroup("/newsletter").WithTags("Newsletter");
        s.MapPost("/", Signup).Validate<NewsletterSignupRequest>().RequireRateLimiting("auth");
        s.MapPost("/confirm", Confirm).Validate<NewsletterTokenRequest>().RequireRateLimiting("auth");
        s.MapPost("/unsubscribe", Unsubscribe).Validate<NewsletterTokenRequest>().RequireRateLimiting("auth");

        var a = admin.MapGroup("/newsletter").WithTags("Newsletter");
        a.MapGet("/", List).RequirePermission(Permissions.OrdersRead);
        a.MapGet("/subscribers.csv", Export).RequirePermission(Permissions.OrdersRead);
    }

    /// <summary>
    /// Always answers the same way (202), whether the address is new, pending, subscribed or unsubscribed, so the form
    /// can't be used to find out who subscribes. A confirmation email goes out unless the address is already subscribed.
    /// </summary>
    private static async Task<IResult> Signup(NewsletterSignupRequest req, AppDbContext db, TenantContext tenant, EmailOutbox email, IConfiguration config, CancellationToken ct)
    {
        var normalized = req.Email.Trim().ToUpperInvariant();
        var now = DateTimeOffset.UtcNow;
        var sub = await db.NewsletterSubscribers.FirstOrDefaultAsync(x => x.NormalizedEmail == normalized, ct);
        if (sub?.Status == NewsletterStatus.Subscribed) return Results.Accepted();
        // Don't re-send to a pending address more than once every 10 minutes.
        if (sub is { Status: NewsletterStatus.Pending } && sub.UpdatedAt > now.AddMinutes(-10)) return Results.Accepted();
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));
        if (sub is null)
        {
            sub = new NewsletterSubscriber { Id = Guid.CreateVersion7(), TenantId = tenant.TenantId!.Value, Email = req.Email.Trim(), NormalizedEmail = normalized, CreatedAt = now };
            db.NewsletterSubscribers.Add(sub);
        }
        sub.Status = NewsletterStatus.Pending;
        sub.TokenHash = Hash(token);
        sub.UpdatedAt = now;
        var store = await db.Tenants.AsNoTracking().Where(t => t.Id == tenant.TenantId)
            .Select(t => new { t.Name, Host = t.Domains.OrderBy(d => d.Kind).Select(d => d.Host).FirstOrDefault() }).FirstAsync(ct);
        var url = CustomerEndpoints.StorefrontUrl(config, store.Host ?? "");
        email.NewsletterConfirm(db, sub.TenantId, store.Name, sub.Email, $"{url}/newsletter/confirm?token={token}", $"{url}/newsletter/unsubscribe?token={token}");
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { /* the same address signed up twice at once: one row wins */ }
        return Results.Accepted();
    }

    private static async Task<IResult> Confirm(NewsletterTokenRequest req, AppDbContext db, CancellationToken ct)
    {
        var sub = await db.NewsletterSubscribers.FirstOrDefaultAsync(x => x.TokenHash == Hash(req.Token), ct)
            ?? throw AppException.Invalid("token", "This link has expired or was replaced by a newer one. Sign up again to get a new link.");
        if (sub.Status != NewsletterStatus.Subscribed)
        {
            sub.Status = NewsletterStatus.Subscribed;
            sub.ConfirmedAt = DateTimeOffset.UtcNow;
            sub.UnsubscribedAt = null;
            sub.UpdatedAt = sub.ConfirmedAt.Value;
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(new { status = sub.Status.ToString() });
    }

    private static async Task<IResult> Unsubscribe(NewsletterTokenRequest req, AppDbContext db, CancellationToken ct)
    {
        var sub = await db.NewsletterSubscribers.FirstOrDefaultAsync(x => x.TokenHash == Hash(req.Token), ct)
            ?? throw AppException.Invalid("token", "This link isn't valid any more.");
        if (sub.Status != NewsletterStatus.Unsubscribed)
        {
            sub.Status = NewsletterStatus.Unsubscribed;
            sub.UnsubscribedAt = DateTimeOffset.UtcNow;
            sub.UpdatedAt = sub.UnsubscribedAt.Value;
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(new { status = sub.Status.ToString() });
    }

    private static async Task<IResult> List([FromQuery] string? status, [FromQuery] int? page, AppDbContext db, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, 50);
        var q = db.NewsletterSubscribers.AsNoTracking();
        if (!string.IsNullOrEmpty(status))
        {
            if (!Enum.TryParse<NewsletterStatus>(status, true, out var st)) throw AppException.Invalid("status", "Unknown status.");
            q = q.Where(x => x.Status == st);
        }
        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(x => x.UpdatedAt).Skip((pg - 1) * size).Take(size)
            .Select(x => new SubscriberDto(x.Email, x.Status.ToString(), x.ConfirmedAt, x.CreatedAt)).ToListAsync(ct);
        var counts = await db.NewsletterSubscribers.AsNoTracking().GroupBy(x => x.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        int Of(NewsletterStatus s) => counts.FirstOrDefault(c => c.Key == s)?.Count ?? 0;
        return Results.Ok(new { items, page = pg, pageSize = size, totalCount = total,
            counts = new { subscribed = Of(NewsletterStatus.Subscribed), pending = Of(NewsletterStatus.Pending), unsubscribed = Of(NewsletterStatus.Unsubscribed) } });
    }

    /// <summary>Confirmed subscribers only (the people who consented), for the store's own email tool.</summary>
    private static async Task<IResult> Export(AppDbContext db, CancellationToken ct)
    {
        var rows = await db.NewsletterSubscribers.AsNoTracking().Where(x => x.Status == NewsletterStatus.Subscribed).OrderBy(x => x.ConfirmedAt)
            .Select(x => new { x.Email, x.ConfirmedAt }).ToListAsync(ct);
        var sb = new StringBuilder("email,confirmed_at\n");
        foreach (var r in rows) sb.Append(Csv.Text(r.Email)).Append(',').Append(Csv.Date(r.ConfirmedAt)).Append('\n');
        return Csv.File("newsletter-subscribers.csv", sb);
    }
}
