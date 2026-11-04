using System.Text.RegularExpressions;
using FluentValidation;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Notifications;

namespace ShopMint.Api.Modules.Customers;

// ---------- Contracts ----------

public sealed record CustomerSignupRequest(string Name, string Email, string Password, bool MarketingOptIn = false);
public sealed record CustomerLoginRequest(string Email, string Password);
public sealed record CustomerProfileRequest(string Name, string? Phone, bool MarketingOptIn);
public sealed record CustomerDto(Guid Id, string Name, string Email, string? Phone, bool MarketingOptIn, DateTimeOffset CreatedAt);
public sealed record AddressRequest(string Name, string Phone, string Line1, string? Line2, string City, string StateCode, string Pincode, bool IsDefault = false);
public sealed record AddressDto(Guid Id, string Name, string Phone, string Line1, string? Line2, string City, string StateCode, string StateName,
    string Pincode, bool IsDefault);
public sealed record AdminCustomerDto(Guid Id, string Name, string Email, string? Phone, bool MarketingOptIn, int Addresses,
    DateTimeOffset CreatedAt, DateTimeOffset? LastLoginAt);

/// <summary>GST state and union-territory codes (used on addresses for CGST/SGST vs IGST).</summary>
public static partial class IndianStates
{
    public static readonly IReadOnlyDictionary<string, string> ByCode = new Dictionary<string, string>
    {
        ["01"] = "Jammu and Kashmir", ["02"] = "Himachal Pradesh", ["03"] = "Punjab", ["04"] = "Chandigarh", ["05"] = "Uttarakhand",
        ["06"] = "Haryana", ["07"] = "Delhi", ["08"] = "Rajasthan", ["09"] = "Uttar Pradesh", ["10"] = "Bihar", ["11"] = "Sikkim",
        ["12"] = "Arunachal Pradesh", ["13"] = "Nagaland", ["14"] = "Manipur", ["15"] = "Mizoram", ["16"] = "Tripura", ["17"] = "Meghalaya",
        ["18"] = "Assam", ["19"] = "West Bengal", ["20"] = "Jharkhand", ["21"] = "Odisha", ["22"] = "Chhattisgarh", ["23"] = "Madhya Pradesh",
        ["24"] = "Gujarat", ["26"] = "Dadra and Nagar Haveli and Daman and Diu", ["27"] = "Maharashtra", ["29"] = "Karnataka",
        ["30"] = "Goa", ["31"] = "Lakshadweep", ["32"] = "Kerala", ["33"] = "Tamil Nadu", ["34"] = "Puducherry",
        ["35"] = "Andaman and Nicobar Islands", ["36"] = "Telangana", ["37"] = "Andhra Pradesh", ["38"] = "Ladakh",
    };

    /// <summary>Indian mobile numbers: 10 digits starting 6–9, optionally prefixed +91 or 0.</summary>
    [GeneratedRegex(@"^(?:\+91|0)?[6-9]\d{9}$")]
    public static partial Regex Mobile();

    /// <summary>PIN codes: 6 digits, not starting with 0.</summary>
    [GeneratedRegex(@"^[1-9]\d{5}$")]
    public static partial Regex Pincode();

    public static string NormalizePhone(string phone)
    {
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        return digits.Length > 10 ? digits[^10..] : digits;
    }
}

public sealed class CustomerSignupValidator : AbstractValidator<CustomerSignupRequest>
{
    public CustomerSignupValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
        RuleFor(x => x.Password).StrongPassword();
    }
}

public sealed class CustomerLoginValidator : AbstractValidator<CustomerLoginRequest>
{
    public CustomerLoginValidator()
    {
        RuleFor(x => x.Email).NotEmpty().MaximumLength(254);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(128);
    }
}

