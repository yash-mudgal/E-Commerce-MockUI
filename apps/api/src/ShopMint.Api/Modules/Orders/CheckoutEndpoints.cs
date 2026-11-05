using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Customers;

namespace ShopMint.Api.Modules.Orders;

public sealed record QuoteRequest(Guid AddressId, string? CouponCode, string? GiftCardCode = null);
public sealed record PlaceOrderRequest(Guid AddressId, string? CouponCode, string PaymentMethod, string? GiftCardCode = null);
public sealed record VerifyPaymentRequest(string RazorpayOrderId, string RazorpayPaymentId, string RazorpaySignature);
public sealed record TestPaymentRequest(string Outcome);
public sealed record CancelOrderRequest(string? Reason);

public sealed class PlaceOrderValidator : AbstractValidator<PlaceOrderRequest>
{
    public PlaceOrderValidator()
    {
        RuleFor(x => x.PaymentMethod).Must(m => m is "online" or "cod").WithMessage("Choose online payment or cash on delivery.");
        RuleFor(x => x.CouponCode).MaximumLength(30);
    }
}

public sealed class VerifyPaymentValidator : AbstractValidator<VerifyPaymentRequest>
{
    public VerifyPaymentValidator()
    {
        RuleFor(x => x.RazorpayOrderId).NotEmpty().MaximumLength(60);
        RuleFor(x => x.RazorpayPaymentId).NotEmpty().MaximumLength(60);
        RuleFor(x => x.RazorpaySignature).NotEmpty().MaximumLength(128);
    }
}

// Shared order views (shopper and admin).
public sealed record OrderLineDto(Guid Id, Guid? VariantId, string ProductTitle, string? VariantLabel, string Sku, string? HsnCode, decimal GstRate,
    decimal UnitPrice, decimal Mrp, int Quantity, decimal Gross, decimal Discount, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, decimal LineTotal);
public sealed record OrderAddressDto(string Name, string Phone, string Line1, string? Line2, string City, string StateCode, string StateName, string Pincode);
public sealed record PaymentDto(string Gateway, string GatewayOrderId, string? GatewayPaymentId, decimal Amount, string Status, string? FailureReason, DateTimeOffset CreatedAt);
public sealed record RefundDto(Guid Id, decimal Amount, string Reason, string Status, DateTimeOffset CreatedAt, DateTimeOffset? ProcessedAt);
public sealed record ShipmentDto(string Carrier, string TrackingNumber, string? TrackingUrl, DateTimeOffset ShippedAt, DateTimeOffset? DeliveredAt);
public sealed record InvoiceSellerDto(string? Name, string? LegalName, string? Gstin, string? Address, string StateCode, string StateName);
public sealed record OrderDto(Guid Id, int Number, string Status, string PaymentMethod, string PaymentStatus, string Email, string CustomerName,
    OrderAddressDto ShipTo, IReadOnlyList<OrderLineDto> Lines, decimal Subtotal, decimal Discount, string? CouponCode, decimal Shipping,
    decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, decimal Total, decimal RefundedTotal, decimal Refundable,
    DateTimeOffset PlacedAt, DateTimeOffset? PaidAt, DateTimeOffset? ReservedUntil, DateTimeOffset? CancelledAt, string? CancelReason,
    string? InvoiceNumber, DateTimeOffset? InvoiceIssuedAt, InvoiceSellerDto Seller, IReadOnlyList<PaymentDto> Payments,
    IReadOnlyList<RefundDto> Refunds, IReadOnlyList<ShipmentDto> Shipments, IReadOnlyList<string> Actions, decimal GiftCardAmount = 0);
public sealed record OrderSummaryDto(Guid Id, int Number, string Status, string PaymentMethod, string PaymentStatus, string CustomerName, string Email,
    int ItemCount, decimal Total, DateTimeOffset PlacedAt);

