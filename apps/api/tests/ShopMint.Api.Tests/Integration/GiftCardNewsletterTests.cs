using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>Gift cards as a payment method (full, partial, cancellations, refunds, races) and the double opt-in newsletter.</summary>
[Collection("api")]
public class GiftCardNewsletterTests(ApiFactory f) : CheckoutTestBase(f)
{
    private static decimal Dec(JsonNode? n) => decimal.Parse(n!.ToString(), System.Globalization.CultureInfo.InvariantCulture);

    private static async Task<(string Code, string Id)> IssueAsync(HttpClient merchant, decimal value, string? email = null)
    {
        var res = await merchant.PostAsJsonAsync("/api/admin/gift-cards", new { value, recipientEmail = email, recipientName = email is null ? null : "Priya", sendEmail = email is not null });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var body = await res.Json();
        return (body["code"]!.ToString(), body["card"]!["id"]!.ToString());
    }

    private static async Task<HttpResponseMessage> PlaceWithCardAsync(Shopper s, string host, string code, string method = "online")
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/storefront/checkout/orders")
        {
            Content = JsonContent.Create(new { addressId = s.AddressId, paymentMethod = method, giftCardCode = code }),
        };
        req.Headers.Host = host;
        req.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString("N"));
        return await s.Client.SendAsync(req);
    }

    private static async Task<decimal> BalanceAsync(HttpClient merchant, string id) =>
        Dec((await (await merchant.GetAsync($"/api/admin/gift-cards/{id}")).Json())["card"]!["balance"]);

    [Fact]
    public async Task Codes_are_shown_once_and_never_stored_in_plain_text()
    {
        var shop = await ShopAsync();
        var (code, id) = await IssueAsync(shop.Merchant, 500, $"gift-{Guid.NewGuid():N}@example.com");
        Assert.Matches("^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$", code);
        var list = await (await shop.Merchant.GetAsync("/api/admin/gift-cards")).Json();
        Assert.DoesNotContain(code, list.ToJsonString());
        Assert.Equal(code[^4..], list["items"]![0]!["last4"]!.ToString());
        Assert.Equal(500m, Dec(list["outstanding"]));
        // Not in the audit log either.
        Assert.DoesNotContain(code, (await (await shop.Merchant.GetAsync("/api/admin/audit?pageSize=50")).Content.ReadAsStringAsync()));
        Assert.Equal(HttpStatusCode.BadRequest, (await shop.Merchant.PostAsJsonAsync("/api/admin/gift-cards", new { value = 0, sendEmail = false })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await F.NewMerchantAsync()).Client.GetAsync($"/api/admin/gift-cards/{id}")).StatusCode);
    }

    [Fact]
    public async Task A_card_can_pay_a_whole_order_but_not_alongside_cash_on_delivery()
    {
        var shop = await ShopAsync(price: 300);
        var (code, id) = await IssueAsync(shop.Merchant, 1000);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        var quote = await (await s.Client.PostAt(shop.Host, "/api/storefront/checkout/quote", new { addressId = s.AddressId, giftCardCode = code.ToLowerInvariant().Replace("-", " ") })).Json();
        var total = Dec(quote["total"]);
        Assert.Equal(total, Dec(quote["giftCardApplied"]));
        Assert.Equal(0m, Dec(quote["amountDue"]));
        Assert.False(quote["payment"]!["codAvailable"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await PlaceWithCardAsync(s, shop.Host, code, "cod")).StatusCode);

        var placed = await PlaceWithCardAsync(s, shop.Host, code);
        Assert.Equal(HttpStatusCode.OK, placed.StatusCode);
        var order = await (await shop.Merchant.GetAsync($"/api/admin/orders/{(await placed.Json())["orderId"]}")).Json();
        Assert.Equal("Confirmed", order["status"]!.ToString());
        Assert.Equal("Paid", order["paymentStatus"]!.ToString());
        Assert.Equal(total, Dec(order["giftCardAmount"]));
        Assert.NotNull(order["invoiceNumber"]);
        Assert.Equal(1000m - total, await BalanceAsync(shop.Merchant, id));

        // Cancelling puts the whole amount back on the card.
        var cancelled = await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{order["id"]}/cancel", new { reason = "Customer asked" });
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.Equal(1000m, await BalanceAsync(shop.Merchant, id));
        var after = await (await shop.Merchant.GetAsync($"/api/admin/orders/{order["id"]}")).Json();
        Assert.Equal("ToGiftCard", after["refunds"]![0]!["status"]!.ToString());
    }

    [Fact]
    public async Task Partial_payment_charges_the_rest_online_and_refunds_cash_first()
    {
        var shop = await ShopAsync(price: 300);
        var (code, id) = await IssueAsync(shop.Merchant, 100);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        var placed = await (await PlaceWithCardAsync(s, shop.Host, code)).Json();
        var total = Dec(placed["total"]);
        Assert.Equal("PendingPayment", placed["status"]!.ToString());
        Assert.Equal((long)((total - 100) * 100), placed["payment"]!["amountPaise"]!.GetValue<long>());
        Assert.Equal(0m, await BalanceAsync(shop.Merchant, id));
        var orderId = placed["orderId"]!.ToString();
        Assert.Equal("Confirmed", (await (await s.Client.PostAt(shop.Host, $"/api/storefront/checkout/orders/{orderId}/test-payment", new { outcome = "success" })).Json())["status"]!.ToString());

        // Refund everything: the online part through the gateway, the rest back to the card.
        var refund = await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{orderId}/refunds", new { amount = total, reason = "Damaged" });
        Assert.Equal(HttpStatusCode.OK, refund.StatusCode);
        var order = await (await shop.Merchant.GetAsync($"/api/admin/orders/{orderId}")).Json();
        var refunds = order["refunds"]!.AsArray();
        Assert.Contains(refunds, r => r!["status"]!.ToString() == "ToGiftCard" && Dec(r["amount"]) == 100m);
        Assert.Contains(refunds, r => r!["status"]!.ToString() != "ToGiftCard" && Dec(r["amount"]) == total - 100);
        Assert.Equal("Refunded", order["paymentStatus"]!.ToString());
        Assert.Equal(100m, await BalanceAsync(shop.Merchant, id));
    }

    [Fact]
    public async Task Unpaid_orders_give_the_balance_back_and_two_orders_cant_spend_it_twice()
    {
        var shop = await ShopAsync(stock: 10, price: 300);
        var (code, id) = await IssueAsync(shop.Merchant, 100);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        var placed = await (await PlaceWithCardAsync(s, shop.Host, code)).Json();
        Assert.Equal(0m, await BalanceAsync(shop.Merchant, id));
        var cancel = await s.Client.PostAt(shop.Host, $"/api/storefront/account/orders/{placed["orderId"]}/cancel", new { reason = "Changed my mind" });
        Assert.Equal(HttpStatusCode.OK, cancel.StatusCode);
        Assert.Equal(100m, await BalanceAsync(shop.Merchant, id));

        // Two shoppers race to spend the same 100: one gets it.
        var a = await ShopperAsync(shop.Host, Variant(shop.Product));
        var b = await ShopperAsync(shop.Host, Variant(shop.Product));
        var results = await Task.WhenAll(PlaceWithCardAsync(a, shop.Host, code), PlaceWithCardAsync(b, shop.Host, code));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Equal(0m, await BalanceAsync(shop.Merchant, id));
        var txns = (await (await shop.Merchant.GetAsync($"/api/admin/gift-cards/{id}")).Json())["transactions"]!.AsArray();
        Assert.Equal(2, txns.Count(t => t!["kind"]!.ToString() == "Redeemed"));
        Assert.Equal(1, txns.Count(t => t!["kind"]!.ToString() == "Restored"));
    }

    [Fact]
    public async Task Disabled_unknown_and_other_stores_cards_are_refused()
    {
        var shop = await ShopAsync();
        var (code, id) = await IssueAsync(shop.Merchant, 200);
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Client.PostAt(shop.Host, "/api/storefront/checkout/quote", new { addressId = s.AddressId, giftCardCode = "AAAA-BBBB-CCCC-DDDD" })).StatusCode);

        var other = await ShopAsync();
        var otherShopper = await ShopperAsync(other.Host, Variant(other.Product));
        Assert.Equal(HttpStatusCode.BadRequest, (await otherShopper.Client.PostAt(other.Host, "/api/storefront/checkout/quote", new { addressId = otherShopper.AddressId, giftCardCode = code })).StatusCode);

        var check = await s.Client.PostAt(shop.Host, "/api/storefront/gift-cards/check", new { code });
        Assert.Equal(200m, Dec((await check.Json())["balance"]));
        Assert.Equal(HttpStatusCode.Unauthorized, (await F.Client().PostAt(shop.Host, "/api/storefront/gift-cards/check", new { code })).StatusCode);

        await shop.Merchant.PostAsync($"/api/admin/gift-cards/{id}/disable", null);
        var refused = await s.Client.PostAt(shop.Host, "/api/storefront/checkout/quote", new { addressId = s.AddressId, giftCardCode = code });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("disabled", await refused.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Newsletter_needs_confirmation_and_doesnt_reveal_who_subscribes()
    {
        var shop = await ShopAsync();
        var email = $"news-{Guid.NewGuid():N}@example.com";
        Assert.Equal(HttpStatusCode.Accepted, (await F.Client().PostAt(shop.Host, "/api/storefront/newsletter", new { email })).StatusCode);
        var mail = await F.LastEmailAsync(email, "newsletter_confirm");
        Assert.NotNull(mail);
        var token = Regex.Match(mail!.TextBody!, @"newsletter/confirm\?token=([0-9a-f]{48})").Groups[1].Value;
        Assert.NotEmpty(token);
        var list = await (await shop.Merchant.GetAsync("/api/admin/newsletter")).Json();
        Assert.Equal(1, list["counts"]!["pending"]!.GetValue<int>());
        Assert.DoesNotContain(email, await (await shop.Merchant.GetAsync("/api/admin/newsletter/subscribers.csv")).Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.OK, (await F.Client().PostAt(shop.Host, "/api/storefront/newsletter/confirm", new { token })).StatusCode);
        Assert.Contains(email, await (await shop.Merchant.GetAsync("/api/admin/newsletter/subscribers.csv")).Content.ReadAsStringAsync());
        // Signing up again looks the same and sends nothing.
        Assert.Equal(HttpStatusCode.Accepted, (await F.Client().PostAt(shop.Host, "/api/storefront/newsletter", new { email })).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await F.Client().PostAt(shop.Host, "/api/storefront/newsletter/unsubscribe", new { token })).StatusCode);
        Assert.DoesNotContain(email, await (await shop.Merchant.GetAsync("/api/admin/newsletter/subscribers.csv")).Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.BadRequest, (await F.Client().PostAt(shop.Host, "/api/storefront/newsletter/confirm", new { token = "nope" })).StatusCode);
        // Another store doesn't see this list.
        Assert.Equal(0, (await (await (await F.NewMerchantAsync()).Client.GetAsync("/api/admin/newsletter")).Json())["totalCount"]!.GetValue<int>());
    }

    [Fact]
    public void Codes_normalise_and_hash_consistently()
    {
        var code = GiftCards.NewCode();
        Assert.Equal(GiftCards.Hash(code), GiftCards.Hash(code.ToLowerInvariant().Replace("-", " ")));
        Assert.NotEqual(GiftCards.Hash(code), GiftCards.Hash(GiftCards.NewCode()));
    }
}