public sealed class CustomerProfileValidator : AbstractValidator<CustomerProfileRequest>
{
    public CustomerProfileValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Phone).Must(p => IndianStates.Mobile().IsMatch(p!.Replace(" ", "")))
            .When(x => !string.IsNullOrWhiteSpace(x.Phone)).WithMessage("Enter a 10-digit Indian mobile number.");
    }
}

public sealed class AddressValidator : AbstractValidator<AddressRequest>
{
    public AddressValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Phone).NotEmpty().Must(p => p is not null && IndianStates.Mobile().IsMatch(p.Replace(" ", "")))
            .WithMessage("Enter a 10-digit Indian mobile number.");
        RuleFor(x => x.Line1).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Line2).MaximumLength(200);
        RuleFor(x => x.City).NotEmpty().MaximumLength(100);
        RuleFor(x => x.StateCode).Must(s => s is not null && IndianStates.ByCode.ContainsKey(s)).WithMessage("Choose a state.");
        RuleFor(x => x.Pincode).Must(p => p is not null && IndianStates.Pincode().IsMatch(p)).WithMessage("Enter a 6-digit PIN code.");
    }
}

// ---------- Endpoints ----------

public static class CustomerEndpoints
{
    public static readonly TimeSpan ResetLifetime = TimeSpan.FromHours(1);
    public const int MaxAddresses = 10;
    private static readonly PasswordHasher<Customer> Hasher = new();
    private static readonly string DummyHash = Hasher.HashPassword(new Customer(), "not-a-real-password-" + Guid.NewGuid());

    /// <summary>Mapped inside the storefront group, so the store comes from the request host and must be live.</summary>
    public static void Map(RouteGroupBuilder storefront, RouteGroupBuilder admin)
    {
        var a = storefront.MapGroup("/account").WithTags("Shopper account");
        a.MapPost("/signup", Signup).Validate<CustomerSignupRequest>().RequireRateLimiting("auth");
        a.MapPost("/login", Login).Validate<CustomerLoginRequest>().RequireRateLimiting("auth");
        a.MapPost("/logout", async (CustomerSession s) => { await s.SignOutAsync(); return Results.NoContent(); });
        a.MapGet("/me", Me);
        a.MapPatch("/me", UpdateProfile).Validate<CustomerProfileRequest>();
        a.MapPost("/password/forgot", Forgot).Validate<ForgotPasswordRequest>().RequireRateLimiting("auth");
        a.MapPost("/password/reset", Reset).Validate<ResetPasswordRequest>().RequireRateLimiting("auth");
        a.MapPost("/password/change", Change).Validate<ChangePasswordRequest>().RequireRateLimiting("auth");
        a.MapGet("/addresses", ListAddresses);
        a.MapPost("/addresses", CreateAddress).Validate<AddressRequest>();
        a.MapPut("/addresses/{id:guid}", UpdateAddress).Validate<AddressRequest>();
        a.MapDelete("/addresses/{id:guid}", DeleteAddress);

        var cart = storefront.MapGroup("/cart").WithTags("Cart");
        cart.MapGet("/", async (CartService svc, CancellationToken ct) => Results.Ok(await svc.ViewAsync(await svc.FindAsync(ct), ct)));
        cart.MapPost("/lines", async (AddToCartRequest req, CartService svc, CancellationToken ct) => Results.Ok(await svc.AddAsync(req, ct)))
            .Validate<AddToCartRequest>();
        cart.MapPatch("/lines/{id:guid}", async (Guid id, UpdateCartLineRequest req, CartService svc, CancellationToken ct) =>
            Results.Ok(await svc.UpdateAsync(id, req.Quantity, ct))).Validate<UpdateCartLineRequest>();
        cart.MapDelete("/lines/{id:guid}", async (Guid id, CartService svc, CancellationToken ct) => Results.Ok(await svc.UpdateAsync(id, 0, ct)));

        admin.MapGet("/customers", AdminList).WithTags("Customers").RequirePermission(Permissions.OrdersRead);
    }

