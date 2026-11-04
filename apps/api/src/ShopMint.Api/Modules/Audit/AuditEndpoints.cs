using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Audit;

public sealed record AuditActor(Guid Id, string Name, string Email);
public sealed record AuditEntryDto(Guid Id, DateTimeOffset At, string Action, string? EntityType, string? EntityId,
    AuditActor? Actor, JsonElement? Data, string? Ip);

/// <summary>Read-only activity log for the current store. Entries are append-only at the database level.</summary>
public static class AuditEndpoints
{
    /// <summary>Filter groups offered in the UI, matched as action prefixes.</summary>
    public static readonly string[] Areas = ["auth", "product", "category", "store", "staff", "tenant"];

    public static void Map(RouteGroupBuilder admin) =>
        admin.MapGet("/audit", List).WithTags("Audit").RequirePermission(Permissions.AuditRead);

    private static async Task<IResult> List(AppDbContext db, int? page, int? pageSize, string? area, Guid? actorId, CancellationToken ct)
    {
        var (p, size) = Paging.Normalize(page, pageSize);
        // The global query filter limits rows to the current store; RLS enforces the same in the database.
        var q = db.AuditLog.AsNoTracking();
        if (!string.IsNullOrEmpty(area))
        {
            if (!Areas.Contains(area)) throw AppException.Invalid("area", "Unknown activity area.");
            var prefix = area + ".";
            q = q.Where(e => e.Action.StartsWith(prefix));
        }
        if (actorId is { } a) q = q.Where(e => e.ActorUserId == a);

        var total = await q.CountAsync(ct);
        var rows = await (from e in q
                          join u in db.Users.AsNoTracking() on e.ActorUserId equals u.Id into actors
                          from u in actors.DefaultIfEmpty()
                          orderby e.At descending, e.Id descending
                          select new { e.Id, e.At, e.Action, e.EntityType, e.EntityId, e.Data, e.Ip, ActorId = (Guid?)u.Id, ActorName = u.Name, ActorEmail = u.Email })
            .Skip((p - 1) * size).Take(size).ToListAsync(ct);

        var items = rows.Select(r => new AuditEntryDto(r.Id, r.At, r.Action, r.EntityType, r.EntityId,
            r.ActorId is { } id ? new AuditActor(id, r.ActorName, r.ActorEmail) : null,
            r.Data is null ? null : JsonDocument.Parse(r.Data).RootElement.Clone(), r.Ip)).ToList();
        return Results.Ok(new Paged<AuditEntryDto>(items, p, size, total));
    }
}
