using System.Globalization;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Platform;

namespace ShopMint.Api.Modules.Catalog;

/// <summary>Application service for catalogue writes. HTTP concerns stay in <see cref="CatalogEndpoints"/>.</summary>
public sealed class ProductService(AppDbContext db, TenantContext tenant, AuditWriter audit)
{
    public async Task<ProductDto> CreateAsync(ProductRequest req, CancellationToken ct)
    {
        var tenantId = tenant.RequireTenant();
        var plan = await db.Tenants.Where(t => t.Id == tenantId).Select(t => t.PlanCode).FirstAsync(ct);
        Plans.EnsureProductCapacity(plan, await db.Products.CountAsync(p => p.Status != ProductStatus.Archived, ct));
        await EnsureCategoryAsync(req.CategoryId, ct);

        var now = DateTimeOffset.UtcNow;
        var product = new Product
        {
            Id = Guid.CreateVersion7(), CreatedAt = now,
            Slug = await UniqueSlugAsync(string.IsNullOrEmpty(req.Slug) ? Slug.From(req.Title) : req.Slug, null, ct),
        };
        Apply(product, req, now);
        var location = await DefaultLocationAsync(ct);
        var position = 0;
        foreach (var v in req.Variants)
        {
            var variant = NewVariant(product, v, position++);
            product.Variants.Add(variant);
            SetStock(variant, location, v.StockOnHand, StockMovementReason.Initial, now);
        }
        db.Products.Add(product);
        audit.Record(db, "product.created", "product", product.Id, new { product.Title, variants = product.Variants.Count });
        await db.SaveChangesAsync(ct);
        return await GetAsync(product.Id, ct);
    }

    public async Task<ProductDto> UpdateAsync(Guid id, ProductRequest req, string? ifMatch, CancellationToken ct)
    {
        // Two SaveChanges calls below (removals, then upserts) must commit or roll back together.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var product = await db.Products.Include(p => p.Variants).ThenInclude(v => v.StockLevels)
            .FirstOrDefaultAsync(p => p.Id == id, ct) ?? throw AppException.NotFound("Product");

        if (!string.IsNullOrEmpty(ifMatch) && ifMatch.Trim('"') != product.Version.ToString(CultureInfo.InvariantCulture))
            throw AppException.Conflict("This product was changed by someone else. Reload to see the latest version.", ProblemTypes.Concurrency);
        // Make EF compare against the version the client saw, so a concurrent writer is detected even between our read and write.
        db.Entry(product).Property(p => p.Version).OriginalValue = product.Version;

        await EnsureCategoryAsync(req.CategoryId, ct);
        var now = DateTimeOffset.UtcNow;
        if (!string.IsNullOrEmpty(req.Slug) && req.Slug != product.Slug)
            product.Slug = await UniqueSlugAsync(req.Slug, product.Id, ct);
        Apply(product, req, now);

        var location = await DefaultLocationAsync(ct);
        var incomingIds = req.Variants.Where(v => v.Id.HasValue).Select(v => v.Id!.Value).ToHashSet();
        var unknown = incomingIds.Except(product.Variants.Select(v => v.Id)).ToList();
        if (unknown.Count > 0) throw AppException.Invalid("variants", "One or more variants do not belong to this product.");

        // Removed variants: there are no orders yet (Phase 8 will block deleting ordered variants and archive instead).
        foreach (var removed in product.Variants.Where(v => !incomingIds.Contains(v.Id)).ToList())
        {
            product.Variants.Remove(removed);
            db.ProductVariants.Remove(removed);
        }
        // Delete-then-insert of a reused SKU must not collide with the unique index inside one SaveChanges.
        await db.SaveChangesAsync(ct);

        var position = 0;
        foreach (var input in req.Variants)
        {
            var variant = input.Id is { } vid ? product.Variants.First(v => v.Id == vid) : null;
            if (variant is null)
            {
                // Explicit Add: a new entity with a client-generated key reached only through a navigation would be
                // treated as an existing (Modified) row.
                variant = NewVariant(product, input, position);
                variant.TenantId = product.TenantId;
                db.ProductVariants.Add(variant);
                product.Variants.Add(variant);
                SetStock(variant, location, input.StockOnHand, StockMovementReason.Initial, now);
            }
            else
            {
                variant.Sku = input.Sku.Trim();
                variant.OptionValues = Clean(input.OptionValues);
                variant.Price = input.Price;
                variant.Mrp = input.Mrp;
                variant.Cost = input.Cost;
                variant.IsActive = input.IsActive;
                variant.Position = position;
                SetStock(variant, location, input.StockOnHand, StockMovementReason.Adjustment, now);
            }
            position++;
        }

        audit.Record(db, "product.updated", "product", product.Id, new { product.Title, product.Status });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await GetAsync(product.Id, ct);
    }

