using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Npgsql;
using ShopMint.Api.Modules;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>Shared set-up: a launched store with one in-stock product.</summary>
public abstract class StorefrontTestBase(ApiFactory f)
{
    protected ApiFactory F { get; } = f;
    protected static string Sku() => "S-" + Guid.NewGuid().ToString("N")[..8];

    protected async Task<(HttpClient Merchant, JsonNode Me, string Host, JsonNode Product)> LiveStoreAsync(int stock = 5, decimal price = 499, decimal mrp = 699)
    {
        var (m, me) = await F.NewMerchantAsync();
        var p = await m.CreateProductAsync(Http.Product("Block-print Kurta", Sku(), price: price, mrp: mrp, stock: stock));
        await F.LaunchAsync(ApiFactory.TenantId(me));
        return (m, me, ApiFactory.Host(me), p);
    }

    protected static string Variant(JsonNode product) => product["variants"]![0]!["id"]!.ToString();

    protected static async Task<HttpClient> SignedUpShopperAsync(ApiFactory f, string host, string? email = null)
    {
        var c = f.Client();
        var res = await c.PostAt(host, "/api/storefront/account/signup",
            new { name = "Meera Shopper", email = email ?? $"shopper-{Guid.NewGuid():N}@example.com", password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return c;
    }
}

[Collection("api")]
public class ShopperAccountTests(ApiFactory f) : StorefrontTestBase(f)
{
    [Fact]
    public async Task Shopper_sessions_are_bound_to_their_store()
    {
        var (_, _, hostA, _) = await LiveStoreAsync();
        var (_, _, hostB, _) = await LiveStoreAsync();
        var shopper = await SignedUpShopperAsync(F, hostA);

        var me = await (await shopper.GetAt(hostA, "/api/storefront/account/me")).Json();
        Assert.Equal("Meera Shopper", me["name"]!.ToString());
        // The same cookie presented on another store's domain is not a session there.
        Assert.Equal(HttpStatusCode.NoContent, (await shopper.GetAt(hostB, "/api/storefront/account/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await shopper.GetAt(hostB, "/api/storefront/account/addresses")).StatusCode);
        // And it never authorises the merchant admin.
        Assert.Equal(HttpStatusCode.Unauthorized, (await shopper.GetAsync("/api/admin/products")).StatusCode);
    }

    [Fact]
    public async Task Merchant_sessions_are_not_shopper_sessions()
    {
        var (merchant, _, host, _) = await LiveStoreAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await merchant.GetAt(host, "/api/storefront/account/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await merchant.GetAt(host, "/api/storefront/account/addresses")).StatusCode);
    }

    [Fact]
    public async Task The_same_email_can_register_at_two_stores_but_only_once_per_store()
    {
        var (_, _, hostA, _) = await LiveStoreAsync();
        var (_, _, hostB, _) = await LiveStoreAsync();
        var email = $"twice-{Guid.NewGuid():N}@example.com";
        await SignedUpShopperAsync(F, hostA, email);
        await SignedUpShopperAsync(F, hostB, email);
        var again = await F.Client().PostAt(hostA, "/api/storefront/account/signup", new { name = "X", email, password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Login_failures_lock_the_account()
    {
        var (_, _, host, _) = await LiveStoreAsync();
        var email = $"lock-{Guid.NewGuid():N}@example.com";
        await SignedUpShopperAsync(F, host, email);
        var c = F.Client();
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await c.PostAt(host, "/api/storefront/account/login", new { email, password = "wrong-password" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PostAt(host, "/api/storefront/account/login", new { email, password = ApiFactory.Password })).StatusCode);
    }

    [Fact]
    public async Task Password_reset_link_uses_the_store_domain_and_signs_out_sessions()
    {
        var (_, _, host, _) = await LiveStoreAsync();
        var email = $"reset-{Guid.NewGuid():N}@example.com";
        var session = await SignedUpShopperAsync(F, host, email);
        var anon = F.Client();
        var known = await anon.PostAt(host, "/api/storefront/account/password/forgot", new { email });
        var unknown = await anon.PostAt(host, "/api/storefront/account/password/forgot", new { email = $"nobody-{Guid.NewGuid():N}@example.com" });
        Assert.Equal(await known.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());

        var mail = await F.LastEmailAsync(email, "customer_password_reset");
        Assert.Contains($"https://{host}/account/reset-password?token=", mail!.TextBody);
        var token = System.Text.RegularExpressions.Regex.Match(mail.TextBody!, "token=([A-Za-z0-9_-]{43})").Groups[1].Value;

        Assert.Equal(HttpStatusCode.NoContent, (await anon.PostAt(host, "/api/storefront/account/password/reset", new { token, password = "Fresh-Shopper-Pw-1" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await session.GetAt(host, "/api/storefront/account/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anon.PostAt(host, "/api/storefront/account/login", new { email, password = "Fresh-Shopper-Pw-1" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.PostAt(host, "/api/storefront/account/password/reset", new { token, password = "Another-Pw-123" })).StatusCode);
    }

    [Fact]
    public async Task Profile_validates_phone_and_records_marketing_consent()
    {
        var (_, _, host, _) = await LiveStoreAsync();
        var c = await SignedUpShopperAsync(F, host);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.At(host, HttpMethod.Patch, "/api/storefront/account/me", new { name = "Meera", phone = "12345", marketingOptIn = false })).StatusCode);
        var ok = await (await c.At(host, HttpMethod.Patch, "/api/storefront/account/me", new { name = "Meera Iyer", phone = "+91 98765 43210", marketingOptIn = true })).Json();
        Assert.Equal("9876543210", ok["phone"]!.ToString());
        Assert.True(ok["marketingOptIn"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Addresses_validate_indian_formats_and_keep_one_default()
    {
        var (_, _, host, _) = await LiveStoreAsync();
        var c = await SignedUpShopperAsync(F, host);
        object Address(string pincode = "411001", string state = "27", string phone = "9876543210", bool isDefault = false) =>
            new { name = "Meera Iyer", phone, line1 = "12 MG Road", line2 = (string?)null, city = "Pune", stateCode = state, pincode, isDefault };

        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAt(host, "/api/storefront/account/addresses", Address(pincode: "011001"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAt(host, "/api/storefront/account/addresses", Address(state: "99"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAt(host, "/api/storefront/account/addresses", Address(phone: "5123456789"))).StatusCode);

        var first = await (await c.PostAt(host, "/api/storefront/account/addresses", Address())).Json();
        Assert.True(first["isDefault"]!.GetValue<bool>());
        Assert.Equal("Maharashtra", first["stateName"]!.ToString());
        var second = await (await c.PostAt(host, "/api/storefront/account/addresses", Address(pincode: "560001", state: "29", isDefault: true))).Json();
        var list = (await (await c.GetAt(host, "/api/storefront/account/addresses")).Json()).AsArray();
        Assert.Equal(second["id"]!.ToString(), list.Single(a => a!["isDefault"]!.GetValue<bool>())!["id"]!.ToString());

        Assert.Equal(HttpStatusCode.NoContent, (await c.At(host, HttpMethod.Delete, $"/api/storefront/account/addresses/{second["id"]}")).StatusCode);
        list = (await (await c.GetAt(host, "/api/storefront/account/addresses")).Json()).AsArray();
        Assert.True(list.Single()!["isDefault"]!.GetValue<bool>());

        // Another shopper of the same store can't touch it.
        var other = await SignedUpShopperAsync(F, host);
        Assert.Equal(HttpStatusCode.NotFound, (await other.At(host, HttpMethod.Delete, $"/api/storefront/account/addresses/{first["id"]}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await F.Client().GetAt(host, "/api/storefront/account/addresses")).StatusCode);
    }

    [Fact]
    public async Task Merchants_see_only_their_own_customers()
    {
        var (a, meA, hostA, _) = await LiveStoreAsync();
        var (b, _, hostB, _) = await LiveStoreAsync();
        var emailA = $"cust-a-{Guid.NewGuid():N}@example.com";
        await SignedUpShopperAsync(F, hostA, emailA);
        await SignedUpShopperAsync(F, hostB);

        var listA = await (await a.GetAsync("/api/admin/customers")).Json();
        Assert.Equal(new[] { emailA }, listA["items"]!.AsArray().Select(c => c!["email"]!.ToString()));
        var listB = await (await b.GetAsync("/api/admin/customers")).Json();
        Assert.DoesNotContain(emailA, listB.ToJsonString());

        // Database layer: store B's app connection can't read store A's customers.
        await using var conn = new NpgsqlConnection(F.AppCs);
        await conn.OpenAsync();
        await using (var set = new NpgsqlCommand("select set_config('app.tenant_id', @t, false)", conn))
        {
            set.Parameters.AddWithValue("t", Guid.NewGuid().ToString());
            await set.ExecuteNonQueryAsync();
        }
        await using var cmd = new NpgsqlCommand("select count(*) from customers where tenant_id = @a", conn);
        cmd.Parameters.AddWithValue("a", ApiFactory.TenantId(meA));
        Assert.Equal(0L, (long)(await cmd.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Accounts_need_a_launched_store()
    {
        var (_, me) = await F.NewMerchantAsync();
        var res = await F.Client().PostAt(ApiFactory.Host(me), "/api/storefront/account/signup",
            new { name = "Early", email = $"early-{Guid.NewGuid():N}@example.com", password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }
}

[Collection("api")]
public class CartTests(ApiFactory f) : StorefrontTestBase(f)
{
    private static async Task<JsonNode> AddAsync(HttpClient c, string host, string variantId, int quantity = 1, HttpStatusCode expect = HttpStatusCode.OK)
    {
        var res = await c.PostAt(host, "/api/storefront/cart/lines", new { variantId, quantity, price = "1.00", unitPrice = 1 });
        Assert.Equal(expect, res.StatusCode);
        return await res.Json();
    }

    [Fact]
    public async Task Cart_prices_come_from_the_catalogue_not_the_client()
    {
        var (merchant, _, host, product) = await LiveStoreAsync(price: 499, mrp: 699);
        var guest = F.Client();
        var cart = await AddAsync(guest, host, Variant(product), 2);
        Assert.Equal("499.00", cart["lines"]![0]!["unitPrice"]!.ToString()); // the "price" sent above is ignored
        Assert.Equal("998.00", cart["subtotal"]!.ToString());
        Assert.Equal("400.00", cart["savings"]!.ToString());
        Assert.Equal(2, cart["itemCount"]!.GetValue<int>());

        // The merchant changes the price: the cart shows the new price.
        var p = await (await merchant.GetAsync($"/api/admin/products/{product["id"]}")).Json();
        var v = p["variants"]![0]!;
        await merchant.PutAsJsonAsync($"/api/admin/products/{product["id"]}", new
        {
            title = p["title"]!.ToString(), status = "active", gstRate = 12, hsnCode = "6204", optionNames = Array.Empty<string>(),
            variants = new[] { new { id = v["id"]!.ToString(), sku = v["sku"]!.ToString(), optionValues = Array.Empty<string>(), price = 449, mrp = 699, stockOnHand = (int?)null } },
        });
        var after = await (await guest.GetAt(host, "/api/storefront/cart")).Json();
        Assert.Equal("898.00", after["subtotal"]!.ToString());
    }

    [Fact]
    public async Task Quantities_are_capped_by_stock_and_per_item_limit()
    {
        var (_, _, host, product) = await LiveStoreAsync(stock: 3);
        var c = F.Client();
        await AddAsync(c, host, Variant(product), 2);
        var tooMany = await c.PostAt(host, "/api/storefront/cart/lines", new { variantId = Variant(product), quantity = 2 });
        Assert.Equal(HttpStatusCode.Conflict, tooMany.StatusCode);
        Assert.Contains("Only 3 available", (await tooMany.Json())["detail"]!.ToString());
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAt(host, "/api/storefront/cart/lines", new { variantId = Variant(product), quantity = 11 })).StatusCode);

        var (_, _, bigHost, big) = await LiveStoreAsync(stock: 50);
        await AddAsync(c, bigHost, Variant(big), 10);
        var over = await c.PostAt(bigHost, "/api/storefront/cart/lines", new { variantId = Variant(big), quantity = 1 });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, over.StatusCode);
    }

    [Fact]
    public async Task Unsellable_and_foreign_items_cannot_be_added()
    {
        var (merchant, _, host, _) = await LiveStoreAsync();
        var draft = await merchant.CreateProductAsync(Http.Product("Draft", Sku(), status: "draft"));
        var (_, _, _, foreign) = await LiveStoreAsync();
        var c = F.Client();
        await AddAsync(c, host, Variant(draft), 1, HttpStatusCode.BadRequest);
        await AddAsync(c, host, Variant(foreign), 1, HttpStatusCode.BadRequest);
        await AddAsync(c, host, Guid.NewGuid().ToString(), 1, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Lines_report_stock_changes_after_they_were_added()
    {
        var (merchant, _, host, product) = await LiveStoreAsync(stock: 5);
        var c = F.Client();
        await AddAsync(c, host, Variant(product), 4);
        var loc = (await (await merchant.GetAsync("/api/admin/locations")).Json())["locations"]![0]!["id"]!.ToString();
        await merchant.PostAsJsonAsync("/api/admin/inventory/adjustments", new { locationId = loc, reason = "damaged", lines = new[] { new { variantId = Variant(product), delta = -3 } } });

        var cart = await (await c.GetAt(host, "/api/storefront/cart")).Json();
        var line = cart["lines"]![0]!;
        Assert.Equal("limited", line["status"]!.ToString());
        Assert.Equal(2, line["maxQuantity"]!.GetValue<int>());
        Assert.Equal("998.00", cart["subtotal"]!.ToString()); // only the 2 available count
        Assert.True(cart["hasIssues"]!.GetValue<bool>());

        // Lowering the quantity resolves it; raising it beyond stock is refused.
        var fixedCart = await (await c.At(host, HttpMethod.Patch, $"/api/storefront/cart/lines/{line["id"]}", new { quantity = 2 })).Json();
        Assert.Equal("ok", fixedCart["lines"]![0]!["status"]!.ToString());
        Assert.Equal(HttpStatusCode.Conflict, (await c.At(host, HttpMethod.Patch, $"/api/storefront/cart/lines/{line["id"]}", new { quantity = 3 })).StatusCode);

        await merchant.PostAsync($"/api/admin/products/{product["id"]}/archive", null);
        var archived = await (await c.GetAt(host, "/api/storefront/cart")).Json();
        Assert.Equal("unavailable", archived["lines"]![0]!["status"]!.ToString());
        Assert.Equal("0.00", archived["subtotal"]!.ToString());

        var removed = await (await c.At(host, HttpMethod.Delete, $"/api/storefront/cart/lines/{line["id"]}")).Json();
        Assert.Empty(removed["lines"]!.AsArray());
    }

    [Fact]
    public async Task Guest_cart_merges_on_sign_in_and_follows_the_shopper_across_devices()
    {
        var (_, _, host, product) = await LiveStoreAsync(stock: 10);
        var email = $"devices-{Guid.NewGuid():N}@example.com";

        // Phone: signs up, adds 1.
        var phone = await SignedUpShopperAsync(F, host, email);
        await AddAsync(phone, host, Variant(product), 1);

        // Laptop: browses as a guest, adds 2, then signs in. The carts combine.
        var laptop = F.Client();
        await AddAsync(laptop, host, Variant(product), 2);
        var login = await laptop.PostAt(host, "/api/storefront/account/login", new { email, password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var merged = await (await laptop.GetAt(host, "/api/storefront/cart")).Json();
        Assert.Equal(3, merged["lines"]![0]!["quantity"]!.GetValue<int>());

        // Back on the phone the same cart appears.
        var onPhone = await (await phone.GetAt(host, "/api/storefront/cart")).Json();
        Assert.Equal(3, onPhone["lines"]![0]!["quantity"]!.GetValue<int>());

        // After signing out, the laptop has no cart (the guest cart was absorbed).
        await laptop.PostAt(host, "/api/storefront/account/logout");
        Assert.Empty((await (await laptop.GetAt(host, "/api/storefront/cart")).Json())["lines"]!.AsArray());
    }

    [Fact]
    public async Task Carts_are_isolated_between_stores_and_shoppers()
    {
        var (_, _, hostA, productA) = await LiveStoreAsync();
        var (_, meB, hostB, _) = await LiveStoreAsync();
        var c = F.Client();
        var cartA = await AddAsync(c, hostA, Variant(productA), 1);
        // Same cookie on store B: an empty cart there.
        Assert.Empty((await (await c.GetAt(hostB, "/api/storefront/cart")).Json())["lines"]!.AsArray());
        Assert.Equal(HttpStatusCode.NotFound, (await c.At(hostB, HttpMethod.Patch, $"/api/storefront/cart/lines/{cartA["lines"]![0]!["id"]}", new { quantity = 1 })).StatusCode);
        // Another guest can't reach the line either.
        Assert.Equal(HttpStatusCode.NotFound, (await F.Client().At(hostA, HttpMethod.Delete, $"/api/storefront/cart/lines/{cartA["lines"]![0]!["id"]}")).StatusCode);

        await using var conn = new NpgsqlConnection(F.AppCs);
        await conn.OpenAsync();
        await using (var set = new NpgsqlCommand("select set_config('app.tenant_id', @t, false)", conn))
        {
            set.Parameters.AddWithValue("t", ApiFactory.TenantId(meB).ToString());
            await set.ExecuteNonQueryAsync();
        }
        await using var cmd = new NpgsqlCommand("select count(*) from cart_lines where id = @id", conn);
        cmd.Parameters.AddWithValue("id", Guid.Parse(cartA["lines"]![0]!["id"]!.ToString()));
        Assert.Equal(0L, (long)(await cmd.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Guest_cart_cookie_is_hardened()
    {
        var (_, _, host, product) = await LiveStoreAsync();
        var c = F.CreateClient(new() { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
        c.DefaultRequestHeaders.Add("X-ShopMint-Csrf", "1");
        var res = await c.PostAt(host, "/api/storefront/cart/lines", new { variantId = Variant(product), quantity = 1 });
        var cookie = res.Headers.GetValues("Set-Cookie").Single(h => h.StartsWith("__Host-sm_cart=", StringComparison.Ordinal)).ToLowerInvariant();
        Assert.Contains("httponly", cookie);
        Assert.Contains("secure", cookie);
        Assert.Contains("samesite=lax", cookie);
    }
}

[Collection("api")]
public class StorefrontSeoAndRevalidationTests(ApiFactory f) : StorefrontTestBase(f)
{
    [Fact]
    public async Task Sitemap_lists_only_sellable_products()
    {
        var (merchant, _, host, product) = await LiveStoreAsync();
        await merchant.CreateProductAsync(Http.Product("Hidden draft", Sku(), status: "draft"));
        var map = await (await F.Client().GetAt(host, "/api/storefront/sitemap")).Json();
        Assert.Equal(new[] { product["slug"]!.ToString() }, map["products"]!.AsArray().Select(p => p!["slug"]!.ToString()));
    }

    [Fact]
    public async Task Admin_changes_refresh_the_storefront_but_failed_requests_do_not()
    {
        var (merchant, me) = await F.NewMerchantAsync();
        var tid = ApiFactory.TenantId(me);
        var before = F.Revalidator.Count(tid);
        await merchant.CreateProductAsync(Http.Product("Fresh", Sku()));
        Assert.True(F.Revalidator.Count(tid) > before);

        var mid = F.Revalidator.Count(tid);
        var bad = await merchant.PostAsJsonAsync("/api/admin/products", new { title = "" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        await merchant.GetAsync("/api/admin/products");
        Assert.Equal(mid, F.Revalidator.Count(tid));

        var admin = await F.AddMemberAsync(Guid.Empty, MemberRole.Owner, platformAdmin: true);
        await admin.PostAsJsonAsync($"/api/platform/tenants/{tid}/suspend", new { reason = "test" });
        Assert.True(F.Revalidator.Count(tid) > mid);
    }
}
