using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Modules.Platform;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

/// <summary>The database is shared by the whole suite, so these tests compare metrics before and after known changes.</summary>
[Collection("api")]
public class PlatformMetricsTests(ApiFactory f) : CheckoutTestBase(f)
{
    private static decimal D(JsonNode? n) => decimal.Parse(n!.ToString(), CultureInfo.InvariantCulture);
    private static int I(JsonNode? n) => n!.GetValue<int>();

    private async Task<HttpClient> AdminAsync()
    {
        var (_, me) = await F.NewMerchantAsync();
        return await F.AddMemberAsync(ApiFactory.TenantId(me), MemberRole.Staff, platformAdmin: true);
    }

    private static async Task<JsonNode> MetricsAsync(HttpClient admin, string query = "")
    {
        var res = await admin.GetAsync($"/api/platform/metrics{query}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Json();
    }

    private async Task ExecAsync(Func<PlatformDbContext, Task> work)
    {
        await using var scope = F.Services.CreateAsyncScope();
        await work(scope.ServiceProvider.GetRequiredService<PlatformDbContext>());
    }

    [Fact]
    public async Task A_new_store_moves_through_the_funnel_and_its_orders_count_like_the_sales_report()
    {
        var admin = await AdminAsync();
        var before = await MetricsAsync(admin);

        var shop = await ShopAsync(stock: 20, price: 300);           // signed up, product added, launched (still trialing)
        var paid = await PlacedAsync(await ShopperAsync(shop.Host, Variant(shop.Product), 2), shop.Host, "cod");
        var cancelled = await PlacedAsync(await ShopperAsync(shop.Host, Variant(shop.Product), 1), shop.Host, "cod");
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{cancelled["orderId"]}/cancel", new { reason = "Test" })).StatusCode);
        await PlacedAsync(await ShopperAsync(shop.Host, Variant(shop.Product), 1), shop.Host, "online"); // unpaid: not a sale

        var after = await MetricsAsync(admin);
        int Delta(params string[] path)
        {
            JsonNode? a = after, b = before;
            foreach (var p in path) { a = a![p]; b = b![p]; }
            return I(a) - I(b);
        }
        Assert.Equal(1, Delta("funnel", "signedUp"));
        Assert.Equal(1, Delta("funnel", "addedProduct"));
        Assert.Equal(1, Delta("funnel", "launched"));
        Assert.Equal(1, Delta("funnel", "firstOrder"));
        Assert.Equal(0, Delta("funnel", "onPaidPlan"));
        Assert.Equal(1, Delta("stores", "total"));
        Assert.Equal(1, Delta("stores", "trialing"));
        Assert.Equal(1, Delta("commerce", "orders"));                 // only the confirmed, uncancelled order
        Assert.Equal(1, Delta("commerce", "storesWithOrders"));

        // Net sales grow by exactly that order's total, and match the store's own sales report.
        var order = await (await shop.Merchant.GetAsync($"/api/admin/orders/{paid["orderId"]}")).Json();
        Assert.Equal(D(order["total"]), D(after["commerce"]!["netSales"]) - D(before["commerce"]!["netSales"]));
        var report = await (await shop.Merchant.GetAsync("/api/admin/reports/sales")).Json();
        Assert.Equal(D(report["totals"]!["netSales"]), D(order["total"]));

        // This week's bucket carries the new signup, launch and order.
        var weekOf = (JsonNode n) => n["weeks"]!.AsArray().Single(w => w!["weekStart"]!.ToString() == PlatformMetrics.Monday(DateOnly.FromDateTime(DateTime.UtcNow.AddMinutes(330))).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))!;
        Assert.Equal(1, I(weekOf(after)["signups"]) - I(weekOf(before)["signups"]));
        Assert.Equal(1, I(weekOf(after)["orders"]) - I(weekOf(before)["orders"]));
    }

