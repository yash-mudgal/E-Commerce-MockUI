using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Orders;

// ---------- Secret encryption ----------

/// <summary>
/// AES-256-GCM encryption for merchant secrets (Razorpay key secret, webhook secret). The key comes from configuration
/// (Payments:SecretsKey, 32 bytes base64, from the secrets manager), never from the database, so a database leak alone
/// doesn't reveal merchants' payment credentials.
/// </summary>
public sealed class SecretBox
{
    private const string Prefix = "v1:";
    private readonly byte[]? _key;

    public SecretBox(IConfiguration config)
    {
        var raw = config["Payments:SecretsKey"];
        if (string.IsNullOrWhiteSpace(raw)) return;
        var key = Convert.FromBase64String(raw);
        if (key.Length != 32) throw new InvalidOperationException("Payments:SecretsKey must be 32 bytes (base64).");
        _key = key;
    }

    public bool Available => _key is not null;

    public string Seal(string plaintext)
    {
        var key = _key ?? throw new InvalidOperationException("Payments:SecretsKey is not configured.");
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(key, 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        return Prefix + Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public string Open(string sealedValue)
    {
        var key = _key ?? throw new InvalidOperationException("Payments:SecretsKey is not configured.");
        if (!sealedValue.StartsWith(Prefix, StringComparison.Ordinal)) throw new CryptographicException("Unknown secret format.");
        var data = Convert.FromBase64String(sealedValue[Prefix.Length..]);
        var plain = new byte[data.Length - 28];
        using var aes = new AesGcm(key, 16);
        aes.Decrypt(data.AsSpan(0, 12), data.AsSpan(28), data.AsSpan(12, 16), plain);
        return Encoding.UTF8.GetString(plain);
    }
}

// ---------- Gateway port ----------

public sealed record GatewayCredentials(string KeyId, string KeySecret, string WebhookSecret);
public sealed record GatewayOrder(string Id, long AmountPaise, string Currency);
public sealed record GatewayPayment(string Id, string OrderId, long AmountPaise, string Status, string? Method, string? ErrorDescription);
public sealed record GatewayRefund(string Id, string PaymentId, long AmountPaise, string Status);

/// <summary>Payment gateway port (ADR-005). Razorpay in production; a clearly labelled test gateway in development and tests.</summary>
public interface IPaymentGateway
{
    string Name { get; }
    Task<GatewayOrder> CreateOrderAsync(GatewayCredentials? creds, long amountPaise, string receipt, CancellationToken ct);
    Task<GatewayPayment?> GetPaymentAsync(GatewayCredentials? creds, string paymentId, CancellationToken ct);
    Task<IReadOnlyList<GatewayPayment>> GetOrderPaymentsAsync(GatewayCredentials? creds, string gatewayOrderId, CancellationToken ct);
    Task<GatewayRefund> RefundAsync(GatewayCredentials? creds, string paymentId, long amountPaise, string note, CancellationToken ct);
}

public static class PaymentMath
{
    public static long ToPaise(decimal rupees) => (long)Math.Round(rupees * 100, MidpointRounding.AwayFromZero);
    public static decimal FromPaise(long paise) => paise / 100m;

    public static string HmacHex(string secret, string message) =>
        Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(message)));

    /// <summary>Constant-time comparison of a hex signature.</summary>
    public static bool SignatureMatches(string expectedHex, string? given) =>
        given is not null && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expectedHex), Encoding.ASCII.GetBytes(given.Trim().ToLowerInvariant()));

    /// <summary>Checkout callback: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret).</summary>
    public static bool VerifyCheckoutSignature(string keySecret, string gatewayOrderId, string paymentId, string? signature) =>
        SignatureMatches(HmacHex(keySecret, gatewayOrderId + "|" + paymentId), signature);

    /// <summary>Webhooks: X-Razorpay-Signature = HMAC_SHA256(raw body, webhook secret).</summary>
    public static bool VerifyWebhookSignature(string webhookSecret, string rawBody, string? signature) =>
        SignatureMatches(HmacHex(webhookSecret, rawBody), signature);
}

/// <summary>Razorpay REST adapter (Orders, Payments, Refunds APIs) using the store's own API keys.</summary>
public sealed class RazorpayGateway(IHttpClientFactory http) : IPaymentGateway
{
    public const string ClientName = "razorpay";
    public string Name => "razorpay";

    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    private HttpClient Client(GatewayCredentials? c)
    {
        var creds = c ?? throw new InvalidOperationException("Razorpay credentials are required.");
        var client = http.CreateClient(ClientName);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{creds.KeyId}:{creds.KeySecret}")));
        return client;
    }

