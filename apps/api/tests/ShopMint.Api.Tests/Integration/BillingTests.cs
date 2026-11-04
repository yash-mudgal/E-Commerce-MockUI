using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Billing;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Tests.Infrastructure;

namespace ShopMint.Api.Tests.Integration;

public abstract class BillingTestBase(ApiFactory f)
{
    protected ApiFactory F => f;
    protected static readonly Dictionary<string, string> RzpPlans = new() { ["basic"] = "plan_basic0000001", ["pro"] = "plan_pro000000001", ["enterprise"] = "plan_ent000000001" };

    protected async Task<HttpClient> PlatformAsync()
    {
        var admin = await f.AddMemberAsync(Guid.Empty, MemberRole.Owner, platformAdmin: true);
        // Link ShopMint's plans to (fake) Razorpay plans, as an operator would once.
        var plans = (await (await admin.GetAsync("/api/platform/plans")).Json()).AsArray();
        foreach (var p in plans.Where(p => RzpPlans.ContainsKey(p!["code"]!.ToString()) && p["razorpayPlanId"]?.ToString() != RzpPlans[p["code"]!.ToString()]))
        {
            var res = await admin.PutAsJsonAsync($"/api/platform/plans/{p!["code"]}", PlanBody(p, razorpayPlanId: RzpPlans[p["code"]!.ToString()]));
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }
        return admin;
    }

    protected static object PlanBody(JsonNode p, int? maxProducts = -1, string? razorpayPlanId = "-") => new
    {
        name = p["name"]!.ToString(), monthlyPrice = decimal.Parse(p["monthlyPrice"]!.ToString(), System.Globalization.CultureInfo.InvariantCulture),
        maxProducts = maxProducts == -1 ? p["maxProducts"]?.GetValue<int?>() : maxProducts,
        maxStaff = p["maxStaff"]?.GetValue<int?>(), maxLocations = p["maxLocations"]?.GetValue<int?>(),
        customDomain = p["customDomain"]!.GetValue<bool>(), isPublic = p["isPublic"]!.GetValue<bool>(),
        razorpayPlanId = razorpayPlanId == "-" ? p["razorpayPlanId"]?.ToString() : razorpayPlanId,
    };

    protected static async Task<JsonNode> BillingAsync(HttpClient owner) => await (await owner.GetAsync("/api/admin/billing")).Json();

    /// <summary>Owner chooses a plan and completes Razorpay Checkout (the fake authorises it); returns the subscription ID.</summary>
    protected async Task<string> SubscribeAsync(HttpClient owner, string plan)
    {
        var checkout = await owner.PostAsJsonAsync("/api/admin/billing/checkout", new { planCode = plan });
        Assert.True(checkout.StatusCode == HttpStatusCode.OK, await checkout.Content.ReadAsStringAsync());
        var c = await checkout.Json();
        Assert.Equal("razorpay", c["gateway"]!.ToString());
        Assert.Equal(FakeRazorpay.BillingKeyId, c["keyId"]!.ToString());
        var subId = c["subscriptionId"]!.ToString();
        var paymentId = f.Razorpay.AuthorizeSubscription(subId);
        var verify = await owner.PostAsJsonAsync("/api/admin/billing/verify", new
        {
            razorpayPaymentId = paymentId, razorpaySubscriptionId = subId,
            razorpaySignature = PaymentMath.HmacHex(FakeRazorpay.ValidSecret, paymentId + "|" + subId),
        });
        Assert.True(verify.StatusCode == HttpStatusCode.OK, await verify.Content.ReadAsStringAsync());
        return subId;
    }

