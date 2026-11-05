namespace ShopMint.Api.Modules.Orders;

public enum OrderStatus { PendingPayment, Confirmed, Packed, Shipped, Delivered, Cancelled, Expired }
public enum PaymentMethod { Online, Cod }
/// <summary>Pending: awaiting online payment. CodDue: cash on delivery not yet collected. Voided: never paid (expired or cancelled).</summary>
public enum PaymentStatus { Pending, Paid, Failed, CodDue, PartiallyRefunded, Refunded, Voided }
public enum PaymentAttemptStatus { Created, Captured, Failed }
/// <summary>ToGiftCard: the refunded amount went back onto the gift card that paid for the order.</summary>
public enum RefundStatus { Pending, Processed, Failed, Manual, ToGiftCard }
public enum CouponKind { Percent, Fixed }

/// <summary>
/// An order. Every amount and every descriptive field is a snapshot taken when the order was placed (or, for the
/// seller fields, when the invoice was issued), so later catalogue or settings changes never alter it.
/// </summary>
public sealed class Order : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public int Number { get; set; }
    public Guid CustomerId { get; set; }
    public string Email { get; set; } = "";
    public string CustomerName { get; set; } = "";
    public string ShipName { get; set; } = "";
    public string ShipPhone { get; set; } = "";
    public string ShipLine1 { get; set; } = "";
    public string? ShipLine2 { get; set; }
    public string ShipCity { get; set; } = "";
    public string ShipStateCode { get; set; } = "";
    public string ShipPincode { get; set; } = "";
    public OrderStatus Status { get; set; }
    public PaymentMethod PaymentMethod { get; set; }
    public PaymentStatus PaymentStatus { get; set; }
    public decimal Subtotal { get; set; }
    public decimal Discount { get; set; }
    public decimal Shipping { get; set; }
    public decimal Taxable { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal Total { get; set; }
    public decimal RefundedTotal { get; set; }
    /// <summary>The store gift card that paid part (or all) of this order, how much it paid, and how much has gone back onto it.</summary>
    public Guid? GiftCardId { get; set; }
    public decimal GiftCardAmount { get; set; }
    public decimal GiftCardRestored { get; set; }
    public Guid? CouponId { get; set; }
    public string? CouponCode { get; set; }
    public string? IdempotencyKey { get; set; }
    public DateTimeOffset PlacedAt { get; set; }
    public DateTimeOffset? ReservedUntil { get; set; }
    public DateTimeOffset? PaidAt { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public string? CancelReason { get; set; }
    // Invoice (issued when the order is confirmed); seller details are copied so the invoice never changes.
    public string? InvoiceNumber { get; set; }
    public DateTimeOffset? InvoiceIssuedAt { get; set; }
    public string SellerStateCode { get; set; } = "";
    public string? SellerName { get; set; }
    public string? SellerLegalName { get; set; }
    public string? SellerGstin { get; set; }
    public string? SellerAddress { get; set; }
    public uint Version { get; set; }
    public List<OrderLine> Lines { get; set; } = [];
    public List<PaymentAttempt> Payments { get; set; } = [];
    public List<Refund> Refunds { get; set; } = [];
    public List<Shipment> Shipments { get; set; } = [];

    public decimal Paid => PaymentStatus is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded or PaymentStatus.Refunded ? Total : 0;
}

public sealed class OrderLine : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public Guid? VariantId { get; set; }
    public Guid LocationId { get; set; }
    public string ProductTitle { get; set; } = "";
    public string? VariantLabel { get; set; }
    public string Sku { get; set; } = "";
    public string? HsnCode { get; set; }
    public decimal GstRate { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Mrp { get; set; }
    public int Quantity { get; set; }
    public decimal Gross { get; set; }
    public decimal DiscountAllocated { get; set; }
    public decimal Taxable { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal LineTotal { get; set; }
    public int Position { get; set; }
}

/// <summary>One attempt to collect money for an order through a gateway (or the test gateway).</summary>
public sealed class PaymentAttempt : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public string Gateway { get; set; } = "";
    /// <summary>The gateway's order ID. Webhooks are matched to orders through this, never through payload notes.</summary>
    public string GatewayOrderId { get; set; } = "";
    public string? GatewayPaymentId { get; set; }
    public decimal Amount { get; set; }
    public PaymentAttemptStatus Status { get; set; }
    public string? FailureReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class Refund : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public decimal Amount { get; set; }
    public string Reason { get; set; } = "";
    public RefundStatus Status { get; set; }
    public string? GatewayRefundId { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
}

public sealed class Shipment : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public string Carrier { get; set; } = "";
    public string TrackingNumber { get; set; } = "";
    public string? TrackingUrl { get; set; }
    public DateTimeOffset ShippedAt { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
}

public sealed class Coupon : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Code { get; set; } = "";
    public CouponKind Kind { get; set; }
    /// <summary>Percent (1–90) or rupees off.</summary>
    public decimal Value { get; set; }
    public decimal MinSubtotal { get; set; }
    public decimal? MaxDiscount { get; set; }
    public DateTimeOffset? StartsAt { get; set; }
    public DateTimeOffset? EndsAt { get; set; }
    public int? UsageLimit { get; set; }
    public int PerCustomerLimit { get; set; } = 1;
    public int TimesUsed { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public uint Version { get; set; }
}

/// <summary>Per-store counters (order numbers, invoice numbers per financial year). Incremented atomically in SQL.</summary>
public sealed class TenantCounter : ITenantOwned
{
    public Guid TenantId { get; set; }
    public string Name { get; set; } = "";
    public int Value { get; set; }
}

/// <summary>Webhook inbox: each gateway event is processed once (the gateway may deliver it several times).</summary>
public sealed class WebhookEvent : ITenantOwned
{
    public string Gateway { get; set; } = "";
    public string EventId { get; set; } = "";
    public Guid TenantId { get; set; }
    public string EventType { get; set; } = "";
    public DateTimeOffset ReceivedAt { get; set; }
}

/// <summary>A store's Razorpay connection. Secrets are encrypted with the platform key (SecretBox) before storage.</summary>
public sealed class TenantPaymentSettings : ITenantOwned
{
    public Guid TenantId { get; set; }
    public string RazorpayKeyId { get; set; } = "";
    public string RazorpayKeySecretEnc { get; set; } = "";
    public string RazorpayWebhookSecretEnc { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; }
}
