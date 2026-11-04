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

    private readonly ConcurrentDictionary<string, long> _orders = new();
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

    private static HttpResponseMessage Json(HttpStatusCode status, object body) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };
}
