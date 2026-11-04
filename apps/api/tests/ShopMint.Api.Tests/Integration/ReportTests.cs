using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Notifications;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

[Collection("api")]
public class ReportTests(ApiFactory f) : CheckoutTestBase(f)
{
    private static decimal D(JsonNode? n) => decimal.Parse(n!.ToString(), CultureInfo.InvariantCulture);

    /// <summary>A store with two GST rates and a mix of orders: COD and online, intra- and inter-state, refunded, cancelled and unpaid.</summary>
    private async Task<(Shop Shop, List<JsonNode> Orders)> StoreWithOrdersAsync()
    {
        var shop = await ShopAsync(stock: 50, price: 300);
        var five = await shop.Merchant.CreateProductAsync(new
        {
            title = "Five Percent Tea", status = "active", gstRate = 5, hsnCode = "0902", optionNames = Array.Empty<string>(),
            variants = new[] { new { sku = "TEA-" + Guid.NewGuid().ToString("N")[..6], optionValues = Array.Empty<string>(), price = 150m, mrp = 200m, stockOnHand = 50 } },
        });
        var ids = new List<string>();
        async Task<string> Place(string state, string method, int qty, bool both = true)
        {
            var s = await ShopperAsync(shop.Host, Variant(shop.Product), qty, state);
            if (both) Assert.Equal(HttpStatusCode.OK, (await s.Client.PostAt(shop.Host, "/api/storefront/cart/lines", new { variantId = Variant(five), quantity = 1 })).StatusCode);
            var o = await PlacedAsync(s, shop.Host, method);
            var id = o["orderId"]!.ToString();
            if (method == "online")
                Assert.Equal(HttpStatusCode.OK, (await s.Client.PostAt(shop.Host, $"/api/storefront/checkout/orders/{id}/test-payment", new { outcome = "success" })).StatusCode);
            ids.Add(id);
            return id;
        }
        await Place("27", "cod", 1);            // Maharashtra: CGST + SGST
        await Place("29", "online", 2);         // Karnataka: IGST
        var refunded = await Place("29", "online", 1, both: false);
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{refunded}/refunds", new { amount = 100, reason = "Damaged" })).StatusCode);
        var cancelled = await Place("27", "cod", 3, both: false);
        Assert.Equal(HttpStatusCode.OK, (await shop.Merchant.PostAsJsonAsync($"/api/admin/orders/{cancelled}/cancel", new { reason = "Out of area" })).StatusCode);
        var unpaid = await ShopperAsync(shop.Host, Variant(shop.Product), 1, "07");
        ids.Add((await PlacedAsync(unpaid, shop.Host, "online"))["orderId"]!.ToString()); // awaiting payment: not a sale
        var orders = new List<JsonNode>();
        foreach (var id in ids) orders.Add(await (await shop.Merchant.GetAsync($"/api/admin/orders/{id}")).Json());
        return (shop, orders);
    }

    [Fact]
    public async Task Sales_report_adds_up_to_the_orders_and_matches_the_dashboard()
    {
        var (shop, orders) = await StoreWithOrdersAsync();
        var sales = orders.Where(o => o["status"]!.ToString() is not ("PendingPayment" or "Cancelled" or "Expired")).ToList();
        Assert.Equal(3, sales.Count);

        var r = await (await shop.Merchant.GetAsync("/api/admin/reports/sales")).Json();
        var t = r["totals"]!;
        Assert.Equal(sales.Count, t["orders"]!.GetValue<int>());
        Assert.Equal(sales.Sum(o => D(o["total"])), D(t["total"]));
        Assert.Equal(sales.Sum(o => D(o["subtotal"])), D(t["grossSales"]));
        Assert.Equal(sales.Sum(o => D(o["discount"])), D(t["discounts"]));
        Assert.Equal(sales.Sum(o => D(o["shipping"])), D(t["shipping"]));
        Assert.Equal(sales.Sum(o => D(o["cgst"]) + D(o["sgst"]) + D(o["igst"])), D(t["tax"]));
        Assert.Equal(sales.Sum(o => D(o["refundedTotal"])), D(t["refunds"]));
        Assert.Equal(100m, D(t["refunds"]));
        Assert.Equal(D(t["total"]) - D(t["refunds"]), D(t["netSales"]));
        Assert.Equal(sales.Sum(o => o["lines"]!.AsArray().Sum(l => l!["quantity"]!.GetValue<int>())), t["units"]!.GetValue<int>());
        Assert.Equal(D(t["grossSales"]) - D(t["discounts"]) + D(t["shipping"]), D(t["total"]));

        // Every breakdown adds back up to the totals.
        Assert.Equal(D(t["netSales"]), r["series"]!.AsArray().Sum(p => D(p!["netSales"])));
        Assert.Equal(D(t["total"]), r["byPayment"]!.AsArray().Sum(p => D(p!["total"])));
        Assert.Equal(D(t["total"]), r["byState"]!.AsArray().Sum(p => D(p!["total"])));
        Assert.Equal(30, r["series"]!.AsArray().Count);
        Assert.Equal(1, r["cancelled"]!["orders"]!.GetValue<int>());
        var top = r["topProducts"]!.AsArray();
        Assert.Equal(t["units"]!.GetValue<int>(), top.Sum(p => p!["units"]!.GetValue<int>()));
        Assert.Equal(sales.Sum(o => o["lines"]!.AsArray().Sum(l => D(l!["lineTotal"]))), top.Sum(p => D(p!["revenue"])));

        var dash = await (await shop.Merchant.GetAsync("/api/admin/dashboard/summary")).Json();
        Assert.Equal(D(t["netSales"]), D(dash["sales"]!["revenue"]));
        Assert.Equal(t["orders"]!.GetValue<int>(), dash["sales"]!["orders"]!.GetValue<int>());

        var monthly = await (await shop.Merchant.GetAsync("/api/admin/reports/sales?groupBy=month")).Json();
        Assert.Equal(D(t["netSales"]), monthly["series"]!.AsArray().Sum(p => D(p!["netSales"])));
    }

