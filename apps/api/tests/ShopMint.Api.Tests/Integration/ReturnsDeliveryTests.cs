using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using ShopMint.Api.Modules.Store;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>Delivery zones by PIN code (checkout and storefront), and returns from request to refund.</summary>
[Collection("api")]
public class ReturnsDeliveryTests(ApiFactory f) : CheckoutTestBase(f)
{
    private static decimal Dec(JsonNode? n) => decimal.Parse(n!.ToString(), System.Globalization.CultureInfo.InvariantCulture);

    private static async Task<JsonNode> QuoteAsync(Shopper s, string host) =>
        await (await s.Client.PostAt(host, "/api/storefront/checkout/quote", new { addressId = s.AddressId })).Json();

    [Fact]
    public async Task Zones_set_fee_cod_and_estimate_by_pincode()
    {
        var shop = await ShopAsync(price: 300);
        await shop.Merchant.PatchAsJsonAsync("/api/admin/store", new
        {
            name = "Zoned", brandColor = "#4f46e5", lowStockThreshold = 2, shippingFee = 49, codEnabled = true, codMaxOrderValue = 5000,
            deliveryMinDays = 4, deliveryMaxDays = 7,
        });
        var zone = await shop.Merchant.PostAsJsonAsync("/api/admin/shipping-zones", new
        {
            name = "Pune city", pincodePrefixes = new[] { "4110", "411002" }, fee = 0, freeShippingThreshold = (decimal?)null, minDays = 1, maxDays = 2, codAvailable = false,
        });
        Assert.Equal(HttpStatusCode.Created, zone.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await shop.Merchant.PostAsJsonAsync("/api/admin/shipping-zones", new
        {
            name = "Bad", pincodePrefixes = new[] { "0110" }, minDays = 3, maxDays = 2, codAvailable = true,
        })).StatusCode);

        var inZone = await (await F.Client().GetAt(shop.Host, "/api/storefront/delivery?pincode=411002")).Json();
        Assert.True(inZone["serviceable"]!.GetValue<bool>());
        Assert.Equal(0m, Dec(inZone["fee"]));
        Assert.False(inZone["cod"]!.GetValue<bool>());
        Assert.Equal(1, inZone["minDays"]!.GetValue<int>());
        var outside = await (await F.Client().GetAt(shop.Host, "/api/storefront/delivery?pincode=560001")).Json();
        Assert.Equal(49m, Dec(outside["fee"]));
        Assert.True(outside["cod"]!.GetValue<bool>());
        Assert.Equal(7, outside["maxDays"]!.GetValue<int>());
        Assert.Equal(HttpStatusCode.BadRequest, (await F.Client().GetAt(shop.Host, "/api/storefront/delivery?pincode=12345")).StatusCode);

