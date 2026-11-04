namespace ShopMint.Api.Modules;

/// <summary>Marker for rows owned by one tenant. Such entities get an EF global query filter, are stamped on
/// insert, and their tables must have a PostgreSQL RLS policy (enforced by RowLevelSecurityTests).</summary>
public interface ITenantOwned
{
    Guid TenantId { get; set; }
}

public enum TenantStatus { Trialing, Active, PastDue, Suspended, Cancelled }
public enum DomainKind { Subdomain, Custom }
public enum MemberRole { Owner, Manager, Staff }
public enum MembershipStatus { Invited, Active, Disabled }
public enum ProductStatus { Draft, Active, Archived }
public enum StockMovementReason { Initial, Adjustment, Sale, Return, Receipt, Correction, Damaged, Lost, TransferOut, TransferIn, OrderCancelled }
public enum MediaStatus { Pending, Ready }
public enum UserTokenPurpose { PasswordReset, EmailVerification, MfaChallenge }
public enum CustomerTokenPurpose { PasswordReset, Unsubscribe }
public enum EmailStatus { Pending, Sent, Failed }

public sealed class Tenant
{
    public Guid Id { get; set; }
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public TenantStatus Status { get; set; } = TenantStatus.Trialing;
    /// <summary>
    /// Effective plan code. Together with <see cref="Status"/>, <see cref="SuspensionReason"/> and <see cref="GraceEndsAt"/> it is
    /// derived from the store's subscriptions by <c>BillingRules.Derive</c>; don't set it directly.
    /// </summary>
    public string PlanCode { get; set; } = "trial";
    public DateTimeOffset? TrialEndsAt { get; set; }
    public Billing.SuspensionReason? SuspensionReason { get; set; }
    /// <summary>While a payment is failing: when the store will be suspended if it still isn't paid.</summary>
    public DateTimeOffset? GraceEndsAt { get; set; }
    public DateTimeOffset? TrialReminderSentAt { get; set; }
    public string? LegalName { get; set; }
    public string? Gstin { get; set; }
    public string? StateCode { get; set; }
    public string? Tagline { get; set; }
    public string? SupportEmail { get; set; }
    public string BrandColor { get; set; } = "#4f46e5";
    public int LowStockThreshold { get; set; } = 10;
    /// <summary>Registered business address printed on invoices.</summary>
    public string? BusinessAddress { get; set; }
    /// <summary>Flat delivery charge (GST-inclusive), waived at or above <see cref="FreeShippingThreshold"/>.</summary>
    public decimal ShippingFee { get; set; } = 49;
    public decimal? FreeShippingThreshold { get; set; } = 499;
    public bool CodEnabled { get; set; } = true;
    public decimal CodMaxOrderValue { get; set; } = 5000;
    /// <summary>Remind signed-in shoppers who agreed to marketing email about carts they left (off by default).</summary>
    public bool AbandonedCartEmails { get; set; }
    /// <summary>When the last low-stock digest was considered, and a fingerprint of what it listed (to avoid repeats).</summary>
    public DateTimeOffset? LowStockDigestAt { get; set; }
    public string? LowStockDigestHash { get; set; }
    /// <summary>Set when the merchant publishes the storefront. Until then shoppers see a "coming soon" page.</summary>
    public DateTimeOffset? LaunchedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public uint Version { get; set; }
    public List<TenantDomain> Domains { get; set; } = [];
}

public sealed class TenantDomain
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    /// <summary>Lower-case host without port, e.g. "desithreads.shopmint.in".</summary>
    public string Host { get; set; } = "";
    public DomainKind Kind { get; set; }
    public DateTimeOffset? VerifiedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Merchant or platform user. Global (not tenant-scoped): one person may belong to several stores.</summary>
