using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>Shared checkout set-up: a live store, a signed-in shopper with an address and a cart.</summary>
public abstract class CheckoutTestBase(ApiFactory f) : StorefrontTestBase(f)
{
    protected sealed record Shop(HttpClient Merchant, JsonNode Me, string Host, JsonNode Product);
    protected sealed record Shopper(HttpClient Client, string AddressId, string Email);

    protected async Task<Shop> ShopAsync(int stock = 10, decimal price = 300, decimal mrp = 400, string? storeState = null)
    {
        var (m, me, host, p) = await LiveStoreAsync(stock, price, mrp);
        await m.PatchAsJsonAsync("/api/admin/store", new
        {
            name = me["tenant"]!["name"]!.ToString(), brandColor = "#4f46e5", lowStockThreshold = 2, supportEmail = $"orders-{Guid.NewGuid():N}@example.com",
            stateCode = storeState ?? "27", legalName = "Test Traders Pvt Ltd", businessAddress = "12 MG Road, Pune 411001",
        });
        return new Shop(m, me, host, p);
    }

    protected async Task<Shopper> ShopperAsync(string host, string? variantId = null, int quantity = 1, string state = "27")
    {
        var email = $"buyer-{Guid.NewGuid():N}@example.com";
        var c = await SignedUpShopperAsync(F, host, email);
        var address = await (await c.PostAt(host, "/api/storefront/account/addresses",
            new { name = "Ravi Buyer", phone = "9876543210", line1 = "4 Park Street", city = "Pune", stateCode = state, pincode = "411002" })).Json();
        if (variantId is not null)
            Assert.Equal(HttpStatusCode.OK, (await c.PostAt(host, "/api/storefront/cart/lines", new { variantId, quantity })).StatusCode);
        return new Shopper(c, address["id"]!.ToString(), email);
    }

    protected static async Task<HttpResponseMessage> PlaceAsync(Shopper s, string host, string method = "cod", string? coupon = null, string? key = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/storefront/checkout/orders")
        {
            Content = JsonContent.Create(new { addressId = s.AddressId, paymentMethod = method, couponCode = coupon }),
        };
        req.Headers.Host = host;
        req.Headers.Add("Idempotency-Key", key ?? Guid.NewGuid().ToString("N"));
        return await s.Client.SendAsync(req);
    }

    protected static async Task<JsonNode> PlacedAsync(Shopper s, string host, string method = "cod", string? coupon = null)
    {
        var res = await PlaceAsync(s, host, method, coupon);
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        return await res.Json();
    }

    protected static async Task<JsonNode> StockAsync(HttpClient merchant, string variantId) =>
        (await (await merchant.GetAsync("/api/admin/inventory?pageSize=100")).Json())["items"]!.AsArray().Single(i => i!["variantId"]!.ToString() == variantId)!;

