using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Platform;

public sealed record PlatformTenantRow(Guid Id, string Name, string Slug, string? Host, string Status, string Plan,
    string? OwnerEmail, int Products, DateTimeOffset CreatedAt, DateTimeOffset? TrialEndsAt, DateTimeOffset? GraceEndsAt, string? SuspensionReason,
    string? Billing);
public sealed record StatusChangeRequest(string? Reason);

/// <summary>Cross-tenant operator console. Uses <see cref="PlatformDbContext"/> (BYPASSRLS) and requires a platform admin.</summary>
public static class PlatformEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/platform").WithTags("Platform").RequireAuthorization(Session.PlatformAdminPolicy);
        g.MapGet("/tenants", List);
        g.MapPost("/tenants/{id:guid}/suspend", (Guid id, StatusChangeRequest? req, PlatformDbContext db, IServiceScopeFactory scopes, HttpContext http, CancellationToken ct)
            => Change(id, true, req?.Reason, db, scopes, http, ct));
        g.MapPost("/tenants/{id:guid}/reactivate", (Guid id, StatusChangeRequest? req, PlatformDbContext db, IServiceScopeFactory scopes, HttpContext http, CancellationToken ct)
            => Change(id, false, req?.Reason, db, scopes, http, ct));
        Billing.PlatformBillingEndpoints.Map(g);
    }

    private static async Task<IResult> List(PlatformDbContext db, [FromQuery] string? q, [FromQuery] string? status,
        [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, pageSize);
        var query = db.Tenants.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = $"%{Catalog.CatalogEndpoints.EscapeLike(q.Trim())}%";
            query = query.Where(t => EF.Functions.ILike(t.Name, term, "\\") || EF.Functions.ILike(t.Slug, term, "\\"));
        }
        if (!string.IsNullOrEmpty(status))
        {
            if (!Enum.TryParse<TenantStatus>(status, true, out var st)) throw AppException.Invalid("status", "Unknown status.");
            query = query.Where(t => t.Status == st);
        }
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(t => t.CreatedAt).Skip((pg - 1) * size).Take(size)
            .Select(t => new PlatformTenantRow(t.Id, t.Name, t.Slug, t.Domains.Select(d => d.Host).FirstOrDefault(),
                t.Status.ToString(), t.PlanCode,
                db.Memberships.Where(m => m.TenantId == t.Id && m.Role == MemberRole.Owner).Select(m => m.User!.Email).FirstOrDefault(),
                db.Products.Count(p => p.TenantId == t.Id), t.CreatedAt, t.TrialEndsAt, t.GraceEndsAt, t.SuspensionReason.ToString(),
                db.Subscriptions.Where(s => s.TenantId == t.Id && (s.Status == Billing.SubscriptionStatus.Active || s.Status == Billing.SubscriptionStatus.Authenticated
                    || s.Status == Billing.SubscriptionStatus.Pending || s.Status == Billing.SubscriptionStatus.Halted))
                    .OrderByDescending(s => s.CreatedAt).Select(s => s.Gateway + ":" + s.Status.ToString()).FirstOrDefault()))
            .ToListAsync(ct);
        return Results.Ok(new Paged<PlatformTenantRow>(items, pg, size, total));
    }

    /// <summary>
    /// Platform suspension sits on top of billing: suspending marks the reason as "platform" (paying can't lift it);
    /// reactivating removes that reason and lets the billing state decide (trial, active, past due…), rather than forcing Active.
    /// </summary>
    private static async Task<IResult> Change(Guid id, bool suspend, string? reason, PlatformDbContext db, IServiceScopeFactory scopes,
        HttpContext http, CancellationToken ct)
    {
        if (!await db.Tenants.AnyAsync(x => x.Id == id, ct)) throw AppException.NotFound("Tenant");
        await Billing.BillingScope.RunAsync(scopes, id, s => s.SetPlatformSuspensionAsync(suspend, reason, http.User.GetUserId(), ct));
        return Results.NoContent();
    }
}
