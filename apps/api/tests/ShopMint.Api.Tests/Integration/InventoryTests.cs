using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Npgsql;
using ShopMint.Api.Modules;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class InventoryTests(ApiFactory f)
{
    private static string Sku() => "I-" + Guid.NewGuid().ToString("N")[..8];

    private async Task SetPlanAsync(JsonNode me, string plan)
    {
        await using var conn = new NpgsqlConnection(f.PlatformCs);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("update tenants set plan_code = @p where id = @id", conn);
        cmd.Parameters.AddWithValue("p", plan);
        cmd.Parameters.AddWithValue("id", ApiFactory.TenantId(me));
        Assert.Equal(1, await cmd.ExecuteNonQueryAsync());
    }

    private static async Task<JsonNode> Locations(HttpClient c) => await (await c.GetAsync("/api/admin/locations")).Json();
    private static async Task<string> DefaultLocation(HttpClient c) =>
        (await Locations(c))["locations"]!.AsArray().Single(l => l!["isDefault"]!.GetValue<bool>())!["id"]!.ToString();

    private async Task<(HttpClient C, JsonNode Me, string VariantId, string ProductId)> StockedAsync(int stock = 10)
    {
        var (c, me) = await f.NewMerchantAsync();
        var p = await c.CreateProductAsync(Http.Product("Steel Tumbler", Sku(), stock: stock));
        return (c, me, p["variants"]![0]!["id"]!.ToString(), p["id"]!.ToString());
    }

    private static async Task<JsonNode> Item(HttpClient c, string variantId) =>
        (await (await c.GetAsync("/api/admin/inventory?pageSize=100")).Json())["items"]!.AsArray().Single(i => i!["variantId"]!.ToString() == variantId)!;

    [Fact]
    public async Task Location_limits_follow_the_plan()
    {
        var (c, me) = await f.NewMerchantAsync();
        var overview = await Locations(c);
        Assert.Single(overview["locations"]!.AsArray());
        Assert.Equal(1, overview["maxLocations"]!.GetValue<int>());
        var refused = await c.PostAsJsonAsync("/api/admin/locations", new { name = "Pune store", code = "PUNE" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        Assert.EndsWith("/entitlement-exceeded", (await refused.Json())["type"]!.ToString());

        await SetPlanAsync(me, "pro");
        Assert.Equal(HttpStatusCode.Created, (await c.PostAsJsonAsync("/api/admin/locations", new { name = "Pune store", code = "pune", stateCode = "27" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/admin/locations", new { name = "Dup", code = "PUNE" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/admin/locations", new { name = "Bad", code = "has space" })).StatusCode);
        var list = (await Locations(c))["locations"]!.AsArray();
        Assert.Equal(2, list.Count);
        Assert.Contains(list, l => l!["code"]!.ToString() == "PUNE");
    }

    [Fact]
    public async Task Default_and_stocked_locations_cannot_be_deleted()
    {
        var (c, me, variantId, _) = await StockedAsync();
        await SetPlanAsync(me, "pro");
        var main = await DefaultLocation(c);
        Assert.Equal(HttpStatusCode.Conflict, (await c.DeleteAsync($"/api/admin/locations/{main}")).StatusCode);

        var created = await (await c.PostAsJsonAsync("/api/admin/locations", new { name = "Kiosk", code = "KIOSK" })).Json();
        var kiosk = created["locations"]!.AsArray().Single(l => l!["code"]!.ToString() == "KIOSK")!["id"]!.ToString();
        await c.PostAsJsonAsync("/api/admin/inventory/transfers", new { fromLocationId = main, toLocationId = kiosk, lines = new[] { new { variantId, quantity = 2 } } });
        Assert.Equal(HttpStatusCode.Conflict, (await c.DeleteAsync($"/api/admin/locations/{kiosk}")).StatusCode);

        // Make the kiosk the default: the old default stops being default.
        var updated = await (await c.PutAsJsonAsync($"/api/admin/locations/{kiosk}", new { name = "Kiosk", code = "KIOSK", isDefault = true })).Json();
        Assert.Equal(kiosk, updated["locations"]![0]!["id"]!.ToString());
        Assert.Single(updated["locations"]!.AsArray(), l => l!["isDefault"]!.GetValue<bool>());

        // Move the stock back and empty the old main location's role; then it can be deleted.
        await c.PostAsJsonAsync("/api/admin/inventory/transfers", new { fromLocationId = main, toLocationId = kiosk, lines = new[] { new { variantId, quantity = 8 } } });
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/admin/locations/{main}")).StatusCode);
        Assert.Equal(10, (await Item(c, variantId))["onHand"]!.GetValue<int>());
    }

    [Fact]
    public async Task Adjustments_record_reason_note_and_actor_in_the_ledger()
    {
        var (c, me, variantId, _) = await StockedAsync(10);
        var loc = await DefaultLocation(c);

        var receipt = await c.PostAsJsonAsync("/api/admin/inventory/adjustments", new
        {
            locationId = loc, reason = "receipt", note = "Supplier invoice INV-204", lines = new[] { new { variantId, delta = 5 } },
        });
        Assert.Equal(HttpStatusCode.OK, receipt.StatusCode);
        Assert.Equal(15, (await receipt.Json())["items"]![0]!["onHand"]!.GetValue<int>());

        var count = await c.PostAsJsonAsync("/api/admin/inventory/adjustments", new
        {
            locationId = loc, reason = "correction", note = "Monthly count", lines = new[] { new { variantId, countedOnHand = 12 } },
        });
        Assert.Equal(12, (await count.Json())["items"]![0]!["onHand"]!.GetValue<int>());

        var ledger = (await (await c.GetAsync($"/api/admin/inventory/movements?variantId={variantId}")).Json())["items"]!.AsArray();
        Assert.Equal(new[] { -3, 5, 10 }, ledger.Select(m => m!["delta"]!.GetValue<int>()));
        Assert.Equal(new[] { "Correction", "Receipt", "Initial" }, ledger.Select(m => m!["reason"]!.ToString()));
        Assert.Equal("Supplier invoice INV-204", ledger[1]!["note"]!.ToString());
        Assert.Equal("Test Owner", ledger[0]!["actorName"]!.ToString());

        var audit = await (await c.GetAsync("/api/admin/audit")).Json();
        Assert.Contains(audit["items"]!.AsArray(), e => e!["action"]!.ToString() == "inventory.adjusted");
        _ = me;
    }

    [Fact]
    public async Task Adjustments_are_all_or_nothing_and_never_go_below_reserved()
    {
        var (c, me, variantId, _) = await StockedAsync(4);
        var other = (await c.CreateProductAsync(Http.Product("Brass Lamp", Sku(), stock: 2)))["variants"]![0]!["id"]!.ToString();
        var loc = await DefaultLocation(c);

        var res = await c.PostAsJsonAsync("/api/admin/inventory/adjustments", new
        {
            locationId = loc, reason = "damaged", lines = new object[] { new { variantId, delta = -1 }, new { variantId = other, delta = -3 } },
        });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        var problem = await res.Json();
        Assert.EndsWith("/insufficient-stock", problem["type"]!.ToString());
        Assert.NotNull(problem["errors"]!["lines[1]"]);
        Assert.Equal(4, (await Item(c, variantId))["onHand"]!.GetValue<int>()); // first line not applied either

        // Wrong direction for the reason is an input error.
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/admin/inventory/adjustments", new
        {
            locationId = loc, reason = "damaged", lines = new[] { new { variantId, delta = 2 } },
        })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/admin/inventory/adjustments", new
        {
            locationId = loc, reason = "correction", lines = new[] { new { variantId, delta = 1, countedOnHand = 3 } },
        })).StatusCode);

        // Reserved units (held for orders) can't be adjusted away.
        await using (var conn = new NpgsqlConnection(f.PlatformCs))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("update stock_levels set reserved = 3 where variant_id = @v", conn);
            cmd.Parameters.AddWithValue("v", Guid.Parse(variantId));
            await cmd.ExecuteNonQueryAsync();
        }
        var below = await c.PostAsJsonAsync("/api/admin/inventory/adjustments", new
        {
            locationId = loc, reason = "correction", lines = new[] { new { variantId, countedOnHand = 2 } },
        });
        Assert.Equal(HttpStatusCode.Conflict, below.StatusCode);
        Assert.Contains("reserved", (await below.Json())["errors"]!["lines[0]"]![0]!.ToString());
        _ = me;
    }

    [Fact]
    public async Task Concurrent_adjustments_never_oversell()
    {
        var (c, _, variantId, _) = await StockedAsync(5);
        var loc = await DefaultLocation(c);
        var attempts = Enumerable.Range(0, 12).Select(_ => c.PostAsJsonAsync("/api/admin/inventory/adjustments", new
        {
            locationId = loc, reason = "lost", lines = new[] { new { variantId, delta = -1 } },
        }));
        var results = await Task.WhenAll(attempts);
        Assert.Equal(5, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.All(results, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }));
        Assert.Equal(0, (await Item(c, variantId))["onHand"]!.GetValue<int>());
    }

    [Fact]
    public async Task Transfers_move_stock_between_locations_in_one_batch()
    {
        var (c, me, variantId, _) = await StockedAsync(6);
        await SetPlanAsync(me, "pro");
        var main = await DefaultLocation(c);
        var created = await (await c.PostAsJsonAsync("/api/admin/locations", new { name = "Mumbai", code = "BOM" })).Json();
        var bom = created["locations"]!.AsArray().Single(l => l!["code"]!.ToString() == "BOM")!["id"]!.ToString();

        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsJsonAsync("/api/admin/inventory/transfers",
            new { fromLocationId = main, toLocationId = bom, lines = new[] { new { variantId, quantity = 7 } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/admin/inventory/transfers",
            new { fromLocationId = main, toLocationId = main, lines = new[] { new { variantId, quantity = 1 } } })).StatusCode);

        var ok = await (await c.PostAsJsonAsync("/api/admin/inventory/transfers",
            new { fromLocationId = main, toLocationId = bom, note = "Diwali stock", lines = new[] { new { variantId, quantity = 4 } } })).Json();
        var levels = ok["items"]![0]!["levels"]!.AsArray();
        Assert.Equal(2, levels.Single(l => l!["locationId"]!.ToString() == main)!["onHand"]!.GetValue<int>());
        Assert.Equal(4, levels.Single(l => l!["locationId"]!.ToString() == bom)!["onHand"]!.GetValue<int>());
        Assert.Equal(6, ok["items"]![0]!["onHand"]!.GetValue<int>());

        var ledger = (await (await c.GetAsync($"/api/admin/inventory/movements?variantId={variantId}&pageSize=2")).Json())["items"]!.AsArray();
        Assert.Equal(ledger[0]!["batchId"]!.ToString(), ledger[1]!["batchId"]!.ToString());
        Assert.Equal(new[] { "TransferIn", "TransferOut" }, ledger.Select(m => m!["reason"]!.ToString()).OrderBy(x => x));

        // Filter by location.
        var atBom = await (await c.GetAsync($"/api/admin/inventory?locationId={bom}")).Json();
        Assert.Equal(4, atBom["items"]![0]!["onHand"]!.GetValue<int>());
    }

    [Fact]
    public async Task Product_editor_leaves_stock_alone_unless_a_count_is_sent()
    {
        var (c, me, variantId, productId) = await StockedAsync(5);
        await SetPlanAsync(me, "pro");
        var main = await DefaultLocation(c);
        var created = await (await c.PostAsJsonAsync("/api/admin/locations", new { name = "Second", code = "TWO" })).Json();
        var two = created["locations"]!.AsArray().Single(l => l!["code"]!.ToString() == "TWO")!["id"]!.ToString();
        await c.PostAsJsonAsync("/api/admin/inventory/adjustments", new { locationId = two, reason = "receipt", lines = new[] { new { variantId, delta = 3 } } });

        var product = await (await c.GetAsync($"/api/admin/products/{productId}")).Json();
        var v = product["variants"]![0]!;
        var put = await c.PutAsJsonAsync($"/api/admin/products/{productId}", new
        {
            title = "Steel Tumbler (set of 2)", status = "active", gstRate = 12, hsnCode = "6204", optionNames = Array.Empty<string>(),
            variants = new[] { new { id = variantId, sku = v["sku"]!.ToString(), optionValues = Array.Empty<string>(), price = 499, mrp = 699, stockOnHand = (int?)null } },
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var item = await Item(c, variantId);
        Assert.Equal(8, item["onHand"]!.GetValue<int>());
        Assert.Equal(5, item["levels"]!.AsArray().Single(l => l!["locationId"]!.ToString() == main)!["onHand"]!.GetValue<int>());
    }

    [Fact]
    public async Task Inventory_filters_and_permissions()
    {
        var (c, me) = await f.NewMerchantAsync();
        await c.CreateProductAsync(Http.Product("Plenty", Sku(), stock: 50));
        await c.CreateProductAsync(Http.Product("Nearly gone", Sku(), stock: 2));
        await c.CreateProductAsync(Http.Product("Sold out", Sku(), stock: 0));

        var low = await (await c.GetAsync("/api/admin/inventory?stock=low")).Json();
        Assert.Equal(new[] { "Nearly gone" }, low["items"]!.AsArray().Select(i => i!["productTitle"]!.ToString()));
        var outOf = await (await c.GetAsync("/api/admin/inventory?stock=out")).Json();
        Assert.Equal(new[] { "Sold out" }, outOf["items"]!.AsArray().Select(i => i!["productTitle"]!.ToString()));
        var search = await (await c.GetAsync("/api/admin/inventory?q=plen")).Json();
        Assert.Single(search["items"]!.AsArray());
        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/api/admin/inventory?stock=nope")).StatusCode);

        var staff = await f.AddMemberAsync(ApiFactory.TenantId(me), MemberRole.Staff);
        var loc = await DefaultLocation(c);
        var variant = search["items"]![0]!["variantId"]!.ToString();
        Assert.Equal(HttpStatusCode.OK, (await staff.PostAsJsonAsync("/api/admin/inventory/adjustments",
            new { locationId = loc, reason = "receipt", lines = new[] { new { variantId = variant, delta = 1 } } })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync("/api/admin/locations", new { name = "X", code = "X" })).StatusCode);
    }

    [Fact]
    public async Task Inventory_is_isolated_between_stores()
    {
        var (a, meA, variantA, _) = await StockedAsync(5);
        var (b, _, variantB, _) = await StockedAsync(5);
        var locA = await DefaultLocation(a);
        var locB = await DefaultLocation(b);

        Assert.Equal(HttpStatusCode.BadRequest, (await b.PostAsJsonAsync("/api/admin/inventory/adjustments",
            new { locationId = locB, reason = "lost", lines = new[] { new { variantId = variantA, delta = -5 } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await b.PostAsJsonAsync("/api/admin/inventory/adjustments",
            new { locationId = locA, reason = "receipt", lines = new[] { new { variantId = variantB, delta = 1 } } })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/admin/locations/{locA}")).StatusCode);
        var ledger = await (await b.GetAsync($"/api/admin/inventory/movements?variantId={variantA}")).Json();
        Assert.Empty(ledger["items"]!.AsArray());
        Assert.Equal(5, (await Item(a, variantA))["onHand"]!.GetValue<int>());
        _ = meA;
    }
}

[Collection("api")]
public class CategoryConcurrencyTests(ApiFactory f)
{
    [Fact]
    public async Task Stale_if_match_is_rejected_and_current_one_accepted()
    {
        var (c, _) = await f.NewMerchantAsync();
        var created = await (await c.PostAsJsonAsync("/api/admin/categories", new { name = "Lamps" })).Json();
        var id = created["id"]!.ToString();
        var v1 = created["version"]!.ToString();

        var first = new HttpRequestMessage(HttpMethod.Put, $"/api/admin/categories/{id}") { Content = JsonContent.Create(new { name = "Lamps & Lights" }) };
        first.Headers.IfMatch.Add(new System.Net.Http.Headers.EntityTagHeaderValue($"\"{v1}\""));
        var ok = await c.SendAsync(first);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var v2 = (await ok.Json())["version"]!.ToString();
        Assert.NotEqual(v1, v2);

        var stale = new HttpRequestMessage(HttpMethod.Put, $"/api/admin/categories/{id}") { Content = JsonContent.Create(new { name = "Overwrite" }) };
        stale.Headers.IfMatch.Add(new System.Net.Http.Headers.EntityTagHeaderValue($"\"{v1}\""));
        var conflict = await c.SendAsync(stale);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.EndsWith("/concurrency", (await conflict.Json())["type"]!.ToString());
    }
}