    protected async Task EndTrialAsync(Guid tenantId)
    {
        await using var scope = f.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
        var ended = DateTimeOffset.UtcNow.AddMinutes(-1);
        await db.Tenants.Where(t => t.Id == tenantId).ExecuteUpdateAsync(s => s.SetProperty(t => t.TrialEndsAt, ended));
        // A subscription set up during the trial starts when the trial ends.
        await db.Subscriptions.Where(x => x.TenantId == tenantId && x.Status == SubscriptionStatus.Authenticated)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.StartAt, ended));
    }

    protected Task<int> RunJobAsync(DateTimeOffset? at = null) =>
        BillingJob.RunOnceAsync(f.Services.GetRequiredService<IServiceScopeFactory>(), at ?? DateTimeOffset.UtcNow, CancellationToken.None);

    protected Task<HttpResponseMessage> WebhookAsync(string evt, string subscriptionId, object? payment = null, object? invoice = null, string? eventId = null,
        string secret = FakeRazorpay.BillingWebhookSecret, object? subscriptionOverride = null)
    {
        var sub = subscriptionOverride ?? JsonNode.Parse(f.Razorpay.Subscriptions.TryGetValue(subscriptionId, out var s) ? s.ToJsonString() : $$"""{"id":"{{subscriptionId}}"}""");
        var payload = new Dictionary<string, object> { ["subscription"] = new { entity = sub } };
        if (payment is not null) payload["payment"] = new { entity = payment };
        if (invoice is not null) payload["invoice"] = new { entity = invoice };
        var body = JsonSerializer.Serialize(new { @event = evt, payload });
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/webhooks/razorpay-billing") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.Add("X-Razorpay-Signature", PaymentMath.HmacHex(secret, body));
        req.Headers.Add("X-Razorpay-Event-Id", eventId ?? "evt_" + Guid.NewGuid().ToString("N"));
        return f.Client(csrf: false).SendAsync(req);
    }

    protected static async Task<HttpStatusCode> StorefrontStatusAsync(ApiFactory f, JsonNode me) =>
        (await f.Client().GetAt(ApiFactory.Host(me), "/api/storefront/store")).StatusCode;
}

[Collection("api")]
public class PlanEnforcementTests(ApiFactory f) : BillingTestBase(f)
{
    [Fact]
    public async Task Product_limit_comes_from_the_plans_table_and_holds_under_concurrency()
    {
        var admin = await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        var basic = (await (await admin.GetAsync("/api/platform/plans")).Json()).AsArray().Single(p => p!["code"]!.ToString() == "basic")!;
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/platform/tenants/{ApiFactory.TenantId(me)}/plan", new { planCode = "basic", note = "test" })).StatusCode);
        Assert.Equal("Active", (await BillingAsync(owner))["status"]!.ToString());
        try
        {
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/platform/plans/basic", PlanBody(basic, maxProducts: 3))).StatusCode);
            // Six parallel creates against a limit of 3: exactly three succeed.
            var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(i =>
                owner.PostAsJsonAsync("/api/admin/products", Http.Product($"Limited {i}", "LIM-" + Guid.NewGuid().ToString("N")[..6]))));
            Assert.Equal(3, results.Count(r => r.StatusCode == HttpStatusCode.Created));
            var refused = results.First(r => r.StatusCode != HttpStatusCode.Created);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
            Assert.EndsWith("/entitlement-exceeded", (await refused.Json())["type"]!.ToString());

            // Unarchiving counts too.
            var list = await (await owner.GetAsync("/api/admin/products?pageSize=10")).Json();
            var first = list["items"]![0]!["id"]!.ToString();
            Assert.Equal(HttpStatusCode.NoContent, (await owner.PostAsync($"/api/admin/products/{first}/archive", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync("/api/admin/products", Http.Product("Replacement", "REP-" + Guid.NewGuid().ToString("N")[..6]))).StatusCode);
            var p = await (await owner.GetAsync($"/api/admin/products/{first}")).Json();
            var unarchive = await owner.PutAsJsonAsync($"/api/admin/products/{first}", new
            {
                title = p["title"]!.ToString(), status = "active", gstRate = 12, hsnCode = "6204", optionNames = Array.Empty<string>(),
                variants = p["variants"]!.AsArray().Select(v => new { id = v!["id"]!.ToString(), sku = v["sku"]!.ToString(), optionValues = Array.Empty<string>(), price = 499, mrp = 699, stockOnHand = (int?)null }),
            });
            Assert.Equal(HttpStatusCode.UnprocessableEntity, unarchive.StatusCode);
        }
        finally
        {
            await admin.PutAsJsonAsync("/api/platform/plans/basic", PlanBody(basic));
        }
    }

