using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Catalog;

namespace ShopMint.Api.Modules.Storefront;

public sealed record StorefrontStore(string Name, string? Tagline, string BrandColor, string? SupportEmail, string? LegalName, string? Gstin);
public sealed record StorefrontCategory(string Name, string Slug, int ProductCount);
public sealed record StorefrontProductCard(string Title, string Slug, string? CategoryName, decimal Price, decimal Mrp, bool InStock);
public sealed record StorefrontVariant(Guid Id, string[] OptionValues, decimal Price, decimal Mrp, bool Available, bool LowStock);
public sealed record StorefrontProduct(string Title, string Slug, string Description, string? CategoryName, string? CategorySlug,
    decimal GstRate, string[] OptionNames, IReadOnlyList<StorefrontVariant> Variants);

/// <summary>
/// Resolves the storefront tenant from the request host. It never reads the tenant from the body, query or
/// cookies, and it overrides any tenant set by a merchant session on the same request.
/// </summary>
public sealed class StorefrontTenantFilter(AppDbContext db, TenantContext tenant, IMemoryCache cache) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var host = ctx.HttpContext.Request.Host.Host.ToLowerInvariant();
        tenant.Set(null, null);
        var resolved = await cache.GetOrCreateAsync(("store-host", host), async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(15);
            return await db.TenantDomains.AsNoTracking().Where(d => d.Host == host && d.VerifiedAt != null)
                .Select(d => (Guid?)d.TenantId).FirstOrDefaultAsync();
        });
        if (resolved is not { } tid) throw AppException.NotFound("Store");
        tenant.Set(tid, null);
        var status = await db.Tenants.AsNoTracking().Where(t => t.Id == tid).Select(t => (TenantStatus?)t.Status).FirstOrDefaultAsync();
        if (status is null or TenantStatus.Suspended or TenantStatus.Cancelled) throw AppException.NotFound("Store");
        tenant.Set(tid, null, status);
        return await next(ctx);
    }
}

public static class StorefrontEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/storefront").WithTags("Storefront").AllowAnonymous().AddEndpointFilter<StorefrontTenantFilter>();
        g.MapGet("/store", GetStore);
        g.MapGet("/categories", GetCategories);
        g.MapGet("/products", GetProducts);
        g.MapGet("/products/{slug}", GetProduct);
    }

    private static IQueryable<Product> Visible(AppDbContext db) => db.Products.AsNoTracking().Where(p => p.Status == ProductStatus.Active);

    private static async Task<IResult> GetStore(AppDbContext db, TenantContext tenant, CancellationToken ct) =>
        Results.Ok(await db.Tenants.AsNoTracking().Where(t => t.Id == tenant.TenantId)
            .Select(t => new StorefrontStore(t.Name, t.Tagline, t.BrandColor, t.SupportEmail, t.LegalName, t.Gstin)).FirstAsync(ct));

    private static async Task<IResult> GetCategories(AppDbContext db, CancellationToken ct) =>
        Results.Ok(await db.Categories.AsNoTracking().OrderBy(c => c.Position).ThenBy(c => c.Name)
            .Select(c => new StorefrontCategory(c.Name, c.Slug, db.Products.Count(p => p.CategoryId == c.Id && p.Status == ProductStatus.Active)))
            .ToListAsync(ct));

    private static async Task<IResult> GetProducts(AppDbContext db, [FromQuery] string? q, [FromQuery] string? category,
        [FromQuery] decimal? minPrice, [FromQuery] decimal? maxPrice, [FromQuery] bool? inStock, [FromQuery] string? sort,
        [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, pageSize ?? 24);
        var query = Visible(db).Where(p => p.Variants.Any(v => v.IsActive));
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = $"%{CatalogEndpoints.EscapeLike(q.Trim())}%";
            query = query.Where(p => EF.Functions.ILike(p.Title, term, "\\") || p.Tags.Any(t => EF.Functions.ILike(t, term, "\\")));
        }
        if (!string.IsNullOrEmpty(category)) query = query.Where(p => p.Category != null && p.Category.Slug == category);
        if (minPrice is { } min) query = query.Where(p => p.Variants.Where(v => v.IsActive).Min(v => v.Price) >= min);
        if (maxPrice is { } max) query = query.Where(p => p.Variants.Where(v => v.IsActive).Min(v => v.Price) <= max);
        if (inStock == true) query = query.Where(p => p.Variants.Any(v => v.IsActive && v.StockLevels.Sum(s => s.OnHand - s.Reserved) > 0));
        query = sort switch
        {
            "price_asc" => query.OrderBy(p => p.Variants.Where(v => v.IsActive).Min(v => v.Price)),
            "price_desc" => query.OrderByDescending(p => p.Variants.Where(v => v.IsActive).Min(v => v.Price)),
            "newest" or null or "" => query.OrderByDescending(p => p.CreatedAt),
            _ => throw AppException.Invalid("sort", "Sort must be newest, price_asc or price_desc."),
        };

        var total = await query.CountAsync(ct);
        var items = await query.Skip((pg - 1) * size).Take(size).Select(p => new
        {
            p.Title, p.Slug, Category = p.Category != null ? p.Category.Name : null,
            Cheapest = p.Variants.Where(v => v.IsActive).OrderBy(v => v.Price).Select(v => new { v.Price, v.Mrp }).First(),
            InStock = p.Variants.Any(v => v.IsActive && v.StockLevels.Sum(s => s.OnHand - s.Reserved) > 0),
        }).ToListAsync(ct);

        return Results.Ok(new Paged<StorefrontProductCard>(
            items.Select(i => new StorefrontProductCard(i.Title, i.Slug, i.Category, i.Cheapest.Price, i.Cheapest.Mrp, i.InStock)).ToList(),
            pg, size, total));
    }

    private static async Task<IResult> GetProduct(string slug, AppDbContext db, TenantContext tenant, CancellationToken ct)
    {
        var p = await Visible(db).AsSplitQuery().Include(x => x.Category).Include(x => x.Variants).ThenInclude(v => v.StockLevels)
            .FirstOrDefaultAsync(x => x.Slug == slug, ct) ?? throw AppException.NotFound("Product");
        var threshold = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.LowStockThreshold).FirstAsync(ct);
        // Exact stock counts are not exposed publicly; only availability and a low-stock hint.
        var variants = p.Variants.Where(v => v.IsActive).OrderBy(v => v.Position).Select(v =>
        {
            var available = v.StockLevels.Sum(s => s.OnHand - s.Reserved);
            return new StorefrontVariant(v.Id, v.OptionValues, v.Price, v.Mrp, available > 0, available > 0 && available <= threshold);
        }).ToList();
        return Results.Ok(new StorefrontProduct(p.Title, p.Slug, p.Description, p.Category?.Name, p.Category?.Slug, p.GstRate,
            p.OptionNames, variants));
    }
}
