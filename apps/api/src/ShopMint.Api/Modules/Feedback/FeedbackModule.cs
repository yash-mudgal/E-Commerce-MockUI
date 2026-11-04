using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;

namespace ShopMint.Api.Modules.Feedback;

public enum FeedbackCategory { Problem, Idea, Question, Other }
public enum FeedbackStatus { New, Triaged, Planned, Done, Declined }

/// <summary>
/// A merchant's message to the ShopMint team, sent from the admin. Tenant-owned, but write-only for the request path:
/// the app role may insert rows for its own store and can't read any back (like the email outbox). Platform admins
/// triage them under the platform role.
/// </summary>
public sealed class FeedbackItem : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public FeedbackCategory Category { get; set; }
    public string Message { get; set; } = "";
    /// <summary>The admin page it was sent from (path only, no query string).</summary>
    public string? Page { get; set; }
    /// <summary>Whether the sender agreed to be contacted about it; their email is shown to the team only then.</summary>
    public bool MayContact { get; set; }
    public FeedbackStatus Status { get; set; }
    public string? TeamNote { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed record SendFeedbackRequest(string Category, string Message, string? Page, bool MayContact);
public sealed record SentFeedback(Guid Id);
public sealed record FeedbackRow(Guid Id, string Category, string Message, string? Page, string Status, string? TeamNote, Guid StoreId, string StoreName,
    string? ContactEmail, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record FeedbackCounts(int New, int Triaged, int Planned, int Done, int Declined);
public sealed record FeedbackPage(IReadOnlyList<FeedbackRow> Items, int Page, int PageSize, int TotalCount, FeedbackCounts Counts);
public sealed record UpdateFeedbackRequest(string Status, string? TeamNote);

public sealed class SendFeedbackValidator : AbstractValidator<SendFeedbackRequest>
{
    public SendFeedbackValidator()
    {
        RuleFor(x => x.Category).Must(c => Enum.TryParse<FeedbackCategory>(c, true, out _)).WithMessage("Choose what this is about.");
        RuleFor(x => x.Message).Must(m => !string.IsNullOrWhiteSpace(m) && m.Trim().Length >= 10)
            .WithMessage("Tell us a little more (at least 10 characters).").MaximumLength(2000);
        RuleFor(x => x.Page).MaximumLength(300).Matches("^/[A-Za-z0-9/_\\-]*$").When(x => !string.IsNullOrEmpty(x.Page))
            .WithMessage("Page must be a path.");
    }
}

public sealed class UpdateFeedbackValidator : AbstractValidator<UpdateFeedbackRequest>
{
    public UpdateFeedbackValidator()
    {
        RuleFor(x => x.Status).Must(s => Enum.TryParse<FeedbackStatus>(s, true, out _)).WithMessage("Unknown status.");
        RuleFor(x => x.TeamNote).MaximumLength(2000);
    }
}

public static class FeedbackEndpoints
{
    public const int PerUserPerHour = 10;

    public static void MapAdmin(RouteGroupBuilder admin) =>
        // Any member may send feedback; no special permission. Rate-limited per user.
        admin.MapPost("/feedback", Send).Validate<SendFeedbackRequest>().RequireRateLimiting("feedback");

    public static void MapPlatform(RouteGroupBuilder platform)
    {
        platform.MapGet("/feedback", List);
        platform.MapPatch("/feedback/{id:guid}", Update).Validate<UpdateFeedbackRequest>();
    }

    private static async Task<IResult> Send(SendFeedbackRequest req, AppDbContext db, TenantContext tenant, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var item = new FeedbackItem
        {
            Id = Guid.CreateVersion7(),
            TenantId = tenant.RequireTenant(),
            UserId = tenant.UserId ?? throw new InvalidOperationException("Admin routes always carry a signed-in user."),
            Category = Enum.Parse<FeedbackCategory>(req.Category, true),
            Message = req.Message.Trim(),
            Page = string.IsNullOrEmpty(req.Page) ? null : req.Page,
            MayContact = req.MayContact,
            Status = FeedbackStatus.New,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Feedback.Add(item);
        await db.SaveChangesAsync(ct);
        return Results.Created((string?)null, new SentFeedback(item.Id));
    }

    private static async Task<IResult> List(PlatformDbContext db, [FromQuery] string? status, [FromQuery] string? category, [FromQuery] string? q,
        [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, pageSize);
        var query = db.Feedback.AsNoTracking();
        if (!string.IsNullOrEmpty(status))
        {
            if (!Enum.TryParse<FeedbackStatus>(status, true, out var st)) throw AppException.Invalid("status", "Unknown status.");
            query = query.Where(x => x.Status == st);
        }
        if (!string.IsNullOrEmpty(category))
        {
            if (!Enum.TryParse<FeedbackCategory>(category, true, out var cat)) throw AppException.Invalid("category", "Unknown category.");
            query = query.Where(x => x.Category == cat);
        }
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = $"%{Catalog.CatalogEndpoints.EscapeLike(q.Trim())}%";
            query = query.Where(x => EF.Functions.ILike(x.Message, term, "\\"));
        }
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(x => x.CreatedAt).Skip((pg - 1) * size).Take(size)
            .Select(x => new FeedbackRow(x.Id, x.Category.ToString(), x.Message, x.Page, x.Status.ToString(), x.TeamNote, x.TenantId,
                db.Tenants.Where(t => t.Id == x.TenantId).Select(t => t.Name).First(),
                x.MayContact ? db.Users.Where(u => u.Id == x.UserId).Select(u => u.Email).FirstOrDefault() : null,
                x.CreatedAt, x.UpdatedAt))
            .ToListAsync(ct);
        var counts = await db.Feedback.AsNoTracking().GroupBy(x => x.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        int C(FeedbackStatus s) => counts.FirstOrDefault(c => c.Key == s)?.Count ?? 0;
        return Results.Ok(new FeedbackPage(items, pg, size, total,
            new FeedbackCounts(C(FeedbackStatus.New), C(FeedbackStatus.Triaged), C(FeedbackStatus.Planned), C(FeedbackStatus.Done), C(FeedbackStatus.Declined))));
    }

    private static async Task<IResult> Update(Guid id, UpdateFeedbackRequest req, PlatformDbContext db, CancellationToken ct)
    {
        var item = await db.Feedback.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Feedback");
        item.Status = Enum.Parse<FeedbackStatus>(req.Status, true);
        item.TeamNote = string.IsNullOrWhiteSpace(req.TeamNote) ? null : req.TeamNote.Trim();
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