    [Fact]
    public async Task Trial_limits_apply_to_locations_and_seats_and_upgrading_lifts_them()
    {
        await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        var loc = await owner.PostAsJsonAsync("/api/admin/locations", new { name = "Second", code = "SEC", stateCode = "27", isDefault = false });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, loc.StatusCode);
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email = $"t{i}-{Guid.NewGuid():N}@example.com", role = "Staff" })).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await owner.PostAsJsonAsync("/api/admin/staff/invitations", new { email = $"t3-{Guid.NewGuid():N}@example.com", role = "Staff" })).StatusCode);

        // Subscribing to Pro during the trial gives Pro's limits now; the first charge happens when the trial ends.
        await SubscribeAsync(owner, "pro");
        var b = await BillingAsync(owner);
        Assert.Equal("Trialing", b["status"]!.ToString());
        Assert.Equal("pro", b["planCode"]!.ToString());
        Assert.Equal("Authenticated", b["subscription"]!["status"]!.ToString());
        Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync("/api/admin/locations", new { name = "Second", code = "SEC", stateCode = "27", isDefault = false })).StatusCode);
        // Razorpay was asked to start charging when the trial ends, not now.
        var trialEnds = me["tenant"]!["trialEndsAt"]!.GetValue<DateTimeOffset>();
        Assert.Equal(trialEnds.ToUnixTimeSeconds(), b["subscription"]!["startAt"]!.GetValue<DateTimeOffset>().ToUnixTimeSeconds());
    }

    [Fact]
    public async Task Downgrades_are_blocked_above_the_new_limits_and_apply_at_period_end_while_upgrades_apply_now()
    {
        await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        var tid = ApiFactory.TenantId(me);
        await EndTrialAsync(tid);
        var subId = await SubscribeAsync(owner, "pro"); // trial over: charged immediately
        Assert.Equal("Active", (await BillingAsync(owner))["status"]!.ToString());
        Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync("/api/admin/locations", new { name = "Second", code = "SEC", stateCode = "27", isDefault = false })).StatusCode);

        var blocked = await owner.PostAsJsonAsync("/api/admin/billing/change-plan", new { planCode = "basic" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, blocked.StatusCode);
        Assert.Contains("stock locations", (await blocked.Json())["detail"]!.ToString());
        var options = (await BillingAsync(owner))["plans"]!.AsArray();
        var basicOption = options.Single(o => o!["code"]!.ToString() == "basic")!;
        Assert.Equal("downgrade", basicOption["action"]!.ToString());
        Assert.False(basicOption["available"]!.GetValue<bool>());

        var locs = await (await owner.GetAsync("/api/admin/locations")).Json();
        var second = locs["locations"]!.AsArray().Single(l => l!["code"]!.ToString() == "SEC")!["id"]!.ToString();
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/admin/locations/{second}")).StatusCode);
        var down = await owner.PostAsJsonAsync("/api/admin/billing/change-plan", new { planCode = "basic" });
        Assert.Equal(HttpStatusCode.OK, down.StatusCode);
        var afterDown = await down.Json();
        Assert.Equal("pro", afterDown["planCode"]!.ToString()); // still Pro until the period ends
        Assert.Equal("basic", afterDown["subscription"]!["pendingPlanCode"]!.ToString());

        // Razorpay renews on the new plan; the webhook moves the store to Basic.
        F.Razorpay.Charge(subId);
        Assert.Equal(HttpStatusCode.OK, (await WebhookAsync("subscription.charged", subId, payment: new { id = "pay_" + Guid.NewGuid().ToString("N")[..14], amount = 117882 })).StatusCode);
        var renewed = await BillingAsync(owner);
        Assert.Equal("basic", renewed["planCode"]!.ToString());
        Assert.Null(renewed["subscription"]!["pendingPlanCode"]);
        Assert.Single(renewed["invoices"]!.AsArray(), i => i!["amount"]!.ToString() == "1178.82");

        var up = await owner.PostAsJsonAsync("/api/admin/billing/change-plan", new { planCode = "enterprise" });
        Assert.Equal(HttpStatusCode.OK, up.StatusCode);
        Assert.Equal("enterprise", (await up.Json())["planCode"]!.ToString());
        Assert.Equal(RzpPlans["enterprise"], F.Razorpay.Subscriptions[subId]["plan_id"]!.ToString());
    }
}

