using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using ShopMint.Api.Modules.Reviews;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>Product reviews (verified buyers, store moderation), ratings on cards, and shoppers' wishlists.</summary>
[Collection("api")]
public class ReviewTests(ApiFactory f) : CheckoutTestBase(f)
{
    /// <summary>A shop whose product the returned shopper has received (a delivered COD order).</summary>
    private async Task<(Shop Shop, Shopper Buyer, string Slug)> DeliveredAsync()
    {
        var shop = await ShopAsync(stock: 10);
        var buyer = await ShopperAsync(shop.Host, Variant(shop.Product));
        var id = (await PlacedAsync(buyer, shop.Host, "cod"))["orderId"]!.ToString();
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.PostAsync($"/api/admin/orders/{id}/pack", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{id}/ship", new { carrier = "Delhivery", trackingNumber = "DLV1" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.PostAsync($"/api/admin/orders/{id}/deliver", null)).StatusCode);
        return (shop, buyer, shop.Product["slug"]!.ToString());
    }

    private static Task<HttpResponseMessage> WriteAsync(HttpClient c, string host, string slug, int rating, string body, string? title = null) =>
        c.At(host, HttpMethod.Put, $"/api/storefront/products/{slug}/reviews/mine", new { rating, title, body });

    [Fact]
    public async Task Only_shoppers_who_received_the_product_can_review_it()
    {
        var shop = await ShopAsync();
        var slug = shop.Product["slug"]!.ToString();
        // Guest: must sign in.
        Assert.Equal(HttpStatusCode.Unauthorized, (await WriteAsync(F.Client(), shop.Host, slug, 5, "Lovely fabric and colour")).StatusCode);
        // Ordered but not delivered: not yet.
        var waiting = await ShopperAsync(shop.Host, Variant(shop.Product));
        await PlacedAsync(waiting, shop.Host, "cod");
        var mine = await (await waiting.Client.GetAt(shop.Host, $"/api/storefront/products/{slug}/reviews/mine")).Json();
        Assert.False(mine["canReview"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Forbidden, (await WriteAsync(waiting.Client, shop.Host, slug, 5, "Lovely fabric and colour")).StatusCode);
    }

    [Fact]
    public async Task Reviews_appear_after_the_store_publishes_them()
    {
        var (shop, buyer, slug) = await DeliveredAsync();
        var mine = await (await buyer.Client.GetAt(shop.Host, $"/api/storefront/products/{slug}/reviews/mine")).Json();
        Assert.True(mine["canReview"]!.GetValue<bool>());

        var bad = await WriteAsync(buyer.Client, shop.Host, slug, 6, "short");
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var written = await WriteAsync(buyer.Client, shop.Host, slug, 4, "Soft cotton, true to size. Colour slightly darker than the photo.", "Good kurta");
        Assert.Equal(HttpStatusCode.OK, written.StatusCode);
        Assert.Equal("Pending", (await written.Json())["status"]!.ToString());

        // Pending: not public yet.
        var list = await (await F.Client().GetAt(shop.Host, $"/api/storefront/products/{slug}/reviews")).Json();
        Assert.Empty(list["items"]!.AsArray());
        Assert.Equal(0, list["summary"]!["count"]!.GetValue<int>());

        var queue = await (await shop.Merchant.GetAsync("/api/admin/reviews?status=pending")).Json();
        var row = queue["items"]!.AsArray().Single()!;
        Assert.Equal(1, queue["counts"]!["pending"]!.GetValue<int>());
        Assert.Equal(buyer.Email, row["customerEmail"]!.ToString());
        var publish = await shop.Merchant.PatchAsJsonAsync($"/api/admin/reviews/{row["id"]}", new { status = "Published", reply = "Thank you, Ravi!" });
        Assert.Equal(HttpStatusCode.OK, publish.StatusCode);

        list = await (await F.Client().GetAt(shop.Host, $"/api/storefront/products/{slug}/reviews")).Json();
        var review = list["items"]!.AsArray().Single()!;
        Assert.Equal("Meera S.", review["author"]!.ToString()); // first name and initial only: never the full name or email
        Assert.Equal("Good kurta", review["title"]!.ToString());
        Assert.Equal("Thank you, Ravi!", review["reply"]!.ToString());
        Assert.Equal("4.0", list["summary"]!["average"]!.ToString());
        Assert.Equal([0, 0, 0, 1, 0], list["summary"]!["distribution"]!.AsArray().Select(n => n!.GetValue<int>()).ToArray());
        Assert.DoesNotContain(buyer.Email, list.ToJsonString());

        // Ratings reach the product page and the listing card.
        var pdp = await (await F.Client().GetAt(shop.Host, $"/api/storefront/products/{slug}")).Json();
        Assert.Equal("4.0", pdp["ratings"]!["average"]!.ToString());
        var card = (await (await F.Client().GetAt(shop.Host, "/api/storefront/products")).Json())["items"]!.AsArray().Single(x => x!["slug"]!.ToString() == slug)!;
        Assert.Equal("4.0", card["rating"]!.ToString());
        Assert.Equal(1, card["reviewCount"]!.GetValue<int>());

        // Editing sends it back for checking; one review per shopper and product.
        var edited = await WriteAsync(buyer.Client, shop.Host, slug, 5, "After a few washes it still looks new. Recommended.");
        Assert.Equal("Pending", (await edited.Json())["status"]!.ToString());
        Assert.Empty((await (await F.Client().GetAt(shop.Host, $"/api/storefront/products/{slug}/reviews")).Json())["items"]!.AsArray());
        Assert.Equal(1, (await (await shop.Merchant.GetAsync("/api/admin/reviews")).Json())["totalCount"]!.GetValue<int>());
    }

    [Fact]
    public async Task Hidden_reviews_leave_the_storefront_and_other_stores_cant_moderate()
    {
        var (shop, buyer, slug) = await DeliveredAsync();
        await WriteAsync(buyer.Client, shop.Host, slug, 2, "Stitching came loose after one wear.");
        var id = (await (await shop.Merchant.GetAsync("/api/admin/reviews")).Json())["items"]![0]!["id"]!.ToString();
        await shop.Merchant.PatchAsJsonAsync($"/api/admin/reviews/{id}", new { status = "Published" });
        Assert.Single((await (await F.Client().GetAt(shop.Host, $"/api/storefront/products/{slug}/reviews")).Json())["items"]!.AsArray());

        var (other, _) = await F.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.PatchAsJsonAsync($"/api/admin/reviews/{id}", new { status = "Hidden" })).StatusCode);
        Assert.Empty((await (await other.GetAsync("/api/admin/reviews")).Json())["items"]!.AsArray());
        Assert.Equal(HttpStatusCode.Unauthorized, (await F.Client().GetAsync("/api/admin/reviews")).StatusCode);

        await shop.Merchant.PatchAsJsonAsync($"/api/admin/reviews/{id}", new { status = "Hidden" });
        var list = await (await F.Client().GetAt(shop.Host, $"/api/storefront/products/{slug}/reviews")).Json();
        Assert.Empty(list["items"]!.AsArray());
        Assert.Null(list["summary"]!["average"]);
    }

