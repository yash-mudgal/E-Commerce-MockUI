using System.Globalization;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Orders;

public sealed record ShipRequest(string Carrier, string TrackingNumber, string? TrackingUrl);
public sealed record RefundRequest(decimal Amount, string Reason);
public sealed record CouponRequest(string Code, string Kind, decimal Value, decimal MinSubtotal, decimal? MaxDiscount, DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt, int? UsageLimit, int PerCustomerLimit, bool IsActive);
public sealed record CouponDto(Guid Id, string Code, string Kind, decimal Value, decimal MinSubtotal, decimal? MaxDiscount, DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt, int? UsageLimit, int PerCustomerLimit, int TimesUsed, bool IsActive, string Version);

public sealed class ShipValidator : AbstractValidator<ShipRequest>
{
    public ShipValidator()
    {
        RuleFor(x => x.Carrier).NotEmpty().MaximumLength(60);
        RuleFor(x => x.TrackingNumber).NotEmpty().MaximumLength(60);
        RuleFor(x => x.TrackingUrl).MaximumLength(500)
            .Must(u => Uri.TryCreate(u, UriKind.Absolute, out var x) && x.Scheme == Uri.UriSchemeHttps).When(x => !string.IsNullOrWhiteSpace(x.TrackingUrl))
            .WithMessage("Use a full https:// link.");
    }
}

public sealed class RefundValidator : AbstractValidator<RefundRequest>
{
    public RefundValidator()
    {
        RuleFor(x => x.Amount).GreaterThan(0).PrecisionScale(14, 2, true);
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(300);
    }
}

public sealed class CouponValidator : AbstractValidator<CouponRequest>
{
    public CouponValidator()
    {
        RuleFor(x => x.Code).NotEmpty().Length(3, 30).Matches("^[A-Za-z0-9_-]+$").WithMessage("Use letters, numbers, - and _ (3–30).");
        RuleFor(x => x.Kind).Must(k => k is "percent" or "fixed").WithMessage("Choose percent or fixed amount.");
        RuleFor(x => x.Value).GreaterThan(0).PrecisionScale(14, 2, true);
        RuleFor(x => x.Value).LessThanOrEqualTo(90).When(x => x.Kind == "percent").WithMessage("Percent discounts go up to 90%.");
        RuleFor(x => x.MinSubtotal).GreaterThanOrEqualTo(0);
        RuleFor(x => x.MaxDiscount).GreaterThan(0).When(x => x.MaxDiscount.HasValue);
        RuleFor(x => x.EndsAt).GreaterThan(x => x.StartsAt).When(x => x.StartsAt.HasValue && x.EndsAt.HasValue).WithMessage("End after the start.");
        RuleFor(x => x.UsageLimit).GreaterThan(0).When(x => x.UsageLimit.HasValue);
        RuleFor(x => x.PerCustomerLimit).InclusiveBetween(1, 100);
    }
}