[Collection("api")]
public class SubscriptionLifecycleTests(ApiFactory f) : BillingTestBase(f)
{
    [Fact]
    public async Task Checkout_needs_a_valid_signature_and_the_stores_own_subscription()
    {
        await PlatformAsync();
        var (owner, _) = await F.NewMerchantAsync();
        var (other, _) = await F.NewMerchantAsync();
        var c = await (await owner.PostAsJsonAsync("/api/admin/billing/checkout", new { planCode = "basic" })).Json();
        var subId = c["subscriptionId"]!.ToString();
        var paymentId = F.Razorpay.AuthorizeSubscription(subId);
        var forged = await owner.PostAsJsonAsync("/api/admin/billing/verify", new { razorpayPaymentId = paymentId, razorpaySubscriptionId = subId, razorpaySignature = new string('a', 64) });
        Assert.Equal(HttpStatusCode.BadRequest, forged.StatusCode);
        var sig = PaymentMath.HmacHex(FakeRazorpay.ValidSecret, paymentId + "|" + subId);
        var stolen = await other.PostAsJsonAsync("/api/admin/billing/verify", new { razorpayPaymentId = paymentId, razorpaySubscriptionId = subId, razorpaySignature = sig });
        Assert.Equal(HttpStatusCode.BadRequest, stolen.StatusCode);
        Assert.Equal("Trialing", (await BillingAsync(other))["status"]!.ToString());
        Assert.Null((await BillingAsync(other))["subscription"]);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync("/api/admin/billing/verify", new { razorpayPaymentId = paymentId, razorpaySubscriptionId = subId, razorpaySignature = sig })).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/admin/billing/checkout", new { planCode = "trial" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.PostAsJsonAsync("/api/admin/billing/test-payment", new { subscriptionId = subId, outcome = "success" })).StatusCode);
    }

    [Fact]
    public async Task Expired_trial_closes_the_store_read_only_and_subscribing_reopens_it()
    {
        await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        var tid = ApiFactory.TenantId(me);
        await F.LaunchAsync(tid);
        await EndTrialAsync(tid);
        Assert.True(await RunJobAsync() >= 1);

        var b = await BillingAsync(owner);
        Assert.Equal("Suspended", b["status"]!.ToString());
        Assert.Equal("TrialExpired", b["suspensionReason"]!.ToString());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, await StorefrontStatusAsync(F, me));
        var write = await owner.PostAsJsonAsync("/api/admin/products", Http.Product("Closed", "CL-" + Guid.NewGuid().ToString("N")[..6]));
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
        Assert.EndsWith("/tenant-suspended", (await write.Json())["type"]!.ToString());
        Assert.NotNull(await F.LastEmailAsync(me["user"]!["email"]!.ToString(), "billing_suspended"));
        Assert.True(F.Revalidator.Count(tid) >= 1);

        var subId = await SubscribeAsync(owner, "basic"); // billing stays writable while closed
        var after = await BillingAsync(owner);
        Assert.Equal("Active", after["status"]!.ToString());
        Assert.Null(after["suspensionReason"]);
        // The receipt arrives with Razorpay's charge webhook, not from the browser.
        Assert.Empty(after["invoices"]!.AsArray());
        await WebhookAsync("subscription.charged", subId, payment: new { id = "pay_" + Guid.NewGuid().ToString("N")[..14], amount = 117882 });
        Assert.Single((await BillingAsync(owner))["invoices"]!.AsArray());
        Assert.Equal(HttpStatusCode.OK, await StorefrontStatusAsync(F, me));
        Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync("/api/admin/products", Http.Product("Open", "OP-" + Guid.NewGuid().ToString("N")[..6]))).StatusCode);
        Assert.NotNull(await F.LastEmailAsync(me["user"]!["email"]!.ToString(), "billing_active"));
    }

    [Fact]
    public async Task Failed_payment_gives_seven_days_grace_then_suspends_and_a_later_charge_restores()
    {
        await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        var tid = ApiFactory.TenantId(me);
        await EndTrialAsync(tid);
        var subId = await SubscribeAsync(owner, "basic");

        F.Razorpay.SetStatus(subId, "pending");
        Assert.Equal(HttpStatusCode.OK, (await WebhookAsync("subscription.pending", subId)).StatusCode);
        var b = await BillingAsync(owner);
        Assert.Equal("PastDue", b["status"]!.ToString());
        var grace = b["graceEndsAt"]!.GetValue<DateTimeOffset>();
        Assert.InRange(grace, DateTimeOffset.UtcNow.AddDays(6.9), DateTimeOffset.UtcNow.AddDays(7.1));
        Assert.NotNull(await F.LastEmailAsync(me["user"]!["email"]!.ToString(), "billing_payment_failed"));
        Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync("/api/admin/products", Http.Product("Grace", "GR-" + Guid.NewGuid().ToString("N")[..6]))).StatusCode);

        await RunJobAsync(DateTimeOffset.UtcNow.AddDays(3));
        Assert.Equal("PastDue", (await BillingAsync(owner))["status"]!.ToString());
        await RunJobAsync(DateTimeOffset.UtcNow.AddDays(8));
        b = await BillingAsync(owner);
        Assert.Equal("Suspended", b["status"]!.ToString());
        Assert.Equal("PaymentFailed", b["suspensionReason"]!.ToString());

        F.Razorpay.Charge(subId);
        Assert.Equal(HttpStatusCode.OK, (await WebhookAsync("subscription.charged", subId, payment: new { id = "pay_" + Guid.NewGuid().ToString("N")[..14], amount = 117882 })).StatusCode);
        b = await BillingAsync(owner);
        Assert.Equal("Active", b["status"]!.ToString());
        Assert.Null(b["graceEndsAt"]);
    }

    [Fact]
    public async Task Halted_subscription_suspends_and_the_owner_can_pay_with_a_new_subscription()
    {
        await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        await EndTrialAsync(ApiFactory.TenantId(me));
        var oldSub = await SubscribeAsync(owner, "basic");
        F.Razorpay.SetStatus(oldSub, "halted");
        await WebhookAsync("subscription.halted", oldSub);
        Assert.Equal("Suspended", (await BillingAsync(owner))["status"]!.ToString());

        var newSub = await SubscribeAsync(owner, "basic");
        var b = await BillingAsync(owner);
        Assert.Equal("Active", b["status"]!.ToString());
        Assert.Equal("cancelled", F.Razorpay.Subscriptions[oldSub]["status"]!.ToString()); // the old mandate is cancelled
        Assert.NotEqual(oldSub, newSub);
    }

    [Fact]
    public async Task Cancelling_keeps_the_store_open_until_the_period_ends()
    {
        await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        await F.LaunchAsync(ApiFactory.TenantId(me));
        await EndTrialAsync(ApiFactory.TenantId(me));
        var subId = await SubscribeAsync(owner, "basic");
        var res = await owner.PostAsync("/api/admin/billing/cancel", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var b = await res.Json();
        Assert.Equal("Active", b["status"]!.ToString());
        Assert.True(b["subscription"]!["cancelAtPeriodEnd"]!.GetValue<bool>());
        Assert.True(F.Razorpay.Subscriptions[subId]["cancel_at_cycle_end"]!.GetValue<bool>());
        Assert.All(b["plans"]!.AsArray(), p => Assert.Equal("subscribe", p!["action"]!.ToString()));

        F.Razorpay.SetStatus(subId, "cancelled");
        await WebhookAsync("subscription.cancelled", subId);
        b = await BillingAsync(owner);
        Assert.Equal("Cancelled", b["status"]!.ToString());
        Assert.Equal(HttpStatusCode.NotFound, await StorefrontStatusAsync(F, me));
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync("/api/admin/billing/checkout", new { planCode = "pro" })).StatusCode);
    }

    [Fact]
    public async Task Platform_suspension_is_not_lifted_by_paying_and_reactivation_restores_the_billing_state()
    {
        var admin = await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        var tid = ApiFactory.TenantId(me);
        await EndTrialAsync(tid);
        var subId = await SubscribeAsync(owner, "basic");
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/platform/tenants/{tid}/suspend", new { reason = "abuse" })).StatusCode);
        F.Razorpay.Charge(subId);
        await WebhookAsync("subscription.charged", subId, payment: new { id = "pay_" + Guid.NewGuid().ToString("N")[..14], amount = 117882 });
        var b = await BillingAsync(owner);
        Assert.Equal("Suspended", b["status"]!.ToString());
        Assert.Equal("Platform", b["suspensionReason"]!.ToString());
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsJsonAsync("/api/admin/billing/checkout", new { planCode = "pro" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/platform/tenants/{tid}/reactivate", new { })).StatusCode);
        Assert.Equal("Active", (await BillingAsync(owner))["status"]!.ToString());

        // A trial store that's reactivated goes back to its trial, not to "Active".
        var (owner2, me2) = await F.NewMerchantAsync();
        await admin.PostAsJsonAsync($"/api/platform/tenants/{ApiFactory.TenantId(me2)}/suspend", new { });
        await admin.PostAsJsonAsync($"/api/platform/tenants/{ApiFactory.TenantId(me2)}/reactivate", new { });
        Assert.Equal("Trialing", (await BillingAsync(owner2))["status"]!.ToString());
    }

    [Fact]
    public async Task Only_owners_manage_billing()
    {
        var (_, me) = await F.NewMerchantAsync();
        var tid = ApiFactory.TenantId(me);
        foreach (var role in new[] { MemberRole.Manager, MemberRole.Staff })
        {
            var c = await F.AddMemberAsync(tid, role);
            Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync("/api/admin/billing")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await c.PostAsJsonAsync("/api/admin/billing/checkout", new { planCode = "basic" })).StatusCode);
        }
    }
}

