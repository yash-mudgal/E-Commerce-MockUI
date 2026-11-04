using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Customers;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Notifications;

public sealed record NotificationPrefsDto(bool NewOrders, bool LowStock);

/// <summary>Per-member email preferences in a store. Unset means the role's default.</summary>
public static class NotificationPrefs
{
    public static bool NewOrdersDefault(MemberRole role) => false; // the store's support address gets order alerts by default
    public static bool LowStockDefault(MemberRole role) => role != MemberRole.Staff;

    public static void Map(RouteGroupBuilder admin)
    {
        var g = admin.MapGroup("/me/notifications").WithTags("Notifications");
        g.MapGet("/", async (AppDbContext db, TenantContext t, CancellationToken ct) => Results.Ok(Dto(await MineAsync(db, t, ct))));
        g.MapPut("/", async (NotificationPrefsDto req, AppDbContext db, TenantContext t, CancellationToken ct) =>
        {
            var m = await MineAsync(db, t, ct);
            m.NotifyNewOrders = req.NewOrders;
            m.NotifyLowStock = req.LowStock;
            await db.SaveChangesAsync(ct);
            return Results.Ok(Dto(m));
        });
    }

    private static async Task<Membership> MineAsync(AppDbContext db, TenantContext t, CancellationToken ct)
    {
        var tid = t.RequireTenant();
        var uid = t.UserId ?? throw AppException.Forbidden("Sign in to continue.");
        return await db.Memberships.FirstOrDefaultAsync(m => m.TenantId == tid && m.UserId == uid && m.Status == MembershipStatus.Active, ct)
            ?? throw AppException.NotFound("Membership");
    }

    private static NotificationPrefsDto Dto(Membership m) =>
        new(m.NotifyNewOrders ?? NewOrdersDefault(m.Role), m.NotifyLowStock ?? LowStockDefault(m.Role));

    /// <summary>
    /// Who gets new-order alerts: the store's support address plus members who turned them on; the owners if that's
    /// nobody. Addresses are de-duplicated.
    /// </summary>
    public static async Task<List<string>> NewOrderRecipientsAsync(AppDbContext db, Guid tid, CancellationToken ct)
    {
        var support = await db.Tenants.Where(t => t.Id == tid).Select(t => t.SupportEmail).FirstOrDefaultAsync(ct);
        var members = await db.Memberships.Where(m => m.TenantId == tid && m.Status == MembershipStatus.Active && m.NotifyNewOrders == true)
            .Select(m => m.User!.Email).ToListAsync(ct);
        var all = (support is null ? members : [support, .. members]).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return all.Count > 0 ? all
            : await db.Memberships.Where(m => m.TenantId == tid && m.Role == MemberRole.Owner && m.Status == MembershipStatus.Active).Select(m => m.User!.Email).ToListAsync(ct);
    }
}

/// <summary>Marketing opt-out by link (no sign-in), on the store's own domain.</summary>
public sealed record UnsubscribeRequest(string Token);

public static class UnsubscribeEndpoint
{
    public static readonly TimeSpan TokenLifetime = TimeSpan.FromDays(90);

    public static void Map(RouteGroupBuilder storefront) =>
        storefront.MapPost("/account/unsubscribe", async (UnsubscribeRequest req, AppDbContext db, CancellationToken ct) =>
        {
            if (!SecureToken.LooksValid(req.Token)) throw new AppException(400, ProblemTypes.InvalidToken, "This unsubscribe link isn't valid.");
            var hash = SecureToken.Hash(req.Token);
            var now = DateTimeOffset.UtcNow;
            // The storefront filter has set this store as the tenant, so another store's link doesn't resolve here.
            var token = await db.CustomerTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.Purpose == CustomerTokenPurpose.Unsubscribe && t.ExpiresAt > now, ct)
                ?? throw new AppException(400, ProblemTypes.InvalidToken, "This unsubscribe link has expired.", "Sign in and turn off emails in your account instead.");
            var c = await db.Customers.FirstAsync(x => x.Id == token.CustomerId, ct);
            c.MarketingOptInAt = null;
            token.UsedAt ??= now;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).AllowAnonymous().RequireRateLimiting("auth").WithTags("Shopper account");
}

