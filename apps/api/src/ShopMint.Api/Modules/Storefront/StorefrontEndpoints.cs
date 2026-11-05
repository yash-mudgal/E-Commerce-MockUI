using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Catalog;
using ShopMint.Api.Modules.Orders;

namespace ShopMint.Api.Modules.Storefront;

/// <summary>Public store profile. Shipping and payment fields are what checkout will apply, so the storefront can state them.</summary>
public sealed record StorefrontStore(string Name, string? Tagline, string BrandColor, string? SupportEmail, string? LegalName, string? Gstin, bool IsLive,
    decimal ShippingFee = 0, decimal? FreeShippingThreshold = null, bool CodEnabled = false, decimal CodMaxOrderValue = 0, bool OnlinePayments = false,
    string? BusinessAddress = null, bool OnlinePaymentsTest = false, int ReturnWindowDays = 0, int? DeliveryMinDays = null, int? DeliveryMaxDays = null,
    bool HasDeliveryZones = false);

/// <summary>Marks a storefront endpoint that also answers before the store launches (the "coming soon" page needs it).</summary>
public sealed class AllowBeforeLaunch;
/// <summary>A category with its cover: the first image of its newest active product that has one.</summary>
public sealed record StorefrontCategory(string Name, string Slug, int ProductCount, StorefrontImage? Cover = null);
public sealed record SitemapEntry(string Slug, DateTimeOffset UpdatedAt);
public sealed record StorefrontSitemap(DateTimeOffset StoreUpdatedAt, IReadOnlyList<SitemapEntry> Products, IReadOnlyList<SitemapEntry> Categories);
/// <summary>HoverImage is the second image, shown when a shopper points at the card.</summary>
public sealed record StorefrontProductCard(string Title, string Slug, string? CategoryName, decimal Price, decimal Mrp, bool InStock, StorefrontImage? Image,
    StorefrontImage? HoverImage = null, string? Rating = null, int ReviewCount = 0);
public sealed record StorefrontImage(string Url, string? AltText);
public sealed record StorefrontVariant(Guid Id, string[] OptionValues, decimal Price, decimal Mrp, bool Available, bool LowStock);
public sealed record StorefrontProduct(string Title, string Slug, string Description, string? CategoryName, string? CategorySlug,
    decimal GstRate, string[] OptionNames, IReadOnlyList<StorefrontVariant> Variants, IReadOnlyList<StorefrontImage> Images,
    Reviews.RatingSummary? Ratings = null);

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
        var state = await db.Tenants.AsNoTracking().Where(t => t.Id == tid)
            .Select(t => new { t.Status, Live = t.LaunchedAt != null }).FirstOrDefaultAsync();
        if (state is null || state.Status == TenantStatus.Cancelled) throw AppException.NotFound("Store");
        // Suspended (unpaid, or by the platform) is temporary: 503 lets the web app show "temporarily unavailable" and tells crawlers to come back.
        if (state.Status == TenantStatus.Suspended)
            throw new AppException(503, ProblemTypes.StoreUnavailable, "This store is temporarily unavailable.");
        // Before launch only the store profile is public (for the "coming soon" page); the catalogue is not.
        if (!state.Live && ctx.HttpContext.GetEndpoint()?.Metadata.GetMetadata<AllowBeforeLaunch>() is null)
            throw AppException.NotFound("Store");
        tenant.Set(tid, null, state.Status);
        return await next(ctx);
    }
}

