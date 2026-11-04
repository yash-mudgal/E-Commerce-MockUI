using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using ShopMint.Api.Modules.Orders;

namespace ShopMint.Api.Modules.Billing;

public sealed record GatewaySubscription(string Id, string? PlanId, SubscriptionStatus Status, DateTimeOffset? CurrentStart, DateTimeOffset? CurrentEnd,
    DateTimeOffset? StartAt, string? ShortUrl);

/// <summary>
/// ShopMint's own subscription billing (separate from merchants' payment gateways, ADR-029). Razorpay Subscriptions
/// with the platform's Razorpay account in production; a labelled test gateway where test mode is allowed.
/// </summary>
public interface IBillingGateway
{
    string Name { get; }
    bool IsTest { get; }
    /// <summary>Public key the browser needs for Razorpay Checkout (null for the test gateway).</summary>
    string? KeyId { get; }
    Task<GatewaySubscription> CreateAsync(string? gatewayPlanId, DateTimeOffset? startAt, Guid tenantId, CancellationToken ct);
    Task<GatewaySubscription?> GetAsync(string subscriptionId, CancellationToken ct);
    Task<GatewaySubscription> ChangePlanAsync(string subscriptionId, string? gatewayPlanId, bool immediately, CancellationToken ct);
    Task<GatewaySubscription> CancelAsync(string subscriptionId, bool atPeriodEnd, CancellationToken ct);
    /// <summary>Checkout callback: HMAC_SHA256(payment_id + "|" + subscription_id, key secret).</summary>
    bool VerifyCheckout(string paymentId, string subscriptionId, string? signature);
}

public static class BillingStatuses
{
    public static SubscriptionStatus Parse(string? s) => s switch
    {
        "authenticated" => SubscriptionStatus.Authenticated,
        "active" => SubscriptionStatus.Active,
        "pending" => SubscriptionStatus.Pending,
        "halted" => SubscriptionStatus.Halted,
        "paused" => SubscriptionStatus.Paused,
        "cancelled" => SubscriptionStatus.Cancelled,
        "completed" => SubscriptionStatus.Completed,
        "expired" => SubscriptionStatus.Expired,
        _ => SubscriptionStatus.Created,
    };

    public static DateTimeOffset? FromUnix(long? s) => s is > 0 ? DateTimeOffset.FromUnixTimeSeconds(s.Value) : null;
}

public sealed class RazorpayBillingGateway(IHttpClientFactory http, IConfiguration config) : IBillingGateway
{
    public string Name => "razorpay";
    public bool IsTest => false;
    public string? KeyId => config["Billing:Razorpay:KeyId"];
    private string KeySecret => config["Billing:Razorpay:KeySecret"] ?? "";

    public static bool Configured(IConfiguration c) =>
        !string.IsNullOrWhiteSpace(c["Billing:Razorpay:KeyId"]) && !string.IsNullOrWhiteSpace(c["Billing:Razorpay:KeySecret"]);

    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    private sealed record RzpSubscription(string Id, string? PlanId, string Status, long? CurrentStart, long? CurrentEnd, long? StartAt,
        [property: JsonPropertyName("short_url")] string? ShortUrl);

    private HttpClient Client()
    {
        var client = http.CreateClient(RazorpayGateway.ClientName);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{KeyId}:{KeySecret}")));
        return client;
    }

