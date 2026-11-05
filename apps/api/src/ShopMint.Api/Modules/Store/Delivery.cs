using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Storefront;

namespace ShopMint.Api.Modules.Store;

/// <summary>
/// A delivery zone: PIN codes that start with any of its prefixes ("110" = Delhi, "4000" = central Mumbai…). A zone can
/// change the fee, the free-shipping threshold, the delivery estimate and whether cash on delivery is offered.
/// The longest matching prefix wins; PIN codes in no zone use the store's defaults, or aren't served if the store
/// delivers only to its zones.
/// </summary>
public sealed class ShippingZone : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Name { get; set; } = "";
    public string[] PincodePrefixes { get; set; } = [];
    /// <summary>Null: the store's fee.</summary>
    public decimal? Fee { get; set; }
    /// <summary>Null: the store's threshold.</summary>
    public decimal? FreeShippingThreshold { get; set; }
    public int MinDays { get; set; }
    public int MaxDays { get; set; }
    public bool CodAvailable { get; set; } = true;
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>What delivery to one PIN code costs and takes. Checkout and the storefront both use this.</summary>
public sealed record DeliveryTerms(bool Serviceable, string? ZoneName, decimal Fee, decimal? FreeShippingThreshold, bool CodAllowed, int? MinDays, int? MaxDays);
public sealed record DeliveryCheck(string Pincode, bool Serviceable, decimal Fee, decimal? FreeShippingThreshold, bool Cod, decimal CodMaxOrderValue, int? MinDays, int? MaxDays);
public sealed record ShippingZoneDto(Guid Id, string Name, string[] PincodePrefixes, decimal? Fee, decimal? FreeShippingThreshold, int MinDays, int MaxDays, bool CodAvailable);
public sealed record ShippingZoneRequest(string Name, string[] PincodePrefixes, decimal? Fee, decimal? FreeShippingThreshold, int MinDays, int MaxDays, bool CodAvailable);

public sealed class ShippingZoneValidator : AbstractValidator<ShippingZoneRequest>
{
    public ShippingZoneValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(60);
        RuleFor(x => x.PincodePrefixes).NotEmpty().WithMessage("Add at least one PIN code or prefix.")
            .Must(p => p.Length <= 200).WithMessage("A zone can list up to 200 prefixes.");
        RuleForEach(x => x.PincodePrefixes).Matches("^[1-9][0-9]{0,5}$").WithMessage("Use 1–6 digits, like 110 or 400001 (PIN codes don't start with 0).");
        RuleFor(x => x.Fee).InclusiveBetween(0, 10_000).When(x => x.Fee.HasValue);
        RuleFor(x => x.FreeShippingThreshold).InclusiveBetween(0, 10_000_000).When(x => x.FreeShippingThreshold.HasValue);
        RuleFor(x => x.MinDays).InclusiveBetween(0, 60);
        RuleFor(x => x.MaxDays).InclusiveBetween(0, 60).GreaterThanOrEqualTo(x => x.MinDays).WithMessage("The latest day can't be before the earliest.");
    }
}

public static class Delivery
{
    public const int MaxZones = 50;

    public static bool IsPincode(string? pin) => pin is { Length: 6 } && pin[0] != '0' && pin.All(char.IsAsciiDigit);

    /// <summary>The terms for a PIN code in the current store (RLS and the tenant filter scope the zones).</summary>
    public static async Task<DeliveryTerms> ForPincodeAsync(AppDbContext db, Guid tenantId, string pincode, CancellationToken ct)
    {
        var store = await db.Tenants.AsNoTracking().Where(t => t.Id == tenantId)
            .Select(t => new { t.ShippingFee, t.FreeShippingThreshold, t.CodEnabled, t.DeliverOnlyToZones, t.DeliveryMinDays, t.DeliveryMaxDays }).FirstAsync(ct);
        var zones = await db.ShippingZones.AsNoTracking().ToListAsync(ct);
        var zone = Match(zones, pincode);
        if (zone is null)
            return store.DeliverOnlyToZones
                ? new DeliveryTerms(false, null, store.ShippingFee, store.FreeShippingThreshold, false, null, null)
                : new DeliveryTerms(true, null, store.ShippingFee, store.FreeShippingThreshold, store.CodEnabled, store.DeliveryMinDays, store.DeliveryMaxDays);
        return new DeliveryTerms(true, zone.Name, zone.Fee ?? store.ShippingFee, zone.FreeShippingThreshold ?? store.FreeShippingThreshold,
            store.CodEnabled && zone.CodAvailable, zone.MinDays, zone.MaxDays);
    }