    private static CustomerDto Dto(Customer c) => new(c.Id, c.Name, c.Email, c.Phone, c.MarketingOptInAt is not null, c.CreatedAt);

    private static async Task<IResult> Signup(CustomerSignupRequest req, AppDbContext db, CustomerSession session, CartService carts, CancellationToken ct)
    {
        var normalized = AuthEndpoints.Normalize(req.Email);
        if (await db.Customers.AnyAsync(c => c.NormalizedEmail == normalized, ct))
            throw AppException.Conflict("An account with this email already exists at this store. Sign in instead.");
        var now = DateTimeOffset.UtcNow;
        var customer = new Customer
        {
            Id = Guid.CreateVersion7(), Email = req.Email.Trim(), NormalizedEmail = normalized, Name = req.Name.Trim(),
            MarketingOptInAt = req.MarketingOptIn ? now : null, CreatedAt = now, LastLoginAt = now,
        };
        customer.PasswordHash = Hasher.HashPassword(customer, req.Password);
        db.Customers.Add(customer);
        await db.SaveChangesAsync(ct);
        await session.SignInAsync(customer);
        await carts.MergeGuestCartAsync(customer, ct);
        return Results.Created("/api/storefront/account/me", Dto(customer));
    }

    private static async Task<IResult> Login(CustomerLoginRequest req, AppDbContext db, CustomerSession session, CartService carts,
        ILoggerFactory lf, CancellationToken ct)
    {
        var log = lf.CreateLogger("ShopMint.CustomerAuth");
        var normalized = AuthEndpoints.Normalize(req.Email);
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.NormalizedEmail == normalized, ct);
        var now = DateTimeOffset.UtcNow;
        if (customer is null)
        {
            Hasher.VerifyHashedPassword(new Customer(), DummyHash, req.Password);
            return Invalid();
        }
        if (customer.LockedUntil > now) return Invalid();
        var result = Hasher.VerifyHashedPassword(customer, customer.PasswordHash, req.Password);
        if (result == PasswordVerificationResult.Failed)
        {
            if (++customer.FailedLogins >= AuthEndpoints.MaxFailedLogins)
            {
                customer.LockedUntil = now.Add(AuthEndpoints.LockoutDuration);
                customer.FailedLogins = 0;
                log.LogWarning("Customer {CustomerId} locked after repeated failures", customer.Id);
            }
            await db.SaveChangesAsync(ct);
            return Invalid();
        }
        if (result == PasswordVerificationResult.SuccessRehashNeeded) customer.PasswordHash = Hasher.HashPassword(customer, req.Password);
        customer.FailedLogins = 0;
        customer.LockedUntil = null;
        customer.LastLoginAt = now;
        await db.SaveChangesAsync(ct);
        await session.SignInAsync(customer);
        await carts.MergeGuestCartAsync(customer, ct);
        return Results.Ok(Dto(customer));
    }

    private static IResult Invalid() => Results.Problem(statusCode: 401, type: ProblemTypes.Unauthenticated, title: "Invalid email or password.",
        detail: "Check your details and try again. After several failed attempts the account is locked for 15 minutes.");

    private static async Task<IResult> Me(CustomerSession session, CancellationToken ct) =>
        await session.CurrentAsync(ct) is { } c ? Results.Ok(Dto(c)) : Results.Problem(statusCode: 401, type: ProblemTypes.Unauthenticated, title: "Not signed in.");

    private static async Task<IResult> UpdateProfile(CustomerProfileRequest req, AppDbContext db, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        c.Name = req.Name.Trim();
        c.Phone = string.IsNullOrWhiteSpace(req.Phone) ? null : IndianStates.NormalizePhone(req.Phone);
        // Consent is recorded with its time; withdrawing clears it.
        if (req.MarketingOptIn && c.MarketingOptInAt is null) c.MarketingOptInAt = DateTimeOffset.UtcNow;
        if (!req.MarketingOptIn) c.MarketingOptInAt = null;
        await db.SaveChangesAsync(ct);
        return Results.Ok(Dto(c));
    }

    /// <summary>Same answer whether or not the account exists. At most one email a minute per account.</summary>
    private static async Task<IResult> Forgot(ForgotPasswordRequest req, AppDbContext db, TenantContext tenant, EmailOutbox email,
        IConfiguration config, CancellationToken ct)
    {
        var normalized = AuthEndpoints.Normalize(req.Email);
        var c = await db.Customers.FirstOrDefaultAsync(x => x.NormalizedEmail == normalized, ct);
        var since = DateTimeOffset.UtcNow - AccountEndpoints.ResendGap;
        if (c is not null && !await db.CustomerTokens.AnyAsync(t => t.CustomerId == c.Id && t.CreatedAt > since, ct))
        {
            var (token, hash) = SecureToken.Create();
            var now = DateTimeOffset.UtcNow;
            db.CustomerTokens.Add(new CustomerToken { Id = Guid.CreateVersion7(), CustomerId = c.Id, TokenHash = hash, CreatedAt = now, ExpiresAt = now.Add(ResetLifetime) });
            var store = await db.Tenants.Where(t => t.Id == tenant.TenantId)
                .Select(t => new { t.Name, Host = t.Domains.OrderBy(d => d.Kind).Select(d => d.Host).First() }).FirstAsync(ct);
            email.CustomerPasswordReset(db, tenant.RequireTenant(), store.Name, StorefrontUrl(config, store.Host), c, token);
            await db.SaveChangesAsync(ct);
        }
        return Results.Accepted(value: new { message = "If an account exists for that email, we've sent a link to reset the password." });
    }

    /// <summary>Store links in emails come from the store's registered domain, never the request's Host header.</summary>
    public static string StorefrontUrl(IConfiguration config, string host) =>
        (config["Platform:StorefrontUrlTemplate"] ?? "https://{host}").Replace("{host}", host, StringComparison.Ordinal).TrimEnd('/');

    private static async Task<IResult> Reset(ResetPasswordRequest req, AppDbContext db, CancellationToken ct)
    {
        var invalid = new AppException(400, ProblemTypes.InvalidToken, "This link is invalid or has expired.", "Request a new password reset email and try again.");
        if (!SecureToken.LooksValid(req.Token)) throw invalid;
        var hash = SecureToken.Hash(req.Token);
        var now = DateTimeOffset.UtcNow;
        var token = await db.CustomerTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.UsedAt == null && t.ExpiresAt > now, ct) ?? throw invalid;
        var c = await db.Customers.FirstAsync(x => x.Id == token.CustomerId, ct);
        c.PasswordHash = Hasher.HashPassword(c, req.Password);
        c.SecurityStamp = Guid.NewGuid().ToString("N");
        c.FailedLogins = 0;
        c.LockedUntil = null;
        token.UsedAt = now;
        await db.CustomerTokens.Where(t => t.CustomerId == c.Id && t.UsedAt == null && t.Id != token.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, now), ct);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Change(ChangePasswordRequest req, AppDbContext db, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        if (Hasher.VerifyHashedPassword(c, c.PasswordHash, req.CurrentPassword) == PasswordVerificationResult.Failed)
            throw AppException.Invalid("currentPassword", "Your current password is incorrect.");
        c.PasswordHash = Hasher.HashPassword(c, req.NewPassword);
        c.SecurityStamp = Guid.NewGuid().ToString("N");
        await db.SaveChangesAsync(ct);
        await session.SignInAsync(c);
        return Results.NoContent();
    }

    // ----- Addresses -----

    private static AddressDto Dto(CustomerAddress a) => new(a.Id, a.Name, a.Phone, a.Line1, a.Line2, a.City, a.StateCode,
        IndianStates.ByCode.GetValueOrDefault(a.StateCode, a.StateCode), a.Pincode, a.IsDefault);

    private static async Task<IResult> ListAddresses(AppDbContext db, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        var list = await db.CustomerAddresses.AsNoTracking().Where(a => a.CustomerId == c.Id)
            .OrderByDescending(a => a.IsDefault).ThenBy(a => a.CreatedAt).ToListAsync(ct);
        return Results.Ok(list.Select(Dto));
    }

    private static async Task<IResult> CreateAddress(AddressRequest req, AppDbContext db, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        var existing = await db.CustomerAddresses.Where(a => a.CustomerId == c.Id).ToListAsync(ct);
        if (existing.Count >= MaxAddresses) throw AppException.Unprocessable(ProblemTypes.Validation, $"You can save up to {MaxAddresses} addresses.");
        var address = new CustomerAddress { Id = Guid.CreateVersion7(), CustomerId = c.Id, CreatedAt = DateTimeOffset.UtcNow };
        Apply(address, req);
        // The first address becomes the default.
        if (req.IsDefault || existing.Count == 0) MakeDefault(existing, address);
        db.CustomerAddresses.Add(address);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/storefront/account/addresses/{address.Id}", Dto(address));
    }

    private static async Task<IResult> UpdateAddress(Guid id, AddressRequest req, AppDbContext db, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        var all = await db.CustomerAddresses.Where(a => a.CustomerId == c.Id).ToListAsync(ct);
        var address = all.FirstOrDefault(a => a.Id == id) ?? throw AppException.NotFound("Address");
        Apply(address, req);
        if (req.IsDefault) MakeDefault(all, address);
        await db.SaveChangesAsync(ct);
        return Results.Ok(Dto(address));
    }

    private static async Task<IResult> DeleteAddress(Guid id, AppDbContext db, CustomerSession session, CancellationToken ct)
    {
        var c = await session.RequireAsync(ct);
        var all = await db.CustomerAddresses.Where(a => a.CustomerId == c.Id).OrderBy(a => a.CreatedAt).ToListAsync(ct);
        var address = all.FirstOrDefault(a => a.Id == id) ?? throw AppException.NotFound("Address");
        db.CustomerAddresses.Remove(address);
        if (address.IsDefault && all.FirstOrDefault(a => a.Id != id) is { } next) next.IsDefault = true;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static void Apply(CustomerAddress a, AddressRequest r)
    {
        a.Name = r.Name.Trim();
        a.Phone = IndianStates.NormalizePhone(r.Phone);
        a.Line1 = r.Line1.Trim();
        a.Line2 = string.IsNullOrWhiteSpace(r.Line2) ? null : r.Line2.Trim();
        a.City = r.City.Trim();
        a.StateCode = r.StateCode;
        a.Pincode = r.Pincode;
    }

    private static void MakeDefault(List<CustomerAddress> all, CustomerAddress chosen)
    {
        foreach (var other in all) other.IsDefault = false;
        chosen.IsDefault = true;
    }

    // ----- Admin -----

    private static async Task<IResult> AdminList(AppDbContext db, [FromQuery] string? q, [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, pageSize);
        var query = db.Customers.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = $"%{Catalog.CatalogEndpoints.EscapeLike(q.Trim())}%";
            query = query.Where(c => EF.Functions.ILike(c.Name, term, "\\") || EF.Functions.ILike(c.Email, term, "\\") || (c.Phone != null && c.Phone.Contains(q.Trim())));
        }
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(c => c.CreatedAt).Skip((pg - 1) * size).Take(size)
            .Select(c => new AdminCustomerDto(c.Id, c.Name, c.Email, c.Phone, c.MarketingOptInAt != null,
                db.CustomerAddresses.Count(a => a.CustomerId == c.Id), c.CreatedAt, c.LastLoginAt))
            .ToListAsync(ct);
        return Results.Ok(new Paged<AdminCustomerDto>(items, pg, size, total));
    }
}