    [Fact]
    public async Task Recurring_revenue_counts_active_paid_plans_and_shows_past_due_as_at_risk()
    {
        var admin = await AdminAsync();
        var shop = await ShopAsync();
        var tid = ApiFactory.TenantId(shop.Me);
        var before = await MetricsAsync(admin);

        decimal price = 0;
        await ExecAsync(async db => price = (await db.Plans.SingleAsync(p => p.Code == "basic")).MonthlyPrice);
        Assert.True(price > 0);
        Assert.True((await admin.PostAsJsonAsync($"/api/platform/tenants/{tid}/plan", new { planCode = "basic", note = "Contract" })).IsSuccessStatusCode);

        var active = await MetricsAsync(admin);
        Assert.Equal(price, D(active["revenue"]!["mrr"]) - D(before["revenue"]!["mrr"]));
        Assert.Equal(1, I(active["revenue"]!["payingStores"]) - I(before["revenue"]!["payingStores"]));
        Assert.Contains(active["revenue"]!["byPlan"]!.AsArray(), p => p!["plan"]!.ToString() == "basic");

        await ExecAsync(async db =>
        {
            var t = await db.Tenants.SingleAsync(x => x.Id == tid);
            t.Status = TenantStatus.PastDue;
            await db.SaveChangesAsync();
        });
        var pastDue = await MetricsAsync(admin);
        Assert.Equal(D(before["revenue"]!["mrr"]), D(pastDue["revenue"]!["mrr"]));
        Assert.Equal(price, D(pastDue["revenue"]!["pastDueMrr"]) - D(before["revenue"]!["pastDueMrr"]));
    }

    [Fact]
    public async Task Payment_success_rate_and_email_health_come_from_the_records()
    {
        var admin = await AdminAsync();
        var shop = await ShopAsync();
        var order = await PlacedAsync(await ShopperAsync(shop.Host, Variant(shop.Product)), shop.Host, "cod");
        var before = await MetricsAsync(admin);

        await ExecAsync(async db =>
        {
            var o = await db.Orders.SingleAsync(x => x.Id == Guid.Parse(order["orderId"]!.ToString()));
            foreach (var status in new[] { PaymentAttemptStatus.Captured, PaymentAttemptStatus.Captured, PaymentAttemptStatus.Failed })
                db.PaymentAttempts.Add(new PaymentAttempt
                {
                    Id = Guid.CreateVersion7(), TenantId = o.TenantId, OrderId = o.Id, Gateway = "test", GatewayOrderId = "order_" + Guid.NewGuid().ToString("N")[..10],
                    Amount = o.Total, Status = status, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
                });
            db.OutboxEmails.Add(new OutboxEmail
            {
                Id = Guid.CreateVersion7(), Template = "test", ToAddress = "stuck@example.com", Subject = "Stuck", Status = EmailStatus.Pending,
                CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-(PlatformMetrics.EmailStuckMinutes + 5)), NextAttemptAt = DateTimeOffset.UtcNow.AddHours(1),
            });
            await db.SaveChangesAsync();
        });

        var after = await MetricsAsync(admin);
        Assert.Equal(2, I(after["payments"]!["captured"]) - I(before["payments"]!["captured"]));
        Assert.Equal(1, I(after["payments"]!["failed"]) - I(before["payments"]!["failed"]));
        var captured = I(after["payments"]!["captured"]);
        var failed = I(after["payments"]!["failed"]);
        Assert.Equal(Math.Round(100m * captured / (captured + failed), 1), D(after["payments"]!["successRate"]));
        Assert.Equal(1, I(after["email"]!["stuckPending"]) - I(before["email"]!["stuckPending"]));
    }

    [Fact]
    public async Task Only_verified_platform_admins_can_read_metrics_and_ranges_are_validated()
    {
        var (merchant, _) = await F.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await merchant.GetAsync("/api/platform/metrics")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await F.Client().GetAsync("/api/platform/metrics")).StatusCode);

        var admin = await AdminAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/platform/metrics?from=2025-01-01&to=2026-06-30")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/platform/metrics?from=yesterday")).StatusCode);
        var year = await MetricsAsync(admin, "?from=2026-01-05&to=2026-03-01");
        var weeks = year["weeks"]!.AsArray();
        Assert.Equal("2026-01-05", weeks[0]!["weekStart"]!.ToString());            // a Monday
        Assert.Equal("2026-02-23", weeks[^1]!["weekStart"]!.ToString());
        Assert.Equal(8, weeks.Count);
    }

    [Theory]
    [InlineData("2026-11-04", "2026-11-02")] // Wednesday
    [InlineData("2026-11-02", "2026-11-02")] // Monday
    [InlineData("2026-11-08", "2026-11-02")] // Sunday belongs to the week that started on Monday
    public void Weeks_start_on_monday(string day, string monday) =>
        Assert.Equal(DateOnly.Parse(monday, CultureInfo.InvariantCulture), PlatformMetrics.Monday(DateOnly.Parse(day, CultureInfo.InvariantCulture)));
}
