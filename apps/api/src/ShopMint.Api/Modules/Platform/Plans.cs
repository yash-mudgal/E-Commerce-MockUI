using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Billing;

namespace ShopMint.Api.Modules.Platform;

/// <summary>Plan entitlements as used by the rest of the API (read from the <c>plans</c> table). Null limit = unlimited.</summary>
public sealed record PlanDefinition(string Code, string Name, decimal MonthlyPrice, int? MaxProducts, int? MaxStaff, int? MaxLocations, bool CustomDomain,
    bool IsPublic, int SortOrder, string? RazorpayPlanId)
{
    public static PlanDefinition From(Plan p) =>
        new(p.Code, p.Name, p.MonthlyPrice, p.MaxProducts, p.MaxStaff, p.MaxLocations, p.CustomDomain, p.IsPublic, p.SortOrder, p.RazorpayPlanId);
}

public static class Plans
{
    public const string TrialCode = "trial";
    public const int TrialDays = 14;
    /// <summary>GST on ShopMint's subscription fees (SAC 9983).</summary>
    public const decimal GstRate = 18;

    public static decimal WithGst(decimal price) => Math.Round(price * (1 + GstRate / 100), 2, MidpointRounding.AwayFromZero);

    public static void EnsureLocationCapacity(PlanDefinition plan, int currentCount)
    {
        if (plan.MaxLocations is { } max && currentCount >= max)
            throw AppException.Unprocessable(ProblemTypes.EntitlementExceeded,
                $"Your {plan.Name} plan includes {max} stock {(max == 1 ? "location" : "locations")}. Upgrade your plan to add more.");
    }

    public static void EnsureProductCapacity(PlanDefinition plan, int currentCount)
    {
        if (plan.MaxProducts is { } max && currentCount >= max)
            throw AppException.Unprocessable(ProblemTypes.EntitlementExceeded,
                $"Your {plan.Name} plan allows up to {max} products. Upgrade your plan to add more.");
    }

    /// <summary>
    /// Locks the store's row for the rest of the transaction, so concurrent requests can't both pass a plan-limit
    /// check and exceed the limit together.
    /// </summary>
    public static Task LockTenantAsync(AppDbContext db, Guid tenantId, CancellationToken ct) =>
        db.Database.ExecuteSqlAsync($"SELECT 1 FROM tenants WHERE id = {tenantId} FOR UPDATE", ct);
}

/// <summary>Plans from the database, cached briefly. Platform edits evict the cache on this instance.</summary>
public sealed class PlanCatalog(AppDbContext db, IMemoryCache cache)
{
    private const string Key = "plans:all";

    public async Task<IReadOnlyList<PlanDefinition>> AllAsync(CancellationToken ct) =>
        (await cache.GetOrCreateAsync(Key, async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60);
            return (IReadOnlyList<PlanDefinition>)(await db.Plans.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync(ct)).Select(PlanDefinition.From).ToList();
        }))!;

    /// <summary>The plan by code; unknown codes fall back to the trial plan's limits (the most restrictive).</summary>
    public async Task<PlanDefinition> GetAsync(string code, CancellationToken ct)
    {
        var all = await AllAsync(ct);
        return all.FirstOrDefault(p => p.Code == code) ?? all.First(p => p.Code == Plans.TrialCode);
    }

    public async Task<PlanDefinition> ForTenantAsync(Guid tenantId, CancellationToken ct) =>
        await GetAsync(await db.Tenants.Where(t => t.Id == tenantId).Select(t => t.PlanCode).FirstAsync(ct), ct);

    public static void Evict(IMemoryCache cache) => cache.Remove(Key);

    /// <summary>Uncached lookup for code that has only a DbContext (inside a transaction that already locked the store).</summary>
    public static async Task<PlanDefinition> LoadForTenantAsync(AppDbContext db, Guid tenantId, CancellationToken ct)
    {
        var code = await db.Tenants.Where(t => t.Id == tenantId).Select(t => t.PlanCode).FirstAsync(ct);
        var plan = await db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Code == code, ct)
            ?? await db.Plans.AsNoTracking().FirstAsync(p => p.Code == Plans.TrialCode, ct);
        return PlanDefinition.From(plan);
    }
}
