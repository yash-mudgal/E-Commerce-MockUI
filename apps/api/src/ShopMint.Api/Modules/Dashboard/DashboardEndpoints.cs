using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Dashboard;

public sealed record CatalogSummary(int Products, int Active, int Draft, int Archived, int Categories, int Variants,
    int LowStockVariants, int OutOfStockVariants, int UnitsOnHand);
public sealed record LowStockItem(Guid ProductId, string Title, string Sku, string[] OptionValues, int OnHand);
/// <summary><c>Sales</c> is null until the Orders module ships (Phase 8). The UI shows an explicit empty state rather than placeholder numbers.</summary>
public sealed record DashboardSummary(CatalogSummary Catalog, IReadOnlyList<LowStockItem> LowStock, object? Sales);

public static class DashboardEndpoints
{
    public static void Map(RouteGroupBuilder admin) =>
        admin.MapGet("/dashboard/summary", Summary).WithTags("Dashboard").RequirePermission(Permissions.ReportsRead);

    private static async Task<IResult> Summary(AppDbContext db, TenantContext tenant, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        var threshold = await db.Tenants.Where(t => t.Id == tid).Select(t => t.LowStockThreshold).FirstAsync(ct);
        var byStatus = await db.Products.GroupBy(p => p.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        int Count(ProductStatus s) => byStatus.FirstOrDefault(x => x.Key == s)?.Count ?? 0;

        var variantStock = db.ProductVariants.Where(v => v.IsActive)
            .Select(v => new { v.Id, v.ProductId, v.Sku, v.OptionValues, OnHand = v.StockLevels.Sum(s => s.OnHand - s.Reserved) });
        var activeVariants = variantStock.Where(v => db.Products.Any(p => p.Id == v.ProductId && p.Status == ProductStatus.Active));

        var summary = new CatalogSummary(
            byStatus.Sum(x => x.Count), Count(ProductStatus.Active), Count(ProductStatus.Draft), Count(ProductStatus.Archived),
            await db.Categories.CountAsync(ct),
            await activeVariants.CountAsync(ct),
            await activeVariants.CountAsync(v => v.OnHand > 0 && v.OnHand <= threshold, ct),
            await activeVariants.CountAsync(v => v.OnHand <= 0, ct),
            await activeVariants.SumAsync(v => v.OnHand, ct));

        var low = await activeVariants.Where(v => v.OnHand <= threshold).OrderBy(v => v.OnHand).Take(8)
            .Join(db.Products, v => v.ProductId, p => p.Id, (v, p) => new LowStockItem(p.Id, p.Title, v.Sku, v.OptionValues, v.OnHand))
            .ToListAsync(ct);

        return Results.Ok(new DashboardSummary(summary, low, null));
    }
}