public static class StorefrontEndpoints
{
    public static RouteGroupBuilder Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/storefront").WithTags("Storefront").AllowAnonymous().AddEndpointFilter<StorefrontTenantFilter>();
        g.MapGet("/sitemap", GetSitemap);
        g.MapGet("/store", GetStore).WithMetadata(new AllowBeforeLaunch());
        g.MapGet("/categories", GetCategories);
        g.MapGet("/products", GetProducts);
        g.MapGet("/products/{slug}", GetProduct);
        return g;
    }

    /// <summary>Everything a sitemap lists: active products and categories with products (capped at 5,000 products).</summary>
    private static async Task<IResult> GetSitemap(AppDbContext db, TenantContext tenant, CancellationToken ct)
    {
        var updated = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.UpdatedAt).FirstAsync(ct);
        var products = await Visible(db).Where(p => p.Variants.Any(v => v.IsActive)).OrderByDescending(p => p.UpdatedAt).Take(5000)
            .Select(p => new SitemapEntry(p.Slug, p.UpdatedAt)).ToListAsync(ct);
        var categories = await db.Categories.AsNoTracking()
            .Where(c => db.Products.Any(p => p.CategoryId == c.Id && p.Status == ProductStatus.Active))
            .Select(c => new SitemapEntry(c.Slug, c.UpdatedAt)).ToListAsync(ct);
        return Results.Ok(new StorefrontSitemap(updated, products, categories));
    }

    private static IQueryable<Product> Visible(AppDbContext db) => db.Products.AsNoTracking().Where(p => p.Status == ProductStatus.Active);

    private static async Task<IResult> GetStore(AppDbContext db, TenantContext tenant, PaymentResolver payments, CancellationToken ct)
    {
        var store = await db.Tenants.AsNoTracking().Where(t => t.Id == tenant.TenantId)
            .Select(t => new StorefrontStore(t.Name, t.Tagline, t.BrandColor, t.SupportEmail, t.LegalName, t.Gstin, t.LaunchedAt != null,
                t.ShippingFee, t.FreeShippingThreshold, t.CodEnabled, t.CodMaxOrderValue, false, t.BusinessAddress)).FirstAsync(ct);
        // The same check checkout uses, so "UPI and cards" is only claimed when online payment really works.
        var gateway = await payments.ForCurrentTenantAsync(ct);
        var extra = await db.Tenants.AsNoTracking().Where(t => t.Id == tenant.TenantId)
            .Select(t => new { t.ReturnWindowDays, t.DeliveryMinDays, t.DeliveryMaxDays }).FirstAsync(ct);
        return Results.Ok(store with
        {
            OnlinePayments = gateway is not null, OnlinePaymentsTest = gateway?.IsTest ?? false, ReturnWindowDays = extra.ReturnWindowDays,
            DeliveryMinDays = extra.DeliveryMinDays, DeliveryMaxDays = extra.DeliveryMaxDays, HasDeliveryZones = await db.ShippingZones.AnyAsync(ct),
        });
    }

    private static async Task<IResult> GetCategories(AppDbContext db, IObjectStorage storage, CancellationToken ct)
    {
        var rows = await db.Categories.AsNoTracking().OrderBy(c => c.Position).ThenBy(c => c.Name)
            .Select(c => new
            {
                c.Name, c.Slug,
                Count = db.Products.Count(p => p.CategoryId == c.Id && p.Status == ProductStatus.Active),
                Cover = db.Products.Where(p => p.CategoryId == c.Id && p.Status == ProductStatus.Active && p.Media.Any(m => m.Status == MediaStatus.Ready))
                    .OrderByDescending(p => p.CreatedAt)
                    .Select(p => p.Media.Where(m => m.Status == MediaStatus.Ready).OrderBy(m => m.Position).Select(m => new { m.StorageKey, m.AltText }).First())
                    .FirstOrDefault(),
            }).ToListAsync(ct);
        return Results.Ok(rows.Select(r => new StorefrontCategory(r.Name, r.Slug, r.Count,
            r.Cover is null ? null : new StorefrontImage(storage.PublicUrl(r.Cover.StorageKey), r.Cover.AltText))).ToList());
    }

    private static async Task<IResult> GetProducts(AppDbContext db, IObjectStorage storage, TenantContext tenant, [FromQuery] string? q, [FromQuery] string? category,
        [FromQuery] decimal? minPrice, [FromQuery] decimal? maxPrice, [FromQuery] bool? inStock, [FromQuery] string? sort,
        [FromQuery] int? page, [FromQuery] int? pageSize, [FromQuery] bool? onSale, [FromQuery] string? exclude, [FromQuery] string? slugs,
        [FromQuery] string? collection, [FromQuery] string[]? opt, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, pageSize ?? 24);
        var query = Visible(db).Where(p => p.Variants.Any(v => v.IsActive));
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = $"%{CatalogEndpoints.EscapeLike(q.Trim())}%";
            query = query.Where(p => EF.Functions.ILike(p.Title, term, "\\") || p.Tags.Any(t => EF.Functions.ILike(t, term, "\\")));
        }
        if (!string.IsNullOrEmpty(category)) query = query.Where(p => p.Category != null && p.Category.Slug == category);
        // A collection is every active product carrying its tag; unknown or unpublished collections are empty.
        if (!string.IsNullOrEmpty(collection))
        {
            var tag = await db.Collections.AsNoTracking().Where(c => c.Slug == collection && c.Published).Select(c => c.Tag).FirstOrDefaultAsync(ct);
            query = tag is null ? query.Where(_ => false) : ShopContentEndpoints.Tagged(query, tag);
        }
        query = await ShopContentEndpoints.WithOptionsAsync(query, db, tenant, opt, ct);
        if (minPrice is { } min) query = query.Where(p => p.Variants.Where(v => v.IsActive).Min(v => v.Price) >= min);
        if (maxPrice is { } max) query = query.Where(p => p.Variants.Where(v => v.IsActive).Min(v => v.Price) <= max);
        // On sale: the cheapest active variant is priced below its MRP (the price the card shows).
        if (onSale == true) query = query.Where(p => p.Variants.Where(v => v.IsActive).OrderBy(v => v.Price).Select(v => v.Price < v.Mrp).First());
        if (!string.IsNullOrEmpty(exclude)) query = query.Where(p => p.Slug != exclude);
        // A given set (recently viewed): at most 24 slugs.
        if (!string.IsNullOrEmpty(slugs))
        {
            var list = slugs.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().Take(24).ToArray();
            query = query.Where(p => list.Contains(p.Slug));
        }
        if (inStock == true) query = query.Where(p => p.Variants.Any(v => v.IsActive && v.StockLevels.Sum(s => s.OnHand - s.Reserved) > 0));
        query = sort switch
        {
            "price_asc" => query.OrderBy(p => p.Variants.Where(v => v.IsActive).Min(v => v.Price)),
            "price_desc" => query.OrderByDescending(p => p.Variants.Where(v => v.IsActive).Min(v => v.Price)),
            "newest" or null or "" => query.OrderByDescending(p => p.CreatedAt),
            _ => throw AppException.Invalid("sort", "Sort must be newest, price_asc or price_desc."),
        };

        var total = await query.CountAsync(ct);
        var cards = await CardsAsync(db, storage, query.Skip((pg - 1) * size).Take(size), ct);
        return Results.Ok(new Paged<StorefrontProductCard>(cards.Select(c => c.Card).ToList(), pg, size, total));
    }

    /// <summary>Product cards for an ordered query: cheapest active variant, stock, first two images and published-review rating.</summary>
    public static async Task<List<(Guid Id, StorefrontProductCard Card)>> CardsAsync(AppDbContext db, IObjectStorage storage, IQueryable<Product> query, CancellationToken ct)
    {
        var items = await query.Select(p => new
        {
            p.Id, p.Title, p.Slug, Category = p.Category != null ? p.Category.Name : null,
            Cheapest = p.Variants.Where(v => v.IsActive).OrderBy(v => v.Price).Select(v => new { v.Price, v.Mrp }).FirstOrDefault(),
            InStock = p.Variants.Any(v => v.IsActive && v.StockLevels.Sum(s => s.OnHand - s.Reserved) > 0),
            Images = p.Media.Where(m => m.Status == MediaStatus.Ready).OrderBy(m => m.Position).Select(m => new { m.StorageKey, m.AltText }).Take(2).ToList(),
            ReviewCount = db.ProductReviews.Count(r => r.ProductId == p.Id && r.Status == Reviews.ReviewStatus.Published),
            RatingTotal = db.ProductReviews.Where(r => r.ProductId == p.Id && r.Status == Reviews.ReviewStatus.Published).Sum(r => (int?)r.Rating) ?? 0,
        }).ToListAsync(ct);
        StorefrontImage? Img(string key, string? alt) => new(storage.PublicUrl(key), alt);
        return items.Where(i => i.Cheapest is not null).Select(i => (i.Id, new StorefrontProductCard(i.Title, i.Slug, i.Category, i.Cheapest!.Price, i.Cheapest.Mrp, i.InStock,
            i.Images.Count > 0 ? Img(i.Images[0].StorageKey, i.Images[0].AltText) : null,
            i.Images.Count > 1 ? Img(i.Images[1].StorageKey, i.Images[1].AltText) : null,
            i.ReviewCount == 0 ? null : Math.Round((decimal)i.RatingTotal / i.ReviewCount, 1).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture),
            i.ReviewCount))).ToList();
    }

    private static async Task<IResult> GetProduct(string slug, AppDbContext db, TenantContext tenant, IObjectStorage storage, CancellationToken ct)
    {
        var p = await Visible(db).AsSplitQuery().Include(x => x.Category).Include(x => x.Variants).ThenInclude(v => v.StockLevels)
            .Include(x => x.Media.Where(m => m.Status == MediaStatus.Ready))
            .FirstOrDefaultAsync(x => x.Slug == slug, ct) ?? throw AppException.NotFound("Product");
        var threshold = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.LowStockThreshold).FirstAsync(ct);
        // Exact stock counts are not exposed publicly; only availability and a low-stock hint.
        var variants = p.Variants.Where(v => v.IsActive).OrderBy(v => v.Position).Select(v =>
        {
            var available = v.StockLevels.Sum(s => s.OnHand - s.Reserved);
            return new StorefrontVariant(v.Id, v.OptionValues, v.Price, v.Mrp, available > 0, available > 0 && available <= threshold);
        }).ToList();
        return Results.Ok(new StorefrontProduct(p.Title, p.Slug, p.Description, p.Category?.Name, p.Category?.Slug, p.GstRate,
            p.OptionNames, variants,
            p.Media.OrderBy(m => m.Position).Select(m => new StorefrontImage(storage.PublicUrl(m.StorageKey), m.AltText)).ToList(),
            await Reviews.ReviewEndpoints.SummaryAsync(db, p.Id, ct)));
    }
}
