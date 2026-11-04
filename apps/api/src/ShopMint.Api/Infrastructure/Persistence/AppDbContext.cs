using System.Reflection;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules;

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
            e.Property(x => x.Gstin).HasMaxLength(15);
            e.Property(x => x.StateCode).HasMaxLength(2);
            e.Property(x => x.BrandColor).HasMaxLength(7);
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
