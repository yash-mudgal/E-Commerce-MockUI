using System.Net;
using System.Net.Http.Json;
using Npgsql;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>Merge-blocking: tenant B must never observe or modify tenant A's data through the API.</summary>
[Collection("api")]
public class TenantIsolationTests(ApiFactory f)
{
    [Fact]
    public async Task Other_tenants_products_are_invisible_and_immutable()
    {
        var (a, _) = await f.NewMerchantAsync();
        var (b, _) = await f.NewMerchantAsync();
        var p = await a.CreateProductAsync(Http.Product("A's secret kurta", "A-" + Guid.NewGuid().ToString("N")[..6]));
        var id = p["id"]!.ToString();

        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/admin/products/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PutAsJsonAsync($"/api/admin/products/{id}", Http.Product("Hijacked", "H-1"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsync($"/api/admin/products/{id}/archive", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/admin/products/{id}")).StatusCode);
        Assert.Equal(0, (await (await b.GetAsync("/api/admin/products?q=secret")).Json())["totalCount"]!.GetValue<int>());
        Assert.Equal(0, (await (await b.GetAsync("/api/admin/dashboard/summary")).Json())["catalog"]!["products"]!.GetValue<int>());

        // A still sees its product unchanged.
        var still = await (await a.GetAsync($"/api/admin/products/{id}")).Json();
        Assert.Equal("A's secret kurta", still["title"]!.ToString());
        Assert.Equal("active", still["status"]!.ToString());
    }

    [Fact]
    public async Task Other_tenants_categories_cannot_be_read_used_or_modified()
    {
        var (a, _) = await f.NewMerchantAsync();
        var (b, _) = await f.NewMerchantAsync();
        var cat = await (await a.PostAsJsonAsync("/api/admin/categories", new { name = "A only" })).Json();
        var cid = cat["id"]!.ToString();

        Assert.Empty((await (await b.GetAsync("/api/admin/categories")).Json()).AsArray());
        Assert.Equal(HttpStatusCode.NotFound, (await b.PutAsJsonAsync($"/api/admin/categories/{cid}", new { name = "Mine now" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/admin/categories/{cid}")).StatusCode);
        // Using another tenant's category id as a foreign key must fail.
        var res = await b.PostAsJsonAsync("/api/admin/products", Http.Product("X", "X-" + Guid.NewGuid().ToString("N")[..6], categoryId: Guid.Parse(cid)));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var sub = await b.PostAsJsonAsync("/api/admin/categories", new { name = "Child", parentId = cid });
        Assert.Equal(HttpStatusCode.BadRequest, sub.StatusCode);
    }

    [Fact]
    public async Task Variant_ids_from_another_tenant_cannot_be_attached()
    {
        var (a, _) = await f.NewMerchantAsync();
        var (b, _) = await f.NewMerchantAsync();
        var pa = await a.CreateProductAsync(Http.Product("A", "A-" + Guid.NewGuid().ToString("N")[..6]));
        var pb = await b.CreateProductAsync(Http.Product("B", "B-" + Guid.NewGuid().ToString("N")[..6]));
        var foreignVariant = pa["variants"]![0]!["id"]!.ToString();
        var res = await b.PutAsJsonAsync($"/api/admin/products/{pb["id"]}", new
        {
            title = "B", status = "active", gstRate = 12,
            variants = new[] { new { id = foreignVariant, sku = "STEAL", price = 1m, mrp = 1m, stockOnHand = 0 } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var still = await (await a.GetAsync($"/api/admin/products/{pa["id"]}")).Json();
        Assert.Equal("499.00", still["variants"]![0]!["price"]!.ToString());
    }

    [Fact]
    public async Task Store_settings_are_per_tenant()
    {
        var (a, meA) = await f.NewMerchantAsync();
        var (b, _) = await f.NewMerchantAsync();
        await b.PatchAsJsonAsync("/api/admin/store", new { name = "B renamed", brandColor = "#0f766e", lowStockThreshold = 3 });
        var storeA = await (await a.GetAsync("/api/admin/store")).Json();
        Assert.Equal(meA["tenant"]!["name"]!.ToString(), storeA["name"]!.ToString());
    }
}

/// <summary>
/// Layer 2: PostgreSQL row-level security, tested with raw SQL as the application role. This bypasses EF, so
/// it proves isolation holds even if application code forgets a filter.
/// </summary>
[Collection("api")]
public class RowLevelSecurityTests(ApiFactory f)
{
    private async Task<NpgsqlConnection> AppConn(Guid? tenant)
    {
        var c = new NpgsqlConnection(f.AppCs);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand("select set_config('app.tenant_id', @t, false)", c);
        cmd.Parameters.AddWithValue("t", tenant?.ToString() ?? "");
        await cmd.ExecuteNonQueryAsync();
        return c;
    }

    private static async Task<long> Count(NpgsqlConnection c, string sql, Guid? param = null)
    {
        await using var cmd = new NpgsqlCommand(sql, c);
        if (param is { } p) cmd.Parameters.AddWithValue("id", p);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    [Fact]
    public async Task App_role_sees_nothing_without_tenant_and_only_own_rows_with_tenant()
    {
        var (a, meA) = await f.NewMerchantAsync();
        var (_, meB) = await f.NewMerchantAsync();
        await a.CreateProductAsync(Http.Product("RLS probe", "RLS-" + Guid.NewGuid().ToString("N")[..6]));
        var ta = ApiFactory.TenantId(meA);

        await using (var none = await AppConn(null))
        {
            Assert.Equal(0, await Count(none, "select count(*) from products"));
            Assert.Equal(0, await Count(none, "select count(*) from product_variants"));
            Assert.Equal(0, await Count(none, "select count(*) from tenants"));
        }
        await using (var asB = await AppConn(ApiFactory.TenantId(meB)))
        {
            Assert.Equal(0, await Count(asB, "select count(*) from products where tenant_id = @id", ta));
            Assert.Equal(0, await Count(asB, "select count(*) from stock_levels where tenant_id = @id", ta));
            Assert.Equal(0, await Count(asB, "select count(*) from audit_log where tenant_id = @id", ta));
            Assert.Equal(0, await Count(asB, "select count(*) from tenants where id = @id", ta));
        }
        await using (var asA = await AppConn(ta))
            Assert.Equal(1, await Count(asA, "select count(*) from products"));
    }

    [Fact]
    public async Task App_role_cannot_write_rows_for_another_tenant()
    {
        var (_, meA) = await f.NewMerchantAsync();
        var (_, meB) = await f.NewMerchantAsync();
        await using var asB = await AppConn(ApiFactory.TenantId(meB));
        await using var cmd = new NpgsqlCommand(
            "insert into categories (id, tenant_id, name, slug, position, created_at, updated_at) values (gen_random_uuid(), @t, 'x', 'x', 0, now(), now())", asB);
        cmd.Parameters.AddWithValue("t", ApiFactory.TenantId(meA));
        var ex = await Assert.ThrowsAsync<PostgresException>(() => cmd.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState); // RLS WITH CHECK violation
    }

    [Fact]
    public async Task Audit_log_is_append_only_for_the_app_role()
    {
        var (_, me) = await f.NewMerchantAsync();
        await using var c = await AppConn(ApiFactory.TenantId(me));
        await using var cmd = new NpgsqlCommand("update audit_log set action = 'tampered'", c);
        var ex = await Assert.ThrowsAsync<PostgresException>(() => cmd.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
    }

    [Fact]
    public async Task Every_table_with_tenant_id_has_forced_rls()
    {
        await using var c = new NpgsqlConnection(f.OwnerCs);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand("""
            select cl.relname, cl.relrowsecurity, cl.relforcerowsecurity
            from information_schema.columns col
            join pg_class cl on cl.relname = col.table_name and cl.relkind = 'r'
            join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
            where col.table_schema = 'public' and col.column_name = 'tenant_id'
            """, c);
        var tables = new List<string>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            tables.Add(r.GetString(0));
            Assert.True(r.GetBoolean(1) && r.GetBoolean(2), $"Table {r.GetString(0)} has a tenant_id column but RLS is not enabled and forced.");
        }
        Assert.Superset(RlsSql.TenantTables.ToHashSet(), tables.ToHashSet());
    }

    [Fact]
    public async Task App_role_is_not_owner_and_cannot_bypass_rls()
    {
        await using var c = new NpgsqlConnection(f.AppCs);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand("select rolbypassrls or rolsuper from pg_roles where rolname = current_user", c);
        Assert.False((bool)(await cmd.ExecuteScalarAsync())!);
    }
}

[Collection("api")]
public class StorefrontTests(ApiFactory f)
{
    private static HttpRequestMessage Get(string host, string path)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, path);
        req.Headers.Host = host;
        return req;
    }

    [Fact]
    public async Task Storefront_is_resolved_by_host_and_shows_only_active_products()
    {
        var (a, meA) = await f.NewMerchantAsync();
        var (b, meB) = await f.NewMerchantAsync();
        await a.CreateProductAsync(Http.Product("Visible Saree", "V-" + Guid.NewGuid().ToString("N")[..6]));
        await a.CreateProductAsync(Http.Product("Hidden Draft", "D-" + Guid.NewGuid().ToString("N")[..6], status: "draft"));
        var bp = await b.CreateProductAsync(Http.Product("B Product", "B-" + Guid.NewGuid().ToString("N")[..6]));
        await f.LaunchAsync(ApiFactory.TenantId(meA));
        await f.LaunchAsync(ApiFactory.TenantId(meB));
        var anon = f.Client();

        var list = await (await anon.SendAsync(Get(ApiFactory.Host(meA), "/api/storefront/products"))).Json();
        Assert.Equal(new[] { "Visible Saree" }, list["items"]!.AsArray().Select(i => i!["title"]!.ToString()));

        var cross = await anon.SendAsync(Get(ApiFactory.Host(meA), $"/api/storefront/products/{bp["slug"]}"));
        Assert.Equal(HttpStatusCode.NotFound, cross.StatusCode);
        var own = await anon.SendAsync(Get(ApiFactory.Host(meB), $"/api/storefront/products/{bp["slug"]}"));
        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        var detail = await own.Json();
        Assert.Null(detail["variants"]![0]!["stockOnHand"]); // exact stock is not exposed publicly
        Assert.True(detail["variants"]![0]!["available"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Merchant_session_cannot_change_which_store_is_served()
    {
        var (a, meA) = await f.NewMerchantAsync();
        var (b, meB) = await f.NewMerchantAsync();
        await b.CreateProductAsync(Http.Product("Only in B", "OB-" + Guid.NewGuid().ToString("N")[..6]));
        await f.LaunchAsync(ApiFactory.TenantId(meB));
        // A's authenticated client browsing B's storefront gets B's catalogue (host wins), never A's.
        var res = await (await a.SendAsync(Get(ApiFactory.Host(meB), "/api/storefront/products"))).Json();
        Assert.Equal("Only in B", res["items"]![0]!["title"]!.ToString());
        _ = meA;
    }

    [Fact]
    public async Task Unknown_host_is_404()
    {
        var res = await f.Client().SendAsync(Get("nope." + ApiFactory.StoreDomain, "/api/storefront/store"));
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Storefront_filters_and_sorts()
    {
        var (a, meA) = await f.NewMerchantAsync();
        await a.CreateProductAsync(Http.Product("Cheap Tea", "T1-" + Guid.NewGuid().ToString("N")[..6], price: 100, mrp: 150));
        await a.CreateProductAsync(Http.Product("Fancy Tea", "T2-" + Guid.NewGuid().ToString("N")[..6], price: 900, mrp: 999));
        await a.CreateProductAsync(Http.Product("Sold Out Tea", "T3-" + Guid.NewGuid().ToString("N")[..6], price: 300, mrp: 300, stock: 0));
        await f.LaunchAsync(ApiFactory.TenantId(meA));
        var anon = f.Client();
        var host = ApiFactory.Host(meA);
        var desc = await (await anon.SendAsync(Get(host, "/api/storefront/products?sort=price_desc"))).Json();
        Assert.Equal("Fancy Tea", desc["items"]![0]!["title"]!.ToString());
        var inStock = await (await anon.SendAsync(Get(host, "/api/storefront/products?inStock=true"))).Json();
        Assert.Equal(2, inStock["totalCount"]!.GetValue<int>());
        var band = await (await anon.SendAsync(Get(host, "/api/storefront/products?minPrice=200&maxPrice=500"))).Json();
        Assert.Equal("Sold Out Tea", band["items"]![0]!["title"]!.ToString());
    }
}

[Collection("api")]
public class PlatformTests(ApiFactory f)
{
    [Fact]
    public async Task Merchants_cannot_use_platform_endpoints()
    {
        var (c, _) = await f.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync("/api/platform/tenants")).StatusCode);
    }

    [Fact]
    public async Task Suspension_blocks_storefront_and_admin_writes_but_keeps_admin_reads()
    {
        var (merchant, me) = await f.NewMerchantAsync();
        var p = await merchant.CreateProductAsync(Http.Product("Before suspension", "BS-" + Guid.NewGuid().ToString("N")[..6]));
        var admin = await f.AddMemberAsync(Guid.Empty, MemberRole.Owner, platformAdmin: true);
        var tid = ApiFactory.TenantId(me);

        var list = await (await admin.GetAsync($"/api/platform/tenants?q={me["tenant"]!["slug"]}")).Json();
        Assert.Equal(1, list["totalCount"]!.GetValue<int>());
        Assert.Equal(1, list["items"]![0]!["products"]!.GetValue<int>());

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/platform/tenants/{tid}/suspend", new { reason = "test" })).StatusCode);

        var store = new HttpRequestMessage(HttpMethod.Get, "/api/storefront/store");
        store.Headers.Host = ApiFactory.Host(me);
        Assert.Equal(HttpStatusCode.NotFound, (await f.Client().SendAsync(store)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await merchant.GetAsync($"/api/admin/products/{p["id"]}")).StatusCode);
        var write = await merchant.PostAsJsonAsync("/api/admin/products", Http.Product("After", "AS-" + Guid.NewGuid().ToString("N")[..6]));
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
        Assert.EndsWith("/tenant-suspended", (await write.Json())["type"]!.ToString());

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/platform/tenants/{tid}/reactivate", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await merchant.PostAsJsonAsync("/api/admin/products", Http.Product("After", "AR-" + Guid.NewGuid().ToString("N")[..6]))).StatusCode);
    }
}