    [Fact]
    public async Task Gst_report_splits_tax_by_place_of_supply_rate_and_hsn_and_adds_up_to_the_invoices()
    {
        var (shop, orders) = await StoreWithOrdersAsync();
        var invoiced = orders.Where(o => o["invoiceNumber"] is not null && o["status"]!.ToString() != "Cancelled").ToList();
        var g = await (await shop.Merchant.GetAsync("/api/admin/reports/gst")).Json();
        Assert.Equal(invoiced.Count, g["invoices"]!.GetValue<int>());
        foreach (var k in new[] { "taxable", "cgst", "sgst", "igst", "total" })
            Assert.Equal(invoiced.Sum(o => D(o[k])), D(g[k]));
        var rows = g["byStateAndRate"]!.AsArray();
        foreach (var k in new[] { "taxable", "cgst", "sgst", "igst" })
        {
            Assert.Equal(D(g[k]), rows.Sum(x => D(x![k])));
            Assert.Equal(D(g[k]), g["hsn"]!.AsArray().Sum(x => D(x![k])));
        }
        // Intra-state rows carry CGST+SGST only, inter-state rows IGST only.
        Assert.All(rows.Where(x => x!["stateCode"]!.ToString() == "27"), x => Assert.Equal(0m, D(x!["igst"])));
        Assert.All(rows.Where(x => x!["stateCode"]!.ToString() == "29"), x => Assert.Equal(0m, D(x!["cgst"])));
        Assert.Contains(rows, x => D(x!["rate"]) == 5m);
        Assert.Contains(g["hsn"]!.AsArray(), x => x!["code"]!.ToString() == "9965");
        Assert.Equal(1, g["cancelledInvoices"]!["orders"]!.GetValue<int>());
    }

    [Fact]
    public async Task Ranges_use_indian_days_and_are_validated()
    {
        var (shop, orders) = await StoreWithOrdersAsync();
        // 18:45 UTC on 31 Jan is 00:15 on 1 Feb in India.
        var first = Guid.Parse(orders[0]["id"]!.ToString());
        await using (var scope = F.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
            await db.Orders.Where(o => o.Id == first).ExecuteUpdateAsync(s => s.SetProperty(o => o.PlacedAt, new DateTimeOffset(2026, 1, 31, 18, 45, 0, TimeSpan.Zero)));
        }
        var feb = await (await shop.Merchant.GetAsync("/api/admin/reports/sales?from=2026-02-01&to=2026-02-01")).Json();
        Assert.Equal(1, feb["totals"]!["orders"]!.GetValue<int>());
        var jan = await (await shop.Merchant.GetAsync("/api/admin/reports/sales?from=2026-01-31&to=2026-01-31")).Json();
        Assert.Equal(0, jan["totals"]!["orders"]!.GetValue<int>());
        var week = await (await shop.Merchant.GetAsync("/api/admin/reports/sales?from=2026-01-28&to=2026-02-08&groupBy=week")).Json();
        Assert.Equal(["2026-01-26", "2026-02-02"], week["series"]!.AsArray().Select(p => p!["start"]!.ToString()).ToArray());

        Assert.Equal(HttpStatusCode.BadRequest, (await shop.Merchant.GetAsync("/api/admin/reports/sales?from=2026-02-02&to=2026-02-01")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await shop.Merchant.GetAsync("/api/admin/reports/sales?from=2025-01-01&to=2026-02-01")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await shop.Merchant.GetAsync("/api/admin/reports/sales?from=01-02-2026")).StatusCode);

        // Another store sees none of these orders.
        var (other, _) = await F.NewMerchantAsync();
        var empty = await (await other.GetAsync("/api/admin/reports/sales?from=2026-02-01&to=2026-02-01")).Json();
        Assert.Equal(0, empty["totals"]!["orders"]!.GetValue<int>());
    }