public static class OrderViews
{
    public static OrderDto Dto(Order o, bool shopper) => new(o.Id, o.Number, o.Status.ToString(), o.PaymentMethod.ToString(), o.PaymentStatus.ToString(),
        o.Email, o.CustomerName,
        new OrderAddressDto(o.ShipName, o.ShipPhone, o.ShipLine1, o.ShipLine2, o.ShipCity, o.ShipStateCode,
            IndianStates.ByCode.GetValueOrDefault(o.ShipStateCode, o.ShipStateCode), o.ShipPincode),
        o.Lines.OrderBy(l => l.Position).Select(l => new OrderLineDto(l.Id, l.VariantId, l.ProductTitle, l.VariantLabel, l.Sku, l.HsnCode, l.GstRate,
            l.UnitPrice, l.Mrp, l.Quantity, l.Gross, l.DiscountAllocated, l.Taxable, l.Cgst, l.Sgst, l.Igst, l.LineTotal)).ToList(),
        o.Subtotal, o.Discount, o.CouponCode, o.Shipping, o.Taxable, o.Cgst, o.Sgst, o.Igst, o.Total, o.RefundedTotal, OrderService.Refundable(o),
        o.PlacedAt, o.PaidAt, o.ReservedUntil, o.CancelledAt, o.CancelReason, o.InvoiceNumber, o.InvoiceIssuedAt,
        new InvoiceSellerDto(o.SellerName, o.SellerLegalName, o.SellerGstin, o.SellerAddress, o.SellerStateCode,
            IndianStates.ByCode.GetValueOrDefault(o.SellerStateCode, o.SellerStateCode)),
        // Shoppers see payment outcomes, not gateway identifiers.
        shopper ? [] : o.Payments.OrderBy(p => p.CreatedAt).Select(p => new PaymentDto(p.Gateway, p.GatewayOrderId, p.GatewayPaymentId, p.Amount, p.Status.ToString(), p.FailureReason, p.CreatedAt)).ToList(),
        o.Refunds.OrderBy(r => r.CreatedAt).Select(r => new RefundDto(r.Id, r.Amount, shopper ? "" : r.Reason, r.Status.ToString(), r.CreatedAt, r.ProcessedAt)).ToList(),
        o.Shipments.OrderBy(s => s.ShippedAt).Select(s => new ShipmentDto(s.Carrier, s.TrackingNumber, s.TrackingUrl, s.ShippedAt, s.DeliveredAt)).ToList(),
        OrderService.AllowedActions(o, shopper), o.GiftCardAmount);

    public static IQueryable<Order> WithDetails(this IQueryable<Order> q) =>
        q.AsNoTracking().AsSplitQuery().Include(o => o.Lines).Include(o => o.Payments).Include(o => o.Refunds).Include(o => o.Shipments);
}

/// <summary>
/// Storefront checkout (shopper must be signed in). Totals are always recomputed on the server; the browser only sends
/// which address, which coupon and how to pay. Placing an order needs an Idempotency-Key header, so a retried request
/// (double click, flaky network) returns the same order instead of creating another.
/// </summary>
public static class CheckoutEndpoints
{
    public static void Map(RouteGroupBuilder storefront)
    {
        var g = storefront.MapGroup("/checkout").WithTags("Checkout");
        g.MapPost("/quote", Quote).Validate<QuoteRequest>();
        g.MapPost("/orders", Place).Validate<PlaceOrderRequest>().RequireRateLimiting("checkout");
        g.MapPost("/orders/{id:guid}/pay", Resume);
        g.MapPost("/orders/{id:guid}/verify", Verify).Validate<VerifyPaymentRequest>();
        g.MapPost("/orders/{id:guid}/test-payment", TestPayment).Validate<TestPaymentRequest>();

        var a = storefront.MapGroup("/account/orders").WithTags("Shopper orders");
        a.MapGet("/", List);
        a.MapGet("/{id:guid}", Get);
        a.MapPost("/{id:guid}/cancel", Cancel);
    }

