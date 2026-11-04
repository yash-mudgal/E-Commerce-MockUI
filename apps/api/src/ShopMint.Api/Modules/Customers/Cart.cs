using FluentValidation;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Catalog;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Customers;

public sealed record CartLineView(Guid Id, Guid VariantId, string ProductTitle, string ProductSlug, string[] OptionNames, string[] OptionValues,
    string Sku, string? ImageUrl, decimal UnitPrice, decimal Mrp, int Quantity, decimal LineTotal, int MaxQuantity, string Status, string? Message);
public sealed record CartView(IReadOnlyList<CartLineView> Lines, int ItemCount, decimal Subtotal, decimal Savings, bool HasIssues);
public sealed record AddToCartRequest(Guid VariantId, int Quantity);
public sealed record UpdateCartLineRequest(int Quantity);

public sealed class AddToCartValidator : AbstractValidator<AddToCartRequest>
{
    public AddToCartValidator() => RuleFor(x => x.Quantity).InclusiveBetween(1, CartRules.MaxQuantityPerLine);
}

public sealed class UpdateCartLineValidator : AbstractValidator<UpdateCartLineRequest>
{
    public UpdateCartLineValidator() => RuleFor(x => x.Quantity).InclusiveBetween(0, CartRules.MaxQuantityPerLine);
}

public static class CartRules
{
    public const int MaxQuantityPerLine = 10;
    public const int MaxLines = 30;
    public static readonly TimeSpan GuestCartLifetime = TimeSpan.FromDays(30);

    /// <summary>
    /// Line state from current data. "ok": can be bought as is; "limited": fewer units are available than requested
    /// (the subtotal counts only what's available); "out_of_stock"; "unavailable": the product or variant was withdrawn.
    /// </summary>
    public static (string Status, string? Message, int Purchasable) Assess(bool sellable, int available, int quantity) =>
        !sellable ? ("unavailable", "This item is no longer available.", 0)
        : available <= 0 ? ("out_of_stock", "Out of stock.", 0)
        : available < quantity ? ("limited", $"Only {available} left. We'll count {available} in your total.", available)
        : ("ok", null, quantity);
}

