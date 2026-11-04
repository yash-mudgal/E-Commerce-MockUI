using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Modules.Platform;

namespace ShopMint.Api.Modules.Billing;

public sealed record PlanChoiceRequest(string PlanCode);
public sealed record VerifySubscriptionRequest(string RazorpayPaymentId, string RazorpaySubscriptionId, string RazorpaySignature);
public sealed record TestSubscriptionPaymentRequest(string SubscriptionId, string Outcome);

public sealed class VerifySubscriptionValidator : AbstractValidator<VerifySubscriptionRequest>
{
    public VerifySubscriptionValidator()
    {
        RuleFor(x => x.RazorpayPaymentId).NotEmpty().MaximumLength(60);
        RuleFor(x => x.RazorpaySubscriptionId).NotEmpty().MaximumLength(60);
        RuleFor(x => x.RazorpaySignature).NotEmpty().MaximumLength(128);
    }
}

/// <summary>
/// The store's own ShopMint subscription (owner only: <c>billing.manage</c>). These routes stay writable while a store
/// is suspended or cancelled, so the owner can always pay to restore it.
/// </summary>
public static class BillingEndpoints
{
    public const string Prefix = "/api/admin/billing";

    public static void Map(RouteGroupBuilder admin)
    {
        var g = admin.MapGroup("/billing").WithTags("Billing").RequirePermission(Permissions.BillingManage);
        g.MapGet("/", (BillingService s, CancellationToken ct) => s.OverviewAsync(ct));
        g.MapPost("/checkout", (PlanChoiceRequest r, BillingService s, CancellationToken ct) => s.CheckoutAsync(r.PlanCode ?? "", ct));
        g.MapPost("/verify", async (VerifySubscriptionRequest r, BillingService s, CancellationToken ct) =>
        {
            await s.VerifyAsync(r.RazorpayPaymentId, r.RazorpaySubscriptionId, r.RazorpaySignature, ct);
            return await s.OverviewAsync(ct);
        }).Validate<VerifySubscriptionRequest>();
        g.MapPost("/test-payment", async (TestSubscriptionPaymentRequest r, BillingService s, CancellationToken ct) =>
        {
            var ok = await s.TestPaymentAsync(r.SubscriptionId ?? "", r.Outcome == "success", ct);
            return Results.Ok(new { paid = ok, billing = await s.OverviewAsync(ct) });
        });
        g.MapPost("/change-plan", async (PlanChoiceRequest r, BillingService s, CancellationToken ct) =>
        {
            await s.ChangePlanAsync(r.PlanCode ?? "", ct);
            return await s.OverviewAsync(ct);
        });
        g.MapPost("/cancel", async (BillingService s, CancellationToken ct) =>
        {
            await s.CancelAsync(ct);
            return await s.OverviewAsync(ct);
        });
    }
}

// ---------- Platform: plans and plan assignment ----------

public sealed record PlatformPlanDto(string Code, string Name, decimal MonthlyPrice, decimal MonthlyPriceWithGst, int? MaxProducts, int? MaxStaff,
    int? MaxLocations, bool CustomDomain, bool IsPublic, int SortOrder, string? RazorpayPlanId, int Stores, string Version);
public sealed record PlanUpdateRequest(string Name, decimal MonthlyPrice, int? MaxProducts, int? MaxStaff, int? MaxLocations, bool CustomDomain,
    bool IsPublic, string? RazorpayPlanId);
public sealed record AssignPlanRequest(string? PlanCode, string? Note);

public sealed class PlanUpdateValidator : AbstractValidator<PlanUpdateRequest>
{
    public PlanUpdateValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(40);
        RuleFor(x => x.MonthlyPrice).InclusiveBetween(0, 1_000_000).PrecisionScale(14, 2, true);
        RuleFor(x => x.MaxProducts).GreaterThan(0).When(x => x.MaxProducts.HasValue);
        RuleFor(x => x.MaxStaff).GreaterThanOrEqualTo(0).When(x => x.MaxStaff.HasValue);
        RuleFor(x => x.MaxLocations).GreaterThan(0).When(x => x.MaxLocations.HasValue);
        RuleFor(x => x.RazorpayPlanId).Matches("^plan_[A-Za-z0-9]{8,30}$").When(x => !string.IsNullOrEmpty(x.RazorpayPlanId))
            .WithMessage("Razorpay plan IDs look like plan_….");
    }
}