    /// <summary>The zone whose prefix matches most digits of the PIN code (ties: the zone listed first by name).</summary>
    public static ShippingZone? Match(IEnumerable<ShippingZone> zones, string pincode) =>
        zones.SelectMany(z => z.PincodePrefixes.Where(p => pincode.StartsWith(p, StringComparison.Ordinal)).Select(p => (Zone: z, p.Length)))
            .OrderByDescending(x => x.Length).ThenBy(x => x.Zone.Name, StringComparer.OrdinalIgnoreCase).Select(x => x.Zone).FirstOrDefault();

    public static void Map(RouteGroupBuilder storefront, RouteGroupBuilder admin)
    {
        storefront.MapGet("/delivery", Check).WithTags("Storefront");
        var z = admin.MapGroup("/shipping-zones").WithTags("Delivery");
        z.MapGet("/", List).RequirePermission(Permissions.SettingsWrite);
        z.MapPost("/", Create).Validate<ShippingZoneRequest>().RequirePermission(Permissions.SettingsWrite);
        z.MapPut("/{id:guid}", Update).Validate<ShippingZoneRequest>().RequirePermission(Permissions.SettingsWrite);
        z.MapDelete("/{id:guid}", Delete).RequirePermission(Permissions.SettingsWrite);
    }

    private static async Task<IResult> Check([FromQuery] string? pincode, AppDbContext db, TenantContext tenant, CancellationToken ct)
    {
        if (!IsPincode(pincode)) throw AppException.Invalid("pincode", "Enter a 6-digit PIN code.");
        var terms = await ForPincodeAsync(db, tenant.TenantId!.Value, pincode!, ct);
        var codMax = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.CodMaxOrderValue).FirstAsync(ct);
        return Results.Ok(new DeliveryCheck(pincode!, terms.Serviceable, terms.Fee, terms.FreeShippingThreshold, terms.Serviceable && terms.CodAllowed, codMax,
            terms.MinDays, terms.MaxDays));
    }

    private static ShippingZoneDto ToDto(ShippingZone z) => new(z.Id, z.Name, z.PincodePrefixes, z.Fee, z.FreeShippingThreshold, z.MinDays, z.MaxDays, z.CodAvailable);

    private static async Task<IResult> List(AppDbContext db, CancellationToken ct) =>
        Results.Ok((await db.ShippingZones.AsNoTracking().OrderBy(z => z.Name).ToListAsync(ct)).Select(ToDto));

    private static void Apply(ShippingZone z, ShippingZoneRequest r)
    {
        z.Name = r.Name.Trim();
        z.PincodePrefixes = r.PincodePrefixes.Select(p => p.Trim()).Distinct().Order(StringComparer.Ordinal).ToArray();
        z.Fee = r.Fee;
        z.FreeShippingThreshold = r.FreeShippingThreshold;
        z.MinDays = r.MinDays;
        z.MaxDays = r.MaxDays;
        z.CodAvailable = r.CodAvailable;
        z.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private static async Task<IResult> Create(ShippingZoneRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        if (await db.ShippingZones.CountAsync(ct) >= MaxZones) throw AppException.Invalid("name", $"A store can have up to {MaxZones} delivery zones.");
        var z = new ShippingZone { Id = Guid.CreateVersion7(), TenantId = tenant.TenantId!.Value };
        Apply(z, req);
        db.ShippingZones.Add(z);
        audit.Record(db, "delivery_zone.created", "shipping_zone", z.Id, new { z.Name });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.Created($"/api/admin/shipping-zones/{z.Id}", ToDto(z));
    }

    private static async Task<IResult> Update(Guid id, ShippingZoneRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        var z = await db.ShippingZones.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Delivery zone");
        Apply(z, req);
        audit.Record(db, "delivery_zone.updated", "shipping_zone", z.Id, new { z.Name });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.Ok(ToDto(z));
    }

    private static async Task<IResult> Delete(Guid id, AppDbContext db, TenantContext tenant, AuditWriter audit, IStorefrontRevalidator revalidator, CancellationToken ct)
    {
        var z = await db.ShippingZones.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Delivery zone");
        db.ShippingZones.Remove(z);
        audit.Record(db, "delivery_zone.deleted", "shipping_zone", z.Id, new { z.Name });
        await db.SaveChangesAsync(ct);
        revalidator.Enqueue(tenant.TenantId!.Value);
        return Results.NoContent();
    }
}