    private static async Task<(Customer, CustomerAddress)> ShopperAndAddressAsync(CustomerSession session, AppDbContext db, Guid addressId, CancellationToken ct)
    {
        var customer = await session.RequireAsync(ct);
        var address = await db.CustomerAddresses.AsNoTracking().FirstOrDefaultAsync(a => a.Id == addressId && a.CustomerId == customer.Id, ct)
            ?? throw AppException.Invalid("addressId", "Choose a delivery address.");
        return (customer, address);
    }

    private static async Task<IResult> Quote(QuoteRequest req, CustomerSession session, AppDbContext db, OrderService orders, CancellationToken ct)
    {
        var (customer, address) = await ShopperAndAddressAsync(session, db, req.AddressId, ct);
        return Results.Ok(await orders.QuoteAsync(customer, address, req.CouponCode, ct, req.GiftCardCode));
    }

    private static async Task<IResult> Place(PlaceOrderRequest req, HttpContext http, CustomerSession session, AppDbContext db, OrderService orders, CancellationToken ct)
    {
        var key = http.Request.Headers["Idempotency-Key"].ToString();
        if (key.Length is < 8 or > 100)
            throw AppException.Invalid("idempotencyKey", "Send an Idempotency-Key header (8–100 characters) with each new order.");
        var (customer, address) = await ShopperAndAddressAsync(session, db, req.AddressId, ct);
        var result = await orders.PlaceAsync(customer, address, req.CouponCode, req.PaymentMethod == "cod" ? PaymentMethod.Cod : PaymentMethod.Online, key, ct, req.GiftCardCode);
        return Results.Ok(result);
    }

    private static async Task<(Customer, Order)> ShopperOrderAsync(CustomerSession session, AppDbContext db, Guid id, CancellationToken ct)
    {
        var customer = await session.RequireAsync(ct);
        var order = await db.Orders.WithDetails().FirstOrDefaultAsync(o => o.Id == id && o.CustomerId == customer.Id, ct)
            ?? throw AppException.NotFound("Order");
        return (customer, order);
    }

    /// <summary>Payment details again for an unpaid order (the shopper closed the payment window).</summary>
    private static async Task<IResult> Resume(Guid id, CustomerSession session, AppDbContext db, OrderService orders, CancellationToken ct)
    {
        var (customer, order) = await ShopperOrderAsync(session, db, id, ct);
        if (order.Status != OrderStatus.PendingPayment) throw new AppException(409, ProblemTypes.InvalidStateTransition, "This order isn't awaiting payment.");
        var storeName = await db.Tenants.Select(t => t.Name).FirstAsync(ct);
        return Results.Ok(await orders.ResultAsync(order, customer, storeName, ct));
    }

    /// <summary>
    /// Razorpay Checkout's success callback. The signature proves the payment belongs to this order (it's an HMAC with
    /// the store's key secret, which the browser never sees). The payment is also looked up server-side to confirm its
    /// status and amount before the order is confirmed. Webhooks confirm the same payment independently.
    /// </summary>
    private static async Task<IResult> Verify(Guid id, VerifyPaymentRequest req, CustomerSession session, AppDbContext db, OrderService orders,
        PaymentResolver payments, ILoggerFactory lf, CancellationToken ct)
    {
        var (_, order) = await ShopperOrderAsync(session, db, id, ct);
        var attempt = order.Payments.FirstOrDefault(p => p.GatewayOrderId == req.RazorpayOrderId && p.Gateway == "razorpay")
            ?? throw new AppException(400, ProblemTypes.PaymentVerification, "This payment doesn't belong to the order.");
        var gateway = await payments.ForCurrentTenantAsync(ct);
        if (gateway?.Credentials is null || gateway.IsTest) throw new AppException(400, ProblemTypes.PaymentVerification, "Online payments aren't set up for this store.");
        if (!PaymentMath.VerifyCheckoutSignature(gateway.Credentials.KeySecret, attempt.GatewayOrderId, req.RazorpayPaymentId, req.RazorpaySignature))
        {
            lf.CreateLogger("ShopMint.Payments").LogWarning("Bad checkout signature for order {OrderId}", order.Id);
            throw new AppException(400, ProblemTypes.PaymentVerification, "We couldn't verify this payment.", "If money was taken, it will be confirmed or refunded automatically.");
        }
        var payment = await gateway.Gateway.GetPaymentAsync(gateway.Credentials, req.RazorpayPaymentId, ct);
        if (payment is null || payment.OrderId != attempt.GatewayOrderId || payment.Status is not ("captured" or "authorized"))
            throw new AppException(400, ProblemTypes.PaymentVerification, "The payment isn't complete yet.", "If money was taken, the order will be confirmed automatically.");
        await orders.MarkPaidAsync(attempt.GatewayOrderId, payment.Id, payment.AmountPaise, "checkout", ct);
        var (_, updated) = await ShopperOrderAsync(session, db, id, ct);
        return Results.Ok(OrderViews.Dto(updated, shopper: true));
    }