public sealed class User
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public string NormalizedEmail { get; set; } = "";
    public string Name { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    /// <summary>Set when the user proves control of the address (verification link or accepted invitation).</summary>
    public DateTimeOffset? EmailVerifiedAt { get; set; }
    public bool IsPlatformAdmin { get; set; }
    public int FailedLogins { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    /// <summary>Rotated on password or permission changes; sessions carrying an old stamp are rejected.</summary>
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
    /// <summary>Two-step verification: the TOTP secret (encrypted), when it was turned on, the last accepted time step
    /// (to stop replays) and SHA-256 hashes of unused recovery codes. A pending secret awaits confirmation.</summary>
    public string? TotpSecretEnc { get; set; }
    public string? TotpPendingSecretEnc { get; set; }
    public DateTimeOffset? TotpEnabledAt { get; set; }
    public long? TotpLastStep { get; set; }
    public List<string> RecoveryCodeHashes { get; set; } = [];
}

/// <summary>User ↔ tenant link with a role. Not ITenantOwned for EF filtering because a user lists their own
/// memberships across tenants; RLS allows rows of the current tenant OR the current user.</summary>
public sealed class Membership
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public MemberRole Role { get; set; }
    public MembershipStatus Status { get; set; } = MembershipStatus.Active;
    public DateTimeOffset CreatedAt { get; set; }
    /// <summary>Email preferences; null means the role's default (see <c>NotificationPrefs</c>).</summary>
    public bool? NotifyNewOrders { get; set; }
    public bool? NotifyLowStock { get; set; }
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

public sealed class Category : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public int Position { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public uint Version { get; set; }
}

public sealed class Product : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid? CategoryId { get; set; }
    public string Title { get; set; } = "";
    public string Slug { get; set; } = "";
    public string Description { get; set; } = "";
    public ProductStatus Status { get; set; } = ProductStatus.Draft;
    public string? HsnCode { get; set; }
    /// <summary>GST rate in percent; prices are GST-inclusive.</summary>
    public decimal GstRate { get; set; }
    /// <summary>Option axis names, e.g. ["Size", "Colour"]. Each variant has one value per axis.</summary>
    public string[] OptionNames { get; set; } = [];
    public string[] Tags { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public uint Version { get; set; }
    public Category? Category { get; set; }
    public List<ProductVariant> Variants { get; set; } = [];
    public List<ProductMedia> Media { get; set; } = [];
}

/// <summary>
/// A stored file waiting to be deleted. Published images stay in storage for a while after removal so storefront
/// pages cached before the change don't show broken images. Written in the same transaction as the removal.
/// </summary>
public sealed class StorageDeletion
{
    public Guid Id { get; set; }
    public string StorageKey { get; set; } = "";
    public DateTimeOffset DeleteAfter { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// A product image in object storage. The browser uploads directly to storage with a short-lived presigned URL;
/// the row stays Pending until the API has checked the stored object (size, type, magic bytes). Pending rows
/// that are never completed are removed by <c>MediaJanitor</c>. URLs are derived from the key at read time.
/// </summary>
public sealed class ProductMedia : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ProductId { get; set; }
    public string StorageKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }
    public string? AltText { get; set; }
    public int Position { get; set; }
    public MediaStatus Status { get; set; } = MediaStatus.Pending;
    public Guid? UploadedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ProductVariant : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ProductId { get; set; }
    public string Sku { get; set; } = "";
    public string[] OptionValues { get; set; } = [];
    public decimal Price { get; set; }
    public decimal Mrp { get; set; }
    public decimal? Cost { get; set; }
    public bool IsActive { get; set; } = true;
    public int Position { get; set; }
    public List<StockLevel> StockLevels { get; set; } = [];
}

public sealed class Location : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Name { get; set; } = "";
    public string Code { get; set; } = "";
    public string? StateCode { get; set; }
    public bool IsDefault { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class StockLevel : ITenantOwned
{
    public Guid TenantId { get; set; }
    public Guid VariantId { get; set; }
    public Guid LocationId { get; set; }
    public int OnHand { get; set; }
    public int Reserved { get; set; }
}

/// <summary>Append-only inventory ledger.</summary>
public sealed class StockMovement : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid VariantId { get; set; }
    public Guid LocationId { get; set; }
    public int Delta { get; set; }
    public StockMovementReason Reason { get; set; }
    public Guid? ActorUserId { get; set; }
    /// <summary>Free-text reason from the person who adjusted stock (supplier invoice number, what was damaged…).</summary>
    public string? Note { get; set; }
    /// <summary>Groups the two rows of a transfer, or the lines of one adjustment.</summary>
    public Guid? BatchId { get; set; }
    public DateTimeOffset At { get; set; }
}

/// <summary>Append-only audit trail. TenantId is null for platform-level events.</summary>
public sealed class AuditEntry
{
    public Guid Id { get; set; }
    public Guid? TenantId { get; set; }
    public Guid? ActorUserId { get; set; }
    public string Action { get; set; } = "";
    public string? EntityType { get; set; }
    public string? EntityId { get; set; }
    public string? Data { get; set; }
    public string? CorrelationId { get; set; }
    public string? Ip { get; set; }
    public DateTimeOffset At { get; set; }
}

/// <summary>
/// Single-use secret for password reset or email verification. Only the SHA-256 hash of the token is stored,
/// so a database leak does not reveal usable links.
/// </summary>
public sealed class UserToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public UserTokenPurpose Purpose { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>A pending invitation to join a store. Only the SHA-256 hash of the link token is stored.</summary>
public sealed class Invitation : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Email { get; set; } = "";
    public string NormalizedEmail { get; set; } = "";
    public MemberRole Role { get; set; }
    public string TokenHash { get; set; } = "";
    public Guid InvitedByUserId { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? AcceptedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public DateTimeOffset LastSentAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public bool IsPending(DateTimeOffset now) => AcceptedAt is null && RevokedAt is null && ExpiresAt > now;
}

/// <summary>
/// Transactional outbox for email. Rows are written in the same transaction as the change that triggers them
/// and delivered by <c>EmailDispatcher</c>. The app role may only INSERT; bodies are cleared once delivered.
/// </summary>
public sealed class OutboxEmail
{
    public Guid Id { get; set; }
    public Guid? TenantId { get; set; }
    public string Template { get; set; } = "";
    public string ToAddress { get; set; } = "";
    public string? ToName { get; set; }
    public string Subject { get; set; } = "";
    public string? TextBody { get; set; }
    public string? HtmlBody { get; set; }
    public EmailStatus Status { get; set; } = EmailStatus.Pending;
    public int Attempts { get; set; }
    public DateTimeOffset NextAttemptAt { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
}

/// <summary>
/// A shopper's account at one store. Customers are tenant-owned: the same email can register separately at two
/// stores, and a customer session is valid only on its own store's host.
/// </summary>
public sealed class Customer : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Email { get; set; } = "";
    public string NormalizedEmail { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string PasswordHash { get; set; } = "";
    /// <summary>DPDP consent record: when the customer opted in to marketing email, or null.</summary>
    public DateTimeOffset? MarketingOptInAt { get; set; }
    public int FailedLogins { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
}

/// <summary>Single-use password-reset token for a customer (SHA-256 hash only).</summary>
public sealed class CustomerToken : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid CustomerId { get; set; }
    public string TokenHash { get; set; } = "";
    public CustomerTokenPurpose Purpose { get; set; } = CustomerTokenPurpose.PasswordReset;
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>A delivery address in India. State is the 2-digit GST state code (used for CGST/SGST vs IGST).</summary>
public sealed class CustomerAddress : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid CustomerId { get; set; }
    public string Name { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Line1 { get; set; } = "";
    public string? Line2 { get; set; }
    public string City { get; set; } = "";
    public string StateCode { get; set; } = "";
    public string Pincode { get; set; } = "";
    public bool IsDefault { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// A shopping cart. A guest cart is found by the hash of a random cookie token; a signed-in customer has at most one
/// cart, which follows them across devices. Lines store only variant and quantity: prices are always read fresh.
/// </summary>
public sealed class Cart : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid? CustomerId { get; set; }
    public string? TokenHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    /// <summary>When an abandoned-cart reminder was sent; another is sent only after the cart changes again.</summary>
    public DateTimeOffset? ReminderSentAt { get; set; }
    public List<CartLine> Lines { get; set; } = [];
}

public sealed class CartLine : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid CartId { get; set; }
    public Guid VariantId { get; set; }
    public int Quantity { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