/// <summary>
/// Hourly: a daily low-stock digest for members who want it (only when the list changed), and abandoned-cart reminders
/// for shoppers who agreed to marketing email, in stores that turned them on (once per cart change).
/// </summary>
public sealed class NotificationJob(IServiceScopeFactory scopes, ILogger<NotificationJob> log) : BackgroundService
{
    public static readonly TimeSpan CartIdle = TimeSpan.FromHours(4);
    public static readonly TimeSpan CartMaxAge = TimeSpan.FromDays(7);
    public const int DigestHourIst = 9;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await RunOnceAsync(scopes, DateTimeOffset.UtcNow, stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Notification run failed"); }
        }
    }

    public static async Task<(int Digests, int Reminders)> RunOnceAsync(IServiceScopeFactory scopes, DateTimeOffset now, CancellationToken ct)
    {
        List<Guid> digestTenants, cartTenants;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
            var open = db.Tenants.Where(t => t.LaunchedAt != null && (t.Status == TenantStatus.Active || t.Status == TenantStatus.Trialing || t.Status == TenantStatus.PastDue));
            var dayAgo = now.AddHours(-20);
            digestTenants = now.ToOffset(TimeSpan.FromMinutes(330)).Hour >= DigestHourIst
                ? await open.Where(t => t.LowStockDigestAt == null || t.LowStockDigestAt < dayAgo).Select(t => t.Id).Take(1000).ToListAsync(ct)
                : [];
            var idle = now - CartIdle;
            var oldest = now - CartMaxAge;
            cartTenants = await open.Where(t => t.AbandonedCartEmails && db.Carts.Any(c => c.TenantId == t.Id && c.CustomerId != null
                    && c.UpdatedAt <= idle && c.UpdatedAt >= oldest && (c.ReminderSentAt == null || c.ReminderSentAt < c.UpdatedAt)))
                .Select(t => t.Id).Take(1000).ToListAsync(ct);
        }
        int digests = 0, reminders = 0;
        foreach (var tid in digestTenants) digests += await InTenantAsync(scopes, tid, (db, email, config) => DigestAsync(db, email, config, tid, now, ct));
        foreach (var tid in cartTenants) reminders += await InTenantAsync(scopes, tid, (db, email, config) => RemindAsync(db, email, config, tid, now, ct));
        return (digests, reminders);
    }

    private static async Task<int> InTenantAsync(IServiceScopeFactory scopes, Guid tid, Func<AppDbContext, EmailOutbox, IConfiguration, Task<int>> work)
    {
        await using var scope = scopes.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tid, null);
        return await work(scope.ServiceProvider.GetRequiredService<AppDbContext>(), scope.ServiceProvider.GetRequiredService<EmailOutbox>(),
            scope.ServiceProvider.GetRequiredService<IConfiguration>());
    }

    private static async Task<int> DigestAsync(AppDbContext db, EmailOutbox email, IConfiguration config, Guid tid, DateTimeOffset now, CancellationToken ct)
    {
        var t = await db.Tenants.FirstAsync(x => x.Id == tid, ct);
        var low = await db.ProductVariants.Where(v => v.IsActive && db.Products.Any(p => p.Id == v.ProductId && p.Status == ProductStatus.Active))
            .Select(v => new { v.Sku, v.ProductId, Available = v.StockLevels.Sum(s => s.OnHand - s.Reserved) })
            .Where(v => v.Available <= t.LowStockThreshold)
            .Join(db.Products, v => v.ProductId, p => p.Id, (v, p) => new { p.Title, v.Sku, v.Available })
            .OrderBy(v => v.Available).ThenBy(v => v.Sku).Take(200).ToListAsync(ct);
        var hash = low.Count == 0 ? null
            : Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("|", low.Select(v => $"{v.Sku}:{Math.Max(0, v.Available)}").Order(StringComparer.Ordinal)))));
        var sent = 0;
        if (hash is not null && hash != t.LowStockDigestHash)
        {
            var members = await db.Memberships.Where(m => m.TenantId == tid && m.Status == MembershipStatus.Active)
                .Select(m => new { m.Role, m.NotifyLowStock, m.User!.Email }).ToListAsync(ct);
            var url = $"{(config["App:PublicUrl"] ?? "").TrimEnd('/')}/admin/inventory?stock=low";
            var shown = low.Take(15).Select(v => (v.Title, v.Sku, v.Available)).ToList();
            foreach (var m in members.Where(m => m.NotifyLowStock ?? NotificationPrefs.LowStockDefault(m.Role)))
            {
                email.LowStockDigest(db, tid, m.Email, t.Name, url, shown, low.Count - shown.Count);
                sent++;
            }
        }
        t.LowStockDigestAt = now;
        t.LowStockDigestHash = hash;
        await db.SaveChangesAsync(ct);
        return sent;
    }

    private static async Task<int> RemindAsync(AppDbContext db, EmailOutbox email, IConfiguration config, Guid tid, DateTimeOffset now, CancellationToken ct)
    {
        var store = await db.Tenants.Where(t => t.Id == tid).Select(t => new { t.Name, t.AbandonedCartEmails, Host = t.Domains.OrderBy(d => d.Kind).Select(d => d.Host).First() }).FirstAsync(ct);
        if (!store.AbandonedCartEmails) return 0;
        var idle = now - CartIdle;
        var oldest = now - CartMaxAge;
        var carts = await db.Carts.Where(c => c.CustomerId != null && c.UpdatedAt <= idle && c.UpdatedAt >= oldest
                && (c.ReminderSentAt == null || c.ReminderSentAt < c.UpdatedAt) && c.Lines.Any())
            .Take(500).ToListAsync(ct);
        var baseUrl = CustomerEndpoints.StorefrontUrl(config, store.Host);
        var sent = 0;
        foreach (var cart in carts)
        {
            // Consent is checked at send time: only shoppers who currently agree to marketing email.
            var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == cart.CustomerId && c.MarketingOptInAt != null, ct);
            cart.ReminderSentAt = now;
            if (customer is null) continue;
            var items = await db.CartLines.Where(l => l.CartId == cart.Id)
                .Join(db.ProductVariants, l => l.VariantId, v => v.Id, (l, v) => new { l.Quantity, v.ProductId })
                .Join(db.Products.Where(p => p.Status == ProductStatus.Active), x => x.ProductId, p => p.Id, (x, p) => new { p.Title, x.Quantity })
                .Take(10).ToListAsync(ct);
            if (items.Count == 0) continue;
            var (token, hash) = SecureToken.Create();
            db.CustomerTokens.Add(new CustomerToken
            {
                Id = Guid.CreateVersion7(), CustomerId = customer.Id, TokenHash = hash, Purpose = CustomerTokenPurpose.Unsubscribe,
                CreatedAt = now, ExpiresAt = now.Add(UnsubscribeEndpoint.TokenLifetime),
            });
            email.AbandonedCart(db, tid, customer.Email, customer.Name, store.Name, $"{baseUrl}/cart", items.Select(i => (i.Title, i.Quantity)).ToList(),
                $"{baseUrl}/account/unsubscribe?token={token}");
            sent++;
        }
        await db.SaveChangesAsync(ct);
        return sent;
    }
}
