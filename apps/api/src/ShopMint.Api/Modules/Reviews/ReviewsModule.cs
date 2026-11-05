using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Catalog;
using ShopMint.Api.Modules.Customers;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Modules.Storefront;

namespace ShopMint.Api.Modules.Reviews;

public enum ReviewStatus { Pending, Published, Hidden }

/// <summary>
/// A shopper's review of a product. Only shoppers with a delivered order containing the product may write one (one per
/// product, editable), and it appears on the storefront only after the store publishes it.
/// </summary>
public sealed class ProductReview : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ProductId { get; set; }
    public Guid CustomerId { get; set; }
    public int Rating { get; set; }
    public string? Title { get; set; }
    public string Body { get; set; } = "";
    public ReviewStatus Status { get; set; }
    /// <summary>The store's public reply, shown under the review.</summary>
    public string? Reply { get; set; }
    public DateTimeOffset? RepliedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>A product a signed-in shopper saved for later.</summary>
public sealed class WishlistItem : ITenantOwned
{
    public Guid TenantId { get; set; }
    public Guid CustomerId { get; set; }
    public Guid ProductId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed record RatingSummary(string? Average, int Count, int[] Distribution);
public sealed record PublicReview(Guid Id, int Rating, string? Title, string Body, string Author, DateTimeOffset CreatedAt, string? Reply, DateTimeOffset? RepliedAt);
public sealed record ReviewPage(RatingSummary Summary, IReadOnlyList<PublicReview> Items, int Page, int PageSize, int TotalCount);
public sealed record MyReview(int Rating, string? Title, string Body, string Status, DateTimeOffset UpdatedAt);
public sealed record ReviewEligibility(bool CanReview, string? Reason, MyReview? Review);
public sealed record WriteReviewRequest(int Rating, string? Title, string Body);
public sealed record AdminReviewRow(Guid Id, string ProductTitle, string ProductSlug, string CustomerName, string CustomerEmail, int Rating, string? Title,
    string Body, string Status, string? Reply, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record ReviewCounts(int Pending, int Published, int Hidden);
public sealed record AdminReviewPage(IReadOnlyList<AdminReviewRow> Items, int Page, int PageSize, int TotalCount, ReviewCounts Counts);
public sealed record ModerateReviewRequest(string? Status, string? Reply);

public sealed class WriteReviewValidator : AbstractValidator<WriteReviewRequest>
{
    public WriteReviewValidator()
    {
        RuleFor(x => x.Rating).InclusiveBetween(1, 5).WithMessage("Choose a rating from 1 to 5 stars.");
        RuleFor(x => x.Title).MaximumLength(100);
        RuleFor(x => x.Body).Must(b => !string.IsNullOrWhiteSpace(b) && b.Trim().Length >= 10)
            .WithMessage("Tell other shoppers a little more (at least 10 characters).").MaximumLength(2000);
    }
}

public sealed class ModerateReviewValidator : AbstractValidator<ModerateReviewRequest>
{
    public ModerateReviewValidator()
    {
        RuleFor(x => x.Status).Must(s => s is null || Enum.TryParse<ReviewStatus>(s, true, out _)).WithMessage("Unknown status.");
        RuleFor(x => x.Reply).MaximumLength(1000);
        RuleFor(x => x).Must(x => x.Status is not null || x.Reply is not null).WithName("status").WithMessage("Nothing to change.");
    }
}

public static class ReviewEndpoints
{
    public const int PageSize = 10;
    public const int MaxWishlist = 200;

    public static void Map(RouteGroupBuilder storefront, RouteGroupBuilder admin)
    {
        storefront.MapGet("/products/{slug}/reviews", List).WithTags("Reviews");
        storefront.MapGet("/products/{slug}/reviews/mine", Mine).WithTags("Reviews");
        storefront.MapPut("/products/{slug}/reviews/mine", Write).Validate<WriteReviewRequest>().RequireRateLimiting("reviews").WithTags("Reviews");

        var w = storefront.MapGroup("/account/wishlist").WithTags("Wishlist");
        w.MapGet("/", Wishlist);
        w.MapPut("/{slug}", Save);
        w.MapDelete("/{slug}", Unsave);

        var a = admin.MapGroup("/reviews").WithTags("Reviews");
        a.MapGet("/", AdminList).RequirePermission(Permissions.CatalogWrite);
        a.MapPatch("/{id:guid}", Moderate).Validate<ModerateReviewRequest>().RequirePermission(Permissions.CatalogWrite);
    }

    /// <summary>"Ananya Rao" → "Ananya R." Shoppers' full names and emails are never public.</summary>
    public static string Author(string name)
    {
        var parts = name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return "Verified buyer";
        return parts.Length == 1 ? parts[0] : $"{parts[0]} {char.ToUpperInvariant(parts[^1][0])}.";
    }

    private static async Task<Product> VisibleProduct(AppDbContext db, string slug, CancellationToken ct) =>
        await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug && p.Status == ProductStatus.Active, ct)
        ?? throw AppException.NotFound("Product");

    public static async Task<RatingSummary> SummaryAsync(AppDbContext db, Guid productId, CancellationToken ct)
    {
        var counts = await db.ProductReviews.AsNoTracking().Where(r => r.ProductId == productId && r.Status == ReviewStatus.Published)
            .GroupBy(r => r.Rating).Select(g => new { Rating = g.Key, Count = g.Count() }).ToListAsync(ct);
        var dist = Enumerable.Range(1, 5).Select(star => counts.FirstOrDefault(c => c.Rating == star)?.Count ?? 0).ToArray();
        var total = dist.Sum();
        string? avg = total == 0 ? null : (Math.Round((decimal)counts.Sum(c => c.Rating * c.Count) / total, 1)).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);
        return new RatingSummary(avg, total, dist);
    }