    protected static async Task ConnectRazorpayAsync(HttpClient merchant)
    {
        var res = await merchant.PutAsJsonAsync("/api/admin/payments/razorpay",
            new { keyId = FakeRazorpay.KeyId, keySecret = FakeRazorpay.ValidSecret, webhookSecret = FakeRazorpay.WebhookSecret });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    protected Task<HttpResponseMessage> WebhookAsync(Guid tenantId, object body, string? secret = null, string? eventId = null)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(body);
        var req = new HttpRequestMessage(HttpMethod.Post, $"/api/webhooks/razorpay/{tenantId}") { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        req.Headers.Add("X-Razorpay-Signature", PaymentMath.HmacHex(secret ?? FakeRazorpay.WebhookSecret, json));
        req.Headers.Add("X-Razorpay-Event-Id", eventId ?? "evt_" + Guid.NewGuid().ToString("N")[..14]);
        // Webhooks carry no CSRF header and no cookies.
        return F.CreateClient(new() { BaseAddress = new Uri("https://localhost") }).SendAsync(req);
    }

    protected static object Captured(string orderId, string paymentId, long amount) => new
    {
        entity = "event", @event = "payment.captured",
        payload = new { payment = new { entity = new { id = paymentId, order_id = orderId, amount, status = "captured", currency = "INR" } } },
    };
}

[Collection("api")]
public class PricingAndCodTests(ApiFactory f) : CheckoutTestBase(f)
{
    [Fact]
    public async Task Quote_is_priced_on_the_server_with_gst_split_by_state_and_shipping()
    {
        var shop = await ShopAsync(price: 300, mrp: 400, storeState: "27");
        var local = await ShopperAsync(shop.Host, Variant(shop.Product), 1, state: "27");
        var q = await (await local.Client.PostAt(shop.Host, "/api/storefront/checkout/quote", new { addressId = local.AddressId })).Json();
        Assert.Equal("300.00", q["subtotal"]!.ToString());
        Assert.Equal("49.00", q["shipping"]!.ToString()); // below the ₹499 free-shipping threshold
        Assert.Equal("349.00", q["total"]!.ToString());
        Assert.True(q["intraState"]!.GetValue<bool>());
        Assert.Equal("0.00", q["igst"]!.ToString());
        // 12% GST inside ₹300 = ₹32.14 (goods) + 12% inside ₹49 = ₹5.25 (shipping at the goods' rate).
        Assert.Equal(32.14m + 5.25m, decimal.Parse(q["cgst"]!.ToString(), System.Globalization.CultureInfo.InvariantCulture) + decimal.Parse(q["sgst"]!.ToString(), System.Globalization.CultureInfo.InvariantCulture));

        var away = await ShopperAsync(shop.Host, Variant(shop.Product), 2, state: "29");
        var q2 = await (await away.Client.PostAt(shop.Host, "/api/storefront/checkout/quote", new { addressId = away.AddressId })).Json();
        Assert.False(q2["intraState"]!.GetValue<bool>());
        Assert.Equal("0.00", q2["shipping"]!.ToString()); // ₹600 qualifies for free shipping
        Assert.Equal("64.29", q2["igst"]!.ToString());
        Assert.Equal("0.00", q2["cgst"]!.ToString());
    }

    [Fact]
    public async Task Cash_on_delivery_order_confirms_issues_invoice_and_moves_through_fulfilment()
    {
        var shop = await ShopAsync(stock: 5);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product), 2);
        var placed = await PlacedAsync(s, shop.Host, "cod");
        Assert.Equal("Confirmed", placed["status"]!.ToString());
        var id = placed["orderId"]!.ToString();
        Assert.True(placed["number"]!.GetValue<int>() >= 1001);

        var stock = await StockAsync(shop.Merchant, Variant(shop.Product));
        Assert.Equal(3, stock["onHand"]!.GetValue<int>());
        Assert.Equal(0, stock["reserved"]!.GetValue<int>());
        Assert.Empty((await (await s.Client.GetAt(shop.Host, "/api/storefront/cart")).Json())["lines"]!.AsArray());

        var order = await (await shop.Merchant.GetAsync($"/api/admin/orders/{id}")).Json();
        Assert.Equal("CodDue", order["paymentStatus"]!.ToString());
        Assert.Matches(@"^\d{2}-\d{2}/000001$", order["invoiceNumber"]!.ToString());
        Assert.Equal("Test Traders Pvt Ltd", order["seller"]!["legalName"]!.ToString());
        Assert.NotNull(await F.LastEmailAsync(s.Email, "order_confirmed"));

        Assert.Equal(HttpStatusCode.Conflict, (await shop.Merchant.PostAsync($"/api/admin/orders/{id}/deliver", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.PostAsync($"/api/admin/orders/{id}/pack", null)).StatusCode);
        var shipped = await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{id}/ship", new { carrier = "Delhivery", trackingNumber = "DLV123456", trackingUrl = "https://track.example/DLV123456" });
        Assert.Equal("Shipped", (await shipped.Json())["status"]!.ToString());
        Assert.NotNull(await F.LastEmailAsync(s.Email, "order_shipped"));
        var delivered = await (await shop.Merchant.PostAsync($"/api/admin/orders/{id}/deliver", null)).Json();
        Assert.Equal("Delivered", delivered["status"]!.ToString());
        Assert.Equal("Paid", delivered["paymentStatus"]!.ToString()); // cash collected at the door

        var mine = await (await s.Client.GetAt(shop.Host, $"/api/storefront/account/orders/{id}")).Json();
        Assert.Equal("Delivered", mine["status"]!.ToString());
        Assert.Empty(mine["payments"]!.AsArray()); // shoppers don't see gateway identifiers
    }

