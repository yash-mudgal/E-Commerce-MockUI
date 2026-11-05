using System.Text.RegularExpressions;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Catalog;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Storefront;

/// <summary>How the store's home page looks. One row per store; absent means the defaults.</summary>
public sealed class StorefrontSettings : ITenantOwned
{
    public Guid TenantId { get; set; }
    public string? HeroHeading { get; set; }
    public string? HeroText { get; set; }
    /// <summary>One of the store's own product images (no separate upload pipeline, no stock imagery).</summary>
    public Guid? HeroMediaId { get; set; }
    /// <summary>Overrides the announcement bar's default (the store's shipping and COD terms).</summary>
    public string? Announcement { get; set; }
    public bool ShowCategories { get; set; } = true;
    public bool ShowNewArrivals { get; set; } = true;
    public bool ShowSale { get; set; } = true;
    public Guid? FeaturedCollectionId { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>A store's own content page: about, shipping, returns, FAQ, contact… Plain text with light formatting.</summary>
public sealed class StorePage : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Slug { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public bool Published { get; set; }
    public int Position { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>A curated group of products: every active product carrying the collection's tag.</summary>
public sealed class Collection : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Title { get; set; } = "";
    public string Slug { get; set; } = "";
    public string? Description { get; set; }
    public string Tag { get; set; } = "";
    public bool Published { get; set; }
    public int Position { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed record HomeCollection(string Title, string Slug, string? Description, int ProductCount, StorefrontImage? Cover);
public sealed record PageLink(string Slug, string Title);
public sealed record StorefrontHome(string? HeroHeading, string? HeroText, StorefrontImage? HeroImage, string? HeroProductSlug, string? Announcement,
    bool ShowCategories, bool ShowNewArrivals, bool ShowSale, HomeCollection? Featured, IReadOnlyList<HomeCollection> Collections, IReadOnlyList<PageLink> Pages);
public sealed record PublicPage(string Slug, string Title, string Body, DateTimeOffset UpdatedAt);
public sealed record FacetValue(string Value, int Count);
public sealed record Facet(string Name, IReadOnlyList<FacetValue> Values);
public sealed record Facets(IReadOnlyList<Facet> Options, decimal? PriceMin, decimal? PriceMax);

public sealed record StorefrontSettingsDto(string? HeroHeading, string? HeroText, Guid? HeroMediaId, string? Announcement, bool ShowCategories,
    bool ShowNewArrivals, bool ShowSale, Guid? FeaturedCollectionId);
public sealed record HeroImageOption(Guid MediaId, string Url, string? AltText, string ProductTitle);
public sealed record PageDto(Guid Id, string Slug, string Title, string Body, bool Published, int Position, DateTimeOffset UpdatedAt);
public sealed record PageRequest(string Title, string? Slug, string Body, bool Published);
public sealed record CollectionDto(Guid Id, string Title, string Slug, string? Description, string Tag, bool Published, int Position, int ProductCount, DateTimeOffset UpdatedAt);
public sealed record CollectionRequest(string Title, string? Slug, string? Description, string Tag, bool Published);

public sealed class StorefrontSettingsValidator : AbstractValidator<StorefrontSettingsDto>
{
    public StorefrontSettingsValidator()
    {
        RuleFor(x => x.HeroHeading).MaximumLength(120);
        RuleFor(x => x.HeroText).MaximumLength(300);
        RuleFor(x => x.Announcement).MaximumLength(140);
    }
}

public sealed class PageValidator : AbstractValidator<PageRequest>
{
    public PageValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Slug).Matches(ShopContentEndpoints.SlugPattern).When(x => !string.IsNullOrEmpty(x.Slug))
            .WithMessage("Use lowercase letters, numbers and hyphens.").MaximumLength(60);
        RuleFor(x => x.Body).MaximumLength(20_000);
        RuleFor(x => x.Body).Must(b => !string.IsNullOrWhiteSpace(b)).When(x => x.Published).WithMessage("Write the page before publishing it.");
    }
}

public sealed class CollectionValidator : AbstractValidator<CollectionRequest>
{
    public CollectionValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(80);
        RuleFor(x => x.Slug).Matches(ShopContentEndpoints.SlugPattern).When(x => !string.IsNullOrEmpty(x.Slug))
            .WithMessage("Use lowercase letters, numbers and hyphens.").MaximumLength(60);
        RuleFor(x => x.Description).MaximumLength(300);
        RuleFor(x => x.Tag).NotEmpty().WithMessage("Choose the product tag this collection shows.").MaximumLength(40);
    }
}

public static class ShopContentEndpoints
{
    public const string SlugPattern = "^[a-z0-9]+(-[a-z0-9]+)*$";
    public const int MaxPages = 20;
    public const int MaxCollections = 30;
    public const int MaxFacetValues = 30;

    public static void Map(RouteGroupBuilder storefront, RouteGroupBuilder admin)
    {
        storefront.MapGet("/home", Home).WithTags("Storefront");
        storefront.MapGet("/pages/{slug}", Page).WithTags("Storefront");
        storefront.MapGet("/facets", GetFacets).WithTags("Storefront");

        var s = admin.MapGroup("/storefront").WithTags("Storefront settings");
        s.MapGet("/", GetSettings).RequirePermission(Permissions.SettingsWrite);
        s.MapPut("/", PutSettings).Validate<StorefrontSettingsDto>().RequirePermission(Permissions.SettingsWrite);
        s.MapGet("/hero-images", HeroImages).RequirePermission(Permissions.SettingsWrite);

        var p = admin.MapGroup("/pages").WithTags("Store pages");
        p.MapGet("/", ListPages).RequirePermission(Permissions.SettingsWrite);
        p.MapPost("/", CreatePage).Validate<PageRequest>().RequirePermission(Permissions.SettingsWrite);
        p.MapPut("/{id:guid}", UpdatePage).Validate<PageRequest>().RequirePermission(Permissions.SettingsWrite);
        p.MapDelete("/{id:guid}", DeletePage).RequirePermission(Permissions.SettingsWrite);

        var c = admin.MapGroup("/collections").WithTags("Collections");
        c.MapGet("/", ListCollections).RequirePermission(Permissions.CatalogWrite);
        c.MapPost("/", CreateCollection).Validate<CollectionRequest>().RequirePermission(Permissions.CatalogWrite);
        c.MapPut("/{id:guid}", UpdateCollection).Validate<CollectionRequest>().RequirePermission(Permissions.CatalogWrite);
        c.MapDelete("/{id:guid}", DeleteCollection).RequirePermission(Permissions.CatalogWrite);
    }

    private static IQueryable<Product> Active(AppDbContext db) =>
        db.Products.AsNoTracking().Where(p => p.Status == ProductStatus.Active && p.Variants.Any(v => v.IsActive));

    /// <summary>Tags are matched case-insensitively, as products store them as typed.</summary>
    public static IQueryable<Product> Tagged(IQueryable<Product> q, string tag)
    {
        // ILIKE without wildcards: a case-insensitive exact match that the database can evaluate.
        var t = CatalogEndpoints.EscapeLike(tag.Trim());
        return q.Where(p => p.Tags.Any(x => EF.Functions.ILike(x, t, "\\")));
    }

    private static async Task<List<HomeCollection>> PublishedCollectionsAsync(AppDbContext db, IObjectStorage storage, CancellationToken ct)
    {
        var cols = await db.Collections.AsNoTracking().Where(c => c.Published).OrderBy(c => c.Position).ThenBy(c => c.Title).ToListAsync(ct);
        var result = new List<HomeCollection>();
        foreach (var c in cols)
        {
            var q = Tagged(Active(db), c.Tag);
            var count = await q.CountAsync(ct);
            var cover = await q.Where(p => p.Media.Any(m => m.Status == MediaStatus.Ready)).OrderByDescending(p => p.CreatedAt)
                .Select(p => p.Media.Where(m => m.Status == MediaStatus.Ready).OrderBy(m => m.Position).Select(m => new { m.StorageKey, m.AltText }).First())
                .FirstOrDefaultAsync(ct);
            result.Add(new HomeCollection(c.Title, c.Slug, c.Description, count, cover is null ? null : new StorefrontImage(storage.PublicUrl(cover.StorageKey), cover.AltText)));
        }
        return result;
    }

    private static async Task<IResult> Home(AppDbContext db, IObjectStorage storage, CancellationToken ct)
    {
        var s = await db.StorefrontSettings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new StorefrontSettings();
        StorefrontImage? hero = null;
        string? heroSlug = null;
        if (s.HeroMediaId is { } mid)
        {
            // Only while the image is ready and its product is on sale; otherwise the home page falls back.
            var m = await db.ProductMedia.AsNoTracking().Where(x => x.Id == mid && x.Status == MediaStatus.Ready)
                .Join(Active(db), x => x.ProductId, p => p.Id, (x, p) => new { x.StorageKey, x.AltText, p.Slug }).FirstOrDefaultAsync(ct);
            if (m is not null) { hero = new StorefrontImage(storage.PublicUrl(m.StorageKey), m.AltText); heroSlug = m.Slug; }
        }
        var collections = await PublishedCollectionsAsync(db, storage, ct);
        HomeCollection? featured = null;
        if (s.FeaturedCollectionId is { } fid)
        {
            var slug = await db.Collections.AsNoTracking().Where(c => c.Id == fid && c.Published).Select(c => c.Slug).FirstOrDefaultAsync(ct);
            featured = collections.FirstOrDefault(c => c.Slug == slug);
        }
        var pages = await db.StorePages.AsNoTracking().Where(p => p.Published).OrderBy(p => p.Position).ThenBy(p => p.Title)
            .Select(p => new PageLink(p.Slug, p.Title)).ToListAsync(ct);
        return Results.Ok(new StorefrontHome(s.HeroHeading, s.HeroText, hero, heroSlug, s.Announcement, s.ShowCategories, s.ShowNewArrivals, s.ShowSale,
            featured, collections, pages));
    }

    private static async Task<IResult> Page(string slug, AppDbContext db, CancellationToken ct)
    {
        var p = await db.StorePages.AsNoTracking().FirstOrDefaultAsync(x => x.Slug == slug && x.Published, ct) ?? throw AppException.NotFound("Page");
        return Results.Ok(new PublicPage(p.Slug, p.Title, p.Body, p.UpdatedAt));
    }

    /// <summary>
    /// Option values (size, colour…) with how many products offer each, for the products in a category, collection or
    /// search. Names are grouped case-insensitively. Only active variants count.
    /// </summary>
    private static async Task<IResult> GetFacets([FromQuery] string? category, [FromQuery] string? collection, [FromQuery] string? q,
        AppDbContext db, TenantContext tenant, CancellationToken ct)
    {
        var products = Active(db);
        if (!string.IsNullOrEmpty(category)) products = products.Where(p => p.Category != null && p.Category.Slug == category);
        if (!string.IsNullOrEmpty(collection))
        {
            var tag = await db.Collections.AsNoTracking().Where(c => c.Slug == collection && c.Published).Select(c => c.Tag).FirstOrDefaultAsync(ct);
            if (tag is null) return Results.Ok(new Facets([], null, null));
            products = Tagged(products, tag);
        }
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = $"%{CatalogEndpoints.EscapeLike(q.Trim())}%";
            products = products.Where(p => EF.Functions.ILike(p.Title, term, "\\") || p.Tags.Any(t => EF.Functions.ILike(t, term, "\\")));
        }
        var ids = await products.Select(p => p.Id).Take(5000).ToArrayAsync(ct);
        if (ids.Length == 0) return Results.Ok(new Facets([], null, null));

        // Tenant filter written out as well as enforced by row-level security.
        var rows = await db.Database.SqlQuery<FacetRow>($"""
            SELECT lower(p.option_names[i]) AS "Key", min(p.option_names[i]) AS "Name", v.option_values[i] AS "Value", count(DISTINCT p.id)::int AS "Count"
            FROM products p
            JOIN product_variants v ON v.product_id = p.id AND v.is_active
            CROSS JOIN LATERAL generate_subscripts(p.option_names, 1) AS i
            WHERE p.tenant_id = {tenant.TenantId} AND p.id = ANY({ids}) AND v.option_values[i] IS NOT NULL AND v.option_values[i] <> ''
            GROUP BY lower(p.option_names[i]), v.option_values[i]
            """).ToListAsync(ct);
        var options = rows.GroupBy(r => r.Key).OrderBy(g => g.Key == "size" ? 0 : g.Key is "colour" or "color" ? 1 : 2).ThenBy(g => g.Key)
            .Select(g => new Facet(g.Min(r => r.Name)!, g.OrderByDescending(r => r.Count).ThenBy(r => r.Value).Take(MaxFacetValues)
                .OrderBy(r => SizeOrder(r.Value)).ThenBy(r => r.Value, StringComparer.OrdinalIgnoreCase).Select(r => new FacetValue(r.Value, r.Count)).ToList()))
            .Where(f => f.Values.Count >= 2)
            .ToList();
        var prices = await db.ProductVariants.AsNoTracking().Where(v => v.IsActive && ids.Contains(v.ProductId))
            .GroupBy(_ => 1).Select(g => new { Min = g.Min(v => v.Price), Max = g.Max(v => v.Price) }).FirstOrDefaultAsync(ct);
        return Results.Ok(new Facets(options, prices?.Min, prices?.Max));
    }

    private sealed record FacetRow(string Key, string Name, string Value, int Count);

    private static readonly string[] Sizes = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "3XL", "4XL"];
    /// <summary>Clothing sizes in size order, numbers numerically, everything else after.</summary>
    public static (int, decimal) SizeOrder(string v)
    {
        var i = Array.FindIndex(Sizes, s => s.Equals(v.Trim(), StringComparison.OrdinalIgnoreCase));
        if (i >= 0) return (0, i);
        var m = Regex.Match(v, @"^\d+(\.\d+)?");
        return m.Success ? (1, decimal.Parse(m.Value, System.Globalization.CultureInfo.InvariantCulture)) : (2, 0);
    }