[Collection("api")]
public class BillingWebhookTests(ApiFactory f) : BillingTestBase(f)
{
    [Fact]
    public async Task Webhooks_are_signed_deduplicated_matched_by_subscription_id_and_read_back_from_razorpay()
    {
        await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        await EndTrialAsync(ApiFactory.TenantId(me));
        var subId = await SubscribeAsync(owner, "basic");

        Assert.Equal(HttpStatusCode.Unauthorized, (await WebhookAsync("subscription.halted", subId, secret: "wrong")).StatusCode);

        // Out of order / forged-looking payload: Razorpay still says active, so the store stays active.
        var stale = await WebhookAsync("subscription.pending", subId, subscriptionOverride: new { id = subId, status = "pending" });
        Assert.Equal(HttpStatusCode.OK, stale.StatusCode);
        Assert.Equal("Active", (await BillingAsync(owner))["status"]!.ToString());

        var eventId = "evt_" + Guid.NewGuid().ToString("N");
        var paymentId = "pay_" + Guid.NewGuid().ToString("N")[..14];
        var first = await WebhookAsync("invoice.paid", subId, invoice: new { id = "inv_ABC123", subscription_id = subId, payment_id = paymentId, amount_paid = 117882, short_url = "https://rzp.io/i/inv123" }, eventId: eventId);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var again = await WebhookAsync("invoice.paid", subId, invoice: new { id = "inv_ABC123", subscription_id = subId, payment_id = paymentId, amount_paid = 117882 }, eventId: eventId);
        Assert.True((await again.Json())["duplicate"]!.GetValue<bool>());
        var invoices = (await BillingAsync(owner))["invoices"]!.AsArray();
        var inv = invoices.Single(i => i!["reference"]!.ToString() == "inv_ABC123")!;
        Assert.Equal("https://rzp.io/i/inv123", inv["invoiceUrl"]!.ToString());
        Assert.Equal("1178.82", inv["amount"]!.ToString());

        var unknown = await WebhookAsync("subscription.halted", "sub_unknown000001", subscriptionOverride: new { id = "sub_unknown000001", status = "halted" });
        Assert.True((await unknown.Json())["ignored"]!.GetValue<bool>());
    }
}

