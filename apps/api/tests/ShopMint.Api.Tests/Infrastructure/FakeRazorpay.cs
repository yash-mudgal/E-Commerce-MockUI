using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ShopMint.Api.Tests.Infrastructure;

/// <summary>
/// In-memory stand-in for the Razorpay REST API (orders, payments, refunds), wired in as the "razorpay" HttpClient's
/// handler. Credentials are checked against <see cref="ValidSecret"/>, so "wrong keys" can be exercised too.
/// </summary>
public sealed class FakeRazorpay : HttpMessageHandler
{
    public const string ValidSecret = "test_secret_abcdefghijklmnop";
    public const string WebhookSecret = "whsec_test_123456";
    public const string KeyId = "rzp_test_ABCDEFGH1234";

    /// <summary>ShopMint's own (platform) account used for subscription billing.</summary>
    public const string BillingKeyId = "rzp_test_PLATFORM0001";
    public const string BillingWebhookSecret = "whsec_billing_test_123";

    private readonly ConcurrentDictionary<string, long> _orders = new();
    public ConcurrentDictionary<string, JsonObject> Subscriptions { get; } = new();
    public bool FailNextSubscription { get; set; }

    /// <summary>Simulates the merchant completing Razorpay Checkout for a subscription (mandate set up, maybe first charge).</summary>
    public string AuthorizeSubscription(string subscriptionId)
    {
        var sub = Subscriptions[subscriptionId];
        var startAt = sub["start_at"] is JsonValue sv ? sv.GetValue<long>() : (long?)null;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (startAt is { } s && s > now) sub["status"] = "authenticated";
        else Charge(subscriptionId);
        return "pay_" + Guid.NewGuid().ToString("N")[..14];
    }

    /// <summary>Simulates a successful charge: the subscription is active for a new month.</summary>
    public void Charge(string subscriptionId)
    {
        var sub = Subscriptions[subscriptionId];
        var now = DateTimeOffset.UtcNow;
        sub["status"] = "active";
        sub["current_start"] = now.ToUnixTimeSeconds();
        sub["current_end"] = now.AddMonths(1).ToUnixTimeSeconds();
        if (sub["scheduled_plan_id"] is { } next) { sub["plan_id"] = next.GetValue<string>(); sub.Remove("scheduled_plan_id"); }
    }

    public void SetStatus(string subscriptionId, string status) => Subscriptions[subscriptionId]["status"] = status;
    private readonly ConcurrentDictionary<string, JsonObject> _payments = new();
    public ConcurrentBag<(string PaymentId, long Amount)> Refunds { get; } = [];
    public bool FailNextOrder { get; set; }

