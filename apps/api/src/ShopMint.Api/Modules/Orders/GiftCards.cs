using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Customers;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Notifications;

namespace ShopMint.Api.Modules.Orders;

public enum GiftCardTxnKind { Issued, Redeemed, Restored, Disabled }

/// <summary>
/// A store-issued gift card: a bearer code worth a balance at this store. Only a hash of the code is stored (the code
/// is shown once, when issued, and emailed to the recipient if asked). It pays for orders like a payment method, not a
/// discount, so GST is charged on the full price.
/// </summary>
public sealed class GiftCard : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string CodeHash { get; set; } = "";
    public string Last4 { get; set; } = "";
    public decimal InitialValue { get; set; }
    public decimal Balance { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public bool IsActive { get; set; } = true;
    public string? RecipientName { get; set; }
    public string? RecipientEmail { get; set; }
    public string? Note { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public uint Version { get; set; }
}

/// <summary>Every change to a card's balance, with the order it paid for or came back from.</summary>
public sealed class GiftCardTransaction : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid GiftCardId { get; set; }
    public Guid? OrderId { get; set; }
    public GiftCardTxnKind Kind { get; set; }
    public decimal Amount { get; set; }
    public decimal BalanceAfter { get; set; }
    public Guid? ActorUserId { get; set; }
    public DateTimeOffset At { get; set; }
}

public sealed record IssueGiftCardRequest(decimal Value, DateTimeOffset? ExpiresAt, string? RecipientName, string? RecipientEmail, string? Note, bool SendEmail);
public sealed record GiftCardDto(Guid Id, string Last4, decimal InitialValue, decimal Balance, DateTimeOffset? ExpiresAt, bool IsActive, string Status,
    string? RecipientName, string? RecipientEmail, string? Note, DateTimeOffset CreatedAt);
public sealed record IssuedGiftCard(GiftCardDto Card, string Code);
public sealed record GiftCardTxnDto(string Kind, decimal Amount, decimal BalanceAfter, int? OrderNumber, DateTimeOffset At);
public sealed record GiftCardDetail(GiftCardDto Card, IReadOnlyList<GiftCardTxnDto> Transactions);
public sealed record CheckGiftCardRequest(string Code);
public sealed record GiftCardBalance(string Last4, decimal Balance, DateTimeOffset? ExpiresAt);

public sealed class IssueGiftCardValidator : AbstractValidator<IssueGiftCardRequest>
{
    public IssueGiftCardValidator()
    {
        RuleFor(x => x.Value).InclusiveBetween(1, 100_000).WithMessage("Gift cards are worth ₹1 to ₹1,00,000.")
            .Must(v => decimal.Round(v, 2) == v).WithMessage("Use at most two decimal places.");
        RuleFor(x => x.ExpiresAt).Must(e => e is null || e > DateTimeOffset.UtcNow).WithMessage("Choose a date in the future.");
        RuleFor(x => x.RecipientName).MaximumLength(120);
        RuleFor(x => x.RecipientEmail).EmailAddress().When(x => !string.IsNullOrEmpty(x.RecipientEmail));
        RuleFor(x => x.RecipientEmail).NotEmpty().When(x => x.SendEmail).WithMessage("Enter the email address to send it to.");
        RuleFor(x => x.Note).MaximumLength(300);
    }
}

public static class GiftCards
{
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
    public const int PerShopperCheckPerMinute = 10;

    /// <summary>16 random characters (80 bits) shown as XXXX-XXXX-XXXX-XXXX.</summary>
    public static string NewCode()
    {
        Span<byte> bytes = stackalloc byte[16];
        RandomNumberGenerator.Fill(bytes);
        var chars = new char[16];
        for (var i = 0; i < 16; i++) chars[i] = Alphabet[bytes[i] % Alphabet.Length];
        var s = new string(chars);
        return $"{s[..4]}-{s[4..8]}-{s[8..12]}-{s[12..]}";
    }

    /// <summary>Upper case, letters and digits only, so spaces, dashes and case don't matter when typing it.</summary>
    public static string Normalize(string code) => new(code.ToUpperInvariant().Where(char.IsAsciiLetterOrDigit).ToArray());