public static class AdminOrderEndpoints
{
    public static void Map(RouteGroupBuilder admin)
    {
        var o = admin.MapGroup("/orders").WithTags("Orders");
        o.MapGet("/", List).RequirePermission(Permissions.OrdersRead);
        o.MapGet("/{id:guid}", Get).RequirePermission(Permissions.OrdersRead);
        o.MapPost("/{id:guid}/pack", async (Guid id, OrderService s, AppDbContext db, CancellationToken ct) => { await s.PackAsync(id, ct); return await Detail(db, id, ct); })
            .RequirePermission(Permissions.OrdersFulfil);
        o.MapPost("/{id:guid}/ship", async (Guid id, ShipRequest r, OrderService s, AppDbContext db, CancellationToken ct) =>
        {
            await s.ShipAsync(id, r.Carrier, r.TrackingNumber, r.TrackingUrl, ct);
            return await Detail(db, id, ct);
        }).Validate<ShipRequest>().RequirePermission(Permissions.OrdersFulfil);
        o.MapPost("/{id:guid}/deliver", async (Guid id, OrderService s, AppDbContext db, CancellationToken ct) => { await s.DeliverAsync(id, ct); return await Detail(db, id, ct); })
            .RequirePermission(Permissions.OrdersFulfil);
        o.MapPost("/{id:guid}/cancel", async (Guid id, CancelOrderRequest? r, OrderService s, AppDbContext db, CancellationToken ct) =>
        {
            await s.CancelAsync(id, string.IsNullOrWhiteSpace(r?.Reason) ? "Cancelled by the store." : r.Reason.Trim(), byShopper: false, ct);
            return await Detail(db, id, ct);
        }).RequirePermission(Permissions.OrdersRefund);
        o.MapPost("/{id:guid}/refunds", async (Guid id, RefundRequest r, OrderService s, AppDbContext db, TenantContext t, CancellationToken ct) =>
        {
            await s.RefundAsync(id, r.Amount, r.Reason.Trim(), t.UserId, allowUnpaid: false, ct);
            return await Detail(db, id, ct);
        }).Validate<RefundRequest>().RequirePermission(Permissions.OrdersRefund);

        var c = admin.MapGroup("/coupons").WithTags("Coupons");
        c.MapGet("/", ListCoupons).RequirePermission(Permissions.OrdersRead);
        c.MapPost("/", CreateCoupon).Validate<CouponRequest>().RequirePermission(Permissions.SettingsWrite);
        c.MapPut("/{id:guid}", UpdateCoupon).Validate<CouponRequest>().RequirePermission(Permissions.SettingsWrite);
        c.MapDelete("/{id:guid}", DeleteCoupon).RequirePermission(Permissions.SettingsWrite);
    }

    private static async Task<IResult> Detail(AppDbContext db, Guid id, CancellationToken ct) =>
        Results.Ok(OrderViews.Dto(await db.Orders.WithDetails().FirstOrDefaultAsync(o => o.Id == id, ct) ?? throw AppException.NotFound("Order"), shopper: false));

    private static Task<IResult> Get(Guid id, AppDbContext db, CancellationToken ct) => Detail(db, id, ct);