        // Checkout applies the same terms: the test shopper's address is in Pune (411002).
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        var q = await QuoteAsync(s, shop.Host);
        Assert.Equal("0.00", q["shipping"]!.ToString());
        Assert.False(q["payment"]!["codAvailable"]!.GetValue<bool>());
        Assert.Contains("411002", q["payment"]!["codUnavailableReason"]!.ToString());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await PlaceAsync(s, shop.Host, "cod")).StatusCode);

        // Deliver only to zones: Bengaluru is now refused at checkout.
        await shop.Merchant.PatchAsJsonAsync("/api/admin/store", new { name = "Zoned", brandColor = "#4f46e5", lowStockThreshold = 2, deliverOnlyToZones = true });
        Assert.False((await (await F.Client().GetAt(shop.Host, "/api/storefront/delivery?pincode=560001")).Json())["serviceable"]!.GetValue<bool>());
        var far = await SignedUpShopperAsync(F, shop.Host);
        var addr = await (await far.PostAt(shop.Host, "/api/storefront/account/addresses",
            new { name = "Far Buyer", phone = "9876543210", line1 = "1 MG Road", city = "Bengaluru", stateCode = "29", pincode = "560001" })).Json();
        await far.PostAt(shop.Host, "/api/storefront/cart/lines", new { variantId = Variant(shop.Product), quantity = 1 });
        var refused = await far.PostAt(shop.Host, "/api/storefront/checkout/quote", new { addressId = addr["id"]!.ToString() });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("560001", await refused.Content.ReadAsStringAsync());
    }

    [Fact]
    public void Longest_prefix_wins()
    {
        var zones = new[]
        {
            new ShippingZone { Name = "Maharashtra", PincodePrefixes = ["4"] },
            new ShippingZone { Name = "Mumbai", PincodePrefixes = ["400", "401"] },
            new ShippingZone { Name = "Fort", PincodePrefixes = ["400001"] },
        };
        Assert.Equal("Fort", Delivery.Match(zones, "400001")!.Name);
        Assert.Equal("Mumbai", Delivery.Match(zones, "400050")!.Name);
        Assert.Equal("Maharashtra", Delivery.Match(zones, "411002")!.Name);
        Assert.Null(Delivery.Match(zones, "560001"));
        Assert.True(Delivery.IsPincode("110001"));
        Assert.False(Delivery.IsPincode("011000"));
        Assert.False(Delivery.IsPincode("11000a"));
    }

    private async Task<(Shop Shop, Shopper Buyer, string OrderId, string LineId)> DeliveredAsync(int returnDays = 7, int quantity = 2)
    {
        var shop = await ShopAsync(stock: 10, price: 300);
        await shop.Merchant.PatchAsJsonAsync("/api/admin/store", new { name = "Returns", brandColor = "#4f46e5", lowStockThreshold = 2, returnWindowDays = returnDays });
        var buyer = await ShopperAsync(shop.Host, Variant(shop.Product), quantity);
        var id = (await PlacedAsync(buyer, shop.Host, "cod"))["orderId"]!.ToString();
        await shop.Merchant.PostAsync($"/api/admin/orders/{id}/pack", null);
        await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{id}/ship", new { carrier = "Delhivery", trackingNumber = "R1" });
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.PostAsync($"/api/admin/orders/{id}/deliver", null)).StatusCode);
        var lineId = (await (await shop.Merchant.GetAsync($"/api/admin/orders/{id}")).Json())["lines"]![0]!["id"]!.ToString();
        return (shop, buyer, id, lineId);
    }

    [Fact]
    public async Task Return_flow_restocks_and_refunds_the_returned_items()
    {
        var (shop, buyer, orderId, lineId) = await DeliveredAsync();
        var path = $"/api/storefront/account/orders/{orderId}/returns";
        var info = await (await buyer.Client.GetAt(shop.Host, path)).Json();
        Assert.True(info["canRequest"]!.GetValue<bool>());
        Assert.Equal(2, info["lines"]![0]!["returnable"]!.GetValue<int>());

        Assert.Equal(HttpStatusCode.BadRequest, (await buyer.Client.PostAt(shop.Host, path, new { reason = "SizeOrFit", resolution = "Refund", lines = new[] { new { orderLineId = lineId, quantity = 3 } } })).StatusCode);
        var created = await buyer.Client.PostAt(shop.Host, path, new { reason = "SizeOrFit", resolution = "Refund", note = "Too tight", lines = new[] { new { orderLineId = lineId, quantity = 1 } } });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var ret = await created.Json();
        Assert.Equal("Requested", ret["status"]!.ToString());
        Assert.Equal(300m, Dec(ret["value"]));
        Assert.Equal(1, (await (await buyer.Client.GetAt(shop.Host, path)).Json())["lines"]![0]!["returnable"]!.GetValue<int>());

        var rid = ret["id"]!.ToString();
        // Can't refund before it's approved and received.
        Assert.Equal(HttpStatusCode.Conflict, (await shop.Merchant.PostAsJsonAsync($"/api/admin/returns/{rid}/refund", new { amount = 300 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.PostAsJsonAsync($"/api/admin/returns/{rid}/approve", new { note = "Send it with the original tags." })).StatusCode);
        Assert.NotNull(await F.LastEmailAsync(buyer.Email, "return_approved"));
        var stockBefore = (await StockAsync(shop.Merchant, Variant(shop.Product)))["onHand"]!.GetValue<int>();
        var received = await (await shop.Merchant.PostAsJsonAsync($"/api/admin/returns/{rid}/receive", new { restock = true })).Json();
        Assert.True(received["restocked"]!.GetValue<bool>());
        Assert.Equal(stockBefore + 1, (await StockAsync(shop.Merchant, Variant(shop.Product)))["onHand"]!.GetValue<int>());

        Assert.Equal(HttpStatusCode.BadRequest, (await shop.Merchant.PostAsJsonAsync($"/api/admin/returns/{rid}/refund", new { amount = 301 })).StatusCode);
        var refunded = await (await shop.Merchant.PostAsJsonAsync($"/api/admin/returns/{rid}/refund", new { amount = 300 })).Json();
        Assert.Equal("Refunded", refunded["status"]!.ToString());
        Assert.Equal(300m, Dec(refunded["refundedAmount"]));
        var order = await (await shop.Merchant.GetAsync($"/api/admin/orders/{orderId}")).Json();
        Assert.Equal("PartiallyRefunded", order["paymentStatus"]!.ToString());
        Assert.NotNull(await F.LastEmailAsync(buyer.Email, "return_refunded"));

        var list = await (await shop.Merchant.GetAsync("/api/admin/returns?status=refunded")).Json();
        Assert.Equal(buyer.Email, list["items"]![0]!["customerEmail"]!.ToString());
    }

    [Fact]
    public async Task Returns_respect_the_window_ownership_and_rejection_needs_a_reason()
    {
        var (shop, buyer, orderId, lineId) = await DeliveredAsync(returnDays: 0);
        var path = $"/api/storefront/account/orders/{orderId}/returns";
        Assert.False((await (await buyer.Client.GetAt(shop.Host, path)).Json())["canRequest"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await buyer.Client.PostAt(shop.Host, path, new { reason = "Damaged", resolution = "Exchange", lines = new[] { new { orderLineId = lineId, quantity = 1 } } })).StatusCode);

        await shop.Merchant.PatchAsJsonAsync("/api/admin/store", new { name = "Returns", brandColor = "#4f46e5", lowStockThreshold = 2, returnWindowDays = 7 });
        // Another shopper of the same store can't see or return this order.
        var other = await ShopperAsync(shop.Host);
        Assert.Equal(HttpStatusCode.NotFound, (await other.Client.GetAt(shop.Host, path)).StatusCode);

        var ret = await (await buyer.Client.PostAt(shop.Host, path, new { reason = "Damaged", resolution = "Exchange", lines = new[] { new { orderLineId = lineId, quantity = 1 } } })).Json();
        var rid = ret["id"]!.ToString();
        Assert.Equal(HttpStatusCode.BadRequest, (await shop.Merchant.PostAsJsonAsync($"/api/admin/returns/{rid}/reject", new { note = "" })).StatusCode);
        var rejected = await (await shop.Merchant.PostAsJsonAsync($"/api/admin/returns/{rid}/reject", new { note = "The photos show wear after use." })).Json();
        Assert.Equal("Rejected", rejected["status"]!.ToString());
        // Rejected quantities can be requested again.
        Assert.Equal(2, (await (await buyer.Client.GetAt(shop.Host, path)).Json())["lines"]![0]!["returnable"]!.GetValue<int>());

        var (otherStore, _) = await F.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await otherStore.PostAsJsonAsync($"/api/admin/returns/{rid}/approve", new { note = "x" })).StatusCode);
    }
}