    private static async Task<T> ReadAsync<T>(HttpResponseMessage res, CancellationToken ct)
    {
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            string? description = null;
            try { description = JsonDocument.Parse(body).RootElement.GetProperty("error").GetProperty("description").GetString(); }
            catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException) { /* not a Razorpay error body */ }
            throw new PaymentGatewayException((int)res.StatusCode, description ?? $"Razorpay returned {(int)res.StatusCode}.");
        }
        return JsonSerializer.Deserialize<T>(body, Json) ?? throw new PaymentGatewayException(502, "Empty response from Razorpay.");
    }

    private sealed record RzpOrder(string Id, long Amount, string Currency);
    private sealed record RzpPayment(string Id, string? OrderId, long Amount, string Status, string? Method, string? ErrorDescription);
    private sealed record RzpPayments(List<RzpPayment> Items);
    private sealed record RzpRefund(string Id, string PaymentId, long Amount, string Status);

    public async Task<GatewayOrder> CreateOrderAsync(GatewayCredentials? creds, long amountPaise, string receipt, CancellationToken ct)
    {
        using var res = await Client(creds).PostAsJsonAsync("orders", new { amount = amountPaise, currency = "INR", receipt }, ct);
        var o = await ReadAsync<RzpOrder>(res, ct);
        return new GatewayOrder(o.Id, o.Amount, o.Currency);
    }

    public async Task<GatewayPayment?> GetPaymentAsync(GatewayCredentials? creds, string paymentId, CancellationToken ct)
    {
        using var res = await Client(creds).GetAsync($"payments/{Uri.EscapeDataString(paymentId)}", ct);
        if (res.StatusCode is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.BadRequest) return null;
        var p = await ReadAsync<RzpPayment>(res, ct);
        return new GatewayPayment(p.Id, p.OrderId ?? "", p.Amount, p.Status, p.Method, p.ErrorDescription);
    }

    public async Task<IReadOnlyList<GatewayPayment>> GetOrderPaymentsAsync(GatewayCredentials? creds, string gatewayOrderId, CancellationToken ct)
    {
        using var res = await Client(creds).GetAsync($"orders/{Uri.EscapeDataString(gatewayOrderId)}/payments", ct);
        var list = await ReadAsync<RzpPayments>(res, ct);
        return list.Items.Select(p => new GatewayPayment(p.Id, p.OrderId ?? gatewayOrderId, p.Amount, p.Status, p.Method, p.ErrorDescription)).ToList();
    }

    public async Task<GatewayRefund> RefundAsync(GatewayCredentials? creds, string paymentId, long amountPaise, string note, CancellationToken ct)
    {
        using var res = await Client(creds).PostAsJsonAsync($"payments/{Uri.EscapeDataString(paymentId)}/refund",
            new { amount = amountPaise, notes = new { reason = note.Length > 250 ? note[..250] : note } }, ct);
        var r = await ReadAsync<RzpRefund>(res, ct);
        return new GatewayRefund(r.Id, r.PaymentId, r.Amount, r.Status);
    }

    /// <summary>Checks a key pair by listing one payment (read-only).</summary>
    public async Task<bool> KeysWorkAsync(GatewayCredentials creds, CancellationToken ct)
    {
        using var res = await Client(creds).GetAsync("payments?count=1", ct);
        return res.IsSuccessStatusCode;
    }
}

/// <summary>
/// Development and test stand-in for a gateway: orders and refunds succeed immediately and payments are simulated by
/// the shopper's "test payment" choice. Only available where Payments:AllowTestMode is true (never in production).
/// </summary>
public sealed class TestGateway : IPaymentGateway
{
    public string Name => "test";
    public Task<GatewayOrder> CreateOrderAsync(GatewayCredentials? creds, long amountPaise, string receipt, CancellationToken ct) =>
        Task.FromResult(new GatewayOrder("order_test_" + Guid.NewGuid().ToString("N")[..14], amountPaise, "INR"));
    public Task<GatewayPayment?> GetPaymentAsync(GatewayCredentials? creds, string paymentId, CancellationToken ct) => Task.FromResult<GatewayPayment?>(null);
    public Task<IReadOnlyList<GatewayPayment>> GetOrderPaymentsAsync(GatewayCredentials? creds, string gatewayOrderId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<GatewayPayment>>([]);
    public Task<GatewayRefund> RefundAsync(GatewayCredentials? creds, string paymentId, long amountPaise, string note, CancellationToken ct) =>
        Task.FromResult(new GatewayRefund("rfnd_test_" + Guid.NewGuid().ToString("N")[..14], paymentId, amountPaise, "processed"));
}

public sealed class PaymentGatewayException(int status, string message) : Exception(message)
{
    public int GatewayStatus { get; } = status;
}

/// <summary>Which gateway (and credentials) a store uses for online payments, if any.</summary>
public sealed record ActiveGateway(IPaymentGateway Gateway, GatewayCredentials? Credentials, bool IsTest);

public sealed class PaymentResolver(AppDbContext db, SecretBox box, RazorpayGateway razorpay, TestGateway test, IConfiguration config)
{
    public bool TestModeAllowed => config.GetValue("Payments:AllowTestMode", false);

