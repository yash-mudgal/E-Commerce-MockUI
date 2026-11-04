using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Dashboard;

public sealed record CatalogSummary(int Products, int Active, int Draft, int Archived, int Categories, int Variants,
    int LowStockVariants, int OutOfStockVariants, int UnitsOnHand);
public sealed record LowStockItem(Guid ProductId, string Title, string Sku, string[] OptionValues, int OnHand);
/// <summary>Sales over the last 30 days from confirmed orders (net of refunds). <c>Sales</c> is null until the first order.</summary>
public sealed record SalesSummary(int Days, int Orders, decimal Revenue, decimal AverageOrderValue, int ToFulfil, int AwaitingPayment,
    IReadOnlyList<DailySales> Daily);
public sealed record DailySales(DateOnly Date, int Orders, decimal Revenue);
public sealed record DashboardSummary(CatalogSummary Catalog, IReadOnlyList<LowStockItem> LowStock, SalesSummary? Sales);

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

        return Results.Ok(new DashboardSummary(summary, low, await SalesAsync(db, ct)));
    }

    private static readonly TimeSpan Ist = TimeSpan.FromMinutes(330);

    /// <summary>Counts orders that were confirmed (or later) and not cancelled; revenue is net of refunds. Days are Indian time.</summary>
    private static async Task<SalesSummary?> SalesAsync(AppDbContext db, CancellationToken ct)
    {
        if (!await db.Orders.AnyAsync(ct)) return null;
        var since = DateTimeOffset.UtcNow.AddDays(-30);
        var counted = db.Orders.Where(o => o.PlacedAt >= since && o.Status != Orders.OrderStatus.PendingPayment
            && o.Status != Orders.OrderStatus.Cancelled && o.Status != Orders.OrderStatus.Expired);
        var rows = await counted.Select(o => new { o.PlacedAt, Net = o.Total - o.RefundedTotal }).ToListAsync(ct);
        var revenue = rows.Sum(r => r.Net);
        var daily = rows.GroupBy(r => DateOnly.FromDateTime(r.PlacedAt.ToOffset(Ist).DateTime))
            .Select(g => new DailySales(g.Key, g.Count(), g.Sum(x => x.Net))).OrderBy(d => d.Date).ToList();
        var toFulfil = await db.Orders.CountAsync(o => o.Status == Orders.OrderStatus.Confirmed || o.Status == Orders.OrderStatus.Packed, ct);
        var awaiting = await db.Orders.CountAsync(o => o.Status == Orders.OrderStatus.PendingPayment, ct);
        return new SalesSummary(30, rows.Count, revenue, rows.Count == 0 ? 0 : Math.Round(revenue / rows.Count, 2), toFulfil, awaiting, daily);
    }
}