    [Fact]
    public async Task Csv_exports_list_every_order_and_neutralise_spreadsheet_formulas()
    {
        var shop = await ShopAsync(stock: 10);
        var c = F.Client();
        Assert.Equal(HttpStatusCode.Created, (await c.PostAt(shop.Host, "/api/storefront/account/signup",
            new { name = "=HYPERLINK(\"http://evil.example\",\"x\")", email = $"csv-{Guid.NewGuid():N}@example.com", password = ApiFactory.Password })).StatusCode);
        var address = await (await c.PostAt(shop.Host, "/api/storefront/account/addresses",
            new { name = "+Ravi", phone = "9876543210", line1 = "4 Park Street", city = "@Pune", stateCode = "27", pincode = "411002" })).Json();
        await c.PostAt(shop.Host, "/api/storefront/cart/lines", new { variantId = Variant(shop.Product), quantity = 1 });
        var o = await PlacedAsync(new Shopper(c, address["id"]!.ToString(), ""), shop.Host, "cod");

        var res = await shop.Merchant.GetAsync("/api/admin/reports/orders.csv");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("text/csv", res.Content.Headers.ContentType!.MediaType);
        Assert.Contains("attachment", res.Content.Headers.ContentDisposition!.ToString());
        var csv = await res.Content.ReadAsStringAsync();
        var rows = csv.TrimStart('﻿').Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(2, rows.Length);
        Assert.StartsWith("Order,Placed (IST)", rows[0]);
        Assert.Contains("\"'=HYPERLINK(\"\"http://evil.example\"\",\"\"x\"\")\"", rows[1]);
        Assert.Contains(",'@Pune,", rows[1]);
        Assert.StartsWith($"{o["number"]},", rows[1]);

        var gst = await (await shop.Merchant.GetAsync("/api/admin/reports/gst.csv")).Content.ReadAsStringAsync();
        Assert.StartsWith("﻿Place of supply,State code,Rate %", gst);
        Assert.Contains("Maharashtra,27,12.00,1,", gst);
        var hsn = await (await shop.Merchant.GetAsync("/api/admin/reports/hsn.csv")).Content.ReadAsStringAsync();
        Assert.Contains("6204,", hsn);
    }
}

[Collection("api")]
public class StoreNotificationTests(ApiFactory f) : CheckoutTestBase(f)
{
    private Task<(int, int)> RunAsync(DateTimeOffset now) =>
        NotificationJob.RunOnceAsync(F.Services.GetRequiredService<IServiceScopeFactory>(), now, CancellationToken.None);