    /// <summary>
    /// Product ids whose active variants offer every requested option (any of the values given for the same option).
    /// Filters look like "Size:M"; names match case-insensitively.
    /// </summary>
    public static async Task<IQueryable<Product>> WithOptionsAsync(IQueryable<Product> query, AppDbContext db, TenantContext tenant, string[]? opts, CancellationToken ct)
    {
        if (opts is null || opts.Length == 0) return query;
        var wanted = opts.Take(20).Select(o => o.Split(':', 2)).Where(p => p.Length == 2 && p[0].Trim().Length > 0 && p[1].Trim().Length > 0)
            .GroupBy(p => p[0].Trim().ToLowerInvariant(), p => p[1].Trim()).ToList();
        foreach (var g in wanted)
        {
            var values = g.Distinct().Take(MaxFacetValues).ToArray();
            var ids = await db.Database.SqlQuery<Guid>($"""
                SELECT DISTINCT p.id AS "Value"
                FROM products p
                JOIN product_variants v ON v.product_id = p.id AND v.is_active
                CROSS JOIN LATERAL generate_subscripts(p.option_names, 1) AS i
                WHERE p.tenant_id = {tenant.TenantId} AND lower(p.option_names[i]) = {g.Key} AND v.option_values[i] = ANY({values})
                """).ToListAsync(ct);
            query = query.Where(p => ids.Contains(p.Id));
        }
        return query;
    }

