namespace ShopMint.Api.Modules.Billing;

/// <summary>Why a store is suspended. Platform suspensions are lifted only by the platform; billing ones by paying.</summary>
public enum SuspensionReason { Platform, TrialExpired, PaymentFailed }

/// <summary>Mirrors Razorpay's subscription states. <c>Manual</c> plans (assigned by the platform) are <c>Active</c>.</summary>
public enum SubscriptionStatus { Created, Authenticated, Active, Pending, Halted, Paused, Cancelled, Completed, Expired }

/// <summary>A ShopMint plan and its entitlements (platform-level, not tenant data). Prices exclude GST.</summary>
public sealed class Plan
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public decimal MonthlyPrice { get; set; }
    public int? MaxProducts { get; set; }
    public int? MaxStaff { get; set; }
    public int? MaxLocations { get; set; }
    public bool CustomDomain { get; set; }
    /// <summary>Shown to merchants and available for self-service subscription.</summary>
    public bool IsPublic { get; set; }
    public int SortOrder { get; set; }
    /// <summary>The matching plan in ShopMint's own Razorpay account (its amount must equal the price plus GST).</summary>
    public string? RazorpayPlanId { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public uint Version { get; set; }
}

/// <summary>A store's subscription to ShopMint. A store can have several over time; the derived state uses the open ones.</summary>
public sealed class Subscription : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string PlanCode { get; set; } = "";
    /// <summary>razorpay, test or manual (assigned by the platform, no payment).</summary>
    public string Gateway { get; set; } = "";
    public string? GatewaySubscriptionId { get; set; }
    public SubscriptionStatus Status { get; set; }
    public DateTimeOffset? StartAt { get; set; }
    public DateTimeOffset? CurrentPeriodStart { get; set; }
    public DateTimeOffset? CurrentPeriodEnd { get; set; }
    public bool CancelAtPeriodEnd { get; set; }
    /// <summary>A downgrade that takes effect when the current period ends.</summary>
    public string? PendingPlanCode { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }

    public bool IsOpen => Status is SubscriptionStatus.Authenticated or SubscriptionStatus.Active or SubscriptionStatus.Pending
        or SubscriptionStatus.Halted or SubscriptionStatus.Paused;
}

/// <summary>A successful subscription charge (ShopMint's revenue), recorded from the gateway.</summary>
public sealed class BillingInvoice : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid SubscriptionId { get; set; }
    public string GatewayPaymentId { get; set; } = "";
    public string? GatewayInvoiceId { get; set; }
    public string PlanCode { get; set; } = "";
    public decimal Amount { get; set; }
    public DateTimeOffset? PeriodStart { get; set; }
    public DateTimeOffset? PeriodEnd { get; set; }
    public DateTimeOffset PaidAt { get; set; }
    /// <summary>Razorpay's hosted invoice page, when Razorpay issued one.</summary>
    public string? InvoiceUrl { get; set; }
}
