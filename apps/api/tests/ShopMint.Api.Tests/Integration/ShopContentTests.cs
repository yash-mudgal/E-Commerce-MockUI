using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using ShopMint.Api.Modules.Storefront;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>Store pages, tag-based collections, option filters (size, colour) and the editable home page.</summary>
[Collection("api")]
public class ShopContentTests(ApiFactory f)
{
    private static string Sku() => "C-" + Guid.NewGuid().ToString("N")[..8];

    private async Task<(HttpClient Merchant, JsonNode Me, string Host)> LiveStoreAsync()
    {
        var (c, me) = await f.NewMerchantAsync();
        await f.LaunchAsync(ApiFactory.TenantId(me));
        return (c, me, ApiFactory.Host(me));
    }

    private Task<JsonNode> GetAsync(string host, string path) => f.Client().GetAt(host, path).ContinueWith(t => t.Result.Json()).Unwrap();

    private static object Apparel(string title, string[] tags, params (string Size, string Colour, decimal Price, bool Active)[] variants) => new
    {
        title, status = "active", gstRate = 12, hsnCode = "6204", tags, optionNames = new[] { "Size", "Colour" },
        variants = variants.Select(v => new { sku = Sku(), optionValues = new[] { v.Size, v.Colour }, price = v.Price, mrp = v.Price + 200, stockOnHand = 5, isActive = v.Active }).ToArray(),
    };

