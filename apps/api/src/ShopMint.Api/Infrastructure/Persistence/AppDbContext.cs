using System.Reflection;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Orders;

namespace ShopMint.Api.Infrastructure.Persistence;

/// <summary>
/// Tenant-scoped context. It connects as the low-privilege <c>shopmint_app</c> role, so PostgreSQL RLS
/// applies. On top of that, every <see cref="ITenantOwned"/> entity gets a global query filter, and writes
/// are stamped and checked against the current tenant.
/// </summary>
public class AppDbContext : DbContext
{
    private readonly TenantContext _tenant;

    public AppDbContext(DbContextOptions<AppDbContext> options, TenantContext tenant) : base(options) => _tenant = tenant;

    protected AppDbContext(DbContextOptions options, TenantContext tenant) : base(options) => _tenant = tenant;

    /// <summary>False only in <see cref="PlatformDbContext"/>.</summary>
    protected virtual bool TenantScoped => true;

    // Referenced by query filters; EF parameterises these per context instance.
    private Guid? CurrentTenantId => _tenant.TenantId;
    private bool FilterEnabled => TenantScoped;

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<TenantDomain> TenantDomains => Set<TenantDomain>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<ProductVariant> ProductVariants => Set<ProductVariant>();
    public DbSet<ProductMedia> ProductMedia => Set<ProductMedia>();
    public DbSet<StorageDeletion> StorageDeletions => Set<StorageDeletion>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<CustomerToken> CustomerTokens => Set<CustomerToken>();
    public DbSet<CustomerAddress> CustomerAddresses => Set<CustomerAddress>();
    public DbSet<Cart> Carts => Set<Cart>();
    public DbSet<CartLine> CartLines => Set<CartLine>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();
    public DbSet<PaymentAttempt> PaymentAttempts => Set<PaymentAttempt>();
    public DbSet<Refund> Refunds => Set<Refund>();
    public DbSet<Shipment> Shipments => Set<Shipment>();
    public DbSet<Coupon> Coupons => Set<Coupon>();
    public DbSet<TenantCounter> TenantCounters => Set<TenantCounter>();
    public DbSet<WebhookEvent> WebhookEvents => Set<WebhookEvent>();
    public DbSet<TenantPaymentSettings> PaymentSettings => Set<TenantPaymentSettings>();
    public DbSet<Modules.Billing.Plan> Plans => Set<Modules.Billing.Plan>();
    public DbSet<Modules.Billing.Subscription> Subscriptions => Set<Modules.Billing.Subscription>();
    public DbSet<Modules.Billing.BillingInvoice> BillingInvoices => Set<Modules.Billing.BillingInvoice>();
    public DbSet<Location> Locations => Set<Location>();
    public DbSet<StockLevel> StockLevels => Set<StockLevel>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<AuditEntry> AuditLog => Set<AuditEntry>();
    public DbSet<UserToken> UserTokens => Set<UserToken>();
    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<OutboxEmail> OutboxEmails => Set<OutboxEmail>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Tenant>(e =>
        {
            e.ToTable("tenants");
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Slug).HasMaxLength(40);
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.PlanCode).HasMaxLength(20);
            e.Property(x => x.SuspensionReason).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.LowStockDigestHash).HasMaxLength(64);
            e.Property(x => x.Gstin).HasMaxLength(15);
            e.Property(x => x.StateCode).HasMaxLength(2);
            e.Property(x => x.BrandColor).HasMaxLength(7);
            e.Property(x => x.BusinessAddress).HasMaxLength(500);
            e.Property(x => x.ShippingFee).HasPrecision(14, 2);
            e.Property(x => x.FreeShippingThreshold).HasPrecision(14, 2);
            e.Property(x => x.CodMaxOrderValue).HasPrecision(14, 2);
            e.Property(x => x.Version).IsRowVersion();
            e.HasMany(x => x.Domains).WithOne().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TenantDomain>(e =>
        {
            e.ToTable("tenant_domains");
            e.HasIndex(x => x.Host).IsUnique();
            e.Property(x => x.Host).HasMaxLength(253);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasIndex(x => x.NormalizedEmail).IsUnique();
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.NormalizedEmail).HasMaxLength(254);
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.SecurityStamp).HasMaxLength(64);
        });

        b.Entity<Membership>(e =>
        {
            e.ToTable("memberships");
            e.HasIndex(x => new { x.TenantId, x.UserId }).IsUnique();
            e.HasIndex(x => x.UserId);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Category>(e =>
        {
            e.ToTable("categories");
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.Slug }).IsUnique();
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Slug).HasMaxLength(100);
            e.Property(x => x.Version).IsRowVersion();
            TenantFk<Category>(e);
            // Composite FK: a parent must belong to the same tenant.
            e.HasOne<Category>().WithMany().HasForeignKey(x => new { x.TenantId, x.ParentId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Product>(e =>
        {
            e.ToTable("products");
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.Slug }).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.Status, x.CreatedAt });
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Slug).HasMaxLength(220);
            e.Property(x => x.Description).HasMaxLength(10_000);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.HsnCode).HasMaxLength(8);
            e.Property(x => x.GstRate).HasPrecision(5, 2);
            e.Property(x => x.Version).IsRowVersion();
            TenantFk<Product>(e);
            e.HasOne(x => x.Category).WithMany().HasForeignKey(x => new { x.TenantId, x.CategoryId })
                .HasPrincipalKey(c => new { c.TenantId, c.Id }).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Variants).WithOne().HasForeignKey(v => new { v.TenantId, v.ProductId })
                .HasPrincipalKey(p => new { p.TenantId, p.Id }).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Media).WithOne().HasForeignKey(m => new { m.TenantId, m.ProductId })
                .HasPrincipalKey(p => new { p.TenantId, p.Id }).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Customer>(e =>
        {
            e.ToTable("customers");
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.NormalizedEmail }).IsUnique();
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.NormalizedEmail).HasMaxLength(254);
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Phone).HasMaxLength(15);
            e.Property(x => x.SecurityStamp).HasMaxLength(64);
            TenantFk<Customer>(e);
        });

        b.Entity<CustomerToken>(e =>
        {
            e.ToTable("customer_tokens");
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.Property(x => x.Purpose).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => new { x.TenantId, x.CustomerId });
            e.Property(x => x.TokenHash).HasMaxLength(64);
            TenantFk<CustomerToken>(e);
            e.HasOne<Customer>().WithMany().HasForeignKey(x => new { x.TenantId, x.CustomerId })
                .HasPrincipalKey(c => new { c.TenantId, c.Id }).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<CustomerAddress>(e =>
        {
            e.ToTable("customer_addresses");
            e.HasIndex(x => new { x.TenantId, x.CustomerId });
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Phone).HasMaxLength(15);
            e.Property(x => x.Line1).HasMaxLength(200);
            e.Property(x => x.Line2).HasMaxLength(200);
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.StateCode).HasMaxLength(2);
            e.Property(x => x.Pincode).HasMaxLength(6);
            TenantFk<CustomerAddress>(e);
            e.HasOne<Customer>().WithMany().HasForeignKey(x => new { x.TenantId, x.CustomerId })
                .HasPrincipalKey(c => new { c.TenantId, c.Id }).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Cart>(e =>
        {
            e.ToTable("carts");
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.CustomerId }).IsUnique().HasFilter("customer_id IS NOT NULL");
            e.HasIndex(x => x.TokenHash).IsUnique().HasFilter("token_hash IS NOT NULL");
            e.HasIndex(x => x.UpdatedAt);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            TenantFk<Cart>(e);
            e.HasOne<Customer>().WithMany().HasForeignKey(x => new { x.TenantId, x.CustomerId })
                .HasPrincipalKey(c => new { c.TenantId, c.Id }).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Lines).WithOne().HasForeignKey(l => new { l.TenantId, l.CartId })
                .HasPrincipalKey(c => new { c.TenantId, c.Id }).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<CartLine>(e =>
        {
            e.ToTable("cart_lines", t => t.HasCheckConstraint("ck_cart_line_quantity", "quantity > 0"));
            e.HasIndex(x => new { x.CartId, x.VariantId }).IsUnique();
            TenantFk<CartLine>(e);
            // A deleted variant drops out of carts.
            e.HasOne<ProductVariant>().WithMany().HasForeignKey(x => new { x.TenantId, x.VariantId })
                .HasPrincipalKey(v => new { v.TenantId, v.Id }).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Order>(e =>
        {
            e.ToTable("orders", t =>
            {
                t.HasCheckConstraint("ck_order_total_nonneg", "total >= 0");
                t.HasCheckConstraint("ck_order_refunded_valid", "refunded_total >= 0 AND refunded_total <= total");
            });
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.Number }).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.InvoiceNumber }).IsUnique().HasFilter("invoice_number IS NOT NULL");
            e.HasIndex(x => new { x.TenantId, x.CustomerId, x.IdempotencyKey }).IsUnique().HasFilter("idempotency_key IS NOT NULL");
            e.HasIndex(x => new { x.TenantId, x.Status, x.PlacedAt });
            e.HasIndex(x => new { x.Status, x.ReservedUntil });
            foreach (var p in new[] { nameof(Order.Subtotal), nameof(Order.Discount), nameof(Order.Shipping), nameof(Order.Taxable),
                         nameof(Order.Cgst), nameof(Order.Sgst), nameof(Order.Igst), nameof(Order.Total), nameof(Order.RefundedTotal) })
                e.Property(p).HasPrecision(14, 2);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.PaymentMethod).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.PaymentStatus).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.CustomerName).HasMaxLength(120);
            e.Property(x => x.ShipName).HasMaxLength(120);
            e.Property(x => x.ShipPhone).HasMaxLength(15);
            e.Property(x => x.ShipLine1).HasMaxLength(200);
            e.Property(x => x.ShipLine2).HasMaxLength(200);
            e.Property(x => x.ShipCity).HasMaxLength(100);
            e.Property(x => x.ShipStateCode).HasMaxLength(2);
            e.Property(x => x.ShipPincode).HasMaxLength(6);
            e.Property(x => x.SellerStateCode).HasMaxLength(2);
            e.Property(x => x.SellerName).HasMaxLength(120);
            e.Property(x => x.SellerLegalName).HasMaxLength(160);
            e.Property(x => x.SellerGstin).HasMaxLength(15);
            e.Property(x => x.SellerAddress).HasMaxLength(500);
            e.Property(x => x.CouponCode).HasMaxLength(30);
            e.Property(x => x.IdempotencyKey).HasMaxLength(100);
            e.Property(x => x.InvoiceNumber).HasMaxLength(16);
            e.Property(x => x.CancelReason).HasMaxLength(300);
            e.Property(x => x.Version).IsRowVersion();
            TenantFk<Order>(e);
            e.HasOne<Customer>().WithMany().HasForeignKey(x => new { x.TenantId, x.CustomerId })
                .HasPrincipalKey(c => new { c.TenantId, c.Id }).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Lines).WithOne().HasForeignKey(l => new { l.TenantId, l.OrderId }).HasPrincipalKey(o => new { o.TenantId, o.Id }).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Payments).WithOne().HasForeignKey(l => new { l.TenantId, l.OrderId }).HasPrincipalKey(o => new { o.TenantId, o.Id }).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Refunds).WithOne().HasForeignKey(l => new { l.TenantId, l.OrderId }).HasPrincipalKey(o => new { o.TenantId, o.Id }).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Shipments).WithOne().HasForeignKey(l => new { l.TenantId, l.OrderId }).HasPrincipalKey(o => new { o.TenantId, o.Id }).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<OrderLine>(e =>
        {
            e.ToTable("order_lines", t => t.HasCheckConstraint("ck_order_line_quantity", "quantity > 0"));
            e.HasIndex(x => new { x.TenantId, x.OrderId });
            e.HasIndex(x => new { x.TenantId, x.VariantId });
            foreach (var p in new[] { nameof(OrderLine.UnitPrice), nameof(OrderLine.Mrp), nameof(OrderLine.Gross), nameof(OrderLine.DiscountAllocated),
                         nameof(OrderLine.Taxable), nameof(OrderLine.Cgst), nameof(OrderLine.Sgst), nameof(OrderLine.Igst), nameof(OrderLine.LineTotal) })
                e.Property(p).HasPrecision(14, 2);
            e.Property(x => x.GstRate).HasPrecision(5, 2);
            e.Property(x => x.ProductTitle).HasMaxLength(200);
            e.Property(x => x.VariantLabel).HasMaxLength(200);
            e.Property(x => x.Sku).HasMaxLength(64);
            e.Property(x => x.HsnCode).HasMaxLength(8);
            TenantFk<OrderLine>(e);
            // No FK to variants: an order keeps its lines (and the ledger its rows) if a variant is later deleted.
        });

        b.Entity<PaymentAttempt>(e =>
        {
            e.ToTable("payment_attempts");
            e.HasIndex(x => new { x.Gateway, x.GatewayOrderId }).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.OrderId });
            e.Property(x => x.Gateway).HasMaxLength(20);
            e.Property(x => x.GatewayOrderId).HasMaxLength(60);
            e.Property(x => x.GatewayPaymentId).HasMaxLength(60);
            e.Property(x => x.Amount).HasPrecision(14, 2);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.FailureReason).HasMaxLength(300);
            TenantFk<PaymentAttempt>(e);
        });

        b.Entity<Refund>(e =>
        {
            e.ToTable("refunds", t => t.HasCheckConstraint("ck_refund_amount_positive", "amount > 0"));
            e.HasIndex(x => new { x.TenantId, x.OrderId });
            e.HasIndex(x => x.GatewayRefundId).IsUnique().HasFilter("gateway_refund_id IS NOT NULL");
            e.Property(x => x.Amount).HasPrecision(14, 2);
            e.Property(x => x.Reason).HasMaxLength(300);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.GatewayRefundId).HasMaxLength(60);
            TenantFk<Refund>(e);
        });

        b.Entity<Shipment>(e =>
        {
            e.ToTable("shipments");
            e.HasIndex(x => new { x.TenantId, x.OrderId });
            e.Property(x => x.Carrier).HasMaxLength(60);
            e.Property(x => x.TrackingNumber).HasMaxLength(60);
            e.Property(x => x.TrackingUrl).HasMaxLength(500);
            TenantFk<Shipment>(e);
        });

        b.Entity<Coupon>(e =>
        {
            e.ToTable("coupons", t =>
            {
                t.HasCheckConstraint("ck_coupon_value_positive", "value > 0");
                t.HasCheckConstraint("ck_coupon_usage_valid", "usage_limit IS NULL OR times_used <= usage_limit");
            });
            e.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
            e.Property(x => x.Code).HasMaxLength(30);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Value).HasPrecision(14, 2);
            e.Property(x => x.MinSubtotal).HasPrecision(14, 2);
            e.Property(x => x.MaxDiscount).HasPrecision(14, 2);
            e.Property(x => x.Version).IsRowVersion();
            TenantFk<Coupon>(e);
        });

        b.Entity<TenantCounter>(e =>
        {
            e.ToTable("tenant_counters");
            e.HasKey(x => new { x.TenantId, x.Name });
            e.Property(x => x.Name).HasMaxLength(30);
            TenantFk<TenantCounter>(e);
        });

        b.Entity<WebhookEvent>(e =>
        {
            e.ToTable("webhook_events");
            e.HasKey(x => new { x.Gateway, x.EventId });
            e.Property(x => x.Gateway).HasMaxLength(20);
            e.Property(x => x.EventId).HasMaxLength(100);
            e.Property(x => x.EventType).HasMaxLength(60);
            TenantFk<WebhookEvent>(e);
        });

        b.Entity<TenantPaymentSettings>(e =>
        {
            e.ToTable("tenant_payment_settings");
            e.HasKey(x => x.TenantId);
            e.Property(x => x.RazorpayKeyId).HasMaxLength(60);
            e.Property(x => x.RazorpayKeySecretEnc).HasMaxLength(500);
            e.Property(x => x.RazorpayWebhookSecretEnc).HasMaxLength(500);
            TenantFk<TenantPaymentSettings>(e);
        });

        b.Entity<Modules.Billing.Plan>(e =>
        {
            e.ToTable("plans", t => t.HasCheckConstraint("ck_plan_price", "monthly_price >= 0"));
            e.HasKey(x => x.Code);
            e.Property(x => x.Code).HasMaxLength(20);
            e.Property(x => x.Name).HasMaxLength(40);
            e.Property(x => x.MonthlyPrice).HasPrecision(14, 2);
            e.Property(x => x.RazorpayPlanId).HasMaxLength(40);
            e.HasIndex(x => x.RazorpayPlanId).IsUnique().HasFilter("razorpay_plan_id IS NOT NULL");
            e.Property(x => x.Version).IsRowVersion();
        });

        b.Entity<Modules.Billing.Subscription>(e =>
        {
            e.ToTable("subscriptions");
            e.HasIndex(x => x.GatewaySubscriptionId).IsUnique().HasFilter("gateway_subscription_id IS NOT NULL");
            e.HasIndex(x => new { x.TenantId, x.Status });
            e.Property(x => x.PlanCode).HasMaxLength(20);
            e.Property(x => x.PendingPlanCode).HasMaxLength(20);
            e.Property(x => x.Gateway).HasMaxLength(20);
            e.Property(x => x.GatewaySubscriptionId).HasMaxLength(60);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Note).HasMaxLength(300);
            e.Ignore(x => x.IsOpen);
            TenantFk<Modules.Billing.Subscription>(e);
        });

        b.Entity<Modules.Billing.BillingInvoice>(e =>
        {
            e.ToTable("billing_invoices");
            e.HasIndex(x => x.GatewayPaymentId).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.PaidAt });
            e.Property(x => x.GatewayPaymentId).HasMaxLength(60);
            e.Property(x => x.GatewayInvoiceId).HasMaxLength(60);
            e.Property(x => x.PlanCode).HasMaxLength(20);
            e.Property(x => x.Amount).HasPrecision(14, 2);
            e.Property(x => x.InvoiceUrl).HasMaxLength(300);
            e.HasOne<Modules.Billing.Subscription>().WithMany().HasForeignKey(x => x.SubscriptionId).OnDelete(DeleteBehavior.Cascade);
            TenantFk<Modules.Billing.BillingInvoice>(e);
        });

        b.Entity<StorageDeletion>(e =>
        {
            e.ToTable("storage_deletions");
            e.HasIndex(x => x.DeleteAfter);
            e.Property(x => x.StorageKey).HasMaxLength(300);
            // Global queue (keys already carry the tenant): the app role may only INSERT; the janitor uses the platform role.
        });

        b.Entity<ProductMedia>(e =>
        {
            e.ToTable("product_media", t => t.HasCheckConstraint("ck_media_size_positive", "size_bytes >= 0"));
            e.HasIndex(x => new { x.TenantId, x.ProductId, x.Position });
            e.HasIndex(x => x.StorageKey).IsUnique();
            e.HasIndex(x => new { x.Status, x.CreatedAt });
            e.Property(x => x.StorageKey).HasMaxLength(300);
            e.Property(x => x.ContentType).HasMaxLength(60);
            e.Property(x => x.AltText).HasMaxLength(250);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            TenantFk<ProductMedia>(e);
        });

        b.Entity<ProductVariant>(e =>
        {
            e.ToTable("product_variants", t =>
            {
                t.HasCheckConstraint("ck_variant_price_positive", "price > 0");
                t.HasCheckConstraint("ck_variant_mrp_gte_price", "mrp >= price");
                t.HasCheckConstraint("ck_variant_cost_nonneg", "cost IS NULL OR cost >= 0");
            });
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.Sku }).IsUnique().HasDatabaseName("ux_product_variants_tenant_sku");
            e.Property(x => x.Sku).HasMaxLength(64);
            e.Property(x => x.Price).HasPrecision(14, 2);
            e.Property(x => x.Mrp).HasPrecision(14, 2);
            e.Property(x => x.Cost).HasPrecision(14, 2);
            TenantFk<ProductVariant>(e);
            e.HasMany(x => x.StockLevels).WithOne().HasForeignKey(s => new { s.TenantId, s.VariantId })
                .HasPrincipalKey(v => new { v.TenantId, v.Id }).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Location>(e =>
        {
            e.ToTable("locations");
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Code).HasMaxLength(16);
            e.Property(x => x.StateCode).HasMaxLength(2);
            TenantFk<Location>(e);
        });

        b.Entity<StockLevel>(e =>
        {
            e.ToTable("stock_levels", t =>
            {
                t.HasCheckConstraint("ck_stock_onhand_nonneg", "on_hand >= 0");
                t.HasCheckConstraint("ck_stock_reserved_valid", "reserved >= 0 AND reserved <= on_hand");
            });
            e.HasKey(x => new { x.VariantId, x.LocationId });
            e.HasIndex(x => new { x.TenantId, x.VariantId });
            TenantFk<StockLevel>(e);
            e.HasOne<Location>().WithMany().HasForeignKey(x => new { x.TenantId, x.LocationId })
                .HasPrincipalKey(l => new { l.TenantId, l.Id }).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<StockMovement>(e =>
        {
            e.ToTable("stock_movements");
            e.HasIndex(x => new { x.TenantId, x.VariantId, x.At });
            e.Property(x => x.Reason).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Note).HasMaxLength(500);
            e.HasIndex(x => new { x.TenantId, x.At });
            TenantFk<StockMovement>(e);
            // Ledger rows outlive variant deletion (no FK to variants) so history is preserved.
        });

        b.Entity<AuditEntry>(e =>
        {
            e.ToTable("audit_log");
            e.HasIndex(x => new { x.TenantId, x.At });
            e.Property(x => x.Action).HasMaxLength(80);
            e.Property(x => x.EntityType).HasMaxLength(60);
            e.Property(x => x.EntityId).HasMaxLength(80);
            e.Property(x => x.Data).HasColumnType("jsonb");
            e.Property(x => x.CorrelationId).HasMaxLength(64);
            e.Property(x => x.Ip).HasMaxLength(45);
            // AuditEntry is not ITenantOwned (TenantId nullable); it is filtered explicitly below.
            e.HasQueryFilter(x => !FilterEnabled || x.TenantId == CurrentTenantId);
        });

        b.Entity<UserToken>(e =>
        {
            e.ToTable("user_tokens");
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => new { x.UserId, x.Purpose });
            e.Property(x => x.Purpose).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Invitation>(e =>
        {
            e.ToTable("invitations");
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.NormalizedEmail });
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.NormalizedEmail).HasMaxLength(254);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            TenantFk<Invitation>(e);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.InvitedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<OutboxEmail>(e =>
        {
            e.ToTable("email_outbox");
            e.HasIndex(x => new { x.Status, x.NextAttemptAt });
            e.Property(x => x.Template).HasMaxLength(60);
            e.Property(x => x.ToAddress).HasMaxLength(254);
            e.Property(x => x.ToName).HasMaxLength(120);
            e.Property(x => x.Subject).HasMaxLength(200);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.LastError).HasMaxLength(500);
            // Not filtered: the app role has INSERT only (no SELECT), and the dispatcher uses the platform role.
        });

        var apply = typeof(AppDbContext).GetMethod(nameof(ApplyTenantFilter), BindingFlags.NonPublic | BindingFlags.Instance)!;
        foreach (var et in b.Model.GetEntityTypes().Where(t => typeof(ITenantOwned).IsAssignableFrom(t.ClrType)))
            apply.MakeGenericMethod(et.ClrType).Invoke(this, [b]);
    }

    private void ApplyTenantFilter<T>(ModelBuilder b) where T : class, ITenantOwned =>
        b.Entity<T>().HasQueryFilter(e => !FilterEnabled || e.TenantId == CurrentTenantId);

    private static void TenantFk<T>(Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<T> e)
        where T : class, ITenantOwned =>
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Cascade);

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        GuardTenantWrites();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        GuardTenantWrites();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>Stamps the tenant on inserts and refuses any write that touches another tenant's rows.</summary>
    private void GuardTenantWrites()
    {
        if (!TenantScoped) return;
        foreach (var entry in ChangeTracker.Entries<ITenantOwned>())
        {
            if (entry.State is EntityState.Unchanged or EntityState.Detached) continue;
            var current = _tenant.TenantId
                ?? throw new InvalidOperationException($"Cannot write {entry.Metadata.ClrType.Name} without a tenant context.");
            if (entry.State == EntityState.Added && entry.Entity.TenantId == Guid.Empty)
                entry.Entity.TenantId = current;
            if (entry.Entity.TenantId != current)
                throw new InvalidOperationException($"Cross-tenant write blocked on {entry.Metadata.ClrType.Name}.");
        }
    }
}

/// <summary>
/// Cross-tenant context for the platform console and system jobs. It connects as <c>shopmint_platform</c>
/// (BYPASSRLS) and applies no tenant filter. Register it only where cross-tenant access is intended.
/// </summary>
public sealed class PlatformDbContext(DbContextOptions<PlatformDbContext> options, TenantContext tenant)
    : AppDbContext(options, tenant)
{
    protected override bool TenantScoped => false;
}
