using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>Storefront data for the redesigned shop: store terms, card hover images, category covers, sale and related lists.</summary>
[Collection("api")]
public class StorefrontShopTests(ApiFactory f)
{
    private static string Sku() => "SF-" + Guid.NewGuid().ToString("N")[..8];

    private async Task<(HttpClient Merchant, string Host)> LiveStoreAsync()
    {
        var (c, me) = await f.NewMerchantAsync();
        await f.LaunchAsync(ApiFactory.TenantId(me));
        return (c, ApiFactory.Host(me));
    }

    private async Task<string> ImageAsync(HttpClient c, string productId)
    {
        var res = await c.PostAsJsonAsync($"/api/admin/products/{productId}/media/uploads", new { contentType = "image/png", sizeBytes = InMemoryObjectStorage.Png.Length, fileName = "photo" });
        var ticket = await res.Json();
        f.Storage.Put(InMemoryObjectStorage.KeyFromUploadUrl(ticket["uploadUrl"]!.ToString()), InMemoryObjectStorage.Png, "image/png");
        var done = await c.PostAsync($"/api/admin/products/{productId}/media/{ticket["mediaId"]}/complete", null);
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);
        return (await done.Json())["url"]!.ToString();
    }

    private async Task<JsonNode> GetAsync(string host, string path) => await (await f.Client().GetAt(host, path)).Json();

    [Fact]
    public async Task Store_profile_states_the_terms_checkout_applies()
    {
        var (c, host) = await LiveStoreAsync();
        var patch = await c.PatchAsJsonAsync("/api/admin/store", new
        {
            name = "Terms Test", brandColor = "#4f46e5", lowStockThreshold = 3, shippingFee = 79, freeShippingThreshold = 999,
            codEnabled = true, codMaxOrderValue = 5000, businessAddress = "12 MG Road, Pune 411001",
        });
        Assert.True(patch.IsSuccessStatusCode);
        var store = await GetAsync(host, "/api/storefront/store");
        Assert.Equal(79m, decimal.Parse(store["shippingFee"]!.ToString(), System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(999m, decimal.Parse(store["freeShippingThreshold"]!.ToString(), System.Globalization.CultureInfo.InvariantCulture));
        Assert.True(store["codEnabled"]!.GetValue<bool>());
        Assert.Equal(5000m, decimal.Parse(store["codMaxOrderValue"]!.ToString(), System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal("12 MG Road, Pune 411001", store["businessAddress"]!.ToString());
        // The test environment allows the labelled test gateway, and the profile says so.
        Assert.True(store["onlinePayments"]!.GetValue<bool>());
        Assert.True(store["onlinePaymentsTest"]!.GetValue<bool>());

        await c.PatchAsJsonAsync("/api/admin/store", new { name = "Terms Test", brandColor = "#4f46e5", lowStockThreshold = 3, clearFreeShipping = true, codEnabled = false });
        store = await GetAsync(host, "/api/storefront/store");
        Assert.Null(store["freeShippingThreshold"]);
        Assert.False(store["codEnabled"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Cards_carry_a_hover_image_and_categories_a_cover()
    {
        var (c, host) = await LiveStoreAsync();
        var cat = await (await c.PostAsJsonAsync("/api/admin/categories", new { name = "Sarees" })).Json();
        var catId = Guid.Parse(cat["id"]!.ToString());
        var older = await c.CreateProductAsync(Http.Product("Older Saree", Sku(), categoryId: catId));
        var olderFirst = await ImageAsync(c, older["id"]!.ToString());
        var newer = await c.CreateProductAsync(Http.Product("Newer Saree", Sku(), categoryId: catId));
        var newerFirst = await ImageAsync(c, newer["id"]!.ToString());
        var newerSecond = await ImageAsync(c, newer["id"]!.ToString());
        await c.CreateProductAsync(Http.Product("Plain Saree", Sku(), categoryId: catId)); // newest, but no image

        var cards = (await GetAsync(host, "/api/storefront/products?category=sarees"))["items"]!.AsArray();
        var newerCard = cards.Single(x => x!["title"]!.ToString() == "Newer Saree")!;
        Assert.Equal(newerFirst, newerCard["image"]!["url"]!.ToString());
        Assert.Equal(newerSecond, newerCard["hoverImage"]!["url"]!.ToString());
        var olderCard = cards.Single(x => x!["title"]!.ToString() == "Older Saree")!;
        Assert.Equal(olderFirst, olderCard["image"]!["url"]!.ToString());
        Assert.Null(olderCard["hoverImage"]);

        var category = (await GetAsync(host, "/api/storefront/categories")).AsArray().Single(x => x!["slug"]!.ToString() == "sarees")!;
        Assert.Equal(3, category["productCount"]!.GetValue<int>());
        Assert.Equal(newerFirst, category["cover"]!["url"]!.ToString()); // newest product that has an image
    }

    [Fact]
    public async Task On_sale_and_exclude_filters()
    {
        var (c, host) = await LiveStoreAsync();
        await c.CreateProductAsync(Http.Product("Discounted Kurta", Sku(), price: 899, mrp: 1299));
        await c.CreateProductAsync(Http.Product("Full Price Kurta", Sku(), price: 999, mrp: 999));

        var sale = (await GetAsync(host, "/api/storefront/products?onSale=true"))["items"]!.AsArray();
        Assert.Equal(["Discounted Kurta"], sale.Select(x => x!["title"]!.ToString()).ToArray());

        var related = (await GetAsync(host, "/api/storefront/products?exclude=discounted-kurta"))["items"]!.AsArray();
        Assert.Equal(["Full Price Kurta"], related.Select(x => x!["title"]!.ToString()).ToArray());
    }
}