    private static async Task<IResult> List(string slug, [FromQuery] int? page, AppDbContext db, CancellationToken ct)
    {
        var product = await VisibleProduct(db, slug, ct);
        var (pg, size) = Paging.Normalize(page, PageSize);
        var q = db.ProductReviews.AsNoTracking().Where(r => r.ProductId == product.Id && r.Status == ReviewStatus.Published);
        var total = await q.CountAsync(ct);
        var rows = await q.OrderByDescending(r => r.CreatedAt).Skip((pg - 1) * size).Take(size)
            .Join(db.Customers, r => r.CustomerId, c => c.Id, (r, c) => new { r, c.Name }).ToListAsync(ct);
        var items = rows.Select(x => new PublicReview(x.r.Id, x.r.Rating, x.r.Title, x.r.Body, Author(x.Name), x.r.CreatedAt, x.r.Reply, x.r.RepliedAt)).ToList();
        return Results.Ok(new ReviewPage(await SummaryAsync(db, product.Id, ct), items, pg, size, total));
    }

    /// <summary>Received means a delivered order with this product; that is what "verified buyer" stands for.</summary>
    private static Task<bool> HasReceivedAsync(AppDbContext db, Guid customerId, Guid productId, CancellationToken ct) =>
        db.Orders.AnyAsync(o => o.CustomerId == customerId && o.Status == OrderStatus.Delivered
            && o.Lines.Any(l => l.VariantId != null && db.ProductVariants.Any(v => v.Id == l.VariantId && v.ProductId == productId)), ct);

    private static MyReview ToMine(ProductReview r) => new(r.Rating, r.Title, r.Body, r.Status.ToString(), r.UpdatedAt);

    private static async Task<IResult> Mine(string slug, AppDbContext db, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        var product = await VisibleProduct(db, slug, ct);
        var existing = await db.ProductReviews.AsNoTracking().FirstOrDefaultAsync(r => r.ProductId == product.Id && r.CustomerId == c.Id, ct);
        if (existing is not null) return Results.Ok(new ReviewEligibility(true, null, ToMine(existing)));
        return await HasReceivedAsync(db, c.Id, product.Id, ct)
            ? Results.Ok(new ReviewEligibility(true, null, null))
            : Results.Ok(new ReviewEligibility(false, "You can review this product once an order with it has been delivered to you.", null));
    }