public static class PlatformBillingEndpoints
{
    public static void Map(RouteGroupBuilder platform)
    {
        platform.MapGet("/plans", ListPlans);
        platform.MapPut("/plans/{code}", UpdatePlan).Validate<PlanUpdateRequest>();
        platform.MapPost("/tenants/{id:guid}/plan", async (Guid id, AssignPlanRequest r, PlatformDbContext db, IServiceScopeFactory scopes, HttpContext http, CancellationToken ct) =>
        {
            if (!await db.Tenants.AnyAsync(t => t.Id == id, ct)) throw AppException.NotFound("Tenant");
            await BillingScope.RunAsync(scopes, id, s => s.AssignManualPlanAsync(string.IsNullOrEmpty(r.PlanCode) ? null : r.PlanCode, r.Note?.Trim(), http.User.GetUserId(), ct));
            return Results.NoContent();
        });
    }

    private static async Task<IResult> ListPlans(PlatformDbContext db, CancellationToken ct)
    {
        var counts = await db.Tenants.GroupBy(t => t.PlanCode).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        return Results.Ok((await db.Plans.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync(ct)).Select(p => new PlatformPlanDto(p.Code, p.Name, p.MonthlyPrice,
            Plans.WithGst(p.MonthlyPrice), p.MaxProducts, p.MaxStaff, p.MaxLocations, p.CustomDomain, p.IsPublic, p.SortOrder, p.RazorpayPlanId,
            counts.GetValueOrDefault(p.Code), p.Version.ToString(CultureInfo.InvariantCulture))));
    }

    private static async Task<IResult> UpdatePlan(string code, PlanUpdateRequest req, PlatformDbContext db, AuditWriter audit, IMemoryCache cache,
        HttpContext http, CancellationToken ct)
    {
        var p = await db.Plans.FirstOrDefaultAsync(x => x.Code == code, ct) ?? throw AppException.NotFound("Plan");
        var ifMatch = http.Request.Headers.IfMatch.ToString();
        if (!string.IsNullOrEmpty(ifMatch) && ifMatch.Trim('"') != p.Version.ToString(CultureInfo.InvariantCulture))
            throw AppException.Conflict("This plan was changed by someone else. Reload and try again.", ProblemTypes.Concurrency);
        if (code == Plans.TrialCode && (req.MonthlyPrice != 0 || req.IsPublic || !string.IsNullOrEmpty(req.RazorpayPlanId)))
            throw AppException.Invalid("monthlyPrice", "The trial is free, not sold and has no Razorpay plan.");
        if (!string.IsNullOrEmpty(req.RazorpayPlanId) && await db.Plans.AnyAsync(x => x.Code != code && x.RazorpayPlanId == req.RazorpayPlanId, ct))
            throw AppException.Invalid("razorpayPlanId", "Another plan already uses this Razorpay plan.");
        var before = new { p.Name, p.MonthlyPrice, p.MaxProducts, p.MaxStaff, p.MaxLocations, p.IsPublic, p.RazorpayPlanId };
        p.Name = req.Name.Trim();
        p.MonthlyPrice = req.MonthlyPrice;
        p.MaxProducts = req.MaxProducts;
        p.MaxStaff = req.MaxStaff;
        p.MaxLocations = req.MaxLocations;
        p.CustomDomain = req.CustomDomain;
        p.IsPublic = req.IsPublic;
        p.RazorpayPlanId = string.IsNullOrEmpty(req.RazorpayPlanId) ? null : req.RazorpayPlanId;
        p.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "plan.updated", "plan", null, new { code, before, after = req }, actorOverride: http.User.GetUserId());
        await db.SaveChangesAsync(ct);
        PlanCatalog.Evict(cache);
        return await ListPlans(db, ct);
    }
}

// ---------- Webhook ----------

/// <summary>
/// ShopMint's own Razorpay account's webhook (subscription events). Signed with the platform webhook secret; matched to
/// a store through our stored subscription ID only; de-duplicated; then handled in that store's scope.
/// </summary>
public static class BillingWebhookEndpoint
{
    public static void Map(RouteGroupBuilder api) =>
        api.MapPost("/webhooks/razorpay-billing", Handle).WithTags("Webhooks").AllowAnonymous().DisableAntiforgery();