    // ---------- Admin: home page ----------

    private static StorefrontSettingsDto ToDto(StorefrontSettings s) =>
        new(s.HeroHeading, s.HeroText, s.HeroMediaId, s.Announcement, s.ShowCategories, s.ShowNewArrivals, s.ShowSale, s.FeaturedCollectionId);

    private static async Task<IResult> GetSettings(AppDbContext db, CancellationToken ct) =>
        Results.Ok(ToDto(await db.StorefrontSettings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new StorefrontSettings()));

    private static async Task<IResult> PutSettings(StorefrontSettingsDto req, AppDbContext db, TenantContext tenant, AuditWriter audit,
        IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        if (req.HeroMediaId is { } mid && !await db.ProductMedia.AnyAsync(m => m.Id == mid && m.Status == MediaStatus.Ready, ct))
            throw AppException.Invalid("heroMediaId", "Choose one of your product photos.");
        if (req.FeaturedCollectionId is { } cid && !await db.Collections.AnyAsync(c => c.Id == cid, ct))
            throw AppException.Invalid("featuredCollectionId", "That collection doesn't exist.");
        var s = await db.StorefrontSettings.FirstOrDefaultAsync(ct);
        if (s is null) { s = new StorefrontSettings { TenantId = tenant.TenantId!.Value }; db.StorefrontSettings.Add(s); }
        s.HeroHeading = Clean(req.HeroHeading);
        s.HeroText = Clean(req.HeroText);
        s.HeroMediaId = req.HeroMediaId;
        s.Announcement = Clean(req.Announcement);
        s.ShowCategories = req.ShowCategories;
        s.ShowNewArrivals = req.ShowNewArrivals;
        s.ShowSale = req.ShowSale;
        s.FeaturedCollectionId = req.FeaturedCollectionId;
        s.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "storefront.updated", "storefront", tenant.TenantId, null);
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.Ok(ToDto(s));
    }

    private static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    private static async Task<IResult> HeroImages(AppDbContext db, IObjectStorage storage, CancellationToken ct)
    {
        var rows = await db.ProductMedia.AsNoTracking().Where(m => m.Status == MediaStatus.Ready)
            .Join(db.Products, m => m.ProductId, p => p.Id, (m, p) => new { m.Id, m.StorageKey, m.AltText, p.Title, p.CreatedAt, m.Position })
            .OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Position).Take(60).ToListAsync(ct);
        return Results.Ok(rows.Select(r => new HeroImageOption(r.Id, storage.PublicUrl(r.StorageKey), r.AltText, r.Title)).ToList());
    }

    // ---------- Admin: pages ----------

    private static PageDto ToDto(StorePage p) => new(p.Id, p.Slug, p.Title, p.Body, p.Published, p.Position, p.UpdatedAt);

    private static async Task<IResult> ListPages(AppDbContext db, CancellationToken ct) =>
        Results.Ok((await db.StorePages.AsNoTracking().OrderBy(p => p.Position).ThenBy(p => p.Title).ToListAsync(ct)).Select(ToDto));

    private static async Task<string> UniqueSlugAsync(IQueryable<string> taken, string? requested, string title, Guid? except, CancellationToken ct)
    {
        var slug = string.IsNullOrEmpty(requested) ? Common.Slug.From(title) : requested;
        if (string.IsNullOrEmpty(slug)) throw AppException.Invalid("slug", "Give it a web address (letters and numbers).");
        if (await taken.AnyAsync(s => s == slug, ct)) throw AppException.Invalid("slug", "Another one already uses this web address.");
        return slug;
    }

    private static async Task<IResult> CreatePage(PageRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        if (await db.StorePages.CountAsync(ct) >= MaxPages) throw AppException.Invalid("title", $"A store can have up to {MaxPages} pages.");
        var slug = await UniqueSlugAsync(db.StorePages.Select(p => p.Slug), req.Slug, req.Title, null, ct);
        var page = new StorePage
        {
            Id = Guid.CreateVersion7(), TenantId = tenant.TenantId!.Value, Slug = slug, Title = req.Title.Trim(), Body = req.Body.Trim(), Published = req.Published,
            Position = await db.StorePages.CountAsync(ct), UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.StorePages.Add(page);
        audit.Record(db, "page.created", "page", page.Id, new { page.Title });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.Created($"/api/admin/pages/{page.Id}", ToDto(page));
    }

    private static async Task<IResult> UpdatePage(Guid id, PageRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        var page = await db.StorePages.FirstOrDefaultAsync(p => p.Id == id, ct) ?? throw AppException.NotFound("Page");
        page.Slug = await UniqueSlugAsync(db.StorePages.Where(p => p.Id != id).Select(p => p.Slug), req.Slug ?? page.Slug, req.Title, id, ct);
        page.Title = req.Title.Trim();
        page.Body = req.Body.Trim();
        page.Published = req.Published;
        page.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "page.updated", "page", page.Id, new { page.Title, page.Published });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.Ok(ToDto(page));
    }

    private static async Task<IResult> DeletePage(Guid id, AppDbContext db, TenantContext tenant, AuditWriter audit, IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        var page = await db.StorePages.FirstOrDefaultAsync(p => p.Id == id, ct) ?? throw AppException.NotFound("Page");
        db.StorePages.Remove(page);
        audit.Record(db, "page.deleted", "page", page.Id, new { page.Title });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.NoContent();
    }

    // ---------- Admin: collections ----------

    private static async Task<IResult> ListCollections(AppDbContext db, CancellationToken ct)
    {
        var cols = await db.Collections.AsNoTracking().OrderBy(c => c.Position).ThenBy(c => c.Title).ToListAsync(ct);
        var result = new List<CollectionDto>();
        foreach (var c in cols)
            result.Add(new CollectionDto(c.Id, c.Title, c.Slug, c.Description, c.Tag, c.Published, c.Position, await Tagged(Active(db), c.Tag).CountAsync(ct), c.UpdatedAt));
        return Results.Ok(result);
    }

    private static async Task<IResult> CreateCollection(CollectionRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        if (await db.Collections.CountAsync(ct) >= MaxCollections) throw AppException.Invalid("title", $"A store can have up to {MaxCollections} collections.");
        var slug = await UniqueSlugAsync(db.Collections.Select(c => c.Slug), req.Slug, req.Title, null, ct);
        var c = new Collection
        {
            Id = Guid.CreateVersion7(), TenantId = tenant.TenantId!.Value, Title = req.Title.Trim(), Slug = slug, Description = Clean(req.Description),
            Tag = req.Tag.Trim(), Published = req.Published, Position = await db.Collections.CountAsync(ct), UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Collections.Add(c);
        audit.Record(db, "collection.created", "collection", c.Id, new { c.Title, c.Tag });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.Created($"/api/admin/collections/{c.Id}", new CollectionDto(c.Id, c.Title, c.Slug, c.Description, c.Tag, c.Published, c.Position,
            await Tagged(Active(db), c.Tag).CountAsync(ct), c.UpdatedAt));
    }

    private static async Task<IResult> UpdateCollection(Guid id, CollectionRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        var c = await db.Collections.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Collection");
        c.Slug = await UniqueSlugAsync(db.Collections.Where(x => x.Id != id).Select(x => x.Slug), req.Slug ?? c.Slug, req.Title, id, ct);
        c.Title = req.Title.Trim();
        c.Description = Clean(req.Description);
        c.Tag = req.Tag.Trim();
        c.Published = req.Published;
        c.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "collection.updated", "collection", c.Id, new { c.Title, c.Tag, c.Published });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.Ok(new CollectionDto(c.Id, c.Title, c.Slug, c.Description, c.Tag, c.Published, c.Position, await Tagged(Active(db), c.Tag).CountAsync(ct), c.UpdatedAt));
    }

    private static async Task<IResult> DeleteCollection(Guid id, AppDbContext db, TenantContext tenant, AuditWriter audit, IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        var c = await db.Collections.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Collection");
        db.Collections.Remove(c);
        audit.Record(db, "collection.deleted", "collection", c.Id, new { c.Title });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.NoContent();
    }
}