    /// <summary>Test mode only: simulates the shopper completing or failing payment. Unavailable when test mode is off.</summary>
    private static async Task<IResult> TestPayment(Guid id, TestPaymentRequest req, CustomerSession session, AppDbContext db, OrderService orders,
        PaymentResolver payments, CancellationToken ct)
    {
        if (!payments.TestModeAllowed) throw AppException.NotFound("Order");
        var (_, order) = await ShopperOrderAsync(session, db, id, ct);
        var attempt = order.Payments.Where(p => p.Gateway == "test").OrderByDescending(p => p.CreatedAt).FirstOrDefault() ?? throw AppException.NotFound("Order");
        if (req.Outcome == "success")
            await orders.MarkPaidAsync(attempt.GatewayOrderId, "pay_test_" + Guid.NewGuid().ToString("N")[..14], PaymentMath.ToPaise(attempt.Amount), "test", ct);
        else
            await orders.MarkFailedAsync(attempt.GatewayOrderId, "Test payment declined.", ct);
        var (_, updated) = await ShopperOrderAsync(session, db, id, ct);
        return Results.Ok(OrderViews.Dto(updated, shopper: true));
    }

    private static async Task<IResult> List(CustomerSession session, AppDbContext db, [FromQuery] int? page, CancellationToken ct)
    {
        var customer = await session.RequireAsync(ct);
        var (pg, size) = Paging.Normalize(page, 20);
        var q = db.Orders.AsNoTracking().Where(o => o.CustomerId == customer.Id);
        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(o => o.PlacedAt).Skip((pg - 1) * size).Take(size)
            .Select(o => new OrderSummaryDto(o.Id, o.Number, o.Status.ToString(), o.PaymentMethod.ToString(), o.PaymentStatus.ToString(), o.CustomerName, o.Email,
                o.Lines.Sum(l => l.Quantity), o.Total, o.PlacedAt)).ToListAsync(ct);
        return Results.Ok(new Paged<OrderSummaryDto>(items, pg, size, total));
    }

    private static async Task<IResult> Get(Guid id, CustomerSession session, AppDbContext db, CancellationToken ct)
    {
        var (_, order) = await ShopperOrderAsync(session, db, id, ct);
        return Results.Ok(OrderViews.Dto(order, shopper: true));
    }

    private static async Task<IResult> Cancel(Guid id, CancelOrderRequest? req, CustomerSession session, AppDbContext db, OrderService orders, CancellationToken ct)
    {
        await ShopperOrderAsync(session, db, id, ct);
        await orders.CancelAsync(id, string.IsNullOrWhiteSpace(req?.Reason) ? "Cancelled by the customer." : req.Reason.Trim(), byShopper: true, ct);
        var (_, updated) = await ShopperOrderAsync(session, db, id, ct);
        return Results.Ok(OrderViews.Dto(updated, shopper: true));
    }
}

public sealed class QuoteValidator : AbstractValidator<QuoteRequest>
{
    public QuoteValidator() => RuleFor(x => x.CouponCode).MaximumLength(30);
}

public sealed class TestPaymentValidator : AbstractValidator<TestPaymentRequest>
{
    public TestPaymentValidator() => RuleFor(x => x.Outcome).Must(o => o is "success" or "failure");
}
