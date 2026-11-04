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
public enum StockMovementReason { Initial, Adjustment, Sale, Return, Receipt, Correction, Damaged, Lost, TransferOut, TransferIn }
public enum MediaStatus { Pending, Ready }
public enum UserTokenPurpose { PasswordReset, EmailVerification }
public enum EmailStatus { Pending, Sent, Failed }

public sealed class Tenant
{
    public Guid Id { get; set; }
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public TenantStatus Status { get; set; } = TenantStatus.Trialing;
    /// <summary>Plan code (trial, basic, pro, enterprise). Replaced by a subscriptions table in Phase 9.</summary>
    public string PlanCode { get; set; } = "trial";
    public DateTimeOffset? TrialEndsAt { get; set; }
    public string? LegalName { get; set; }
    public string? Gstin { get; set; }
    public string? StateCode { get; set; }
    public string? Tagline { get; set; }
    public string? SupportEmail { get; set; }
    public string BrandColor { get; set; } = "#4f46e5";
    public int LowStockThreshold { get; set; } = 10;
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