    [Fact]
    public async Task Cod_respects_the_store_limit_and_switch()
    {
        var shop = await ShopAsync(price: 300);
        await shop.Merchant.PatchAsJsonAsync("/api/admin/store", new { name = "S", brandColor = "#4f46e5", lowStockThreshold = 2, codMaxOrderValue = 100 });
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        var res = await PlaceAsync(s, shop.Host, "cod");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Contains("up to", (await res.Json())["detail"]!.ToString());
        await shop.Merchant.PatchAsJsonAsync("/api/admin/store", new { name = "S", brandColor = "#4f46e5", lowStockThreshold = 2, codMaxOrderValue = 5000, codEnabled = false });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await PlaceAsync(s, shop.Host, "cod")).StatusCode);
    }

    [Fact]
    public async Task Checkout_needs_a_signed_in_shopper_their_own_address_and_an_idempotency_key()
    {
        var shop = await ShopAsync();
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        var other = await ShopperAsync(shop.Host);
        Assert.Equal(HttpStatusCode.BadRequest, (await PlaceAsync(s with { AddressId = other.AddressId }, shop.Host)).StatusCode);

        var noKey = new HttpRequestMessage(HttpMethod.Post, "/api/storefront/checkout/orders") { Content = JsonContent.Create(new { addressId = s.AddressId, paymentMethod = "cod" }) };
        noKey.Headers.Host = shop.Host;
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Client.SendAsync(noKey)).StatusCode);

        var guest = F.Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.PostAt(shop.Host, "/api/storefront/checkout/quote", new { addressId = s.AddressId })).StatusCode);
    }
}