[Collection("api")]
public class PlatformPlanTests(ApiFactory f) : BillingTestBase(f)
{
    [Fact]
    public async Task Platform_edits_plans_safely_and_assigns_plans()
    {
        var admin = await PlatformAsync();
        var (owner, me) = await F.NewMerchantAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.GetAsync("/api/platform/plans")).StatusCode);

        var plans = (await (await admin.GetAsync("/api/platform/plans")).Json()).AsArray();
        Assert.Equal(["trial", "basic", "pro", "enterprise"], plans.Select(p => p!["code"]!.ToString()).ToArray());
        var basic = plans.Single(p => p!["code"]!.ToString() == "basic")!;
        Assert.Equal("1178.82", basic["monthlyPriceWithGst"]!.ToString());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/platform/plans/basic", PlanBody(basic, razorpayPlanId: "not-a-plan"))).StatusCode);
        var trial = plans.Single(p => p!["code"]!.ToString() == "trial")!;
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/platform/plans/trial", new { name = "Trial", monthlyPrice = 10, maxProducts = 100, maxStaff = 2, maxLocations = 1, customDomain = false, isPublic = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/platform/plans/pro", PlanBody(basic, razorpayPlanId: RzpPlans["basic"]))).StatusCode); // already used by Basic
        var stale = new HttpRequestMessage(HttpMethod.Put, "/api/platform/plans/basic") { Content = JsonContent.Create(PlanBody(basic)) };
        stale.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
        Assert.Equal(HttpStatusCode.Conflict, (await admin.SendAsync(stale)).StatusCode);
        Assert.Equal("0.00", trial["monthlyPrice"]!.ToString());

        var tid = ApiFactory.TenantId(me);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/platform/tenants/{tid}/plan", new { planCode = "enterprise", note = "Annual contract" })).StatusCode);
        var b = await BillingAsync(owner);
        Assert.Equal("Active", b["status"]!.ToString());
        Assert.Equal("enterprise", b["planCode"]!.ToString());
        Assert.Equal("manual", b["subscription"]!["gateway"]!.ToString());
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/admin/billing/checkout", new { planCode = "pro" })).StatusCode);

        // A store paying through Razorpay can't be given a manual plan on top.
        var (payer, payerMe) = await F.NewMerchantAsync();
        await SubscribeAsync(payer, "basic");
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/api/platform/tenants/{ApiFactory.TenantId(payerMe)}/plan", new { planCode = "pro" })).StatusCode);

        var row = (await (await admin.GetAsync($"/api/platform/tenants?q={me["tenant"]!["slug"]}")).Json())["items"]![0]!;
        Assert.Equal("enterprise", row["plan"]!.ToString());
        Assert.Equal("manual:Active", row["billing"]!.ToString());
    }
}

