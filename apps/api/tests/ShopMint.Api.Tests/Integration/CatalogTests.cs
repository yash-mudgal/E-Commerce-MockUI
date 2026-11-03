using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class CatalogTests(ApiFactory f)
{
    private static string Sku() => "SKU-" + Guid.NewGuid().ToString("N")[..8];

    [Fact]
    public async Task Create_product_with_variants_records_stock_and_money_as_strings()
    {
        var (c, _) = await f.NewMerchantAsync();
        var cat = await (await c.PostAsJsonAsync("/api/admin/categories", new { name = "Ethnic Wear" })).Json();
        var body = new
        {
            title = "Jaipuri Cotton Kurta", status = "active", gstRate = 12, hsnCode = "6204", categoryId = cat["id"]!.ToString(),
            optionNames = new[] { "Size", "Colour" }, tags = new[] { "cotton" },
            variants = new[]
            {
                new { sku = Sku(), optionValues = new[] { "M", "Indigo" }, price = 1299.5m, mrp = 2499m, stockOnHand = 4 },
                new { sku = Sku(), optionValues = new[] { "L", "Indigo" }, price = 1299.5m, mrp = 2499m, stockOnHand = 6 },
            },
        };
        var p = await c.CreateProductAsync(body);
        Assert.Equal("jaipuri-cotton-kurta", p["slug"]!.ToString());
        Assert.Equal("Ethnic Wear", p["categoryName"]!.ToString());
        Assert.Equal(2, p["variants"]!.AsArray().Count);
        Assert.Equal("1299.50", p["variants"]![0]!["price"]!.GetValue<string>());
        Assert.Equal(10, p["variants"]!.AsArray().Sum(v => v!["stockOnHand"]!.GetValue<int>()));

        var cats = await (await c.GetAsync("/api/admin/categories")).Json();
        Assert.Equal(1, cats[0]!["productCount"]!.GetValue<int>());
    }

    [Fact]
    public async Task Slug_collisions_are_made_unique()
    {
        var (c, _) = await f.NewMerchantAsync();
        var a = await c.CreateProductAsync(Http.Product("Copper Bottle", Sku()));
        var b = await c.CreateProductAsync(Http.Product("Copper Bottle", Sku()));
        Assert.Equal("copper-bottle", a["slug"]!.ToString());
        Assert.Equal("copper-bottle-2", b["slug"]!.ToString());
    }

    [Fact]
    public async Task Duplicate_sku_within_tenant_is_a_409_but_allowed_across_tenants()
    {
        var sku = Sku();
        var (a, _) = await f.NewMerchantAsync();
        var (b, _) = await f.NewMerchantAsync();
        await a.CreateProductAsync(Http.Product("One", sku));
        var dup = await a.PostAsJsonAsync("/api/admin/products", Http.Product("Two", sku));
        Assert.Equal(HttpStatusCode.Conflict, dup.StatusCode);
        Assert.Contains("SKU", (await dup.Json())["detail"]!.ToString());
        await b.CreateProductAsync(Http.Product("Other tenant", sku));
    }

    [Theory]
    [InlineData(100, 50, 12, "variants[0].mrp")]  // MRP below price
    [InlineData(0, 50, 12, "variants[0].price")]  // non-positive price
    [InlineData(100, 150, 7, "gstRate")]          // not a GST slab
    public async Task Validation_errors_name_the_field(decimal price, decimal mrp, decimal gst, string field)
    {
        var (c, _) = await f.NewMerchantAsync();
        var res = await c.PostAsJsonAsync("/api/admin/products", new
        {
            title = "X", status = "active", gstRate = gst, variants = new[] { new { sku = Sku(), price, mrp, stockOnHand = 1 } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.NotNull((await res.Json())["errors"]![field]);
    }

    [Fact]
    public async Task Variants_must_match_option_axes_and_be_unique()
    {
        var (c, _) = await f.NewMerchantAsync();
        var res = await c.PostAsJsonAsync("/api/admin/products", new
        {
            title = "X", status = "draft", gstRate = 5, optionNames = new[] { "Size" },
            variants = new[]
            {
                new { sku = Sku(), optionValues = new[] { "M" }, price = 10m, mrp = 10m, stockOnHand = 1 },
                new { sku = Sku(), optionValues = new[] { "m" }, price = 10m, mrp = 10m, stockOnHand = 1 },
            },
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task List_supports_search_status_filter_and_pagination()
    {
        var (c, _) = await f.NewMerchantAsync();
        for (var i = 0; i < 5; i++) await c.CreateProductAsync(Http.Product($"Masala Blend {i}", Sku()));
        var tea = await c.CreateProductAsync(Http.Product("Darjeeling Tea", "TEA-" + Guid.NewGuid().ToString("N")[..6], status: "draft"));

        var page = await (await c.GetAsync("/api/admin/products?q=masala&pageSize=2&page=2&sort=title")).Json();
        Assert.Equal(5, page["totalCount"]!.GetValue<int>());
        Assert.Equal(2, page["items"]!.AsArray().Count);
        Assert.Equal("Masala Blend 2", page["items"]![0]!["title"]!.ToString());

        var bySku = await (await c.GetAsync("/api/admin/products?q=TEA-")).Json();
        Assert.Equal(tea["id"]!.ToString(), bySku["items"]![0]!["id"]!.ToString());

        var drafts = await (await c.GetAsync("/api/admin/products?status=draft")).Json();
        Assert.Equal(1, drafts["totalCount"]!.GetValue<int>());

        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/api/admin/products?sort=evil")).StatusCode);
        var wildcard = await (await c.GetAsync("/api/admin/products?q=%25")).Json();
        Assert.Equal(0, wildcard["totalCount"]!.GetValue<int>());
    }

    [Fact]
    public async Task Update_replaces_variants_and_enforces_if_match()
    {
        var (c, _) = await f.NewMerchantAsync();
        var p = await c.CreateProductAsync(new
        {
            title = "Tee", status = "active", gstRate = 5, optionNames = new[] { "Size" },
            variants = new[]
            {
                new { sku = Sku(), optionValues = new[] { "S" }, price = 599m, mrp = 999m, stockOnHand = 3 },
                new { sku = Sku(), optionValues = new[] { "M" }, price = 599m, mrp = 999m, stockOnHand = 3 },
            },
        });
        var id = p["id"]!.ToString();
        var keep = p["variants"]![1]!;
        var version = p["version"]!.ToString();
        object Body(int stock) => new
        {
            title = "Tee v2", status = "active", gstRate = 5, optionNames = new[] { "Size" },
            variants = new object[]
            {
                new { id = keep["id"]!.ToString(), sku = keep["sku"]!.ToString(), optionValues = new[] { "M" }, price = 649m, mrp = 999m, stockOnHand = stock },
                new { sku = Sku(), optionValues = new[] { "L" }, price = 649m, mrp = 999m, stockOnHand = 2 },
            },
        };

        var req = new HttpRequestMessage(HttpMethod.Put, $"/api/admin/products/{id}") { Content = JsonContent.Create(Body(7)) };
        req.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        var ok = await c.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var updated = await ok.Json();
        Assert.Equal("Tee v2", updated["title"]!.ToString());
        Assert.Equal(new[] { "M", "L" }, updated["variants"]!.AsArray().Select(v => v!["optionValues"]![0]!.ToString()));
        Assert.Equal(7, updated["variants"]![0]!["stockOnHand"]!.GetValue<int>());

        var stale = new HttpRequestMessage(HttpMethod.Put, $"/api/admin/products/{id}") { Content = JsonContent.Create(Body(1)) };
        stale.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        var conflict = await c.SendAsync(stale);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.EndsWith("/concurrency", (await conflict.Json())["type"]!.ToString());
    }

    [Fact]
    public async Task Archive_hides_from_default_list_and_delete_removes()
    {
        var (c, _) = await f.NewMerchantAsync();
        var a = await c.CreateProductAsync(Http.Product("Archive me", Sku()));
        var d = await c.CreateProductAsync(Http.Product("Delete me", Sku()));
        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsync($"/api/admin/products/{a["id"]}/archive", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/admin/products/{d["id"]}")).StatusCode);
        var list = await (await c.GetAsync("/api/admin/products")).Json();
        Assert.Equal(0, list["totalCount"]!.GetValue<int>());
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/api/admin/products/{d["id"]}")).StatusCode);
        Assert.Equal("archived", (await (await c.GetAsync($"/api/admin/products/{a["id"]}")).Json())["status"]!.ToString());
    }

    [Fact]
    public async Task Category_with_products_cannot_be_deleted()
    {
        var (c, _) = await f.NewMerchantAsync();
        var cat = await (await c.PostAsJsonAsync("/api/admin/categories", new { name = "Spices" })).Json();
        await c.CreateProductAsync(Http.Product("Garam Masala", Sku(), categoryId: Guid.Parse(cat["id"]!.ToString())));
        var res = await c.DeleteAsync($"/api/admin/categories/{cat["id"]}");
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Only_one_level_of_sub_categories()
    {
        var (c, _) = await f.NewMerchantAsync();
        var top = await (await c.PostAsJsonAsync("/api/admin/categories", new { name = "Fashion" })).Json();
        var child = await (await c.PostAsJsonAsync("/api/admin/categories", new { name = "Men", parentId = top["id"]!.ToString() })).Json();
        var grandchild = await c.PostAsJsonAsync("/api/admin/categories", new { name = "Shirts", parentId = child["id"]!.ToString() });
        Assert.Equal(HttpStatusCode.BadRequest, grandchild.StatusCode);
    }

    [Fact]
    public async Task Dashboard_summarises_real_catalogue_and_has_no_sales_yet()
    {
        var (c, _) = await f.NewMerchantAsync();
        await c.CreateProductAsync(Http.Product("In stock", Sku(), stock: 50));
        await c.CreateProductAsync(Http.Product("Low", Sku(), stock: 2));
        await c.CreateProductAsync(Http.Product("Out", Sku(), stock: 0));
        await c.CreateProductAsync(Http.Product("Draft", Sku(), stock: 0, status: "draft"));
        var s = await (await c.GetAsync("/api/admin/dashboard/summary")).Json();
        Assert.Equal(4, s["catalog"]!["products"]!.GetValue<int>());
        Assert.Equal(3, s["catalog"]!["active"]!.GetValue<int>());
        Assert.Equal(1, s["catalog"]!["lowStockVariants"]!.GetValue<int>());
        Assert.Equal(1, s["catalog"]!["outOfStockVariants"]!.GetValue<int>());
        Assert.Equal(52, s["catalog"]!["unitsOnHand"]!.GetValue<int>());
        Assert.Null(s["sales"]);
    }
}