[Collection("api")]
public class OnlinePaymentTests(ApiFactory f) : CheckoutTestBase(f)
{
    [Fact]
    public async Task Test_gateway_payment_reserves_then_commits_stock_and_retries_are_idempotent()
    {
        var shop = await ShopAsync(stock: 5);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product), 2);
        var key = Guid.NewGuid().ToString("N");
        var first = await (await PlaceAsync(s, shop.Host, "online", key: key)).Json();
        Assert.Equal("PendingPayment", first["status"]!.ToString());
        Assert.True(first["payment"]!["isTest"]!.GetValue<bool>());
        var again = await (await PlaceAsync(s, shop.Host, "online", key: key)).Json();
        Assert.Equal(first["orderId"]!.ToString(), again["orderId"]!.ToString());

        var held = await StockAsync(shop.Merchant, Variant(shop.Product));
        Assert.Equal(5, held["onHand"]!.GetValue<int>());
        Assert.Equal(2, held["reserved"]!.GetValue<int>());

        var id = first["orderId"]!.ToString();
        var failed = await (await s.Client.PostAt(shop.Host, $"/api/storefront/checkout/orders/{id}/test-payment", new { outcome = "failure" })).Json();
        Assert.Equal("PendingPayment", failed["status"]!.ToString()); // the shopper can try again
        var paid = await (await s.Client.PostAt(shop.Host, $"/api/storefront/checkout/orders/{id}/test-payment", new { outcome = "success" })).Json();
        Assert.Equal("Confirmed", paid["status"]!.ToString());
        Assert.Equal("Paid", paid["paymentStatus"]!.ToString());
        Assert.NotNull(paid["invoiceNumber"]);

        var after = await StockAsync(shop.Merchant, Variant(shop.Product));
        Assert.Equal(3, after["onHand"]!.GetValue<int>());
        Assert.Equal(0, after["reserved"]!.GetValue<int>());
        var ledger = await (await shop.Merchant.GetAsync($"/api/admin/inventory/movements?variantId={Variant(shop.Product)}")).Json();
        Assert.Equal("Sale", ledger["items"]![0]!["reason"]!.ToString());
    }

    [Fact]
    public async Task Concurrent_checkouts_never_oversell_the_last_unit()
    {
        var shop = await ShopAsync(stock: 1);
        var buyers = new List<Shopper>();
        for (var i = 0; i < 6; i++) buyers.Add(await ShopperAsync(shop.Host, Variant(shop.Product)));
        var results = await Task.WhenAll(buyers.Select(b => PlaceAsync(b, shop.Host, "online")));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
        Assert.All(results.Where(r => r.StatusCode != HttpStatusCode.OK), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        var stock = await StockAsync(shop.Merchant, Variant(shop.Product));
        Assert.Equal(1, stock["reserved"]!.GetValue<int>());
        Assert.Equal(1, stock["onHand"]!.GetValue<int>());
    }

    [Fact]
    public async Task Concurrent_retries_with_one_idempotency_key_create_one_order()
    {
        var shop = await ShopAsync(stock: 10);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product), 1);
        var key = Guid.NewGuid().ToString("N");
        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => PlaceAsync(s, shop.Host, "cod", key: key)));
        var ids = new HashSet<string>();
        foreach (var r in results.Where(r => r.StatusCode == HttpStatusCode.OK)) ids.Add((await r.Json())["orderId"]!.ToString());
        Assert.Single(ids);
        var orders = await (await shop.Merchant.GetAsync("/api/admin/orders")).Json();
        Assert.Equal(1, orders["totalCount"]!.GetValue<int>());
    }

    [Fact]
    public async Task Unpaid_orders_expire_and_release_their_reservation()
    {
        var shop = await ShopAsync(stock: 3);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product), 2);
        var placed = await PlacedAsync(s, shop.Host, "online");
        await using (var conn = new NpgsqlConnection(F.PlatformCs))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("update orders set reserved_until = now() - interval '1 minute' where id = @id", conn);
            cmd.Parameters.AddWithValue("id", Guid.Parse(placed["orderId"]!.ToString()));
            Assert.Equal(1, await cmd.ExecuteNonQueryAsync());
        }
        await OrderExpiryJob.RunOnceAsync(F.Services.GetRequiredService<IServiceScopeFactory>(), default);
        var order = await (await shop.Merchant.GetAsync($"/api/admin/orders/{placed["orderId"]}")).Json();
        Assert.Equal("Expired", order["status"]!.ToString());
        Assert.Equal("Voided", order["paymentStatus"]!.ToString());
        Assert.Equal(0, (await StockAsync(shop.Merchant, Variant(shop.Product)))["reserved"]!.GetValue<int>());
    }

    [Fact]
    public async Task Razorpay_checkout_signature_is_verified_before_confirming()
    {
        var shop = await ShopAsync(stock: 5);
        await ConnectRazorpayAsync(shop.Merchant);
        var settings = await (await shop.Merchant.GetAsync("/api/admin/payments")).Json();
        Assert.True(settings["connected"]!.GetValue<bool>());
        Assert.Equal("test", settings["mode"]!.ToString());
        Assert.DoesNotContain(FakeRazorpay.ValidSecret, settings.ToJsonString());
        Assert.Contains($"/api/webhooks/razorpay/{ApiFactory.TenantId(shop.Me)}", settings["webhookUrl"]!.ToString());

        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        var placed = await PlacedAsync(s, shop.Host, "online");
        var pay = placed["payment"]!;
        Assert.Equal("razorpay", pay["gateway"]!.ToString());
        Assert.Equal(FakeRazorpay.KeyId, pay["keyId"]!.ToString());
        Assert.Equal(34900, pay["amountPaise"]!.GetValue<long>());
        var gatewayOrder = pay["gatewayOrderId"]!.ToString();
        var id = placed["orderId"]!.ToString();
        // Test-mode simulation is not possible for a Razorpay order.
        Assert.Equal(HttpStatusCode.NotFound, (await s.Client.PostAt(shop.Host, $"/api/storefront/checkout/orders/{id}/test-payment", new { outcome = "success" })).StatusCode);

        var paymentId = F.Razorpay.Capture(gatewayOrder);
        var forged = await s.Client.PostAt(shop.Host, $"/api/storefront/checkout/orders/{id}/verify",
            new { razorpayOrderId = gatewayOrder, razorpayPaymentId = paymentId, razorpaySignature = PaymentMath.HmacHex("not-the-secret", gatewayOrder + "|" + paymentId) });
        Assert.Equal(HttpStatusCode.BadRequest, forged.StatusCode);
        var ok = await s.Client.PostAt(shop.Host, $"/api/storefront/checkout/orders/{id}/verify",
            new { razorpayOrderId = gatewayOrder, razorpayPaymentId = paymentId, razorpaySignature = PaymentMath.HmacHex(FakeRazorpay.ValidSecret, gatewayOrder + "|" + paymentId) });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("Confirmed", (await ok.Json())["status"]!.ToString());
    }

    [Fact]
    public async Task Wrong_razorpay_keys_are_rejected()
    {
        var shop = await ShopAsync();
        var res = await shop.Merchant.PutAsJsonAsync("/api/admin/payments/razorpay",
            new { keyId = FakeRazorpay.KeyId, keySecret = "wrong-secret-0000000", webhookSecret = "whsec_x_12345" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await shop.Merchant.PutAsJsonAsync("/api/admin/payments/razorpay",
            new { keyId = "not-a-key", keySecret = FakeRazorpay.ValidSecret, webhookSecret = "whsec_x_12345" })).StatusCode);
        var staff = await F.AddMemberAsync(ApiFactory.TenantId(shop.Me), MemberRole.Manager);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/admin/payments")).StatusCode);
    }

    [Fact]
    public async Task Stored_razorpay_secrets_are_encrypted()
    {
        var shop = await ShopAsync();
        await ConnectRazorpayAsync(shop.Merchant);
        await using var conn = new NpgsqlConnection(F.PlatformCs);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("select razorpay_key_secret_enc, razorpay_webhook_secret_enc from tenant_payment_settings where tenant_id = @t", conn);
        cmd.Parameters.AddWithValue("t", ApiFactory.TenantId(shop.Me));
        await using var r = await cmd.ExecuteReaderAsync();
        Assert.True(await r.ReadAsync());
        Assert.StartsWith("v1:", r.GetString(0));
        Assert.DoesNotContain(FakeRazorpay.ValidSecret, r.GetString(0));
        Assert.DoesNotContain(FakeRazorpay.WebhookSecret, r.GetString(1));
    }

    [Fact]
    public async Task Payment_start_failure_releases_the_reservation()
    {
        var shop = await ShopAsync(stock: 2);
        await ConnectRazorpayAsync(shop.Merchant);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product), 1);
        F.Razorpay.FailNextOrder = true;
        Assert.Equal(HttpStatusCode.BadGateway, (await PlaceAsync(s, shop.Host, "online")).StatusCode);
        Assert.Equal(0, (await StockAsync(shop.Merchant, Variant(shop.Product)))["reserved"]!.GetValue<int>());
    }
}