    public static string Hash(string code) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Normalize(code))));

    public static string Status(GiftCard c, DateTimeOffset now) =>
        !c.IsActive ? "Disabled" : c.ExpiresAt is { } e && e <= now ? "Expired" : c.Balance <= 0 ? "Used" : "Active";

    public static GiftCardDto ToDto(GiftCard c) => new(c.Id, c.Last4, c.InitialValue, c.Balance, c.ExpiresAt, c.IsActive, Status(c, DateTimeOffset.UtcNow),
        c.RecipientName, c.RecipientEmail, c.Note, c.CreatedAt);

    /// <summary>A card that can pay right now, or a shopper-facing reason it can't. Never says whether a wrong code exists elsewhere.</summary>
    public static async Task<GiftCard> UsableAsync(AppDbContext db, string code, bool track, CancellationToken ct)
    {
        var normalized = Normalize(code);
        if (normalized.Length != 16) throw AppException.Invalid("giftCardCode", "Gift card codes have 16 letters and numbers.");
        var hash = Hash(normalized);
        var q = track ? db.GiftCards.FromSql($"SELECT g.*, g.xmin FROM gift_cards g WHERE g.code_hash = {hash} FOR UPDATE") : db.GiftCards.AsNoTracking().Where(g => g.CodeHash == hash);
        var card = await q.FirstOrDefaultAsync(ct) ?? throw AppException.Invalid("giftCardCode", "We couldn't find that gift card. Check the code and try again.");
        return Status(card, DateTimeOffset.UtcNow) switch
        {
            "Disabled" => throw AppException.Invalid("giftCardCode", "This gift card has been disabled. Contact the store."),
            "Expired" => throw AppException.Invalid("giftCardCode", "This gift card has expired."),
            "Used" => throw AppException.Invalid("giftCardCode", "This gift card has no balance left."),
            _ => card,
        };
    }

    /// <summary>Puts money back on the order's card (cancelled, expired or refunded orders). Locks the card row.</summary>
    public static async Task RestoreAsync(AppDbContext db, Order order, decimal amount, Guid? actor, CancellationToken ct)
    {
        if (amount <= 0 || order.GiftCardId is not { } cardId) return;
        var card = await db.GiftCards.FromSql($"SELECT g.*, g.xmin FROM gift_cards g WHERE g.id = {cardId} FOR UPDATE").FirstAsync(ct);
        card.Balance += amount;
        card.UpdatedAt = DateTimeOffset.UtcNow;
        order.GiftCardRestored += amount;
        db.GiftCardTransactions.Add(new GiftCardTransaction
        {
            Id = Guid.CreateVersion7(), GiftCardId = card.Id, OrderId = order.Id, Kind = GiftCardTxnKind.Restored, Amount = amount, BalanceAfter = card.Balance,
            ActorUserId = actor, At = card.UpdatedAt,
        });
    }

    public static void Map(RouteGroupBuilder storefront, RouteGroupBuilder admin)
    {
        storefront.MapPost("/gift-cards/check", Check).Validate<CheckGiftCardRequest>().RequireRateLimiting("checkout").WithTags("Gift cards");
        var g = admin.MapGroup("/gift-cards").WithTags("Gift cards");
        g.MapGet("/", List).RequirePermission(Permissions.OrdersRead);
        g.MapGet("/{id:guid}", Get).RequirePermission(Permissions.OrdersRead);
        g.MapPost("/", Issue).Validate<IssueGiftCardRequest>().RequirePermission(Permissions.SettingsWrite);
        g.MapPost("/{id:guid}/disable", Disable).RequirePermission(Permissions.SettingsWrite);
    }

    public sealed class CheckValidator : AbstractValidator<CheckGiftCardRequest>
    {
        public CheckValidator() => RuleFor(x => x.Code).NotEmpty().MaximumLength(40);
    }

    /// <summary>Shoppers check a balance (signed in, rate-limited, so codes can't be guessed at speed).</summary>
    private static async Task<IResult> Check(CheckGiftCardRequest req, AppDbContext db, CustomerSession session, CancellationToken ct)
    {
        await session.RequireAsync(ct);
        var card = await UsableAsync(db, req.Code, track: false, ct);
        return Results.Ok(new GiftCardBalance(card.Last4, card.Balance, card.ExpiresAt));
    }

    private static async Task<IResult> List([FromQuery] string? q, [FromQuery] int? page, AppDbContext db, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, 25);
        var query = db.GiftCards.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToUpperInvariant();
            query = query.Where(c => c.Last4 == term || (c.RecipientEmail != null && c.RecipientEmail.Contains(q.Trim())) || (c.RecipientName != null && EF.Functions.ILike(c.RecipientName, $"%{CatalogEscape(q.Trim())}%", "\\")));
        }
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(c => c.CreatedAt).Skip((pg - 1) * size).Take(size).ToListAsync(ct);
        var outstanding = await db.GiftCards.Where(c => c.IsActive && (c.ExpiresAt == null || c.ExpiresAt > DateTimeOffset.UtcNow)).SumAsync(c => (decimal?)c.Balance, ct) ?? 0;
        return Results.Ok(new { items = items.Select(ToDto), page = pg, pageSize = size, totalCount = total, outstanding });
    }

    private static string CatalogEscape(string s) => Catalog.CatalogEndpoints.EscapeLike(s);

    private static async Task<IResult> Get(Guid id, AppDbContext db, CancellationToken ct)
    {
        var c = await db.GiftCards.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Gift card");
        var txns = await db.GiftCardTransactions.AsNoTracking().Where(t => t.GiftCardId == id).OrderByDescending(t => t.At)
            .Select(t => new GiftCardTxnDto(t.Kind.ToString(), t.Amount, t.BalanceAfter, db.Orders.Where(o => o.Id == t.OrderId).Select(o => (int?)o.Number).FirstOrDefault(), t.At))
            .ToListAsync(ct);
        return Results.Ok(new GiftCardDetail(ToDto(c), txns));
    }

    private static async Task<IResult> Issue(IssueGiftCardRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, EmailOutbox email,
        IConfiguration config, CancellationToken ct)
    {
        var code = NewCode();
        var now = DateTimeOffset.UtcNow;
        var card = new GiftCard
        {
            Id = Guid.CreateVersion7(), TenantId = tenant.RequireTenant(), CodeHash = Hash(code), Last4 = Normalize(code)[^4..], InitialValue = req.Value, Balance = req.Value,
            ExpiresAt = req.ExpiresAt, RecipientName = Blank(req.RecipientName), RecipientEmail = Blank(req.RecipientEmail), Note = Blank(req.Note),
            CreatedByUserId = tenant.UserId, CreatedAt = now, UpdatedAt = now,
        };
        db.GiftCards.Add(card);
        db.GiftCardTransactions.Add(new GiftCardTransaction
        {
            Id = Guid.CreateVersion7(), GiftCardId = card.Id, Kind = GiftCardTxnKind.Issued, Amount = req.Value, BalanceAfter = req.Value, ActorUserId = tenant.UserId, At = now,
        });
        // The code itself is never written to the audit log.
        audit.Record(db, "gift_card.issued", "gift_card", card.Id, new { card.Last4, card.InitialValue, emailed = req.SendEmail });
        if (req.SendEmail && card.RecipientEmail is { } to)
        {
            var store = await db.Tenants.AsNoTracking().Where(t => t.Id == tenant.TenantId)
                .Select(t => new { t.Name, Host = t.Domains.OrderBy(d => d.Kind).Select(d => d.Host).FirstOrDefault() }).FirstAsync(ct);
            email.GiftCardIssued(db, card.TenantId, store.Name, CustomerEndpoints.StorefrontUrl(config, store.Host ?? ""), to, card.RecipientName, code, card.InitialValue, card.ExpiresAt, card.Note);
        }
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/admin/gift-cards/{card.Id}", new IssuedGiftCard(ToDto(card), code));
    }

    private static async Task<IResult> Disable(Guid id, AppDbContext db, TenantContext tenant, AuditWriter audit, CancellationToken ct)
    {
        var card = await db.GiftCards.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Gift card");
        if (!card.IsActive) return Results.Ok(ToDto(card));
        card.IsActive = false;
        card.UpdatedAt = DateTimeOffset.UtcNow;
        db.GiftCardTransactions.Add(new GiftCardTransaction
        {
            Id = Guid.CreateVersion7(), GiftCardId = card.Id, Kind = GiftCardTxnKind.Disabled, Amount = 0, BalanceAfter = card.Balance, ActorUserId = tenant.UserId, At = card.UpdatedAt,
        });
        audit.Record(db, "gift_card.disabled", "gift_card", card.Id, new { card.Last4, card.Balance });
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(card));
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