/// <summary>
/// The current cart: the signed-in customer's cart, or a guest cart identified by a random, HttpOnly cookie token
/// (only its hash is stored). Prices, availability and totals are always computed from the database; nothing a
/// client sends about price is used.
/// </summary>
public sealed class CartService(AppDbContext db, CustomerSession customers, IHttpContextAccessor accessor,
    IObjectStorage storage, IConfiguration config, IHostEnvironment env)
{
    private HttpContext Http => accessor.HttpContext ?? throw new InvalidOperationException("No HTTP context.");
    private string CookieName => config["Auth:CartCookieName"] ?? (env.IsDevelopment() ? "sm_cart" : "__Host-sm_cart");

    public async Task<Cart?> FindAsync(CancellationToken ct)
    {
        if (await customers.CurrentAsync(ct) is { } c)
            return await db.Carts.Include(x => x.Lines).FirstOrDefaultAsync(x => x.CustomerId == c.Id, ct);
        var token = Http.Request.Cookies[CookieName];
        if (!SecureToken.LooksValid(token)) return null;
        var hash = SecureToken.Hash(token!);
        return await db.Carts.Include(x => x.Lines).FirstOrDefaultAsync(x => x.TokenHash == hash && x.CustomerId == null, ct);
    }

    private async Task<Cart> GetOrCreateAsync(CancellationToken ct)
    {
        if (await FindAsync(ct) is { } existing) return existing;
        var now = DateTimeOffset.UtcNow;
        var cart = new Cart { Id = Guid.CreateVersion7(), CreatedAt = now, UpdatedAt = now };
        if (await customers.CurrentAsync(ct) is { } c) cart.CustomerId = c.Id;
        else
        {
            var (token, hash) = SecureToken.Create();
            cart.TokenHash = hash;
            SetCookie(token);
        }
        db.Carts.Add(cart);
        return cart;
    }

    private void SetCookie(string token) => Http.Response.Cookies.Append(CookieName, token, new CookieOptions
    {
        HttpOnly = true, SameSite = SameSiteMode.Lax, Secure = !env.IsDevelopment() || Http.Request.IsHttps, Path = "/",
        Expires = DateTimeOffset.UtcNow.Add(CartRules.GuestCartLifetime), IsEssential = true,
    });

    public async Task<CartView> AddAsync(AddToCartRequest req, CancellationToken ct)
    {
        var stock = await SellableAsync([req.VariantId], ct);
        if (!stock.TryGetValue(req.VariantId, out var s) || !s.Sellable)
            throw AppException.Invalid("variantId", "This item isn't available.");
        var cart = await GetOrCreateAsync(ct);
        var line = cart.Lines.FirstOrDefault(l => l.VariantId == req.VariantId);
        var quantity = (line?.Quantity ?? 0) + req.Quantity;
        if (line is null && cart.Lines.Count >= CartRules.MaxLines)
            throw AppException.Unprocessable(ProblemTypes.CartLimit, $"A cart can hold up to {CartRules.MaxLines} different items.");
        if (quantity > CartRules.MaxQuantityPerLine)
            throw AppException.Unprocessable(ProblemTypes.CartLimit, $"You can buy up to {CartRules.MaxQuantityPerLine} of each item.");
        if (quantity > s.Available)
            throw new AppException(409, ProblemTypes.InsufficientStock, "Not enough stock.",
                s.Available <= 0 ? "This item just sold out." : $"Only {s.Available} available{(line is null ? "" : $", and {line.Quantity} are already in your cart")}.");
        if (line is null)
        {
            line = new CartLine { Id = Guid.CreateVersion7(), CartId = cart.Id, VariantId = req.VariantId, CreatedAt = DateTimeOffset.UtcNow };
            db.CartLines.Add(line);
            cart.Lines.Add(line);
        }
        line.Quantity = quantity;
        cart.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await ViewAsync(cart, ct);
    }

    public async Task<CartView> UpdateAsync(Guid lineId, int quantity, CancellationToken ct)
    {
        var cart = await FindAsync(ct) ?? throw AppException.NotFound("Cart item");
        var line = cart.Lines.FirstOrDefault(l => l.Id == lineId) ?? throw AppException.NotFound("Cart item");
        if (quantity == 0)
        {
            cart.Lines.Remove(line);
            db.CartLines.Remove(line);
        }
        else
        {
            var stock = await SellableAsync([line.VariantId], ct);
            var available = stock.TryGetValue(line.VariantId, out var s) && s.Sellable ? s.Available : 0;
            // Lowering a quantity is always allowed (it resolves "only N left"); raising it needs stock.
            if (quantity > line.Quantity && quantity > available)
                throw new AppException(409, ProblemTypes.InsufficientStock, "Not enough stock.", $"Only {available} available.");
            line.Quantity = quantity;
        }
        cart.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await ViewAsync(cart, ct);
    }

    /// <summary>After sign-in: moves the guest cart's lines into the customer's cart and forgets the guest cart.</summary>
    public async Task MergeGuestCartAsync(Customer customer, CancellationToken ct)
    {
        var token = Http.Request.Cookies[CookieName];
        if (!SecureToken.LooksValid(token)) return;
        Http.Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/", Secure = !env.IsDevelopment() || Http.Request.IsHttps, SameSite = SameSiteMode.Lax });
        var hash = SecureToken.Hash(token!);
        var guest = await db.Carts.Include(x => x.Lines).FirstOrDefaultAsync(x => x.TokenHash == hash && x.CustomerId == null, ct);
        if (guest is null) return;

        var mine = await db.Carts.Include(x => x.Lines).FirstOrDefaultAsync(x => x.CustomerId == customer.Id, ct);
        if (mine is null)
        {
            // Adopt the guest cart as is.
            guest.CustomerId = customer.Id;
            guest.TokenHash = null;
            guest.UpdatedAt = DateTimeOffset.UtcNow;
        }
        else
        {
            foreach (var gl in guest.Lines)
            {
                var existing = mine.Lines.FirstOrDefault(l => l.VariantId == gl.VariantId);
                if (existing is not null) existing.Quantity = Math.Min(CartRules.MaxQuantityPerLine, existing.Quantity + gl.Quantity);
                else if (mine.Lines.Count < CartRules.MaxLines)
                {
                    var line = new CartLine { Id = Guid.CreateVersion7(), CartId = mine.Id, VariantId = gl.VariantId, Quantity = gl.Quantity, CreatedAt = gl.CreatedAt };
                    db.CartLines.Add(line);
                    mine.Lines.Add(line);
                }
            }
            mine.UpdatedAt = DateTimeOffset.UtcNow;
            db.Carts.Remove(guest);
        }
        await db.SaveChangesAsync(ct);
    }

    private sealed record Stock(bool Sellable, int Available);

    private async Task<Dictionary<Guid, Stock>> SellableAsync(IReadOnlyCollection<Guid> variantIds, CancellationToken ct) =>
        await db.ProductVariants.AsNoTracking().Where(v => variantIds.Contains(v.Id))
            .Join(db.Products, v => v.ProductId, p => p.Id, (v, p) => new
            {
                v.Id,
                Sellable = v.IsActive && p.Status == ProductStatus.Active,
                Available = v.StockLevels.Sum(s => (int?)(s.OnHand - s.Reserved)) ?? 0,
            })
            .ToDictionaryAsync(x => x.Id, x => new Stock(x.Sellable, x.Available), ct);

    public async Task<CartView> ViewAsync(Cart? cart, CancellationToken ct)
    {
        if (cart is null || cart.Lines.Count == 0) return new CartView([], 0, 0, 0, false);
        var ids = cart.Lines.Select(l => l.VariantId).ToList();
        var rows = await db.ProductVariants.AsNoTracking().Where(v => ids.Contains(v.Id))
            .Join(db.Products, v => v.ProductId, p => p.Id, (v, p) => new
            {
                v.Id, v.Sku, v.OptionValues, v.Price, v.Mrp, p.Title, p.Slug, p.OptionNames,
                Sellable = v.IsActive && p.Status == ProductStatus.Active,
                Available = v.StockLevels.Sum(s => (int?)(s.OnHand - s.Reserved)) ?? 0,
                Image = p.Media.Where(m => m.Status == MediaStatus.Ready).OrderBy(m => m.Position).Select(m => m.StorageKey).FirstOrDefault(),
            })
            .ToDictionaryAsync(x => x.Id, ct);

        var lines = new List<CartLineView>();
        decimal subtotal = 0, savings = 0;
        var count = 0;
        foreach (var l in cart.Lines.OrderBy(l => l.CreatedAt))
        {
            if (!rows.TryGetValue(l.VariantId, out var r)) continue;
            var (status, message, purchasable) = CartRules.Assess(r.Sellable, r.Available, l.Quantity);
            subtotal += r.Price * purchasable;
            savings += (r.Mrp - r.Price) * purchasable;
            count += purchasable;
            lines.Add(new CartLineView(l.Id, l.VariantId, r.Title, r.Slug, r.OptionNames, r.OptionValues, r.Sku,
                r.Image is null ? null : storage.PublicUrl(r.Image), r.Price, r.Mrp, l.Quantity, r.Price * purchasable,
                Math.Max(0, Math.Min(CartRules.MaxQuantityPerLine, r.Available)), status, message));
        }
        return new CartView(lines, count, subtotal, savings, lines.Any(x => x.Status != "ok"));
    }
}

/// <summary>Deletes guest carts nobody has touched for 30 days (daily).</summary>
public sealed class CartJanitor(IServiceScopeFactory scopes, ILogger<CartJanitor> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(6));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
                var cutoff = DateTimeOffset.UtcNow - CartRules.GuestCartLifetime;
                var removed = await db.Carts.Where(c => c.CustomerId == null && c.UpdatedAt < cutoff).ExecuteDeleteAsync(stoppingToken);
                if (removed > 0) log.LogInformation("Removed {Count} abandoned guest carts", removed);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Cart janitor run failed");
            }
        }
    }
}