[Collection("api")]
public class WebhookTests(ApiFactory f) : CheckoutTestBase(f)
{
    private async Task<(Shop Shop, Shopper Shopper, string OrderId, string GatewayOrder)> PendingRazorpayOrderAsync(int stock = 5)
    {
        var shop = await ShopAsync(stock: stock);
        await ConnectRazorpayAsync(shop.Merchant);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product), 1);
        var placed = await PlacedAsync(s, shop.Host, "online");
        return (shop, s, placed["orderId"]!.ToString(), placed["payment"]!["gatewayOrderId"]!.ToString());
    }

    [Fact]
    public async Task Captured_webhook_confirms_once_even_when_redelivered()
    {
        var (shop, _, id, gatewayOrder) = await PendingRazorpayOrderAsync();
        var tid = ApiFactory.TenantId(shop.Me);
        var paymentId = F.Razorpay.Capture(gatewayOrder);
        var evt = Captured(gatewayOrder, paymentId, 34900);

        Assert.Equal(HttpStatusCode.Unauthorized, (await WebhookAsync(tid, evt, secret: "forged")).StatusCode);
        Assert.Equal("PendingPayment", (await (await shop.Merchant.GetAsync($"/api/admin/orders/{id}")).Json())["status"]!.ToString());

        Assert.Equal(HttpStatusCode.OK, (await WebhookAsync(tid, evt, eventId: "evt_same")).StatusCode);
        var redelivered = await WebhookAsync(tid, evt, eventId: "evt_same");
        Assert.True((await redelivered.Json())["duplicate"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.OK, (await WebhookAsync(tid, evt)).StatusCode); // new id, same payment: still idempotent

        var order = await (await shop.Merchant.GetAsync($"/api/admin/orders/{id}")).Json();
        Assert.Equal("Confirmed", order["status"]!.ToString());
        Assert.Equal(paymentId, order["payments"]![0]!["gatewayPaymentId"]!.ToString());
        var stock = await StockAsync(shop.Merchant, Variant(shop.Product));
        Assert.Equal(4, stock["onHand"]!.GetValue<int>()); // decremented exactly once
        Assert.Equal(0, stock["reserved"]!.GetValue<int>());
    }

    [Fact]
    public async Task A_payment_for_the_wrong_amount_does_not_confirm()
    {
        var (shop, _, id, gatewayOrder) = await PendingRazorpayOrderAsync();
        var paymentId = F.Razorpay.Capture(gatewayOrder, amount: 100);
        await WebhookAsync(ApiFactory.TenantId(shop.Me), Captured(gatewayOrder, paymentId, 100));
        Assert.Equal("PendingPayment", (await (await shop.Merchant.GetAsync($"/api/admin/orders/{id}")).Json())["status"]!.ToString());
    }

    [Fact]
    public async Task Webhooks_cannot_cross_stores()
    {
        var (shop, _, id, gatewayOrder) = await PendingRazorpayOrderAsync();
        var other = await ShopAsync();
        await ConnectRazorpayAsync(other.Merchant);
        var paymentId = F.Razorpay.Capture(gatewayOrder);
        // Correctly signed, but sent to another store's URL: that store has no such gateway order.
        Assert.Equal(HttpStatusCode.OK, (await WebhookAsync(ApiFactory.TenantId(other.Me), Captured(gatewayOrder, paymentId, 34900))).StatusCode);
        Assert.Equal("PendingPayment", (await (await shop.Merchant.GetAsync($"/api/admin/orders/{id}")).Json())["status"]!.ToString());
    }

    [Fact]
    public async Task Missed_webhook_is_reconciled_by_the_expiry_job()
    {
        var (shop, _, id, gatewayOrder) = await PendingRazorpayOrderAsync();
        F.Razorpay.Capture(gatewayOrder);
        await using (var conn = new NpgsqlConnection(F.PlatformCs))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("update orders set reserved_until = now() - interval '1 minute' where id = @id", conn);
            cmd.Parameters.AddWithValue("id", Guid.Parse(id));
            await cmd.ExecuteNonQueryAsync();
        }
        await OrderExpiryJob.RunOnceAsync(F.Services.GetRequiredService<IServiceScopeFactory>(), default);
        Assert.Equal("Confirmed", (await (await shop.Merchant.GetAsync($"/api/admin/orders/{id}")).Json())["status"]!.ToString());
    }

    [Fact]
    public async Task A_payment_that_arrives_after_expiry_is_refunded_automatically()
    {
        var (shop, _, id, gatewayOrder) = await PendingRazorpayOrderAsync();
        await using (var conn = new NpgsqlConnection(F.PlatformCs))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("update orders set reserved_until = now() - interval '1 minute' where id = @id", conn);
            cmd.Parameters.AddWithValue("id", Guid.Parse(id));
            await cmd.ExecuteNonQueryAsync();
        }
        await OrderExpiryJob.RunOnceAsync(F.Services.GetRequiredService<IServiceScopeFactory>(), default);
        var paymentId = F.Razorpay.Capture(gatewayOrder);
        await WebhookAsync(ApiFactory.TenantId(shop.Me), Captured(gatewayOrder, paymentId, 34900));

        var order = await (await shop.Merchant.GetAsync($"/api/admin/orders/{id}")).Json();
        Assert.Equal("Expired", order["status"]!.ToString());
        Assert.Equal("Refunded", order["paymentStatus"]!.ToString());
        Assert.Equal("Processed", order["refunds"]![0]!["status"]!.ToString());
        Assert.Contains(F.Razorpay.Refunds, r => r.PaymentId == paymentId && r.Amount == 34900);
        Assert.Equal(5, (await StockAsync(shop.Merchant, Variant(shop.Product)))["onHand"]!.GetValue<int>());
    }
}