    public async Task ArchiveAsync(Guid id, CancellationToken ct)
    {
        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == id, ct) ?? throw AppException.NotFound("Product");
        product.Status = ProductStatus.Archived;
        product.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "product.archived", "product", id);
        await db.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == id, ct) ?? throw AppException.NotFound("Product");
        db.Products.Remove(product);
        audit.Record(db, "product.deleted", "product", id, new { product.Title });
        await db.SaveChangesAsync(ct);
    }

    public async Task<ProductDto> GetAsync(Guid id, CancellationToken ct)
    {
        var p = await db.Products.AsNoTracking().AsSplitQuery()
            .Include(x => x.Category).Include(x => x.Variants).ThenInclude(v => v.StockLevels)
            .FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Product");
        return ToDto(p);
    }

    public static ProductDto ToDto(Product p) => new(p.Id, p.Title, p.Slug, p.Description, p.CategoryId, p.Category?.Name,
        p.Status.ToString().ToLowerInvariant(), p.HsnCode, p.GstRate, p.OptionNames, p.Tags,
        p.Variants.OrderBy(v => v.Position).Select(v => new VariantDto(v.Id, v.Sku, v.OptionValues, v.Price, v.Mrp, v.Cost,
            v.StockLevels.Sum(s => s.OnHand), v.StockLevels.Sum(s => s.Reserved), v.IsActive)).ToList(),
        p.CreatedAt, p.UpdatedAt, p.Version.ToString(CultureInfo.InvariantCulture));

    private static void Apply(Product p, ProductRequest r, DateTimeOffset now)
    {
        p.Title = r.Title.Trim();
        p.Description = r.Description?.Trim() ?? "";
        p.CategoryId = r.CategoryId;
        p.Status = Enum.Parse<ProductStatus>(r.Status, ignoreCase: true);
        p.HsnCode = string.IsNullOrEmpty(r.HsnCode) ? null : r.HsnCode;
        p.GstRate = r.GstRate;
        p.OptionNames = Clean(r.OptionNames);
        p.Tags = Clean(r.Tags).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        p.UpdatedAt = now;
    }

    private static string[] Clean(string[]? values) => (values ?? []).Select(v => v.Trim()).ToArray();

    private static ProductVariant NewVariant(Product p, VariantInput v, int position) => new()
    {
        Id = Guid.CreateVersion7(), ProductId = p.Id, Sku = v.Sku.Trim(), OptionValues = Clean(v.OptionValues),
        Price = v.Price, Mrp = v.Mrp, Cost = v.Cost, IsActive = v.IsActive, Position = position,
    };

    /// <summary>Sets on-hand stock at the default location and records the difference in the ledger.</summary>
    private void SetStock(ProductVariant variant, Location location, int target, StockMovementReason reason, DateTimeOffset now)
    {
        var level = variant.StockLevels.FirstOrDefault(s => s.LocationId == location.Id);
        if (level is null)
        {
            level = new StockLevel { TenantId = variant.TenantId, VariantId = variant.Id, LocationId = location.Id };
            db.StockLevels.Add(level);
            variant.StockLevels.Add(level);
        }
        var delta = target - level.OnHand;
        if (delta == 0 && reason != StockMovementReason.Initial) return;
        if (target < level.Reserved)
            throw AppException.Invalid("variants", $"Stock for {variant.Sku} cannot go below the {level.Reserved} units reserved for open orders.");
        level.OnHand = target;
        if (delta != 0)
            db.StockMovements.Add(new StockMovement
            {
                Id = Guid.CreateVersion7(), VariantId = variant.Id, LocationId = location.Id, Delta = delta,
                Reason = reason, ActorUserId = tenant.UserId, At = now,
            });
    }

    private async Task<Location> DefaultLocationAsync(CancellationToken ct) =>
        await db.Locations.OrderByDescending(l => l.IsDefault).ThenBy(l => l.CreatedAt).FirstOrDefaultAsync(ct)
        ?? throw new InvalidOperationException("Tenant has no stock location.");

    private async Task EnsureCategoryAsync(Guid? categoryId, CancellationToken ct)
    {
        // The tenant query filter makes another tenant's category look non-existent.
        if (categoryId is { } cid && !await db.Categories.AnyAsync(c => c.Id == cid, ct))
            throw AppException.Invalid("categoryId", "Category not found.");
    }

    private async Task<string> UniqueSlugAsync(string baseSlug, Guid? excludeId, CancellationToken ct)
    {
        var slug = baseSlug;
        for (var i = 2; await db.Products.AnyAsync(p => p.Slug == slug && p.Id != excludeId, ct); i++)
            slug = $"{baseSlug}-{i}";
        return slug;
    }
}
