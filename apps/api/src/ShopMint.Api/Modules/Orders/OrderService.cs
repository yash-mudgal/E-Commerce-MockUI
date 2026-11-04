using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Catalog;
using ShopMint.Api.Modules.Customers;
using ShopMint.Api.Modules.Notifications;

namespace ShopMint.Api.Modules.Orders;

// ---------- Quote ----------

public sealed record QuoteLine(Guid VariantId, string ProductTitle, string? VariantLabel, string Sku, string? HsnCode, decimal GstRate,
    decimal UnitPrice, decimal Mrp, int Quantity, decimal Gross, decimal Discount, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst,
    decimal LineTotal, string? ImageUrl);
public sealed record PaymentOptions(bool OnlineAvailable, bool OnlineIsTest, bool CodAvailable, string? CodUnavailableReason);
public sealed record Quote(IReadOnlyList<QuoteLine> Lines, decimal Subtotal, decimal Discount, string? CouponCode, Guid? CouponId,
    decimal Shipping, decimal ShippingTax, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, decimal Total, bool IntraState,
    string SellerStateCode, PaymentOptions Payment);

public sealed record CheckoutPayment(string Gateway, bool IsTest, string? KeyId, string GatewayOrderId, long AmountPaise, string Currency,
    string StoreName, string CustomerName, string Email, string Phone);
public sealed record CheckoutResult(Guid OrderId, int Number, string Status, string PaymentMethod, decimal Total, CheckoutPayment? Payment);