    private static async Task<IResult> List(AppDbContext db, [FromQuery] string? q, [FromQuery] string? status, [FromQuery] string? payment,
        [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, pageSize);
        var query = db.Orders.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().TrimStart('#');
            if (int.TryParse(term, NumberStyles.None, CultureInfo.InvariantCulture, out var number)) query = query.Where(o => o.Number == number);
            else
            {
                var like = $"%{Catalog.CatalogEndpoints.EscapeLike(term)}%";
                query = query.Where(o => EF.Functions.ILike(o.CustomerName, like, "\\") || EF.Functions.ILike(o.Email, like, "\\") || o.ShipPhone.Contains(term));
            }
        }
        if (!string.IsNullOrEmpty(status))
        {
            // "open" = needs work: confirmed or packed.
            if (status == "open") query = query.Where(o => o.Status == OrderStatus.Confirmed || o.Status == OrderStatus.Packed);
            else if (Enum.TryParse<OrderStatus>(status, true, out var st)) query = query.Where(o => o.Status == st);
            else throw AppException.Invalid("status", "Unknown order status.");
        }
        if (!string.IsNullOrEmpty(payment))
        {
            if (!Enum.TryParse<PaymentStatus>(payment, true, out var ps)) throw AppException.Invalid("payment", "Unknown payment status.");
            query = query.Where(o => o.PaymentStatus == ps);
        }
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(o => o.PlacedAt).Skip((pg - 1) * size).Take(size)
            .Select(o => new OrderSummaryDto(o.Id, o.Number, o.Status.ToString(), o.PaymentMethod.ToString(), o.PaymentStatus.ToString(), o.CustomerName, o.Email,
                o.Lines.Sum(l => l.Quantity), o.Total, o.PlacedAt)).ToListAsync(ct);
        return Results.Ok(new Paged<OrderSummaryDto>(items, pg, size, total));
    }

    // ----- Coupons -----

    private static CouponDto Dto(Coupon c) => new(c.Id, c.Code, c.Kind.ToString().ToLowerInvariant(), c.Value, c.MinSubtotal, c.MaxDiscount, c.StartsAt, c.EndsAt,
        c.UsageLimit, c.PerCustomerLimit, c.TimesUsed, c.IsActive, c.Version.ToString(CultureInfo.InvariantCulture));

    private static async Task<IResult> ListCoupons(AppDbContext db, CancellationToken ct) =>
        Results.Ok((await db.Coupons.AsNoTracking().OrderByDescending(c => c.CreatedAt).ToListAsync(ct)).Select(Dto));

    private static void Apply(Coupon c, CouponRequest r)
    {
        c.Code = r.Code.Trim().ToUpperInvariant();
        c.Kind = r.Kind == "percent" ? CouponKind.Percent : CouponKind.Fixed;
        c.Value = r.Value;
        c.MinSubtotal = r.MinSubtotal;
        c.MaxDiscount = r.Kind == "percent" ? r.MaxDiscount : null;
        c.StartsAt = r.StartsAt;
        c.EndsAt = r.EndsAt;
        c.UsageLimit = r.UsageLimit;
        c.PerCustomerLimit = r.PerCustomerLimit;
        c.IsActive = r.IsActive;
    }

    private static async Task<IResult> CreateCoupon(CouponRequest req, AppDbContext db, AuditWriter audit, CancellationToken ct)
    {
        var c = new Coupon { Id = Guid.CreateVersion7(), CreatedAt = DateTimeOffset.UtcNow };
        Apply(c, req);
        if (await db.Coupons.AnyAsync(x => x.Code == c.Code, ct)) throw AppException.Invalid("code", "A coupon with this code already exists.");
        db.Coupons.Add(c);
        audit.Record(db, "coupon.created", "coupon", c.Id, new { c.Code });
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/admin/coupons/{c.Id}", Dto(c));
    }

    private static async Task<IResult> UpdateCoupon(Guid id, CouponRequest req, AppDbContext db, AuditWriter audit, HttpContext http, CancellationToken ct)
    {
        var c = await db.Coupons.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Coupon");
        var ifMatch = http.Request.Headers.IfMatch.ToString();
        if (!string.IsNullOrEmpty(ifMatch) && ifMatch.Trim('"') != c.Version.ToString(CultureInfo.InvariantCulture))
            throw AppException.Conflict("This coupon was changed by someone else. Reload and try again.", ProblemTypes.Concurrency);
        var code = req.Code.Trim().ToUpperInvariant();
        if (code != c.Code && await db.Coupons.AnyAsync(x => x.Code == code, ct)) throw AppException.Invalid("code", "A coupon with this code already exists.");
        if (req.UsageLimit is { } limit && limit < c.TimesUsed) throw AppException.Invalid("usageLimit", $"It has already been used {c.TimesUsed} times.");
        Apply(c, req);
        audit.Record(db, "coupon.updated", "coupon", c.Id, new { c.Code, c.IsActive });
        await db.SaveChangesAsync(ct);
        return Results.Ok(Dto(c));
    }

    private static async Task<IResult> DeleteCoupon(Guid id, AppDbContext db, AuditWriter audit, CancellationToken ct)
    {
        var c = await db.Coupons.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Coupon");
        // Orders keep the code they used (a snapshot); used coupons are deactivated rather than deleted to keep reporting simple.
        if (c.TimesUsed > 0) throw AppException.Conflict("This coupon has been used. Turn it off instead of deleting it.");
        db.Coupons.Remove(c);
        audit.Record(db, "coupon.deleted", "coupon", id, new { c.Code });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