    private static async Task<GatewaySubscription> ReadAsync(HttpResponseMessage res, CancellationToken ct)
    {
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            string? description = null;
            try { description = JsonDocument.Parse(body).RootElement.GetProperty("error").GetProperty("description").GetString(); }
            catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException) { /* not a Razorpay error body */ }
            throw new PaymentGatewayException((int)res.StatusCode, description ?? $"Razorpay returned {(int)res.StatusCode}.");
        }
        var s = JsonSerializer.Deserialize<RzpSubscription>(body, Json) ?? throw new PaymentGatewayException(502, "Empty response from Razorpay.");
        return new GatewaySubscription(s.Id, s.PlanId, BillingStatuses.Parse(s.Status), BillingStatuses.FromUnix(s.CurrentStart),
            BillingStatuses.FromUnix(s.CurrentEnd), BillingStatuses.FromUnix(s.StartAt), s.ShortUrl);
    }

    public async Task<GatewaySubscription> CreateAsync(string? gatewayPlanId, DateTimeOffset? startAt, Guid tenantId, CancellationToken ct)
    {
        var body = new Dictionary<string, object>
        {
            ["plan_id"] = gatewayPlanId ?? throw new InvalidOperationException("Razorpay plan ID required."),
            ["total_count"] = 120, // monthly for up to 10 years; renewed by creating a new subscription after that
            ["quantity"] = 1,
            ["customer_notify"] = 1,
            ["notes"] = new { tenant_id = tenantId.ToString() }, // informational only: webhooks are matched by subscription ID
        };
        if (startAt is { } s) body["start_at"] = s.ToUnixTimeSeconds();
        using var res = await Client().PostAsJsonAsync("subscriptions", body, ct);
        return await ReadAsync(res, ct);
    }

    public async Task<GatewaySubscription?> GetAsync(string subscriptionId, CancellationToken ct)
    {
        using var res = await Client().GetAsync($"subscriptions/{Uri.EscapeDataString(subscriptionId)}", ct);
        if (res.StatusCode is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.BadRequest) return null;
        return await ReadAsync(res, ct);
    }

    public async Task<GatewaySubscription> ChangePlanAsync(string subscriptionId, string? gatewayPlanId, bool immediately, CancellationToken ct)
    {
        using var res = await Client().PatchAsJsonAsync($"subscriptions/{Uri.EscapeDataString(subscriptionId)}", new
        {
            plan_id = gatewayPlanId ?? throw new InvalidOperationException("Razorpay plan ID required."),
            schedule_change_at = immediately ? "now" : "cycle_end",
            customer_notify = 1,
        }, ct);
        return await ReadAsync(res, ct);
    }

    public async Task<GatewaySubscription> CancelAsync(string subscriptionId, bool atPeriodEnd, CancellationToken ct)
    {
        using var res = await Client().PostAsJsonAsync($"subscriptions/{Uri.EscapeDataString(subscriptionId)}/cancel",
            new { cancel_at_cycle_end = atPeriodEnd ? 1 : 0 }, ct);
        return await ReadAsync(res, ct);
    }

    public bool VerifyCheckout(string paymentId, string subscriptionId, string? signature) =>
        KeySecret.Length > 0 && PaymentMath.SignatureMatches(PaymentMath.HmacHex(KeySecret, paymentId + "|" + subscriptionId), signature);
}

/// <summary>
/// Development and demo stand-in: subscriptions live only in our database and "payments" are simulated by the merchant
/// in a clearly labelled dialog. Available only where Payments:AllowTestMode is true (never in production).
/// </summary>
public sealed class TestBillingGateway : IBillingGateway
{
    public string Name => "test";
    public bool IsTest => true;
    public string? KeyId => null;

    public Task<GatewaySubscription> CreateAsync(string? gatewayPlanId, DateTimeOffset? startAt, Guid tenantId, CancellationToken ct) =>
        Task.FromResult(new GatewaySubscription("sub_test_" + Guid.NewGuid().ToString("N")[..14], gatewayPlanId, SubscriptionStatus.Created, null, null, startAt, null));
    public Task<GatewaySubscription?> GetAsync(string subscriptionId, CancellationToken ct) => Task.FromResult<GatewaySubscription?>(null);
    public Task<GatewaySubscription> ChangePlanAsync(string subscriptionId, string? gatewayPlanId, bool immediately, CancellationToken ct) =>
        Task.FromResult(new GatewaySubscription(subscriptionId, gatewayPlanId, SubscriptionStatus.Active, null, null, null, null));
    public Task<GatewaySubscription> CancelAsync(string subscriptionId, bool atPeriodEnd, CancellationToken ct) =>
        Task.FromResult(new GatewaySubscription(subscriptionId, null, atPeriodEnd ? SubscriptionStatus.Active : SubscriptionStatus.Cancelled, null, null, null, null));
    public bool VerifyCheckout(string paymentId, string subscriptionId, string? signature) => false;
}

/// <summary>Which billing gateway is in use: Razorpay when platform keys are configured, else the test gateway if allowed.</summary>
public sealed class BillingGatewayResolver(RazorpayBillingGateway razorpay, TestBillingGateway test, IConfiguration config)
{
    public IBillingGateway? Current =>
        RazorpayBillingGateway.Configured(config) ? razorpay : config.GetValue("Payments:AllowTestMode", false) ? test : null;

    public IBillingGateway? ByName(string name) => name switch { "razorpay" => razorpay, "test" => test, _ => null };

    public string? WebhookSecret => config["Billing:Razorpay:WebhookSecret"] is { Length: > 0 } s ? s : null;
}