    private static async Task<IResult> Write(string slug, WriteReviewRequest req, AppDbContext db, TenantContext tenant, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        var product = await VisibleProduct(db, slug, ct);
        var review = await db.ProductReviews.FirstOrDefaultAsync(r => r.ProductId == product.Id && r.CustomerId == c.Id, ct);
        if (review is null && !await HasReceivedAsync(db, c.Id, product.Id, ct))
            throw AppException.Forbidden("You can review this product once an order with it has been delivered to you.");
        var now = DateTimeOffset.UtcNow;
        if (review is null)
        {
            review = new ProductReview { Id = Guid.CreateVersion7(), TenantId = tenant.TenantId!.Value, ProductId = product.Id, CustomerId = c.Id, CreatedAt = now };
            db.ProductReviews.Add(review);
        }
        review.Rating = req.Rating;
        review.Title = string.IsNullOrWhiteSpace(req.Title) ? null : req.Title.Trim();
        review.Body = req.Body.Trim();
        // Every new or edited review is checked by the store before it is shown again.
        review.Status = ReviewStatus.Pending;
        review.UpdatedAt = now;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) when (db.ChangeTracker.Entries<ProductReview>().Any(e => e.State == EntityState.Added))
        {
            // Two submissions at once: the unique index keeps one review per shopper and product.
            throw AppException.Conflict("You've already reviewed this product. Reload to edit your review.");
        }
        return Results.Ok(ToMine(review));
    }

    // ---------- Wishlist ----------

    private static async Task<IResult> Wishlist(AppDbContext db, CustomerSession session, IObjectStorage storage, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        var ids = await db.WishlistItems.AsNoTracking().Where(w => w.CustomerId == c.Id).OrderByDescending(w => w.CreatedAt).Select(w => w.ProductId).ToListAsync(ct);
        var cards = await StorefrontEndpoints.CardsAsync(db, storage, db.Products.AsNoTracking().Where(p => ids.Contains(p.Id) && p.Status == ProductStatus.Active), ct);
        // Keep the order in which they were saved.
        var bySlug = cards.ToDictionary(x => x.Id);
        return Results.Ok(ids.Where(bySlug.ContainsKey).Select(id => bySlug[id].Card).ToList());
    }

    private static async Task<IResult> Save(string slug, AppDbContext db, TenantContext tenant, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        var product = await VisibleProduct(db, slug, ct);
        if (await db.WishlistItems.AnyAsync(w => w.CustomerId == c.Id && w.ProductId == product.Id, ct)) return Results.NoContent();
        if (await db.WishlistItems.CountAsync(w => w.CustomerId == c.Id, ct) >= MaxWishlist)
            throw AppException.Invalid("slug", $"Your wishlist can hold up to {MaxWishlist} products. Remove some to add more.");
        db.WishlistItems.Add(new WishlistItem { TenantId = tenant.TenantId!.Value, CustomerId = c.Id, ProductId = product.Id, CreatedAt = DateTimeOffset.UtcNow });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { /* saved twice at once: it's in the list either way */ }
        return Results.NoContent();
    }

    private static async Task<IResult> Unsave(string slug, AppDbContext db, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        await db.WishlistItems.Where(w => w.CustomerId == c.Id && db.Products.Any(p => p.Id == w.ProductId && p.Slug == slug)).ExecuteDeleteAsync(ct);
        return Results.NoContent();
    }

    // ---------- Admin moderation ----------

    private static async Task<IResult> AdminList([FromQuery] string? status, [FromQuery] int? page, AppDbContext db, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, 25);
        var q = db.ProductReviews.AsNoTracking();
        if (!string.IsNullOrEmpty(status))
        {
            if (!Enum.TryParse<ReviewStatus>(status, true, out var s)) throw AppException.Invalid("status", "Unknown status.");
            q = q.Where(r => r.Status == s);
        }
        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(r => r.UpdatedAt).Skip((pg - 1) * size).Take(size)
            .Join(db.Products, r => r.ProductId, p => p.Id, (r, p) => new { r, p.Title, p.Slug })
            .Join(db.Customers, x => x.r.CustomerId, c => c.Id, (x, c) => new AdminReviewRow(x.r.Id, x.Title, x.Slug, c.Name, c.Email, x.r.Rating, x.r.Title,
                x.r.Body, x.r.Status.ToString(), x.r.Reply, x.r.CreatedAt, x.r.UpdatedAt))
            .ToListAsync(ct);
        var counts = await db.ProductReviews.AsNoTracking().GroupBy(r => r.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        int Of(ReviewStatus s) => counts.FirstOrDefault(c => c.Key == s)?.Count ?? 0;
        return Results.Ok(new AdminReviewPage(items, pg, size, total, new ReviewCounts(Of(ReviewStatus.Pending), Of(ReviewStatus.Published), Of(ReviewStatus.Hidden))));
    }

    private static async Task<IResult> Moderate(Guid id, ModerateReviewRequest req, AppDbContext db, AuditWriter audit, IStorefrontRevalidator revalidator,
        TenantContext tenant, CancellationToken ct)
    {
        var r = await db.ProductReviews.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Review");
        var now = DateTimeOffset.UtcNow;
        if (req.Status is not null) r.Status = Enum.Parse<ReviewStatus>(req.Status, true);
        if (req.Reply is not null)
        {
            r.Reply = string.IsNullOrWhiteSpace(req.Reply) ? null : req.Reply.Trim();
            r.RepliedAt = r.Reply is null ? null : now;
        }
        audit.Record(db, "review.moderated", "review", r.Id, new { status = r.Status.ToString(), replied = r.Reply is not null });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.Ok(new { status = r.Status.ToString(), r.Reply, r.RepliedAt });
    }
}