    [Fact]
    public async Task Wishlist_is_per_shopper_and_per_store()
    {
        var shop = await ShopAsync();
        var slug = shop.Product["slug"]!.ToString();
        Assert.Equal(HttpStatusCode.Unauthorized, (await F.Client().At(shop.Host, HttpMethod.Put, $"/api/storefront/account/wishlist/{slug}")).StatusCode);

        var s = await ShopperAsync(shop.Host);
        Assert.Equal(HttpStatusCode.NoContent, (await s.Client.At(shop.Host, HttpMethod.Put, $"/api/storefront/account/wishlist/{slug}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await s.Client.At(shop.Host, HttpMethod.Put, $"/api/storefront/account/wishlist/{slug}")).StatusCode); // idempotent
        var list = (await (await s.Client.GetAt(shop.Host, "/api/storefront/account/wishlist")).Json()).AsArray();
        Assert.Equal([slug], list.Select(x => x!["slug"]!.ToString()).ToArray());
        Assert.Equal(HttpStatusCode.NotFound, (await s.Client.At(shop.Host, HttpMethod.Put, "/api/storefront/account/wishlist/no-such-product")).StatusCode);

        // Another shopper of the same store sees an empty list.
        var other = await ShopperAsync(shop.Host);
        Assert.Empty((await (await other.Client.GetAt(shop.Host, "/api/storefront/account/wishlist")).Json()).AsArray());

        Assert.Equal(HttpStatusCode.NoContent, (await s.Client.At(shop.Host, HttpMethod.Delete, $"/api/storefront/account/wishlist/{slug}")).StatusCode);
        Assert.Empty((await (await s.Client.GetAt(shop.Host, "/api/storefront/account/wishlist")).Json()).AsArray());
    }

    [Fact]
    public async Task Products_can_be_fetched_by_slug_for_recently_viewed()
    {
        var shop = await ShopAsync();
        await shop.Merchant.CreateProductAsync(Http.Product("Second Item", Sku()));
        await shop.Merchant.CreateProductAsync(Http.Product("Third Item", Sku()));
        var res = await (await F.Client().GetAt(shop.Host, $"/api/storefront/products?slugs=third-item,{shop.Product["slug"]},missing")).Json();
        Assert.Equal(new[] { shop.Product["slug"]!.ToString(), "third-item" }.Order(), res["items"]!.AsArray().Select(x => x!["slug"]!.ToString()).Order());
    }

    [Theory]
    [InlineData("Ananya Rao", "Ananya R.")]
    [InlineData("Ravi", "Ravi")]
    [InlineData("  ravi  kumar  singh ", "ravi S.")]
    [InlineData("", "Verified buyer")]
    public void Author_names_are_shortened(string name, string expected) => Assert.Equal(expected, ReviewEndpoints.Author(name));
}