[Collection("api")]
public class CancelRefundCouponTests(ApiFactory f) : CheckoutTestBase(f)
{
    private static async Task<string> PaidTestOrderAsync(Shopper s, string host)
    {
        var placed = await PlacedAsync(s, host, "online");
        var id = placed["orderId"]!.ToString();
        await s.Client.PostAt(host, $"/api/storefront/checkout/orders/{id}/test-payment", new { outcome = "success" });
        return id;
    }

    [Fact]
    public async Task Shopper_cancels_a_paid_order_stock_returns_and_money_is_refunded()
    {
        var shop = await ShopAsync(stock: 4);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product), 2);
        var id = await PaidTestOrderAsync(s, shop.Host);
        Assert.Equal(2, (await StockAsync(shop.Merchant, Variant(shop.Product)))["onHand"]!.GetValue<int>());

        var cancelled = await (await s.Client.PostAt(shop.Host, $"/api/storefront/account/orders/{id}/cancel", new { reason = "Ordered by mistake" })).Json();
        Assert.Equal("Cancelled", cancelled["status"]!.ToString());
        Assert.Equal("Refunded", cancelled["paymentStatus"]!.ToString());
        Assert.Equal(cancelled["total"]!.ToString(), cancelled["refundedTotal"]!.ToString());
        Assert.Equal(4, (await StockAsync(shop.Merchant, Variant(shop.Product)))["onHand"]!.GetValue<int>());
        Assert.NotNull(await F.LastEmailAsync(s.Email, "order_cancelled"));
        // Can't cancel twice.
        Assert.Equal(HttpStatusCode.Conflict, (await s.Client.PostAt(shop.Host, $"/api/storefront/account/orders/{id}/cancel", new { })).StatusCode);
    }

    [Fact]
    public async Task Partial_refunds_are_capped_and_permissioned()
    {
        var shop = await ShopAsync(stock: 4);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product), 1);
        var id = await PaidTestOrderAsync(s, shop.Host);
        var staff = await F.AddMemberAsync(ApiFactory.TenantId(shop.Me), MemberRole.Staff);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync($"/api/admin/orders/{id}/refunds", new { amount = 10, reason = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await staff.PostAsync($"/api/admin/orders/{id}/pack", null)).StatusCode); // staff can fulfil

        var partial = await (await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{id}/refunds", new { amount = 100, reason = "Damaged box" })).Json();
        Assert.Equal("PartiallyRefunded", partial["paymentStatus"]!.ToString());
        Assert.Equal("249.00", partial["refundable"]!.ToString());
        Assert.Equal(HttpStatusCode.BadRequest, (await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{id}/refunds", new { amount = 300, reason = "Too much" })).StatusCode);
        var rest = await (await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{id}/refunds", new { amount = 249, reason = "Rest" })).Json();
        Assert.Equal("Refunded", rest["paymentStatus"]!.ToString());
        Assert.DoesNotContain("refund", rest["actions"]!.AsArray().Select(a => a!.ToString()));
    }

    [Fact]
    public async Task Coupons_discount_and_enforce_their_limits()
    {
        var shop = await ShopAsync(stock: 20, price: 300);
        var created = await shop.Merchant.PostAsJsonAsync("/api/admin/coupons",
            new { code = "diwali10", kind = "percent", value = 10, minSubtotal = 500, maxDiscount = 50, perCustomerLimit = 1, usageLimit = 2, isActive = true });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal("DIWALI10", (await created.Json())["code"]!.ToString());

        var a = await ShopperAsync(shop.Host, Variant(shop.Product), 1);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PostAt(shop.Host, "/api/storefront/checkout/quote", new { addressId = a.AddressId, couponCode = "DIWALI10" })).StatusCode); // under ₹500
        await a.Client.PostAt(shop.Host, "/api/storefront/cart/lines", new { variantId = Variant(shop.Product), quantity = 1 });
        var q = await (await a.Client.PostAt(shop.Host, "/api/storefront/checkout/quote", new { addressId = a.AddressId, couponCode = "diwali10" })).Json();
        Assert.Equal("50.00", q["discount"]!.ToString()); // 10% of ₹600 = ₹60, capped at ₹50
        Assert.Equal("550.00", q["total"]!.ToString());
        await PlacedAsync(a, shop.Host, "cod", coupon: "DIWALI10");

        await a.Client.PostAt(shop.Host, "/api/storefront/cart/lines", new { variantId = Variant(shop.Product), quantity = 2 });
        var again = await PlaceAsync(a, shop.Host, "cod", coupon: "DIWALI10");
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
        Assert.Contains("already used", (await again.Json())["errors"]!["couponCode"]![0]!.ToString());

        var b = await ShopperAsync(shop.Host, Variant(shop.Product), 2);
        await PlacedAsync(b, shop.Host, "cod", coupon: "DIWALI10");
        var c = await ShopperAsync(shop.Host, Variant(shop.Product), 2);
        var full = await PlaceAsync(c, shop.Host, "cod", coupon: "DIWALI10");
        Assert.Contains("fully used", (await full.Json())["errors"]!["couponCode"]![0]!.ToString());

        var coupon = (await (await shop.Merchant.GetAsync("/api/admin/coupons")).Json()).AsArray()[0]!;
        Assert.Equal(2, coupon["timesUsed"]!.GetValue<int>());
        Assert.Equal(HttpStatusCode.Conflict, (await shop.Merchant.DeleteAsync($"/api/admin/coupons/{coupon["id"]}")).StatusCode);
    }

    [Fact]
    public async Task Orders_are_isolated_between_shoppers_and_stores()
    {
        var shop = await ShopAsync();
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        var id = (await PlacedAsync(s, shop.Host, "cod"))["orderId"]!.ToString();
        var other = await ShopperAsync(shop.Host);
        Assert.Equal(HttpStatusCode.NotFound, (await other.Client.GetAt(shop.Host, $"/api/storefront/account/orders/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.Client.PostAt(shop.Host, $"/api/storefront/account/orders/{id}/cancel", new { })).StatusCode);

        var otherStore = await ShopAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await otherStore.Merchant.GetAsync($"/api/admin/orders/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherStore.Merchant.PostAsync($"/api/admin/orders/{id}/pack", null)).StatusCode);

        await using var conn = new NpgsqlConnection(F.AppCs);
        await conn.OpenAsync();
        await using (var set = new NpgsqlCommand("select set_config('app.tenant_id', @t, false)", conn))
        {
            set.Parameters.AddWithValue("t", ApiFactory.TenantId(otherStore.Me).ToString());
            await set.ExecuteNonQueryAsync();
        }
        await using var cmd = new NpgsqlCommand("select count(*) from orders where id = @id", conn);
        cmd.Parameters.AddWithValue("id", Guid.Parse(id));
        Assert.Equal(0L, (long)(await cmd.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Ordered_products_and_variants_cannot_be_deleted()
    {
        var shop = await ShopAsync();
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        await PlacedAsync(s, shop.Host, "cod");
        var pid = shop.Product["id"]!.ToString();

        var del = await shop.Merchant.DeleteAsync($"/api/admin/products/{pid}");
        Assert.Equal(HttpStatusCode.Conflict, del.StatusCode);
        Assert.Contains("Archive it instead", (await del.Json())["detail"]!.ToString());

        // Replacing the ordered variant with a new one would delete it: refused too.
        var p = await (await shop.Merchant.GetAsync($"/api/admin/products/{pid}")).Json();
        var put = await shop.Merchant.PutAsJsonAsync($"/api/admin/products/{pid}", new
        {
            title = p["title"]!.ToString(), status = "active", gstRate = 12, hsnCode = "6204", optionNames = Array.Empty<string>(),
            variants = new[] { new { id = (string?)null, sku = "NEW-" + Guid.NewGuid().ToString("N")[..6], optionValues = Array.Empty<string>(), price = 300, mrp = 400, stockOnHand = (int?)5 } },
        });
        Assert.Equal(HttpStatusCode.Conflict, put.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.GetAsync($"/api/admin/products/{pid}")).StatusCode);

        // A product nobody ordered can still be deleted.
        var other = await shop.Merchant.CreateProductAsync(Http.Product("Never Ordered", "NO-" + Guid.NewGuid().ToString("N")[..6]));
        Assert.Equal(HttpStatusCode.NoContent, (await shop.Merchant.DeleteAsync($"/api/admin/products/{other["id"]}")).StatusCode);
    }

    [Fact]
    public async Task Dashboard_reports_real_sales()
    {
        var shop = await ShopAsync(price: 300);
        var before = await (await shop.Merchant.GetAsync("/api/admin/dashboard/summary")).Json();
        Assert.Null(before["sales"]);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product), 2);
        await PlacedAsync(s, shop.Host, "cod");
        var after = await (await shop.Merchant.GetAsync("/api/admin/dashboard/summary")).Json();
        Assert.Equal(1, after["sales"]!["orders"]!.GetValue<int>());
        Assert.Equal("600.00", after["sales"]!["revenue"]!.ToString());
        Assert.Equal(1, after["sales"]!["toFulfil"]!.GetValue<int>());
    }
}