    public async Task<ActiveGateway?> ForCurrentTenantAsync(CancellationToken ct)
    {
        var s = await db.PaymentSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (s is not null && box.Available)
            return new ActiveGateway(razorpay, new GatewayCredentials(s.RazorpayKeyId, box.Open(s.RazorpayKeySecretEnc), box.Open(s.RazorpayWebhookSecretEnc)), false);
        return TestModeAllowed ? new ActiveGateway(test, null, true) : null;
    }

    public IPaymentGateway ByName(string name) => name == razorpay.Name ? razorpay : test;
}

// ---------- Admin: payment settings ----------

public sealed record PaymentSettingsDto(bool Connected, string? KeyIdHint, string? Mode, string WebhookUrl, bool TestModeAvailable, bool EncryptionConfigured,
    DateTimeOffset? UpdatedAt);
public sealed record RazorpayKeysRequest(string KeyId, string KeySecret, string WebhookSecret);

public sealed class RazorpayKeysValidator : AbstractValidator<RazorpayKeysRequest>
{
    public RazorpayKeysValidator()
    {
        RuleFor(x => x.KeyId).NotEmpty().Matches("^rzp_(test|live)_[A-Za-z0-9]{8,30}$").WithMessage("Key IDs look like rzp_live_… or rzp_test_….");
        RuleFor(x => x.KeySecret).NotEmpty().Length(16, 64);
        RuleFor(x => x.WebhookSecret).NotEmpty().Length(8, 128);
    }
}

public static class PaymentSettingsEndpoints
{
    public static void Map(RouteGroupBuilder admin)
    {
        var g = admin.MapGroup("/payments").WithTags("Payments");
        g.MapGet("/", Get).RequirePermission(Permissions.SettingsWrite);
        g.MapPut("/razorpay", Connect).Validate<RazorpayKeysRequest>().RequirePermission(Permissions.SettingsWrite);
        g.MapDelete("/razorpay", Disconnect).RequirePermission(Permissions.SettingsWrite);
    }

    public static string WebhookUrl(IConfiguration config, Guid tenantId) =>
        $"{(config["App:PublicUrl"] ?? "").TrimEnd('/')}/api/webhooks/razorpay/{tenantId}";

    private static async Task<IResult> Get(AppDbContext db, TenantContext tenant, SecretBox box, PaymentResolver resolver, IConfiguration config, CancellationToken ct)
    {
        var s = await db.PaymentSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        return Results.Ok(new PaymentSettingsDto(s is not null, s is null ? null : $"{s.RazorpayKeyId[..9]}…{s.RazorpayKeyId[^4..]}",
            s is null ? null : s.RazorpayKeyId.StartsWith("rzp_live_", StringComparison.Ordinal) ? "live" : "test",
            WebhookUrl(config, tenant.RequireTenant()), resolver.TestModeAllowed, box.Available, s?.UpdatedAt));
    }

    private static async Task<IResult> Connect(RazorpayKeysRequest req, AppDbContext db, TenantContext tenant, SecretBox box, RazorpayGateway razorpay,
        PaymentResolver resolver, AuditWriter audit, IConfiguration config, CancellationToken ct)
    {
        if (!box.Available)
            throw new AppException(503, ProblemTypes.PaymentsUnavailable, "Payment settings can't be saved right now.", "The platform's secrets key isn't configured.");
        var creds = new GatewayCredentials(req.KeyId.Trim(), req.KeySecret.Trim(), req.WebhookSecret.Trim());
        bool ok;
        try { ok = await razorpay.KeysWorkAsync(creds, ct); }
        catch (HttpRequestException) { throw new AppException(502, ProblemTypes.PaymentsUnavailable, "Couldn't reach Razorpay.", "Try again in a moment."); }
        if (!ok) throw AppException.Invalid("keySecret", "Razorpay didn't accept this key ID and secret.");

        var s = await db.PaymentSettings.FirstOrDefaultAsync(ct);
        if (s is null) db.PaymentSettings.Add(s = new TenantPaymentSettings());
        s.RazorpayKeyId = creds.KeyId;
        s.RazorpayKeySecretEnc = box.Seal(creds.KeySecret);
        s.RazorpayWebhookSecretEnc = box.Seal(creds.WebhookSecret);
        s.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "payments.razorpay_connected", "tenant", tenant.RequireTenant(), new { keyId = creds.KeyId[..9] + "…" + creds.KeyId[^4..] });
        await db.SaveChangesAsync(ct);
        return await Get(db, tenant, box, resolver, config, ct);
    }

    private static async Task<IResult> Disconnect(AppDbContext db, TenantContext tenant, AuditWriter audit, CancellationToken ct)
    {
        var s = await db.PaymentSettings.FirstOrDefaultAsync(ct);
        if (s is null) return Results.NoContent();
        db.PaymentSettings.Remove(s);
        audit.Record(db, "payments.razorpay_disconnected", "tenant", tenant.RequireTenant());
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}

/// <summary>Formats an amount for receipts and gateway notes.</summary>
public static class Money
{
    public static string Inr(decimal v) => "₹" + v.ToString("N2", CultureInfo.GetCultureInfo("en-IN"));
}