    private static async Task<IResult> Handle(HttpContext http, BillingGatewayResolver gateways, PlatformDbContext platform, IServiceScopeFactory scopes,
        ILoggerFactory lf, CancellationToken ct)
    {
        var log = lf.CreateLogger("ShopMint.BillingWebhooks");
        string body;
        using (var reader = new StreamReader(http.Request.Body, Encoding.UTF8)) body = await reader.ReadToEndAsync(ct);
        if (body.Length > 1_000_000) return Results.StatusCode(413);
        if (gateways.WebhookSecret is not { } secret) return Results.NotFound();
        if (!PaymentMath.VerifyWebhookSignature(secret, body, http.Request.Headers["X-Razorpay-Signature"]))
        {
            log.LogWarning("Rejected billing webhook with a bad signature");
            return Results.Unauthorized();
        }
        var eventId = http.Request.Headers["X-Razorpay-Event-Id"].ToString();
        if (string.IsNullOrEmpty(eventId)) eventId = "sha256:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(body)));
        if (await platform.WebhookEvents.AnyAsync(e => e.Gateway == "razorpay-billing" && e.EventId == eventId, ct)) return Results.Ok(new { duplicate = true });

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var type = root.TryGetProperty("event", out var ev) ? ev.GetString() ?? "" : "";
        var payload = root.TryGetProperty("payload", out var p) ? p : default;
        var sub = Entity(payload, "subscription");
        var payment = Entity(payload, "payment");
        var invoice = Entity(payload, "invoice");
        var subscriptionId = (sub is { } s && Str(s, "id") is { } sid) ? sid : invoice is { } i ? Str(i, "subscription_id") : null;
        if (subscriptionId is null || !(type.StartsWith("subscription.", StringComparison.Ordinal) || type == "invoice.paid"))
        {
            log.LogInformation("Ignoring billing event {EventType}", type);
            return Results.Ok(new { ignored = true });
        }
        var tenantId = await platform.Subscriptions.Where(x => x.GatewaySubscriptionId == subscriptionId).Select(x => (Guid?)x.TenantId).FirstOrDefaultAsync(ct);
        if (tenantId is not { } tid)
        {
            log.LogWarning("Billing event {EventType} for unknown subscription {SubscriptionId}", type, subscriptionId);
            return Results.Ok(new { ignored = true });
        }
        await BillingScope.RunAsync(scopes, tid, svc => svc.ApplyWebhookAsync(subscriptionId, type, sub, payment, invoice, ct));
        platform.WebhookEvents.Add(new WebhookEvent { TenantId = tid, Gateway = "razorpay-billing", EventId = eventId, EventType = type.Length > 60 ? type[..60] : type, ReceivedAt = DateTimeOffset.UtcNow });
        try { await platform.SaveChangesAsync(ct); }
        catch (DbUpdateException) { /* processed concurrently; handlers are idempotent */ }
        return Results.Ok(new { received = true });
    }

    private static JsonElement? Entity(JsonElement payload, string name) =>
        payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty(name, out var w) && w.TryGetProperty("entity", out var e) ? e.Clone() : null;

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

// ---------- Job ----------

/// <summary>
/// Periodically re-derives stores whose billing state may have moved without a webhook: trials ending or ended, grace
/// periods ending, periods ending (cancellations, test-mode renewals), plus trial reminders and Razorpay reconciliation.
/// </summary>
public sealed class BillingJob(IServiceScopeFactory scopes, IConfiguration config, ILogger<BillingJob> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(config.GetValue("Billing:JobIntervalSeconds", 900)));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await RunOnceAsync(scopes, DateTimeOffset.UtcNow, stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Billing run failed"); }
        }
    }

    public static async Task<int> RunOnceAsync(IServiceScopeFactory scopes, DateTimeOffset now, CancellationToken ct)
    {
        List<Guid> due;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
            var soon = now.AddDays(3);
            var byTenant = db.Tenants.AsNoTracking().Where(t => t.SuspensionReason != SuspensionReason.Platform && (
                (t.Status == TenantStatus.Trialing && t.TrialEndsAt <= soon && (t.TrialEndsAt <= now || t.TrialReminderSentAt == null))
                || (t.Status == TenantStatus.PastDue && (t.GraceEndsAt == null || t.GraceEndsAt <= now))
                || (t.Status == TenantStatus.Suspended && t.SuspensionReason == SuspensionReason.PaymentFailed))).Select(t => t.Id);
            var bySub = db.Subscriptions.AsNoTracking().Where(s => (s.Status == SubscriptionStatus.Active && s.CurrentPeriodEnd <= now)
                || (s.Status == SubscriptionStatus.Authenticated && s.StartAt <= now)
                || (s.Status == SubscriptionStatus.Created && s.CreatedAt < now.AddDays(-1))).Select(s => s.TenantId);
            due = await byTenant.Union(bySub).Distinct().Take(500).ToListAsync(ct);
        }
        foreach (var tid in due) await BillingScope.RunAsync(scopes, tid, s => s.ReconcileAsync(now, ct));
        return due.Count;
    }
}