/// <summary>The labelled test gateway used in development when ShopMint's Razorpay keys aren't configured.</summary>
[Collection("api")]
public class TestBillingGatewayTests(ApiFactory f) : BillingTestBase(f)
{
    [Fact]
    public async Task Test_mode_simulates_payment_and_renewals_without_razorpay()
    {
        await using var dev = F.WithWebHostBuilder(b => b.UseSetting("Billing:Razorpay:KeyId", ""));
        HttpClient Client()
        {
            var c = dev.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = true, AllowAutoRedirect = false });
            c.DefaultRequestHeaders.Add("X-ShopMint-Csrf", "1");
            return c;
        }
        var owner = Client();
        var sub = "t" + Guid.NewGuid().ToString("N")[..10];
        (await owner.PostAsJsonAsync("/api/auth/signup", new { name = "Dev Owner", email = $"{sub}@example.com", password = ApiFactory.Password, storeName = "Dev Store", subdomain = sub })).EnsureSuccessStatusCode();

        var b = await BillingAsync(owner);
        Assert.True(b["isTestMode"]!.GetValue<bool>());
        var c = await (await owner.PostAsJsonAsync("/api/admin/billing/checkout", new { planCode = "pro" })).Json();
        Assert.True(c["isTest"]!.GetValue<bool>());
        Assert.Null(c["keyId"]);
        var subId = c["subscriptionId"]!.ToString();
        Assert.StartsWith("sub_test_", subId);
        Assert.False(F.Razorpay.Subscriptions.ContainsKey(subId)); // never sent to Razorpay

        var declined = await (await owner.PostAsJsonAsync("/api/admin/billing/test-payment", new { subscriptionId = subId, outcome = "failure" })).Json();
        Assert.False(declined["paid"]!.GetValue<bool>());
        var paid = await (await owner.PostAsJsonAsync("/api/admin/billing/test-payment", new { subscriptionId = subId, outcome = "success" })).Json();
        Assert.True(paid["paid"]!.GetValue<bool>());
        Assert.Equal("Trialing", paid["billing"]!["status"]!.ToString());
        Assert.Equal("pro", paid["billing"]!["planCode"]!.ToString());

        // Trial ends: the job stands in for Razorpay's first charge.
        var tid = Guid.Parse((await (await owner.GetAsync("/api/auth/me")).Json())["tenant"]!["id"]!.ToString());
        await EndTrialAsync(tid);
        await BillingJob.RunOnceAsync(dev.Services.GetRequiredService<IServiceScopeFactory>(), DateTimeOffset.UtcNow, CancellationToken.None);
        b = await BillingAsync(owner);
        Assert.Equal("Active", b["status"]!.ToString());
        Assert.Equal("2948.82", b["invoices"]![0]!["amount"]!.ToString());

        // Another store can't pay for (or see) this checkout.
        var intruder = Client();
        var sub2 = "t" + Guid.NewGuid().ToString("N")[..10];
        (await intruder.PostAsJsonAsync("/api/auth/signup", new { name = "Other", email = $"{sub2}@example.com", password = ApiFactory.Password, storeName = "Other", subdomain = sub2 })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.PostAsJsonAsync("/api/admin/billing/test-payment", new { subscriptionId = subId, outcome = "success" })).StatusCode);
    }
}
