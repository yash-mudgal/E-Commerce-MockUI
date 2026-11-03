using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Catalog;

public static class CatalogEndpoints
{
    public static void Map(RouteGroupBuilder admin)
    {
        var c = admin.MapGroup("/categories").WithTags("Catalog");
        c.MapGet("/", ListCategories).RequirePermission(Permissions.CatalogRead);
        c.MapPost("/", CreateCategory).Validate<CategoryRequest>().RequirePermission(Permissions.CatalogWrite);
        c.MapPut("/{id:guid}", UpdateCategory).Validate<CategoryRequest>().RequirePermission(Permissions.CatalogWrite);
        c.MapDelete("/{id:guid}", DeleteCategory).RequirePermission(Permissions.CatalogDelete);

        var p = admin.MapGroup("/products").WithTags("Catalog");
        p.MapGet("/", ListProducts).RequirePermission(Permissions.CatalogRead);
        p.MapGet("/{id:guid}", async (Guid id, ProductService svc, HttpContext http, CancellationToken ct) =>
        {
            var dto = await svc.GetAsync(id, ct);
            http.Response.Headers.ETag = $"\"{dto.Version}\"";
            return Results.Ok(dto);
        }).RequirePermission(Permissions.CatalogRead);
        p.MapPost("/", async (ProductRequest req, ProductService svc, CancellationToken ct) =>
        {
            var dto = await svc.CreateAsync(req, ct);
            return Results.Created($"/api/admin/products/{dto.Id}", dto);
        }).Validate<ProductRequest>().RequirePermission(Permissions.CatalogWrite);
        p.MapPut("/{id:guid}", async (Guid id, ProductRequest req, ProductService svc, HttpContext http, CancellationToken ct) =>
        {
            var dto = await svc.UpdateAsync(id, req, http.Request.Headers.IfMatch.ToString(), ct);
            http.Response.Headers.ETag = $"\"{dto.Version}\"";
            return Results.Ok(dto);
        }).Validate<ProductRequest>().RequirePermission(Permissions.CatalogWrite);
        p.MapPost("/{id:guid}/archive", async (Guid id, ProductService svc, CancellationToken ct) =>
        {
            await svc.ArchiveAsync(id, ct);
            return Results.NoContent();
        }).RequirePermission(Permissions.CatalogWrite);
        p.MapDelete("/{id:guid}", async (Guid id, ProductService svc, CancellationToken ct) =>
        {
            await svc.DeleteAsync(id, ct);
            return Results.NoContent();
        }).RequirePermission(Permissions.CatalogDelete);
    }

    private static async Task<IResult> ListCategories(AppDbContext db, CancellationToken ct) =>
        Results.Ok(await db.Categories.AsNoTracking().OrderBy(c => c.Position).ThenBy(c => c.Name)
            .Select(c => new CategoryDto(c.Id, c.Name, c.Slug, c.ParentId, c.Position,
                db.Products.Count(p => p.CategoryId == c.Id && p.Status != ProductStatus.Archived)))
            .ToListAsync(ct));

    private static async Task<IResult> CreateCategory(CategoryRequest req, AppDbContext db, AuditWriter audit, CancellationToken ct)
    {
        await EnsureParentAsync(db, req.ParentId, null, ct);
        var now = DateTimeOffset.UtcNow;
        var cat = new Category
        {
            Id = Guid.CreateVersion7(), Name = req.Name.Trim(), Slug = string.IsNullOrEmpty(req.Slug) ? Slug.From(req.Name) : req.Slug,
            ParentId = req.ParentId, Position = req.Position, CreatedAt = now, UpdatedAt = now,
        };
        db.Categories.Add(cat);
        audit.Record(db, "category.created", "category", cat.Id, new { cat.Name });
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/admin/categories/{cat.Id}", new CategoryDto(cat.Id, cat.Name, cat.Slug, cat.ParentId, cat.Position, 0));
    }