/// <summary>
/// The order lifecycle. Every money and stock change happens here, inside a transaction, with the affected rows locked
/// (orders and stock levels, always in a fixed order), so checkouts, webhooks, verifications, the expiry job and admin
/// actions can run concurrently without double-selling or double-confirming.
/// </summary>
public sealed class OrderService(AppDbContext db, TenantContext tenant, CartService carts, PaymentResolver payments,
    IObjectStorage storage, EmailOutbox email, AuditWriter audit, IConfiguration config, ILogger<OrderService> log)
{
    public static readonly TimeSpan ReservationWindow = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan Ist = TimeSpan.FromMinutes(330);

    // ----- Pricing -----

    /// <summary>
    /// Prices the shopper's cart from the database: coupon, shipping and GST (CGST+SGST when the delivery state is the
    /// seller's state, IGST otherwise). Shipping is taxed at the highest GST rate in the order (principal supply).
    /// </summary>
    public async Task<Quote> QuoteAsync(Customer customer, CustomerAddress address, string? couponCode, CancellationToken ct)
    {
        var cart = await carts.FindAsync(ct);
        if (cart is null || cart.Lines.Count == 0)
            throw AppException.Unprocessable(ProblemTypes.CartChanged, "Your cart is empty.");
        var ids = cart.Lines.Select(l => l.VariantId).ToList();
        var rows = await db.ProductVariants.AsNoTracking().Where(v => ids.Contains(v.Id))
            .Join(db.Products, v => v.ProductId, p => p.Id, (v, p) => new
            {
                v.Id, v.Sku, v.OptionValues, v.Price, v.Mrp, v.IsActive, p.Title, p.Status, p.OptionNames, p.HsnCode, p.GstRate,
                Available = v.StockLevels.Sum(s => (int?)(s.OnHand - s.Reserved)) ?? 0,
                Image = p.Media.Where(m => m.Status == MediaStatus.Ready).OrderBy(m => m.Position).Select(m => m.StorageKey).FirstOrDefault(),
            }).ToDictionaryAsync(x => x.Id, ct);

        var items = cart.Lines.OrderBy(l => l.CreatedAt).Select(l => (Line: l, Row: rows.GetValueOrDefault(l.VariantId))).ToList();
        if (items.Any(i => i.Row is null || !i.Row.IsActive || i.Row.Status != ProductStatus.Active || i.Row.Available < i.Line.Quantity))
            throw new AppException(409, ProblemTypes.CartChanged, "Your cart has changed.", "Some items are no longer available in the quantity you chose. Review your cart and try again.");

        var store = await db.Tenants.AsNoTracking().Where(t => t.Id == tenant.TenantId)
            .Select(t => new { t.StateCode, t.Gstin, t.ShippingFee, t.FreeShippingThreshold, t.CodEnabled, t.CodMaxOrderValue }).FirstAsync(ct);
        var defaultLocationState = await db.Locations.Where(l => l.IsDefault).Select(l => l.StateCode).FirstOrDefaultAsync(ct);
        // Place of supply rules need the seller's state; fall back to the GSTIN prefix, then the default warehouse.
        var sellerState = store.StateCode ?? store.Gstin?[..2] ?? defaultLocationState ?? address.StateCode;

        var subtotal = items.Sum(i => i.Row!.Price * i.Line.Quantity);
        var (coupon, discount) = await ApplyCouponAsync(customer, couponCode, subtotal, ct);
        var goods = GstCalculator.Calculate(items.Select(i => new PricedLine(i.Row!.Price, i.Line.Quantity, i.Row.GstRate)).ToList(),
            discount, sellerState, address.StateCode);
        var netGoods = subtotal - discount;
        var shipping = store.FreeShippingThreshold is { } free && netGoods >= free ? 0 : store.ShippingFee;
        var shipTax = shipping > 0
            ? GstCalculator.Calculate([new PricedLine(shipping, 1, items.Max(i => i.Row!.GstRate))], 0, sellerState, address.StateCode)
            : null;

        var lines = items.Select((i, n) =>
        {
            var t = goods.Lines[n];
            var label = i.Row!.OptionValues.Length == 0 ? null : string.Join(" / ", i.Row.OptionNames.Zip(i.Row.OptionValues, (a, b) => $"{a}: {b}"));
            return new QuoteLine(i.Line.VariantId, i.Row.Title, label, i.Row.Sku, i.Row.HsnCode, i.Row.GstRate, i.Row.Price, i.Row.Mrp, i.Line.Quantity,
                t.Gross, t.DiscountAllocated, t.Taxable, t.Cgst, t.Sgst, t.Igst, t.Net, i.Row.Image is null ? null : storage.PublicUrl(i.Row.Image));
        }).ToList();
        var total = netGoods + shipping;

        var gateway = await payments.ForCurrentTenantAsync(ct);
        string? codReason = !store.CodEnabled ? "This store doesn't offer cash on delivery."
            : total > store.CodMaxOrderValue ? $"Cash on delivery is available for orders up to {Money.Inr(store.CodMaxOrderValue)}." : null;

        return new Quote(lines, subtotal, discount, coupon?.Code, coupon?.Id, shipping, shipTax?.Tax ?? 0,
            goods.Taxable + (shipTax?.Taxable ?? 0), goods.Cgst + (shipTax?.Cgst ?? 0), goods.Sgst + (shipTax?.Sgst ?? 0), goods.Igst + (shipTax?.Igst ?? 0),
            total, goods.IntraState, sellerState,
            new PaymentOptions(gateway is not null && total >= 1, gateway?.IsTest ?? false, codReason is null, codReason));
    }

    private async Task<(Coupon? Coupon, decimal Discount)> ApplyCouponAsync(Customer customer, string? code, decimal subtotal, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(code)) return (null, 0);
        var normalized = code.Trim().ToUpperInvariant();
        var c = await db.Coupons.AsNoTracking().FirstOrDefaultAsync(x => x.Code == normalized, ct);
        var now = DateTimeOffset.UtcNow;
        static AppException Bad(string m) => AppException.Invalid("couponCode", m);
        if (c is null || !c.IsActive || (c.StartsAt is { } s && s > now) || (c.EndsAt is { } e && e < now)) throw Bad("This coupon isn't valid.");
        if (c.UsageLimit is { } limit && c.TimesUsed >= limit) throw Bad("This coupon has been fully used.");
        if (subtotal < c.MinSubtotal) throw Bad($"Spend at least {Money.Inr(c.MinSubtotal)} to use this coupon.");
        var used = await db.Orders.CountAsync(o => o.CouponId == c.Id && o.CustomerId == customer.Id
            && o.Status != OrderStatus.Cancelled && o.Status != OrderStatus.Expired, ct);
        if (used >= c.PerCustomerLimit) throw Bad("You've already used this coupon.");
        var discount = c.Kind == CouponKind.Percent ? Math.Round(subtotal * c.Value / 100, 2, MidpointRounding.AwayFromZero) : c.Value;
        if (c.MaxDiscount is { } max) discount = Math.Min(discount, max);
        return (c, Math.Min(discount, subtotal));
    }

    // ----- Placing an order -----

    public async Task<CheckoutResult> PlaceAsync(Customer customer, CustomerAddress address, string? couponCode, PaymentMethod method,
        string? idempotencyKey, CancellationToken ct)
    {
        if (idempotencyKey is not null && await ResultForKeyAsync(customer, idempotencyKey, ct) is { } previous) return previous;

        Quote quote;
        try
        {
            quote = await QuoteAsync(customer, address, couponCode, ct);
        }
        catch (AppException) when (idempotencyKey is not null)
        {
            // A retry that lost the race: the first request already turned the cart into an order.
            if (await ResultForKeyAsync(customer, idempotencyKey, ct) is { } same) return same;
            throw;
        }
        if (method == PaymentMethod.Online && !quote.Payment.OnlineAvailable)
            throw AppException.Unprocessable(ProblemTypes.PaymentsUnavailable, "Online payment isn't available for this store yet. Choose cash on delivery.");
        if (method == PaymentMethod.Cod && !quote.Payment.CodAvailable)
            throw AppException.Unprocessable(ProblemTypes.PaymentsUnavailable, quote.Payment.CodUnavailableReason!);

        var store = await db.Tenants.AsNoTracking().Where(t => t.Id == tenant.TenantId).Select(t => new { t.Name }).FirstAsync(ct);
        var now = DateTimeOffset.UtcNow;
        Order order;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            var levels = await LockLevelsAsync(quote.Lines.Select(l => l.VariantId).ToList(), ct);
            var defaultLocation = await db.Locations.Where(l => l.IsDefault).Select(l => l.Id).FirstAsync(ct);
            order = new Order
            {
                Id = Guid.CreateVersion7(), CustomerId = customer.Id, Email = customer.Email, CustomerName = customer.Name,
                ShipName = address.Name, ShipPhone = address.Phone, ShipLine1 = address.Line1, ShipLine2 = address.Line2, ShipCity = address.City,
                ShipStateCode = address.StateCode, ShipPincode = address.Pincode, SellerStateCode = quote.SellerStateCode,
                PaymentMethod = method, Subtotal = quote.Subtotal, Discount = quote.Discount, Shipping = quote.Shipping, Taxable = quote.Taxable,
                Cgst = quote.Cgst, Sgst = quote.Sgst, Igst = quote.Igst, Total = quote.Total, CouponId = quote.CouponId, CouponCode = quote.CouponCode,
                IdempotencyKey = idempotencyKey, PlacedAt = now,
            };
            order.Number = await NextAsync("order", 1001, ct);
            var position = 0;
            foreach (var l in quote.Lines)
            {
                // One location per line: the default if it has enough, else the location with the most free stock.
                var level = levels.Where(s => s.VariantId == l.VariantId && s.OnHand - s.Reserved >= l.Quantity)
                    .OrderByDescending(s => s.LocationId == defaultLocation).ThenByDescending(s => s.OnHand - s.Reserved).FirstOrDefault()
                    ?? throw new AppException(409, ProblemTypes.InsufficientStock, "Not enough stock.",
                        $"{l.ProductTitle} just sold out in the quantity you chose. Review your cart and try again.");
                if (method == PaymentMethod.Online) level.Reserved += l.Quantity;
                else Sell(level, l.Quantity, order, now);
                order.Lines.Add(new OrderLine
                {
                    Id = Guid.CreateVersion7(), VariantId = l.VariantId, LocationId = level.LocationId, ProductTitle = l.ProductTitle, VariantLabel = l.VariantLabel,
                    Sku = l.Sku, HsnCode = l.HsnCode, GstRate = l.GstRate, UnitPrice = l.UnitPrice, Mrp = l.Mrp, Quantity = l.Quantity, Gross = l.Gross,
                    DiscountAllocated = l.Discount, Taxable = l.Taxable, Cgst = l.Cgst, Sgst = l.Sgst, Igst = l.Igst, LineTotal = l.LineTotal, Position = position++,
                });
            }
            if (quote.CouponId is { } couponId)
            {
                var claimed = await db.Coupons.Where(c => c.Id == couponId && (c.UsageLimit == null || c.TimesUsed < c.UsageLimit))
                    .ExecuteUpdateAsync(s => s.SetProperty(c => c.TimesUsed, c => c.TimesUsed + 1), ct);
                if (claimed == 0) throw AppException.Invalid("couponCode", "This coupon has just been fully used.");
            }
            if (method == PaymentMethod.Online)
            {
                order.Status = OrderStatus.PendingPayment;
                order.PaymentStatus = PaymentStatus.Pending;
                order.ReservedUntil = now.Add(ReservationWindow);
            }
            else
            {
                order.Status = OrderStatus.Confirmed;
                order.PaymentStatus = PaymentStatus.CodDue;
                await IssueInvoiceAsync(order, ct);
            }
            db.Orders.Add(order);
            // The cart becomes the order.
            if (await carts.FindAsync(ct) is { } cart) db.CartLines.RemoveRange(cart.Lines);
            audit.Record(db, "order.placed", "order", order.Id, new { order.Number, method = method.ToString(), total = order.Total }, actorOverride: null);
            if (method == PaymentMethod.Cod) await QueueConfirmationEmailsAsync(order, store.Name, ct);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException e) when (idempotencyKey is not null && e.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation } pg
                                               && pg.ConstraintName?.Contains("idempotency", StringComparison.Ordinal) == true)
            {
                await tx.RollbackAsync(ct);
                db.ChangeTracker.Clear();
                // The same request is being (or was) placed concurrently: answer with that order.
                if (await ResultForKeyAsync(customer, idempotencyKey, ct) is { } same) return same;
                throw;
            }
            await tx.CommitAsync(ct);
        }

        if (method == PaymentMethod.Cod) return new CheckoutResult(order.Id, order.Number, order.Status.ToString(), "Cod", order.Total, null);
        return await StartPaymentAsync(order, customer, store.Name, ct);
    }

    private async Task<CheckoutResult?> ResultForKeyAsync(Customer customer, string key, CancellationToken ct)
    {
        var existing = await db.Orders.Include(o => o.Payments).FirstOrDefaultAsync(o => o.CustomerId == customer.Id && o.IdempotencyKey == key, ct);
        if (existing is null) return null;
        var storeName = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.Name).FirstAsync(ct);
        return await ResultAsync(existing, customer, storeName, ct);
    }

    /// <summary>Creates the gateway order (outside the stock transaction). If that fails, the reservation is released.</summary>
    private async Task<CheckoutResult> StartPaymentAsync(Order order, Customer customer, string storeName, CancellationToken ct)
    {
        var gateway = await payments.ForCurrentTenantAsync(ct) ?? throw AppException.Unprocessable(ProblemTypes.PaymentsUnavailable, "Online payment isn't available.");
        GatewayOrder go;
        try
        {
            go = await gateway.Gateway.CreateOrderAsync(gateway.Credentials, PaymentMath.ToPaise(order.Total), $"order-{order.Number}", ct);
        }
        catch (Exception e) when (e is PaymentGatewayException or HttpRequestException or TaskCanceledException)
        {
            log.LogError(e, "Could not start payment for order {OrderId}", order.Id);
            await ReleaseAsync(order.Id, OrderStatus.Cancelled, "Payment couldn't be started.", ct);
            throw new AppException(502, ProblemTypes.PaymentsUnavailable, "We couldn't start the payment.", "Nothing was charged. Please try again in a moment.");
        }
        var now = DateTimeOffset.UtcNow;
        db.PaymentAttempts.Add(new PaymentAttempt
        {
            Id = Guid.CreateVersion7(), OrderId = order.Id, Gateway = gateway.Gateway.Name, GatewayOrderId = go.Id, Amount = order.Total,
            Status = PaymentAttemptStatus.Created, CreatedAt = now, UpdatedAt = now,
        });
        await db.SaveChangesAsync(ct);
        var reloaded = await db.Orders.Include(o => o.Payments).FirstAsync(o => o.Id == order.Id, ct);
        return await ResultAsync(reloaded, customer, storeName, ct);
    }

    public async Task<CheckoutResult> ResultAsync(Order order, Customer customer, string storeName, CancellationToken ct)
    {
        CheckoutPayment? pay = null;
        var attempt = order.Payments.OrderByDescending(p => p.CreatedAt).FirstOrDefault();
        if (order.PaymentMethod == PaymentMethod.Online && attempt is not null && order.Status == OrderStatus.PendingPayment)
        {
            var gateway = await payments.ForCurrentTenantAsync(ct);
            pay = new CheckoutPayment(attempt.Gateway, attempt.Gateway == "test", gateway?.Credentials?.KeyId, attempt.GatewayOrderId,
                PaymentMath.ToPaise(attempt.Amount), "INR", storeName, customer.Name, customer.Email, order.ShipPhone);
        }
        return new CheckoutResult(order.Id, order.Number, order.Status.ToString(), order.PaymentMethod.ToString(), order.Total, pay);
    }

    // ----- Payment results -----

    /// <summary>
    /// Records a captured payment. Idempotent: verification, webhooks and the expiry job may all report the same payment.
    /// A payment for a different amount never confirms an order. A payment that arrives after the order expired or was
    /// cancelled is refunded automatically.
    /// </summary>
    public async Task<Order?> MarkPaidAsync(string gatewayOrderId, string paymentId, long amountPaise, string source, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var attempt = await db.PaymentAttempts.FirstOrDefaultAsync(a => a.GatewayOrderId == gatewayOrderId, ct);
        if (attempt is null) return null;
        var order = await LockOrderAsync(attempt.OrderId, ct);
        if (PaymentMath.ToPaise(attempt.Amount) != amountPaise)
        {
            log.LogWarning("Payment {PaymentId} for order {OrderId} has amount {Amount} paise, expected {Expected}; not confirming",
                paymentId, order.Id, amountPaise, PaymentMath.ToPaise(attempt.Amount));
            return order;
        }
        var now = DateTimeOffset.UtcNow;
        attempt.GatewayPaymentId ??= paymentId;
        attempt.UpdatedAt = now;

        if (order.Status == OrderStatus.PendingPayment)
        {
            attempt.Status = PaymentAttemptStatus.Captured;
            var levels = await LockLevelsAsync(order.Lines.Where(l => l.VariantId != null).Select(l => l.VariantId!.Value).ToList(), ct);
            foreach (var line in order.Lines.Where(l => l.VariantId != null))
            {
                var level = levels.First(s => s.VariantId == line.VariantId && s.LocationId == line.LocationId);
                level.Reserved -= line.Quantity;
                Sell(level, line.Quantity, order, now);
            }
            order.Status = OrderStatus.Confirmed;
            order.PaymentStatus = PaymentStatus.Paid;
            order.PaidAt = now;
            order.ReservedUntil = null;
            await IssueInvoiceAsync(order, ct);
            audit.Record(db, "order.paid", "order", order.Id, new { order.Number, source, paymentId }, actorOverride: null);
            await QueueConfirmationEmailsAsync(order, await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.Name).FirstAsync(ct), ct);
        }
        else if (order.Status is OrderStatus.Expired or OrderStatus.Cancelled && attempt.Status != PaymentAttemptStatus.Captured)
        {
            // Late capture: the stock was released, so the money goes back.
            attempt.Status = PaymentAttemptStatus.Captured;
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            await RefundAsync(order.Id, order.Total, "Payment arrived after the order had expired; refunded automatically.", null, allowUnpaid: true, ct);
            return order;
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return order;
    }

    public async Task MarkFailedAsync(string gatewayOrderId, string? reason, CancellationToken ct)
    {
        var attempt = await db.PaymentAttempts.FirstOrDefaultAsync(a => a.GatewayOrderId == gatewayOrderId, ct);
        if (attempt is null || attempt.Status == PaymentAttemptStatus.Captured) return;
        attempt.Status = PaymentAttemptStatus.Failed;
        attempt.FailureReason = reason?.Length > 300 ? reason[..300] : reason;
        attempt.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Expiry job: confirm if the gateway did take the money (missed webhook), otherwise release the stock.</summary>
    public async Task ReconcileOrExpireAsync(Guid orderId, CancellationToken ct)
    {
        var order = await db.Orders.Include(o => o.Payments).AsNoTracking().FirstOrDefaultAsync(o => o.Id == orderId, ct);
        if (order is null || order.Status != OrderStatus.PendingPayment) return;
        var attempt = order.Payments.OrderByDescending(p => p.CreatedAt).FirstOrDefault();
        if (attempt is not null && attempt.Gateway != "test")
        {
            var gateway = await payments.ForCurrentTenantAsync(ct);
            if (gateway is not null && !gateway.IsTest)
            {
                try
                {
                    var paid = (await gateway.Gateway.GetOrderPaymentsAsync(gateway.Credentials, attempt.GatewayOrderId, ct))
                        .FirstOrDefault(p => p.Status is "captured" or "authorized");
                    if (paid is not null)
                    {
                        await MarkPaidAsync(attempt.GatewayOrderId, paid.Id, paid.AmountPaise, "reconciliation", ct);
                        return;
                    }
                }
                catch (Exception e) when (e is PaymentGatewayException or HttpRequestException or TaskCanceledException)
                {
                    log.LogWarning(e, "Could not reconcile order {OrderId}; will retry", orderId);
                    return; // try again next run rather than expiring an order that may have been paid
                }
            }
        }
        await ReleaseAsync(orderId, OrderStatus.Expired, "Payment wasn't completed within 15 minutes.", ct);
    }

    /// <summary>Ends an unpaid order: returns reserved stock and the coupon use.</summary>
    private async Task ReleaseAsync(Guid orderId, OrderStatus to, string reason, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var order = await LockOrderAsync(orderId, ct);
        if (order.Status != OrderStatus.PendingPayment) return;
        var levels = await LockLevelsAsync(order.Lines.Where(l => l.VariantId != null).Select(l => l.VariantId!.Value).ToList(), ct);
        foreach (var line in order.Lines.Where(l => l.VariantId != null))
            if (levels.FirstOrDefault(s => s.VariantId == line.VariantId && s.LocationId == line.LocationId) is { } level)
                level.Reserved = Math.Max(0, level.Reserved - line.Quantity);
        await ReturnCouponAsync(order, ct);
        order.Status = to;
        order.PaymentStatus = PaymentStatus.Voided;
        order.CancelledAt = DateTimeOffset.UtcNow;
        order.CancelReason = reason;
        order.ReservedUntil = null;
        audit.Record(db, to == OrderStatus.Expired ? "order.expired" : "order.cancelled", "order", order.Id, new { order.Number, reason }, actorOverride: null);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    // ----- Fulfilment -----

    public static IReadOnlyList<string> AllowedActions(Order o, bool shopper)
    {
        var a = new List<string>();
        if (shopper)
        {
            if (o.Status is OrderStatus.PendingPayment or OrderStatus.Confirmed) a.Add("cancel");
            if (o.Status == OrderStatus.PendingPayment) a.Add("pay");
            return a;
        }
        if (o.Status == OrderStatus.Confirmed) a.Add("pack");
        if (o.Status is OrderStatus.Confirmed or OrderStatus.Packed) a.AddRange(["ship", "cancel"]);
        if (o.Status == OrderStatus.Shipped) a.Add("deliver");
        if (o.Status == OrderStatus.PendingPayment) a.Add("cancel");
        if (Refundable(o) > 0) a.Add("refund");
        return a;
    }

    /// <summary>Money that can still be returned: online payments once paid; cash on delivery once collected.</summary>
    public static decimal Refundable(Order o) =>
        o.PaymentStatus is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded ? o.Total - o.RefundedTotal : 0;

    public async Task<Order> PackAsync(Guid id, CancellationToken ct) => await TransitionAsync(id, OrderStatus.Confirmed, OrderStatus.Packed, "order.packed", null, ct);

    public async Task<Order> ShipAsync(Guid id, string carrier, string tracking, string? trackingUrl, CancellationToken ct)
    {
        var order = await TransitionAsync(id, null, OrderStatus.Shipped, "order.shipped", o =>
        {
            if (o.Status is not (OrderStatus.Confirmed or OrderStatus.Packed)) throw InvalidTransition(o, "shipped");
            db.Shipments.Add(new Shipment
            {
                Id = Guid.CreateVersion7(), OrderId = o.Id, Carrier = carrier.Trim(), TrackingNumber = tracking.Trim(),
                TrackingUrl = string.IsNullOrWhiteSpace(trackingUrl) ? null : trackingUrl.Trim(), ShippedAt = DateTimeOffset.UtcNow,
            });
        }, ct);
        var storeName = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.Name).FirstAsync(ct);
        email.OrderShipped(db, tenant.RequireTenant(), storeName, await StoreUrlAsync(ct), order, carrier, tracking, trackingUrl);
        await db.SaveChangesAsync(ct);
        return order;
    }

    public async Task<Order> DeliverAsync(Guid id, CancellationToken ct) => await TransitionAsync(id, OrderStatus.Shipped, OrderStatus.Delivered, "order.delivered", o =>
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var s in o.Shipments.Where(s => s.DeliveredAt is null)) s.DeliveredAt = now;
        // Cash on delivery is collected at the door.
        if (o.PaymentStatus == PaymentStatus.CodDue) { o.PaymentStatus = PaymentStatus.Paid; o.PaidAt = now; }
    }, ct);

    private async Task<Order> TransitionAsync(Guid id, OrderStatus? from, OrderStatus to, string action, Action<Order>? apply, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var order = await LockOrderAsync(id, ct);
        if (from is { } f && order.Status != f) throw InvalidTransition(order, to.ToString().ToLowerInvariant());
        apply?.Invoke(order);
        order.Status = to;
        audit.Record(db, action, "order", order.Id, new { order.Number });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return order;
    }

    private static AppException InvalidTransition(Order o, string to) =>
        new(409, ProblemTypes.InvalidStateTransition, "That isn't possible for this order now.", $"Order #{o.Number} is {Describe(o.Status)} and can't be {to}.");

    public static string Describe(OrderStatus s) => s switch
    {
        OrderStatus.PendingPayment => "awaiting payment",
        _ => s.ToString().ToLowerInvariant(),
    };

    /// <summary>
    /// Cancels an order. Unpaid: stock reservation released. Confirmed or packed: stock goes back on the shelf and an
    /// online payment is refunded in full. Shipped orders can't be cancelled (refund instead).
    /// </summary>
    public async Task<Order> CancelAsync(Guid id, string reason, bool byShopper, CancellationToken ct)
    {
        var current = await db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == id, ct) ?? throw AppException.NotFound("Order");
        if (current.Status == OrderStatus.PendingPayment)
        {
            await ReleaseAsync(id, OrderStatus.Cancelled, reason, ct);
            return await db.Orders.AsNoTracking().FirstAsync(o => o.Id == id, ct);
        }
        var allowed = byShopper ? current.Status == OrderStatus.Confirmed : current.Status is OrderStatus.Confirmed or OrderStatus.Packed;
        if (!allowed) throw InvalidTransition(current, "cancelled");

        Order order;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            order = await LockOrderAsync(id, ct);
            if (order.Status is not (OrderStatus.Confirmed or OrderStatus.Packed)) throw InvalidTransition(order, "cancelled");
            var now = DateTimeOffset.UtcNow;
            var levels = await LockLevelsAsync(order.Lines.Where(l => l.VariantId != null).Select(l => l.VariantId!.Value).ToList(), ct);
            foreach (var line in order.Lines.Where(l => l.VariantId != null))
            {
                var level = levels.FirstOrDefault(s => s.VariantId == line.VariantId && s.LocationId == line.LocationId);
                if (level is null) continue;
                level.OnHand += line.Quantity;
                db.StockMovements.Add(new StockMovement
                {
                    Id = Guid.CreateVersion7(), VariantId = line.VariantId!.Value, LocationId = line.LocationId, Delta = line.Quantity,
                    Reason = StockMovementReason.OrderCancelled, Note = $"Order #{order.Number}", BatchId = order.Id, ActorUserId = tenant.UserId, At = now,
                });
            }
            await ReturnCouponAsync(order, ct);
            order.Status = OrderStatus.Cancelled;
            order.CancelledAt = now;
            order.CancelReason = reason;
            if (order.PaymentStatus == PaymentStatus.CodDue) order.PaymentStatus = PaymentStatus.Voided;
            audit.Record(db, "order.cancelled", "order", order.Id, new { order.Number, reason, byShopper });
            var storeName = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.Name).FirstAsync(ct);
            email.OrderCancelled(db, tenant.RequireTenant(), storeName, await StoreUrlAsync(ct), order, Refundable(order) > 0);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        if (Refundable(order) > 0) await RefundAsync(order.Id, Refundable(order), "Order cancelled: " + reason, tenant.UserId, allowUnpaid: false, ct);
        return await db.Orders.AsNoTracking().FirstAsync(o => o.Id == id, ct);
    }

    /// <summary>
    /// Refunds money. Online payments go back through the gateway (status follows its answer and later webhooks).
    /// Cash on delivery refunds are recorded as manual: the merchant returns the money outside ShopMint.
    /// </summary>
    public async Task<Refund> RefundAsync(Guid orderId, decimal amount, string reason, Guid? actor, bool allowUnpaid, CancellationToken ct)
    {
        Refund refund;
        PaymentAttempt? attempt;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            var order = await LockOrderAsync(orderId, ct);
            var refundable = allowUnpaid ? order.Total - order.RefundedTotal : Refundable(order);
            if (amount <= 0 || amount > refundable)
                throw AppException.Invalid("amount", refundable <= 0 ? "Nothing on this order can be refunded." : $"You can refund up to {Money.Inr(refundable)}.");
            attempt = order.Payments.Where(p => p.Status == PaymentAttemptStatus.Captured).OrderByDescending(p => p.UpdatedAt).FirstOrDefault();
            var manual = order.PaymentMethod == PaymentMethod.Cod || attempt?.GatewayPaymentId is null;
            refund = new Refund
            {
                Id = Guid.CreateVersion7(), OrderId = order.Id, Amount = amount, Reason = reason.Length > 300 ? reason[..300] : reason,
                Status = manual ? RefundStatus.Manual : RefundStatus.Pending, CreatedByUserId = actor, CreatedAt = DateTimeOffset.UtcNow,
                ProcessedAt = manual ? DateTimeOffset.UtcNow : null,
            };
            db.Refunds.Add(refund);
            order.RefundedTotal += amount;
            order.PaymentStatus = order.RefundedTotal >= order.Total ? PaymentStatus.Refunded : PaymentStatus.PartiallyRefunded;
            audit.Record(db, "order.refunded", "order", order.Id, new { order.Number, amount, manual, reason }, actorOverride: actor);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            if (manual) return refund;
        }

        // Call the gateway after recording the refund, so a crash in between can't refund twice.
        try
        {
            var gateway = payments.ByName(attempt!.Gateway);
            var active = await payments.ForCurrentTenantAsync(ct);
            var result = await gateway.RefundAsync(active?.Credentials, attempt.GatewayPaymentId!, PaymentMath.ToPaise(amount), reason, ct);
            refund.GatewayRefundId = result.Id;
            if (result.Status == "processed") { refund.Status = RefundStatus.Processed; refund.ProcessedAt = DateTimeOffset.UtcNow; }
        }
        catch (Exception e) when (e is PaymentGatewayException or HttpRequestException or TaskCanceledException)
        {
            log.LogError(e, "Gateway refund failed for order {OrderId}", orderId);
            refund.Status = RefundStatus.Failed;
            var order = await db.Orders.FirstAsync(o => o.Id == orderId, ct);
            order.RefundedTotal -= amount;
            order.PaymentStatus = order.RefundedTotal <= 0 ? (order.PaidAt is null ? PaymentStatus.Voided : PaymentStatus.Paid) : PaymentStatus.PartiallyRefunded;
        }
        await db.SaveChangesAsync(ct);
        if (refund.Status == RefundStatus.Failed)
            throw new AppException(502, ProblemTypes.PaymentsUnavailable, "The refund couldn't be sent to the payment gateway.", "No money was moved. Try again later.");
        return refund;
    }

    public async Task RefundUpdatedAsync(string gatewayRefundId, bool processed, CancellationToken ct)
    {
        var refund = await db.Refunds.FirstOrDefaultAsync(r => r.GatewayRefundId == gatewayRefundId, ct);
        if (refund is null || refund.Status is RefundStatus.Processed or RefundStatus.Failed) return;
        if (processed) { refund.Status = RefundStatus.Processed; refund.ProcessedAt = DateTimeOffset.UtcNow; }
        else
        {
            refund.Status = RefundStatus.Failed;
            var order = await db.Orders.FirstAsync(o => o.Id == refund.OrderId, ct);
            order.RefundedTotal -= refund.Amount;
            order.PaymentStatus = order.RefundedTotal <= 0 ? PaymentStatus.Paid : PaymentStatus.PartiallyRefunded;
        }
        await db.SaveChangesAsync(ct);
    }

    // ----- Helpers -----

    private void Sell(StockLevel level, int quantity, Order order, DateTimeOffset now)
    {
        level.OnHand -= quantity;
        db.StockMovements.Add(new StockMovement
        {
            Id = Guid.CreateVersion7(), VariantId = level.VariantId, LocationId = level.LocationId, Delta = -quantity,
            Reason = StockMovementReason.Sale, Note = $"Order #{order.Number}", BatchId = order.Id, At = now,
        });
    }

    private async Task ReturnCouponAsync(Order order, CancellationToken ct)
    {
        if (order.CouponId is { } cid)
            await db.Coupons.Where(c => c.Id == cid && c.TimesUsed > 0).ExecuteUpdateAsync(s => s.SetProperty(c => c.TimesUsed, c => c.TimesUsed - 1), ct);
    }

    private async Task<Order> LockOrderAsync(Guid id, CancellationToken ct)
    {
        // xmin is a system column that SELECT * leaves out; EF needs it as the concurrency token.
        var order = await db.Orders.FromSql($"SELECT o.*, o.xmin FROM orders o WHERE o.id = {id} FOR UPDATE").FirstOrDefaultAsync(ct)
            ?? throw AppException.NotFound("Order");
        await db.Entry(order).Collection(o => o.Lines).LoadAsync(ct);
        await db.Entry(order).Collection(o => o.Payments).LoadAsync(ct);
        await db.Entry(order).Collection(o => o.Shipments).LoadAsync(ct);
        return order;
    }

    /// <summary>Same lock order as inventory adjustments (variant, location), so the two can't deadlock.</summary>
    private Task<List<StockLevel>> LockLevelsAsync(List<Guid> variantIds, CancellationToken ct) =>
        db.StockLevels.FromSql($"""
            SELECT * FROM stock_levels WHERE variant_id = ANY({variantIds.Distinct().ToArray()})
            ORDER BY variant_id, location_id FOR UPDATE
            """).ToListAsync(ct);

    /// <summary>Atomically takes the next number from a per-store counter.</summary>
    private async Task<int> NextAsync(string name, int start, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        // INSERT … RETURNING can't be composed over (no LIMIT), so read it as a list.
        var values = await db.Database.SqlQuery<int>($"""
            INSERT INTO tenant_counters (tenant_id, name, value) VALUES ({tid}, {name}, {start})
            ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_counters.value + 1
            RETURNING value AS "Value"
            """).ToListAsync(ct);
        return values.Single();
    }

    /// <summary>
    /// Issues the GST invoice number from the store's series for the Indian financial year (April–March), e.g. "26-27/000001"
    /// (at most 16 characters, unique per financial year, as GST rules require), and freezes the seller details.
    /// </summary>
    private async Task IssueInvoiceAsync(Order order, CancellationToken ct)
    {
        if (order.InvoiceNumber is not null) return;
        var now = DateTimeOffset.UtcNow;
        var india = now.ToOffset(Ist);
        var fyStart = india.Month >= 4 ? india.Year : india.Year - 1;
        var fy = $"{fyStart % 100:00}-{(fyStart + 1) % 100:00}";
        var seq = await NextAsync($"invoice:{fy}", 1, ct);
        var seller = await db.Tenants.AsNoTracking().Where(t => t.Id == tenant.TenantId)
            .Select(t => new { t.Name, t.LegalName, t.Gstin, t.BusinessAddress, t.StateCode }).FirstAsync(ct);
        order.InvoiceNumber = $"{fy}/{seq:000000}";
        order.InvoiceIssuedAt = now;
        order.SellerName = seller.Name;
        order.SellerLegalName = seller.LegalName;
        order.SellerGstin = seller.Gstin;
        order.SellerAddress = seller.BusinessAddress;
    }

    private async Task QueueConfirmationEmailsAsync(Order order, string storeName, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        email.OrderConfirmed(db, tid, storeName, await StoreUrlAsync(ct), order);
        // New-order alerts go to the store's support address, or to the owners if none is set.
        var support = await db.Tenants.Where(t => t.Id == tid).Select(t => t.SupportEmail).FirstOrDefaultAsync(ct);
        var recipients = support is not null
            ? [support]
            : await db.Memberships.Where(m => m.TenantId == tid && m.Role == MemberRole.Owner).Select(m => m.User!.Email).ToListAsync(ct);
        foreach (var to in recipients)
            email.NewOrderAlert(db, tid, storeName, $"{(config["App:PublicUrl"] ?? "").TrimEnd('/')}/admin/orders/{order.Id}", to, order);
    }

    private async Task<string> StoreUrlAsync(CancellationToken ct)
    {
        var host = await db.TenantDomains.Where(d => d.TenantId == tenant.TenantId).OrderBy(d => d.Kind).Select(d => d.Host).FirstAsync(ct);
        return CustomerEndpoints.StorefrontUrl(config, host);
    }
}