    // 10:00 in India, when digests go out.
    private static DateTimeOffset Morning(int day = 0) => new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero).AddHours(4.5).AddDays(day + 1);

    private async Task ExecAsync(Func<PlatformDbContext, Task> work)
    {
        await using var scope = F.Services.CreateAsyncScope();
        await work(scope.ServiceProvider.GetRequiredService<PlatformDbContext>());
    }

    [Fact]
    public async Task Members_choose_order_and_low_stock_emails_with_role_defaults()
    {
        var shop = await ShopAsync();
        var tid = ApiFactory.TenantId(shop.Me);
        var mine = await (await shop.Merchant.GetAsync("/api/admin/me/notifications")).Json();
        Assert.False(mine["newOrders"]!.GetValue<bool>());
        Assert.True(mine["lowStock"]!.GetValue<bool>());
        var staff = await F.AddMemberAsync(tid, MemberRole.Staff);
        var staffPrefs = await (await staff.GetAsync("/api/admin/me/notifications")).Json();
        Assert.False(staffPrefs["lowStock"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.OK, (await staff.PutAsJsonAsync("/api/admin/me/notifications", new { newOrders = true, lowStock = false })).StatusCode);
        var staffEmail = (await (await staff.GetAsync("/api/auth/me")).Json())["user"]!["email"]!.ToString();

        // Store support address and the opted-in staff member both get the new-order alert.
        var support = (await (await shop.Merchant.GetAsync("/api/admin/store")).Json())["supportEmail"]!.ToString();
        var s = await ShopperAsync(shop.Host, Variant(shop.Product));
        var placed = await PlacedAsync(s, shop.Host, "cod");
        Assert.NotNull(await F.LastEmailAsync(support, "order_new_alert"));
        var alert = await F.LastEmailAsync(staffEmail, "order_new_alert");
        Assert.NotNull(alert);
        Assert.Contains($"#{placed["number"]}", alert!.Subject);
    }

    [Fact]
    public async Task Low_stock_digest_goes_out_once_per_change_to_members_who_want_it()
    {
        var shop = await ShopAsync(stock: 1); // threshold is 2
        var tid = ApiFactory.TenantId(shop.Me);
        var owner = shop.Me["user"]!["email"]!.ToString();
        await ExecAsync(db => db.Tenants.Where(t => t.Id != tid).ExecuteUpdateAsync(s => s.SetProperty(t => t.LowStockDigestAt, DateTimeOffset.UtcNow.AddYears(1))));

        var (digests, _) = await RunAsync(Morning());
        Assert.True(digests >= 1);
        var mail = await F.LastEmailAsync(owner, "low_stock_digest");
        Assert.NotNull(mail);
        Assert.Contains(shop.Product["variants"]![0]!["sku"]!.ToString(), mail!.TextBody);

        // Next day, same list: nothing new.
        await RunAsync(Morning(1));
        Assert.Equal(mail.Id, (await F.LastEmailAsync(owner, "low_stock_digest"))!.Id);
        // Before 9:00 in India nothing is sent even if due.
        Assert.Equal(0, (await RunAsync(Morning(3).AddHours(-6))).Item1);
    }

    [Fact]
    public async Task Abandoned_cart_reminders_need_consent_go_once_and_unsubscribe_works()
    {
        var shop = await ShopAsync(stock: 10);
        var tid = ApiFactory.TenantId(shop.Me);
        var store = await (await shop.Merchant.GetAsync("/api/admin/store")).Json();
        Assert.False(store["abandonedCartEmails"]!.GetValue<bool>());
        await shop.Merchant.PatchAsJsonAsync("/api/admin/store", new { name = store["name"]!.ToString(), brandColor = "#4f46e5", lowStockThreshold = 2, abandonedCartEmails = true });

        async Task<(HttpClient Client, string Email)> Shopper(bool optIn)
        {
            var c = F.Client();
            var email = $"cart-{Guid.NewGuid():N}@example.com";
            Assert.Equal(HttpStatusCode.Created, (await c.PostAt(shop.Host, "/api/storefront/account/signup", new { name = "Asha", email, password = ApiFactory.Password, marketingOptIn = optIn })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await c.PostAt(shop.Host, "/api/storefront/cart/lines", new { variantId = Variant(shop.Product), quantity = 1 })).StatusCode);
            return (c, email);
        }
        var (yes, yesEmail) = await Shopper(true);
        var (_, noEmail) = await Shopper(false);
        await ExecAsync(db => db.Carts.Where(c => c.TenantId == tid).ExecuteUpdateAsync(s => s.SetProperty(c => c.UpdatedAt, DateTimeOffset.UtcNow.AddHours(-5))));

        var (_, reminders) = await RunAsync(DateTimeOffset.UtcNow);
        Assert.True(reminders >= 1);
        var mail = await F.LastEmailAsync(yesEmail, "abandoned_cart");
        Assert.NotNull(mail);
        Assert.Null(await F.LastEmailAsync(noEmail, "abandoned_cart"));
        Assert.Contains($"{ApiFactory.Host(shop.Me)}/cart", mail!.TextBody);

        await RunAsync(DateTimeOffset.UtcNow);
        Assert.Equal(mail.Id, (await F.LastEmailAsync(yesEmail, "abandoned_cart"))!.Id); // once per cart change

        var token = System.Text.RegularExpressions.Regex.Match(mail.TextBody!, @"unsubscribe\?token=([A-Za-z0-9_\-]+)").Groups[1].Value;
        // The unsubscribe token is not a password-reset token, and works only on its own store.
        Assert.Equal(HttpStatusCode.BadRequest, (await F.Client().PostAt(shop.Host, "/api/storefront/account/password/reset", new { token, password = "Another-Pass-123" })).StatusCode);
        var (_, _, otherHost, _) = await LiveStoreAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await F.Client().PostAt(otherHost, "/api/storefront/account/unsubscribe", new { token })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await F.Client().PostAt(shop.Host, "/api/storefront/account/unsubscribe", new { token })).StatusCode);
        var me = await (await yes.GetAt(shop.Host, "/api/storefront/account/me")).Json();
        Assert.False(me["marketingOptIn"]!.GetValue<bool>());

        // After unsubscribing, a changed cart gets no reminder.
        await yes.PostAt(shop.Host, "/api/storefront/cart/lines", new { variantId = Variant(shop.Product), quantity = 1 });
        await ExecAsync(db => db.Carts.Where(c => c.TenantId == tid).ExecuteUpdateAsync(s => s.SetProperty(c => c.UpdatedAt, DateTimeOffset.UtcNow.AddHours(-5))));
        await RunAsync(DateTimeOffset.UtcNow);
        Assert.Equal(mail.Id, (await F.LastEmailAsync(yesEmail, "abandoned_cart"))!.Id);
    }
}