    [Fact]
    public async Task Pages_are_public_only_when_published()
    {
        var (c, _, host) = await LiveStoreAsync();
        var draft = await c.PostAsJsonAsync("/api/admin/pages", new { title = "Returns and exchanges", body = "", published = false });
        Assert.Equal(HttpStatusCode.Created, draft.StatusCode);
        var page = await draft.Json();
        Assert.Equal("returns-and-exchanges", page["slug"]!.ToString());
        Assert.Equal(HttpStatusCode.NotFound, (await f.Client().GetAt(host, "/api/storefront/pages/returns-and-exchanges")).StatusCode);

        // Publishing needs content.
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PutAsJsonAsync($"/api/admin/pages/{page["id"]}", new { title = "Returns and exchanges", body = " ", published = true })).StatusCode);
        var ok = await c.PutAsJsonAsync($"/api/admin/pages/{page["id"]}", new { title = "Returns and exchanges", slug = "returns", body = "## Window\nReturn within 7 days of delivery.", published = true });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var pub = await GetAsync(host, "/api/storefront/pages/returns");
        Assert.Equal("Returns and exchanges", pub["title"]!.ToString());
        Assert.Contains("7 days", pub["body"]!.ToString());
        var home = await GetAsync(host, "/api/storefront/home");
        Assert.Equal(["returns"], home["pages"]!.AsArray().Select(p => p!["slug"]!.ToString()).ToArray());

        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/admin/pages", new { title = "Another", slug = "returns", body = "x", published = false })).StatusCode);
        var (other, _) = await f.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/api/admin/pages/{page["id"]}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/admin/pages/{page["id"]}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await f.Client().GetAt(host, "/api/storefront/pages/returns")).StatusCode);
    }

    [Fact]
    public async Task Collections_gather_products_by_tag()
    {
        var (c, _, host) = await LiveStoreAsync();
        await c.CreateProductAsync(Apparel("Wedding Lehenga", ["Wedding", "silk"], ("M", "Red", 4999, true)));
        await c.CreateProductAsync(Apparel("Festive Kurta", ["wedding"], ("L", "Gold", 1999, true)));
        await c.CreateProductAsync(Apparel("Office Shirt", ["formal"], ("M", "White", 999, true)));
        var res = await c.PostAsJsonAsync("/api/admin/collections", new { title = "The Wedding Edit", tag = "WEDDING", description = "For the big day", published = true });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.Equal(2, (await res.Json())["productCount"]!.GetValue<int>()); // tags match case-insensitively

        var items = (await GetAsync(host, "/api/storefront/products?collection=the-wedding-edit"))["items"]!.AsArray();
        Assert.Equal(["Festive Kurta", "Wedding Lehenga"], items.Select(i => i!["title"]!.ToString()).Order().ToArray());
        var home = await GetAsync(host, "/api/storefront/home");
        var col = home["collections"]!.AsArray().Single()!;
        Assert.Equal("The Wedding Edit", col["title"]!.ToString());
        Assert.Equal(2, col["productCount"]!.GetValue<int>());

        // Unpublished: gone from the storefront.
        var id = (await res.Json())["id"]!.ToString();
        await c.PutAsJsonAsync($"/api/admin/collections/{id}", new { title = "The Wedding Edit", tag = "wedding", published = false });
        Assert.Empty((await GetAsync(host, "/api/storefront/products?collection=the-wedding-edit"))["items"]!.AsArray());
        Assert.Empty((await GetAsync(host, "/api/storefront/home"))["collections"]!.AsArray());
    }

    [Fact]
    public async Task Size_and_colour_filters_use_active_variants()
    {
        var (c, _, host) = await LiveStoreAsync();
        await c.CreateProductAsync(Apparel("Kurta A", [], ("S", "Indigo", 999, true), ("M", "Indigo", 999, true)));
        await c.CreateProductAsync(Apparel("Kurta B", [], ("M", "Mustard", 1299, true), ("XL", "Mustard", 1299, false))); // XL inactive
        await c.CreateProductAsync(Apparel("Kurta C", [], ("L", "Indigo", 1599, true)));

        var facets = await GetAsync(host, "/api/storefront/facets");
        var size = facets["options"]!.AsArray().Single(o => o!["name"]!.ToString() == "Size")!["values"]!.AsArray();
        Assert.Equal(["S", "M", "L"], size.Select(v => v!["value"]!.ToString()).ToArray()); // size order; inactive XL left out
        Assert.Equal(2, size.Single(v => v!["value"]!.ToString() == "M")!["count"]!.GetValue<int>());
        Assert.Equal("999.00", facets["priceMin"]!.ToString());
        Assert.Equal("1599.00", facets["priceMax"]!.ToString());

        static string[] Titles(JsonNode page) => page["items"]!.AsArray().Select(i => i!["title"]!.ToString()).Order().ToArray();
        Assert.Equal(["Kurta A", "Kurta B"], Titles(await GetAsync(host, "/api/storefront/products?opt=Size:M")));
        Assert.Equal(["Kurta A", "Kurta B", "Kurta C"], Titles(await GetAsync(host, "/api/storefront/products?opt=size:M&opt=size:L"))); // OR within an option
        Assert.Equal(["Kurta A"], Titles(await GetAsync(host, "/api/storefront/products?opt=Size:M&opt=Colour:Indigo"))); // AND across options
        Assert.Empty(Titles(await GetAsync(host, "/api/storefront/products?opt=Size:XL")));
    }

    [Fact]
    public async Task Home_page_settings_use_the_stores_own_photos()
    {
        var (c, me, host) = await LiveStoreAsync();
        var p = await c.CreateProductAsync(Http.Product("Hero Saree", Sku()));
        var ticket = await (await c.PostAsJsonAsync($"/api/admin/products/{p["id"]}/media/uploads", new { contentType = "image/png", sizeBytes = InMemoryObjectStorage.Png.Length, fileName = "hero" })).Json();
        f.Storage.Put(InMemoryObjectStorage.KeyFromUploadUrl(ticket["uploadUrl"]!.ToString()), InMemoryObjectStorage.Png, "image/png");
        var media = await (await c.PostAsync($"/api/admin/products/{p["id"]}/media/{ticket["mediaId"]}/complete", null)).Json();

        var options = (await (await c.GetAsync("/api/admin/storefront/hero-images")).Json()).AsArray();
        Assert.Equal(ticket["mediaId"]!.ToString(), options.Single()!["mediaId"]!.ToString());

        // Another store's photo is refused.
        var (other, _) = await f.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await other.PutAsJsonAsync("/api/admin/storefront", new
        {
            heroMediaId = ticket["mediaId"]!.ToString(), showCategories = true, showNewArrivals = true, showSale = true,
        })).StatusCode);

        var put = await c.PutAsJsonAsync("/api/admin/storefront", new
        {
            heroHeading = "Handwoven, made to last", heroText = "Sarees from weavers we know by name.", heroMediaId = ticket["mediaId"]!.ToString(),
            announcement = "Diwali orders ship within 2 days", showCategories = true, showNewArrivals = true, showSale = false,
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var home = await GetAsync(host, "/api/storefront/home");
        Assert.Equal("Handwoven, made to last", home["heroHeading"]!.ToString());
        Assert.Equal(media["url"]!.ToString(), home["heroImage"]!["url"]!.ToString());
        Assert.Equal("hero-saree", home["heroProductSlug"]!.ToString());
        Assert.Equal("Diwali orders ship within 2 days", home["announcement"]!.ToString());
        Assert.False(home["showSale"]!.GetValue<bool>());

        // Archiving the product drops the hero image instead of showing a product that can't be bought.
        var full = await (await c.GetAsync($"/api/admin/products/{p["id"]}")).Json();
        full["status"] = "archived";
        await c.PutAsJsonAsync($"/api/admin/products/{p["id"]}", full);
        Assert.Null((await GetAsync(host, "/api/storefront/home"))["heroImage"]);
    }

    [Theory]
    [InlineData(new[] { "XL", "S", "40", "M", "38", "Free" }, new[] { "S", "M", "XL", "38", "40", "Free" })]
    public void Sizes_sort_naturally(string[] input, string[] expected) =>
        Assert.Equal(expected, input.OrderBy(ShopContentEndpoints.SizeOrder).ToArray());
}