    private static async Task<IResult> UpdateCategory(Guid id, CategoryRequest req, AppDbContext db, AuditWriter audit, CancellationToken ct)
    {
        var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id, ct) ?? throw AppException.NotFound("Category");
        await EnsureParentAsync(db, req.ParentId, id, ct);
        cat.Name = req.Name.Trim();
        if (!string.IsNullOrEmpty(req.Slug)) cat.Slug = req.Slug;
        cat.ParentId = req.ParentId;
        cat.Position = req.Position;
        cat.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "category.updated", "category", id, new { cat.Name });
        await db.SaveChangesAsync(ct);
        var count = await db.Products.CountAsync(p => p.CategoryId == id && p.Status != ProductStatus.Archived, ct);
        return Results.Ok(new CategoryDto(cat.Id, cat.Name, cat.Slug, cat.ParentId, cat.Position, count));
    }

    private static async Task<IResult> DeleteCategory(Guid id, AppDbContext db, AuditWriter audit, CancellationToken ct)
    {
        var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id, ct) ?? throw AppException.NotFound("Category");
        if (await db.Products.AnyAsync(p => p.CategoryId == id, ct))
            throw AppException.Conflict("Move or delete the products in this category first.");
        if (await db.Categories.AnyAsync(c => c.ParentId == id, ct))
            throw AppException.Conflict("Move or delete the sub-categories of this category first.");
        db.Categories.Remove(cat);
        audit.Record(db, "category.deleted", "category", id, new { cat.Name });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    /// <summary>Only one level of nesting in the MVP; the parent must exist in this tenant and not be the category itself.</summary>
    private static async Task EnsureParentAsync(AppDbContext db, Guid? parentId, Guid? selfId, CancellationToken ct)
    {
        if (parentId is not { } pid) return;
        if (pid == selfId) throw AppException.Invalid("parentId", "A category cannot be its own parent.");
        var parent = await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == pid, ct)
            ?? throw AppException.Invalid("parentId", "Parent category not found.");
        if (parent.ParentId is not null) throw AppException.Invalid("parentId", "Only one level of sub-categories is supported.");
        if (selfId is { } sid && await db.Categories.AnyAsync(c => c.ParentId == sid, ct))
            throw AppException.Invalid("parentId", "A category with sub-categories cannot become a sub-category.");
    }

    private static async Task<IResult> ListProducts(AppDbContext db, [FromQuery] string? q, [FromQuery] string? status,
        [FromQuery] Guid? categoryId, [FromQuery] string? sort, [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, pageSize);
        var query = db.Products.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = $"%{EscapeLike(q.Trim())}%";
            query = query.Where(p => EF.Functions.ILike(p.Title, term, "\\") || p.Variants.Any(v => EF.Functions.ILike(v.Sku, term, "\\")));
        }
        if (!string.IsNullOrEmpty(status))
        {
            if (!Enum.TryParse<ProductStatus>(status, true, out var st))
                throw AppException.Invalid("status", "Status must be draft, active or archived.");
            query = query.Where(p => p.Status == st);
        }
        else query = query.Where(p => p.Status != ProductStatus.Archived);
        if (categoryId is { } cid) query = query.Where(p => p.CategoryId == cid);

        query = sort switch
        {
            "title" => query.OrderBy(p => p.Title),
            "-title" => query.OrderByDescending(p => p.Title),
            "price" => query.OrderBy(p => p.Variants.Min(v => (decimal?)v.Price)),
            "-price" => query.OrderByDescending(p => p.Variants.Min(v => (decimal?)v.Price)),
            "updatedAt" => query.OrderBy(p => p.UpdatedAt),
            "-updatedAt" or null or "" => query.OrderByDescending(p => p.UpdatedAt),
            _ => throw AppException.Invalid("sort", "Sort must be one of title, price, updatedAt (prefix - for descending)."),
        };

        var total = await query.CountAsync(ct);
        var items = await query.Skip((pg - 1) * size).Take(size)
            .Select(p => new ProductListItem(p.Id, p.Title, p.Slug, p.Status.ToString().ToLower(), p.CategoryId,
                p.Category != null ? p.Category.Name : null, p.Variants.Count,
                p.Variants.OrderBy(v => v.Position).Select(v => v.Sku).FirstOrDefault(),
                p.Variants.Min(v => (decimal?)v.Price), p.Variants.Max(v => (decimal?)v.Price),
                p.Variants.SelectMany(v => v.StockLevels).Sum(s => s.OnHand), p.UpdatedAt))
            .ToListAsync(ct);
        return Results.Ok(new Paged<ProductListItem>(items, pg, size, total));
    }

    public static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
