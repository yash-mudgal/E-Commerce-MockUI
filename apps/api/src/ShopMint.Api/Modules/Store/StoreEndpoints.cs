using System.Globalization;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Store;

public sealed record StoreDto(Guid Id, string Name, string Slug, string Host, string Status, string Plan, DateTimeOffset? TrialEndsAt,
    string? LegalName, string? Gstin, string? StateCode, string? Tagline, string? SupportEmail, string BrandColor, int LowStockThreshold,
    string? BusinessAddress, decimal ShippingFee, decimal? FreeShippingThreshold, bool CodEnabled, decimal CodMaxOrderValue);

/// <summary>Shipping and COD fields are optional so older clients that don't send them keep the current values.</summary>
public sealed record StoreUpdateRequest(string Name, string? LegalName, string? Gstin, string? StateCode, string? Tagline,
    string? SupportEmail, string BrandColor, int LowStockThreshold, string? BusinessAddress = null, decimal? ShippingFee = null,
    decimal? FreeShippingThreshold = null, bool? ClearFreeShipping = null, bool? CodEnabled = null, decimal? CodMaxOrderValue = null);

public sealed class StoreUpdateValidator : AbstractValidator<StoreUpdateRequest>
{
    public StoreUpdateValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.LegalName).MaximumLength(160);
        // GSTIN: 2-digit state code, 10-char PAN, entity number, 'Z', checksum.
        RuleFor(x => x.Gstin).Matches("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$").When(x => !string.IsNullOrEmpty(x.Gstin))
            .WithMessage("Enter a valid 15-character GSTIN.");
        RuleFor(x => x.StateCode).Matches("^[0-9]{2}$").When(x => !string.IsNullOrEmpty(x.StateCode));
        RuleFor(x => x).Must(x => string.IsNullOrEmpty(x.Gstin) || string.IsNullOrEmpty(x.StateCode) || x.Gstin[..2] == x.StateCode)
            .WithName("gstin").WithMessage("The GSTIN's first two digits must match the business state code.");
        RuleFor(x => x.Tagline).MaximumLength(200);
        RuleFor(x => x.SupportEmail).EmailAddress().When(x => !string.IsNullOrEmpty(x.SupportEmail));
        RuleFor(x => x.BrandColor).Must(BrandColor.IsValidHex).WithMessage("Use a hex colour like #4f46e5.")
            .Must(c => !BrandColor.IsValidHex(c) || BrandColor.ContrastWithWhite(c) >= 4.5)
            .WithMessage("This colour is too light for white button text (needs 4.5:1 contrast). Choose a darker shade.");
        RuleFor(x => x.LowStockThreshold).InclusiveBetween(0, 10_000);
        RuleFor(x => x.BusinessAddress).MaximumLength(500);
        RuleFor(x => x.ShippingFee).InclusiveBetween(0, 10_000).When(x => x.ShippingFee.HasValue);
        RuleFor(x => x.FreeShippingThreshold).InclusiveBetween(0, 10_000_000).When(x => x.FreeShippingThreshold.HasValue);
        RuleFor(x => x.CodMaxOrderValue).InclusiveBetween(1, 1_000_000).When(x => x.CodMaxOrderValue.HasValue);
    }
}

/// <summary>Accessible brand colours: white text on the brand colour must reach WCAG AA (4.5:1).</summary>
public static class BrandColor
{
    public static bool IsValidHex(string? hex) =>
        hex is { Length: 7 } && hex[0] == '#' && int.TryParse(hex.AsSpan(1), NumberStyles.HexNumber, null, out _);

    public static double ContrastWithWhite(string hex)
    {
        static double Channel(int c) { var s = c / 255.0; return s <= 0.03928 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4); }
        var v = int.Parse(hex.AsSpan(1), NumberStyles.HexNumber);
        var l = 0.2126 * Channel((v >> 16) & 255) + 0.7152 * Channel((v >> 8) & 255) + 0.0722 * Channel(v & 255);
        return 1.05 / (l + 0.05);
    }
}

public static class StoreEndpoints
{
    public static void Map(RouteGroupBuilder admin)
    {
        var g = admin.MapGroup("/store").WithTags("Store");
        g.MapGet("/", Get).RequireAuthorization(Session.TenantMemberPolicy);
        g.MapPatch("/", Update).Validate<StoreUpdateRequest>().RequirePermission(Permissions.SettingsWrite);
    }

    private static async Task<IResult> Get(AppDbContext db, TenantContext tenant, CancellationToken ct) =>
        Results.Ok(await Load(db, tenant.RequireTenant(), ct));

    private static async Task<IResult> Update(StoreUpdateRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, CancellationToken ct)
    {
        var id = tenant.RequireTenant();
        var t = await db.Tenants.FirstAsync(x => x.Id == id, ct);
        t.Name = req.Name.Trim();
        t.LegalName = Blank(req.LegalName);
        t.Gstin = Blank(req.Gstin);
        t.StateCode = Blank(req.StateCode) ?? t.Gstin?[..2];
        t.Tagline = Blank(req.Tagline);
        t.SupportEmail = Blank(req.SupportEmail);
        t.BrandColor = req.BrandColor.ToLowerInvariant();
        t.LowStockThreshold = req.LowStockThreshold;
        if (req.BusinessAddress is not null) t.BusinessAddress = Blank(req.BusinessAddress);
        if (req.ShippingFee is { } fee) t.ShippingFee = fee;
        if (req.ClearFreeShipping == true) t.FreeShippingThreshold = null;
        else if (req.FreeShippingThreshold is { } free) t.FreeShippingThreshold = free;
        if (req.CodEnabled is { } cod) t.CodEnabled = cod;
        if (req.CodMaxOrderValue is { } codMax) t.CodMaxOrderValue = codMax;
        t.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "store.settings_updated", "tenant", id, new { t.Name, t.Gstin, t.BrandColor });
        await db.SaveChangesAsync(ct);
        return Results.Ok(await Load(db, id, ct));
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static Task<StoreDto> Load(AppDbContext db, Guid id, CancellationToken ct) =>
        db.Tenants.AsNoTracking().Where(t => t.Id == id).Select(t => new StoreDto(t.Id, t.Name, t.Slug,
            t.Domains.OrderBy(d => d.Kind).Select(d => d.Host).FirstOrDefault() ?? "", t.Status.ToString(), t.PlanCode,
            t.TrialEndsAt, t.LegalName, t.Gstin, t.StateCode, t.Tagline, t.SupportEmail, t.BrandColor, t.LowStockThreshold,
            t.BusinessAddress, t.ShippingFee, t.FreeShippingThreshold, t.CodEnabled, t.CodMaxOrderValue))
            .FirstAsync(ct);
}
