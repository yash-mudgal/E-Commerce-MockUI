using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Catalog;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class MediaTests(ApiFactory f)
{
    private static string Sku() => "M-" + Guid.NewGuid().ToString("N")[..8];

    private async Task<(HttpClient Client, JsonNode Me, string ProductId)> ProductAsync()
    {
        var (c, me) = await f.NewMerchantAsync();
        var p = await c.CreateProductAsync(Http.Product("Pictured Kurta", Sku()));
        return (c, me, p["id"]!.ToString());
    }

    private static async Task<JsonNode> StartAsync(HttpClient c, string productId, string type = "image/png", long size = 1000)
    {
        var res = await c.PostAsJsonAsync($"/api/admin/products/{productId}/media/uploads", new { contentType = type, sizeBytes = size, fileName = "photo" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return await res.Json();
    }

    /// <summary>Start, "upload" the bytes to storage, complete. Returns the completion response.</summary>
    private async Task<HttpResponseMessage> UploadAsync(HttpClient c, string productId, byte[] bytes, string type = "image/png")
    {
        var ticket = await StartAsync(c, productId, type, bytes.Length);
        f.Storage.Put(InMemoryObjectStorage.KeyFromUploadUrl(ticket["uploadUrl"]!.ToString()), bytes, type);
        return await c.PostAsync($"/api/admin/products/{productId}/media/{ticket["mediaId"]}/complete", null);
    }

    [Fact]
    public async Task Upload_flow_shows_the_image_in_admin_and_on_the_storefront()
    {
        var (c, me, pid) = await ProductAsync();
        var ticket = await StartAsync(c, pid);
        Assert.Equal("PUT", ticket["method"]!.ToString());
        Assert.Equal("image/png", ticket["headers"]!["Content-Type"]!.ToString());
        var key = InMemoryObjectStorage.KeyFromUploadUrl(ticket["uploadUrl"]!.ToString());
        Assert.StartsWith($"t/{ApiFactory.TenantId(me):N}/p/", key);

        // Not shown until completed.
        Assert.Empty((await (await c.GetAsync($"/api/admin/products/{pid}")).Json())["media"]!.AsArray());
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsync($"/api/admin/products/{pid}/media/{ticket["mediaId"]}/complete", null)).StatusCode);

        f.Storage.Put(key, InMemoryObjectStorage.Png, "image/png");
        var done = await c.PostAsync($"/api/admin/products/{pid}/media/{ticket["mediaId"]}/complete", null);
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);
        var url = (await done.Json())["url"]!.ToString();
        Assert.Equal($"{InMemoryObjectStorage.Host}/media/{key}", url);

        var product = await (await c.GetAsync($"/api/admin/products/{pid}")).Json();
        Assert.Equal(url, product["media"]![0]!["url"]!.ToString());
        var list = await (await c.GetAsync("/api/admin/products")).Json();
        Assert.Equal(url, list["items"]![0]!["thumbnailUrl"]!.ToString());

        await f.LaunchAsync(ApiFactory.TenantId(me));
        var anon = f.Client();
        var card = await (await anon.SendAsync(StorefrontGet(me, "/api/storefront/products"))).Json();
        Assert.Equal(url, card["items"]![0]!["image"]!["url"]!.ToString());
        var pdp = await (await anon.SendAsync(StorefrontGet(me, $"/api/storefront/products/{product["slug"]}"))).Json();
        Assert.Equal(url, pdp["images"]![0]!["url"]!.ToString());
    }

    private static HttpRequestMessage StorefrontGet(JsonNode me, string path)
    {
        var r = new HttpRequestMessage(HttpMethod.Get, path);
        r.Headers.Host = ApiFactory.Host(me);
        return r;
    }

    [Theory]
    [InlineData("image/svg+xml", 1000)]
    [InlineData("application/pdf", 1000)]
    [InlineData("image/png", 6 * 1024 * 1024)]
    [InlineData("image/png", 0)]
    public async Task Disallowed_types_and_sizes_are_refused_before_upload(string type, long size)
    {
        var (c, _, pid) = await ProductAsync();
        var res = await c.PostAsJsonAsync($"/api/admin/products/{pid}/media/uploads", new { contentType = type, sizeBytes = size });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Stored_bytes_are_checked_and_bad_files_are_deleted()
    {
        var (c, _, pid) = await ProductAsync();

        var ticket = await StartAsync(c, pid, "image/png");
        var key = InMemoryObjectStorage.KeyFromUploadUrl(ticket["uploadUrl"]!.ToString());
        f.Storage.Put(key, "<svg onload=alert(1)>"u8.ToArray(), "image/png"); // lies about its type
        var res = await c.PostAsync($"/api/admin/products/{pid}/media/{ticket["mediaId"]}/complete", null);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.EndsWith("/invalid-media", (await res.Json())["type"]!.ToString());
        Assert.False(f.Storage.Exists(key));
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsync($"/api/admin/products/{pid}/media/{ticket["mediaId"]}/complete", null)).StatusCode);

        // A real JPEG declared as PNG is refused too (the stored content type would be wrong).
        var mismatch = await UploadAsync(c, pid, InMemoryObjectStorage.Jpeg, "image/png");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, mismatch.StatusCode);

        // Bigger than declared and over the limit.
        var big = await StartAsync(c, pid, "image/png", 1000);
        var bigKey = InMemoryObjectStorage.KeyFromUploadUrl(big["uploadUrl"]!.ToString());
        f.Storage.Put(bigKey, [.. InMemoryObjectStorage.Png, .. new byte[MediaRules.MaxBytes]], "image/png");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await c.PostAsync($"/api/admin/products/{pid}/media/{big["mediaId"]}/complete", null)).StatusCode);
        Assert.False(f.Storage.Exists(bigKey));
    }

    [Fact]
    public async Task A_product_holds_at_most_ten_images_including_uploads_in_progress()
    {
        var (c, _, pid) = await ProductAsync();
        for (var i = 0; i < MediaRules.MaxPerProduct; i++) await StartAsync(c, pid);
        var res = await c.PostAsJsonAsync($"/api/admin/products/{pid}/media/uploads", new { contentType = "image/png", sizeBytes = 100 });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
    }

    [Fact]
    public async Task Alt_text_order_and_deletion()
    {
        var (c, _, pid) = await ProductAsync();
        var a = await (await UploadAsync(c, pid, InMemoryObjectStorage.Png)).Json();
        var b = await (await UploadAsync(c, pid, InMemoryObjectStorage.Jpeg, "image/jpeg")).Json();
        Assert.Equal(0, a["position"]!.GetValue<int>());
        Assert.Equal(1, b["position"]!.GetValue<int>());

        var alt = await c.PatchAsJsonAsync($"/api/admin/products/{pid}/media/{a["id"]}", new { altText = "  Indigo kurta, front view " });
        Assert.Equal("Indigo kurta, front view", (await alt.Json())["altText"]!.ToString());

        var reorder = await c.PutAsJsonAsync($"/api/admin/products/{pid}/media/order", new { mediaIds = new[] { b["id"]!.ToString(), a["id"]!.ToString() } });
        Assert.Equal(HttpStatusCode.OK, reorder.StatusCode);
        var media = (await (await c.GetAsync($"/api/admin/products/{pid}")).Json())["media"]!.AsArray();
        Assert.Equal(b["id"]!.ToString(), media[0]!["id"]!.ToString());
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PutAsJsonAsync($"/api/admin/products/{pid}/media/order", new { mediaIds = new[] { a["id"]!.ToString() } })).StatusCode);

        var bKey = b["url"]!.ToString()[(InMemoryObjectStorage.Host + "/media/").Length..];
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/admin/products/{pid}/media/{b["id"]}")).StatusCode);
        Assert.False(f.Storage.Exists(bKey));

        var aKey = a["url"]!.ToString()[(InMemoryObjectStorage.Host + "/media/").Length..];
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/admin/products/{pid}")).StatusCode);
        Assert.False(f.Storage.Exists(aKey)); // deleting the product removes its files
    }

    [Fact]
    public async Task Media_is_isolated_between_stores()
    {
        var (a, meA, pid) = await ProductAsync();
        var (b, meB) = await f.NewMerchantAsync();
        var img = await (await UploadAsync(a, pid, InMemoryObjectStorage.Png)).Json();

        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync($"/api/admin/products/{pid}/media/uploads", new { contentType = "image/png", sizeBytes = 100 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/admin/products/{pid}/media/{img["id"]}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PatchAsJsonAsync($"/api/admin/products/{pid}/media/{img["id"]}", new { altText = "x" })).StatusCode);

        await using var conn = new NpgsqlConnection(f.AppCs);
        await conn.OpenAsync();
        await using (var set = new NpgsqlCommand("select set_config('app.tenant_id', @t, false)", conn))
        {
            set.Parameters.AddWithValue("t", ApiFactory.TenantId(meB).ToString());
            await set.ExecuteNonQueryAsync();
        }
        await using var cmd = new NpgsqlCommand("select count(*) from product_media where tenant_id = @a", conn);
        cmd.Parameters.AddWithValue("a", ApiFactory.TenantId(meA));
        Assert.Equal(0L, (long)(await cmd.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Staff_can_upload_and_anonymous_callers_cannot()
    {
        var (_, me, pid) = await ProductAsync();
        var staff = await f.AddMemberAsync(ApiFactory.TenantId(me), ShopMint.Api.Modules.MemberRole.Staff);
        Assert.Equal(HttpStatusCode.Created, (await staff.PostAsJsonAsync($"/api/admin/products/{pid}/media/uploads", new { contentType = "image/webp", sizeBytes = 100 })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Client().PostAsJsonAsync($"/api/admin/products/{pid}/media/uploads", new { contentType = "image/webp", sizeBytes = 100 })).StatusCode);
    }

    [Fact]
    public async Task Abandoned_uploads_are_swept()
    {
        var (c, _, pid) = await ProductAsync();
        var ticket = await StartAsync(c, pid);
        var key = InMemoryObjectStorage.KeyFromUploadUrl(ticket["uploadUrl"]!.ToString());
        f.Storage.Put(key, InMemoryObjectStorage.Png, "image/png"); // uploaded but never completed

        await using (var conn = new NpgsqlConnection(f.PlatformCs))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("update product_media set created_at = now() - interval '2 hours' where id = @id", conn);
            cmd.Parameters.AddWithValue("id", Guid.Parse(ticket["mediaId"]!.ToString()));
            Assert.Equal(1, await cmd.ExecuteNonQueryAsync());
        }
        await using var scope = f.Services.CreateAsyncScope();
        var swept = await MediaJanitor.SweepAsync(scope.ServiceProvider.GetRequiredService<PlatformDbContext>(), f.Storage, NullLogger.Instance, default);
        Assert.True(swept >= 1);
        Assert.False(f.Storage.Exists(key));
    }
}