    /// <summary>Simulates the shopper paying: a captured payment against a Razorpay order.</summary>
    public string Capture(string orderId, long? amount = null, string status = "captured")
    {
        var id = "pay_" + Guid.NewGuid().ToString("N")[..14];
        _payments[id] = new JsonObject { ["id"] = id, ["order_id"] = orderId, ["amount"] = amount ?? _orders[orderId], ["status"] = status, ["method"] = "upi" };
        return id;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var auth = request.Headers.Authorization?.Parameter;
        var creds = auth is null ? "" : Encoding.UTF8.GetString(Convert.FromBase64String(auth));
        if (!creds.EndsWith(":" + ValidSecret, StringComparison.Ordinal))
            return Json(HttpStatusCode.Unauthorized, new { error = new { code = "BAD_REQUEST_ERROR", description = "The api key provided is invalid" } });

        var path = request.RequestUri!.AbsolutePath.Replace("/v1/", "/", StringComparison.Ordinal).TrimStart('/');
        var body = request.Content is null ? null : JsonNode.Parse(await request.Content.ReadAsStringAsync(ct));

        if (request.Method == HttpMethod.Post && path == "orders")
        {
            if (FailNextOrder) { FailNextOrder = false; return Json(HttpStatusCode.InternalServerError, new { error = new { description = "Gateway down" } }); }
            var id = "order_" + Guid.NewGuid().ToString("N")[..14];
            var amount = body!["amount"]!.GetValue<long>();
            _orders[id] = amount;
            return Json(HttpStatusCode.OK, new { id, amount, currency = "INR", status = "created" });
        }
        if (path.StartsWith("subscriptions", StringComparison.Ordinal))
            return Subscription(request.Method, path, body);
        if (request.Method == HttpMethod.Get && path.StartsWith("payments", StringComparison.Ordinal) && request.RequestUri.Query.Contains("count", StringComparison.Ordinal))
            return Json(HttpStatusCode.OK, new { entity = "collection", count = 0, items = Array.Empty<object>() });
        if (request.Method == HttpMethod.Get && path.StartsWith("payments/", StringComparison.Ordinal))
        {
            var id = path["payments/".Length..];
            return _payments.TryGetValue(id, out var p) ? Json(HttpStatusCode.OK, p) : Json(HttpStatusCode.BadRequest, new { error = new { description = "The id provided does not exist" } });
        }
        if (request.Method == HttpMethod.Get && path.StartsWith("orders/", StringComparison.Ordinal) && path.EndsWith("/payments", StringComparison.Ordinal))
        {
            var orderId = path["orders/".Length..^"/payments".Length];
            var items = _payments.Values.Where(p => p["order_id"]!.GetValue<string>() == orderId).ToArray();
            return Json(HttpStatusCode.OK, new { entity = "collection", count = items.Length, items });
        }
        if (request.Method == HttpMethod.Post && path.StartsWith("payments/", StringComparison.Ordinal) && path.EndsWith("/refund", StringComparison.Ordinal))
        {
            var paymentId = path["payments/".Length..^"/refund".Length];
            var amount = body!["amount"]!.GetValue<long>();
            Refunds.Add((paymentId, amount));
            return Json(HttpStatusCode.OK, new { id = "rfnd_" + Guid.NewGuid().ToString("N")[..14], payment_id = paymentId, amount, status = "processed" });
        }
        return Json(HttpStatusCode.NotFound, new { error = new { description = "Unknown route " + path } });
    }

    private HttpResponseMessage Subscription(HttpMethod method, string path, JsonNode? body)
    {
        if (method == HttpMethod.Post && path == "subscriptions")
        {
            if (FailNextSubscription) { FailNextSubscription = false; return Json(HttpStatusCode.InternalServerError, new { error = new { description = "Gateway down" } }); }
            var id = "sub_" + Guid.NewGuid().ToString("N")[..14];
            var sub = new JsonObject { ["id"] = id, ["entity"] = "subscription", ["plan_id"] = body!["plan_id"]!.GetValue<string>(), ["status"] = "created",
                ["start_at"] = body["start_at"]?.GetValue<long>(), ["short_url"] = "https://rzp.io/i/" + id[4..12] };
            Subscriptions[id] = sub;
            return Json(HttpStatusCode.OK, sub);
        }
        var parts = path.Split('/');
        if (parts.Length < 2 || !Subscriptions.TryGetValue(parts[1], out var s))
            return Json(HttpStatusCode.BadRequest, new { error = new { description = "The id provided does not exist" } });
        if (method == HttpMethod.Get && parts.Length == 2) return Json(HttpStatusCode.OK, s);
        if (method == HttpMethod.Patch && parts.Length == 2)
        {
            if (s["status"]!.GetValue<string>() != "active") return Json(HttpStatusCode.BadRequest, new { error = new { description = "Subscription is not active" } });
            var plan = body!["plan_id"]!.GetValue<string>();
            if (body["schedule_change_at"]!.GetValue<string>() == "now") s["plan_id"] = plan; else s["scheduled_plan_id"] = plan;
            return Json(HttpStatusCode.OK, s);
        }
        if (method == HttpMethod.Post && parts.Length == 3 && parts[2] == "cancel")
        {
            if (body!["cancel_at_cycle_end"]!.GetValue<int>() == 1) s["cancel_at_cycle_end"] = true;
            else s["status"] = "cancelled";
            return Json(HttpStatusCode.OK, s);
        }
        return Json(HttpStatusCode.NotFound, new { error = new { description = "Unknown route " + path } });
    }

    private static HttpResponseMessage Json(HttpStatusCode status, object body) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };
}
