using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Platform;

public sealed record PlatformTenantRow(Guid Id, string Name, string Slug, string? Host, string Status, string Plan,
    string? OwnerEmail, int Products, DateTimeOffset CreatedAt);
public sealed record StatusChangeRequest(string? Reason);

/// <summary>Cross-tenant operator console. Uses <see cref="PlatformDbContext"/> (BYPASSRLS) and requires a platform admin.</summary>
public static class PlatformEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/platform").WithTags("Platform").RequireAuthorization(Session.PlatformAdminPolicy);
        g.MapGet("/tenants", List);
        g.MapPost("/tenants/{id:guid}/suspend", (Guid id, StatusChangeRequest? req, PlatformDbContext db, AuditWriter audit, HttpContext http, CancellationToken ct)
            => Change(id, TenantStatus.Suspended, req?.Reason, db, audit, http, ct));
        g.MapPost("/tenants/{id:guid}/reactivate", (Guid id, StatusChangeRequest? req, PlatformDbContext db, AuditWriter audit, HttpContext http, CancellationToken ct)
            => Change(id, TenantStatus.Active, req?.Reason, db, audit, http, ct));
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
                db.Products.Count(p => p.TenantId == t.Id), t.CreatedAt))
            .ToListAsync(ct);
        return Results.Ok(new Paged<PlatformTenantRow>(items, pg, size, total));
    }

    private static async Task<IResult> Change(Guid id, TenantStatus to, string? reason, PlatformDbContext db, AuditWriter audit,
        HttpContext http, CancellationToken ct)
    {
        var t = await db.Tenants.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Tenant");
        if (t.Status == to) return Results.NoContent();
        var from = t.Status;
        t.Status = to;
        t.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, to == TenantStatus.Suspended ? "tenant.suspended" : "tenant.reactivated", "tenant", id,
            new { from = from.ToString(), to = to.ToString(), reason }, tenantIdOverride: id, actorOverride: http.User.GetUserId());
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
