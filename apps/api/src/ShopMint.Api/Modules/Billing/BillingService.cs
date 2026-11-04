using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Notifications;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Modules.Platform;
using ShopMint.Api.Modules.Storefront;

namespace ShopMint.Api.Modules.Billing;

public sealed record BillingState(TenantStatus Status, string PlanCode, SuspensionReason? Reason, DateTimeOffset? GraceEndsAt);

/// <summary>
/// The subscription lifecycle as a pure function (ADR-030): a store's status and plan are derived from its open
/// subscriptions, its trial and any platform suspension, never set ad hoc. Every billing event (checkout, webhook,
/// job, platform action) updates subscriptions and then re-derives.
/// </summary>
public static class BillingRules
{
    public static readonly TimeSpan Grace = TimeSpan.FromDays(7);

    private static int Priority(SubscriptionStatus s) => s switch
    {
        SubscriptionStatus.Active => 0,
        SubscriptionStatus.Pending => 1,
        SubscriptionStatus.Authenticated => 2,
        _ => 3, // Halted, Paused
    };

    public static Subscription? Best(IEnumerable<Subscription> subs) =>
        subs.Where(s => s.IsOpen).OrderBy(s => Priority(s.Status)).ThenByDescending(s => s.CreatedAt).FirstOrDefault();

    public static BillingState Derive(SuspensionReason? reason, DateTimeOffset? trialEndsAt, DateTimeOffset? graceEndsAt, string currentPlan,
        IReadOnlyCollection<Subscription> subs, DateTimeOffset now)
    {
        var best = Best(subs);
        var plan = best?.PlanCode ?? (trialEndsAt > now ? Plans.TrialCode : currentPlan);
        if (reason == SuspensionReason.Platform) return new(TenantStatus.Suspended, plan, reason, graceEndsAt);

        BillingState Dunning()
        {
            var grace = graceEndsAt ?? now + Grace;
            return now >= grace ? new(TenantStatus.Suspended, plan, SuspensionReason.PaymentFailed, grace) : new(TenantStatus.PastDue, plan, null, grace);
        }

        switch (best?.Status)
        {
            case SubscriptionStatus.Active:
                return new(TenantStatus.Active, plan, null, null);
            case SubscriptionStatus.Pending:
                return Dunning();
            case SubscriptionStatus.Authenticated:
                // Payment method set up; the first charge happens when the trial (or the previous plan) ends.
                return trialEndsAt > now ? new(TenantStatus.Trialing, plan, null, null) : Dunning();
            case SubscriptionStatus.Halted or SubscriptionStatus.Paused:
                return new(TenantStatus.Suspended, plan, SuspensionReason.PaymentFailed, graceEndsAt);
        }
        if (trialEndsAt > now) return new(TenantStatus.Trialing, Plans.TrialCode, null, null);
        // A store that paid at some point and then ended its subscription is cancelled; one that never paid has an expired trial.
        var everPaid = subs.Any(s => s.CurrentPeriodStart is not null && s.Status is SubscriptionStatus.Cancelled or SubscriptionStatus.Completed or SubscriptionStatus.Expired);
        return everPaid ? new(TenantStatus.Cancelled, currentPlan, null, null) : new(TenantStatus.Suspended, Plans.TrialCode, SuspensionReason.TrialExpired, null);
    }

    /// <summary>Why a plan can't hold the store's current data, or null if it fits.</summary>
    public static string? DoesNotFit(PlanDefinition plan, BillingUsage usage)
    {
        if (plan.MaxProducts is { } p && usage.Products > p) return $"You have {usage.Products} products; {plan.Name} allows {p}. Archive some first.";
        if (plan.MaxStaff is { } s && usage.Staff > s) return $"You have {usage.Staff} team members or invitations; {plan.Name} includes {s}. Remove some first.";
        if (plan.MaxLocations is { } l && usage.Locations > l) return $"You have {usage.Locations} stock locations; {plan.Name} includes {l}. Remove some first.";
        return null;
    }
}

public sealed record BillingUsage(int Products, int Staff, int Locations);
public sealed record BillingSubscriptionDto(Guid Id, string PlanCode, string PlanName, string Gateway, string Status, DateTimeOffset? StartAt,
    DateTimeOffset? CurrentPeriodEnd, bool CancelAtPeriodEnd, string? PendingPlanCode);
public sealed record BillingPlanOption(string Code, string Name, decimal MonthlyPrice, decimal MonthlyPriceWithGst, int? MaxProducts, int? MaxStaff,
    int? MaxLocations, string Action, bool Available, string? UnavailableReason);
public sealed record BillingInvoiceDto(Guid Id, string PlanCode, decimal Amount, DateTimeOffset PaidAt, DateTimeOffset? PeriodStart, DateTimeOffset? PeriodEnd,
    string? InvoiceUrl, string Reference);
public sealed record BillingOverview(string Status, string PlanCode, string PlanName, string? SuspensionReason, DateTimeOffset? TrialEndsAt,
    DateTimeOffset? GraceEndsAt, BillingSubscriptionDto? Subscription, BillingUsage Usage, PlanDefinition Limits, IReadOnlyList<BillingPlanOption> Plans,
    IReadOnlyList<BillingInvoiceDto> Invoices, bool GatewayAvailable, bool IsTestMode, decimal GstRate);
public sealed record BillingCheckout(string SubscriptionId, string Gateway, bool IsTest, string? KeyId, string PlanName, decimal AmountWithGst,
    DateTimeOffset? StartAt, string StoreName, string Email);

public sealed class BillingService(AppDbContext db, TenantContext tenant, PlanCatalog plans, BillingGatewayResolver gateways, EmailOutbox email,
    AuditWriter audit, IMemoryCache cache, IStorefrontRevalidator revalidator, IConfiguration config, ILogger<BillingService> log)
{
    private Guid Tid => tenant.RequireTenant();

    // ---------- Reads ----------

    public async Task<BillingUsage> UsageAsync(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var tid = Tid;
        return new BillingUsage(
            await db.Products.CountAsync(p => p.Status != ProductStatus.Archived, ct),
            await db.Memberships.CountAsync(m => m.TenantId == tid && m.Role != MemberRole.Owner && m.Status == MembershipStatus.Active, ct)
                + await db.Invitations.CountAsync(i => i.AcceptedAt == null && i.RevokedAt == null && i.ExpiresAt > now, ct),
            await db.Locations.CountAsync(ct));
    }

    public async Task<BillingOverview> OverviewAsync(CancellationToken ct)
    {
        var t = await db.Tenants.AsNoTracking().FirstAsync(x => x.Id == Tid, ct);
        var subs = await db.Subscriptions.AsNoTracking().ToListAsync(ct);
        var best = BillingRules.Best(subs);
        var all = await plans.AllAsync(ct);
        var current = await plans.GetAsync(t.PlanCode, ct);
        var usage = await UsageAsync(ct);
        var gateway = gateways.Current;
        var bestPrice = best is null ? 0 : all.FirstOrDefault(p => p.Code == best.PlanCode)?.MonthlyPrice ?? 0;
        var options = all.Where(p => p.IsPublic && p.Code != Plans.TrialCode).Select(p => Option(p, best, bestPrice, usage, gateway, t)).ToList();
        var invoices = (await db.BillingInvoices.AsNoTracking().OrderByDescending(i => i.PaidAt).Take(24).ToListAsync(ct))
            .Select(i => new BillingInvoiceDto(i.Id, i.PlanCode, i.Amount, i.PaidAt, i.PeriodStart, i.PeriodEnd, i.InvoiceUrl, i.GatewayInvoiceId ?? i.GatewayPaymentId)).ToList();
        var subDto = best is null ? null : new BillingSubscriptionDto(best.Id, best.PlanCode, (await plans.GetAsync(best.PlanCode, ct)).Name, best.Gateway,
            best.Status.ToString(), best.StartAt, best.CurrentPeriodEnd, best.CancelAtPeriodEnd, best.PendingPlanCode);
        return new BillingOverview(t.Status.ToString(), t.PlanCode, current.Name, t.SuspensionReason?.ToString(), t.TrialEndsAt, t.GraceEndsAt, subDto,
            usage, current, options, invoices, gateway is not null, gateway?.IsTest == true, Plans.GstRate);
    }

    private static BillingPlanOption Option(PlanDefinition p, Subscription? best, decimal bestPrice, BillingUsage usage, IBillingGateway? gateway, Tenant t)
    {
        string action;
        string? why = null;
        if (t.SuspensionReason == SuspensionReason.Platform) { action = "none"; why = "Your store is suspended by ShopMint. Contact support."; }
        else if (best?.Gateway == "manual") { action = p.Code == best.PlanCode ? "current" : "none"; why = action == "none" ? "Your plan is managed by ShopMint. Contact support to change it." : null; }
        else if (best is { Status: SubscriptionStatus.Active, CancelAtPeriodEnd: false })
            action = p.Code == best.PlanCode ? "current" : p.MonthlyPrice > bestPrice ? "upgrade" : "downgrade";
        else if (best is { Status: SubscriptionStatus.Authenticated } && best.PlanCode == p.Code) action = "current";
        else action = "subscribe";

        if (why is null && action is not "current")
        {
            why = BillingRules.DoesNotFit(p, usage);
            if (why is null && gateway is null) why = "Online billing isn't available yet. Contact support.";
            if (why is null && gateway is { IsTest: false } && string.IsNullOrEmpty(p.RazorpayPlanId)) why = "This plan can't be bought online yet. Contact support.";
        }
        return new BillingPlanOption(p.Code, p.Name, p.MonthlyPrice, Plans.WithGst(p.MonthlyPrice), p.MaxProducts, p.MaxStaff, p.MaxLocations, action,
            action is not ("none" or "current") && why is null, why);
    }

    // ---------- Merchant actions ----------

    public async Task<BillingCheckout> CheckoutAsync(string planCode, CancellationToken ct)
    {
        var tid = Tid;
        var plan = await PurchasableAsync(planCode, ct);
        var t = await db.Tenants.AsNoTracking().FirstAsync(x => x.Id == tid, ct);
        if (t.SuspensionReason == SuspensionReason.Platform) throw AppException.Forbidden("Your store is suspended by ShopMint. Contact support.");
        var subs = await db.Subscriptions.AsNoTracking().ToListAsync(ct);
        var best = BillingRules.Best(subs);
        if (best?.Gateway == "manual") throw AppException.Conflict("Your plan is managed by ShopMint. Contact support to change it.");
        if (best is { Status: SubscriptionStatus.Active, CancelAtPeriodEnd: false })
            throw AppException.Conflict("You already have an active subscription. Change your plan instead.");
        if (BillingRules.DoesNotFit(plan, await UsageAsync(ct)) is { } why) throw AppException.Unprocessable(ProblemTypes.EntitlementExceeded, why);
        var gateway = RequireGateway(plan);

        // Charge when the trial (or the plan being cancelled) ends, so nobody pays twice for the same days.
        var now = DateTimeOffset.UtcNow;
        DateTimeOffset? startAt = t.TrialEndsAt > now.AddMinutes(10) && best is not { Status: SubscriptionStatus.Pending or SubscriptionStatus.Halted }
            ? t.TrialEndsAt
            : best is { Status: SubscriptionStatus.Active, CancelAtPeriodEnd: true, CurrentPeriodEnd: { } end } && end > now ? end : null;

        GatewaySubscription created;
        try { created = await gateway.CreateAsync(plan.RazorpayPlanId, startAt, tid, ct); }
        catch (Exception e) when (e is PaymentGatewayException or HttpRequestException or TaskCanceledException)
        {
            log.LogError(e, "Could not create a subscription for tenant {TenantId}", tid);
            throw new AppException(502, ProblemTypes.PaymentsUnavailable, "We couldn't start the subscription.", "Nothing was charged. Please try again in a moment.");
        }
        // Earlier checkouts that were never completed are abandoned.
        foreach (var stale in await db.Subscriptions.Where(s => s.Status == SubscriptionStatus.Created).ToListAsync(ct)) { stale.Status = SubscriptionStatus.Expired; stale.EndedAt = now; }
        db.Subscriptions.Add(new Subscription
        {
            Id = Guid.CreateVersion7(), PlanCode = plan.Code, Gateway = gateway.Name, GatewaySubscriptionId = created.Id, Status = SubscriptionStatus.Created,
            StartAt = startAt, CreatedAt = now, UpdatedAt = now,
        });
        audit.Record(db, "billing.checkout_started", "subscription", null, new { plan = plan.Code, gateway = gateway.Name });
        await db.SaveChangesAsync(ct);
        return new BillingCheckout(created.Id, gateway.Name, gateway.IsTest, gateway.KeyId, plan.Name, Plans.WithGst(plan.MonthlyPrice), startAt, t.Name,
            await OwnerEmailsAsync(ct) is [var first, ..] ? first : "");
    }

    /// <summary>Razorpay Checkout's callback: the signature and a server-side read of the subscription prove the mandate.</summary>
    public async Task VerifyAsync(string paymentId, string subscriptionId, string signature, CancellationToken ct)
    {
        var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.GatewaySubscriptionId == subscriptionId && s.Gateway == "razorpay", ct)
            ?? throw new AppException(400, ProblemTypes.PaymentVerification, "This subscription doesn't belong to your store.");
        var gateway = gateways.ByName("razorpay")!;
        if (!gateway.VerifyCheckout(paymentId, subscriptionId, signature))
        {
            log.LogWarning("Bad subscription checkout signature for tenant {TenantId}", Tid);
            throw new AppException(400, ProblemTypes.PaymentVerification, "We couldn't verify this payment.", "If money was taken, your subscription will update automatically.");
        }
        var fetched = await gateway.GetAsync(subscriptionId, ct);
        if (fetched is null || fetched.Status is not (SubscriptionStatus.Authenticated or SubscriptionStatus.Active))
            throw new AppException(400, ProblemTypes.PaymentVerification, "The payment isn't complete yet.", "Your subscription will update as soon as Razorpay confirms it.");
        await MutateAsync(async () =>
        {
            await UpdateFromGatewayAsync(sub, fetched, ct);
            await ReplaceOthersAsync(sub, ct);
        }, ct);
    }

    /// <summary>Test mode only: simulates the merchant completing (or failing) the subscription payment.</summary>
    public async Task<bool> TestPaymentAsync(string subscriptionId, bool success, CancellationToken ct)
    {
        if (gateways.Current is not { IsTest: true }) throw AppException.NotFound("Subscription");
        var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.GatewaySubscriptionId == subscriptionId && s.Gateway == "test", ct)
            ?? throw AppException.NotFound("Subscription");
        if (sub.Status != SubscriptionStatus.Created) throw new AppException(409, ProblemTypes.InvalidStateTransition, "This checkout is already complete.");
        if (!success) return false;
        await MutateAsync(async () =>
        {
            var now = DateTimeOffset.UtcNow;
            if (sub.StartAt > now) sub.Status = SubscriptionStatus.Authenticated;
            else await StartTestPeriodAsync(sub, now, ct);
            sub.UpdatedAt = now;
            await ReplaceOthersAsync(sub, ct);
        }, ct);
        return true;
    }

    public async Task ChangePlanAsync(string planCode, CancellationToken ct)
    {
        var plan = await PurchasableAsync(planCode, ct);
        var sub = BillingRules.Best(await db.Subscriptions.ToListAsync(ct));
        if (sub is not { Status: SubscriptionStatus.Active } || sub.Gateway == "manual" || sub.CancelAtPeriodEnd)
            throw new AppException(409, ProblemTypes.InvalidStateTransition, "Plans can be changed on an active subscription. Subscribe to a plan instead.");
        if (sub.PlanCode == plan.Code && sub.PendingPlanCode is null) throw AppException.Invalid("planCode", "You're already on this plan.");
        if (BillingRules.DoesNotFit(plan, await UsageAsync(ct)) is { } why) throw AppException.Unprocessable(ProblemTypes.EntitlementExceeded, why);
        var currentPlan = await plans.GetAsync(sub.PlanCode, ct);
        var upgrade = plan.MonthlyPrice > currentPlan.MonthlyPrice || plan.Code == sub.PlanCode; // same plan = cancel a scheduled downgrade
        var gateway = gateways.ByName(sub.Gateway) ?? throw new AppException(503, ProblemTypes.PaymentsUnavailable, "Billing isn't available right now.");
        if (!gateway.IsTest && string.IsNullOrEmpty(plan.RazorpayPlanId))
            throw AppException.Unprocessable(ProblemTypes.PaymentsUnavailable, "This plan can't be bought online yet. Contact support.");
        try { await gateway.ChangePlanAsync(sub.GatewaySubscriptionId!, plan.RazorpayPlanId, upgrade, ct); }
        catch (Exception e) when (e is PaymentGatewayException or HttpRequestException or TaskCanceledException)
        {
            log.LogError(e, "Could not change plan for tenant {TenantId}", Tid);
            throw new AppException(502, ProblemTypes.PaymentsUnavailable, "We couldn't change your plan.", "Nothing changed. Please try again in a moment.");
        }
        await MutateAsync(() =>
        {
            // Upgrades apply now (Razorpay charges the new plan); downgrades when the paid period ends.
            if (upgrade) { sub.PlanCode = plan.Code; sub.PendingPlanCode = null; }
            else sub.PendingPlanCode = plan.Code;
            sub.UpdatedAt = DateTimeOffset.UtcNow;
            audit.Record(db, upgrade ? "billing.plan_upgraded" : "billing.downgrade_scheduled", "subscription", sub.Id, new { plan = plan.Code });
            return Task.CompletedTask;
        }, ct);
    }

    public async Task CancelAsync(CancellationToken ct)
    {
        var sub = BillingRules.Best(await db.Subscriptions.ToListAsync(ct)) ?? throw AppException.Conflict("There's no subscription to cancel.");
        if (sub.Gateway == "manual") throw AppException.Conflict("Your plan is managed by ShopMint. Contact support to change it.");
        if (sub.CancelAtPeriodEnd) return;
        var atPeriodEnd = sub.Status == SubscriptionStatus.Active;
        var gateway = gateways.ByName(sub.Gateway) ?? throw new AppException(503, ProblemTypes.PaymentsUnavailable, "Billing isn't available right now.");
        try { await gateway.CancelAsync(sub.GatewaySubscriptionId!, atPeriodEnd, ct); }
        catch (Exception e) when (e is PaymentGatewayException or HttpRequestException or TaskCanceledException)
        {
            log.LogError(e, "Could not cancel subscription for tenant {TenantId}", Tid);
            throw new AppException(502, ProblemTypes.PaymentsUnavailable, "We couldn't cancel the subscription.", "Nothing changed. Please try again in a moment.");
        }
        await MutateAsync(() =>
        {
            var now = DateTimeOffset.UtcNow;
            if (atPeriodEnd) sub.CancelAtPeriodEnd = true;
            else { sub.Status = SubscriptionStatus.Cancelled; sub.EndedAt = now; }
            sub.UpdatedAt = now;
            audit.Record(db, "billing.cancelled", "subscription", sub.Id, new { atPeriodEnd });
            return Task.CompletedTask;
        }, ct);
    }

    // ---------- Gateway events, jobs and platform ----------

    /// <summary>
    /// A signed webhook for one of this store's subscriptions. For Razorpay the subscription is read back from the
    /// API (the webhook is a trigger, so out-of-order deliveries can't move it backwards); test subscriptions use the payload.
    /// </summary>
    public async Task ApplyWebhookAsync(string subscriptionId, string eventType, JsonElement? subEntity, JsonElement? payment, JsonElement? invoice, CancellationToken ct)
    {
        var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.GatewaySubscriptionId == subscriptionId, ct);
        if (sub is null) return;
        GatewaySubscription? state = null;
        if (sub.Gateway == "razorpay")
        {
            try { state = await gateways.ByName("razorpay")!.GetAsync(subscriptionId, ct); }
            catch (Exception e) when (e is PaymentGatewayException or HttpRequestException or TaskCanceledException)
            {
                log.LogWarning(e, "Couldn't read subscription {SubscriptionId}; using the webhook payload", subscriptionId);
            }
        }
        if (state is null && subEntity is { } se) state = FromEntity(se);
        await MutateAsync(async () =>
        {
            if (state is not null) await UpdateFromGatewayAsync(sub, state, ct);
            if (eventType == "subscription.charged" && payment is { } p && Str(p, "id") is { } pid && p.TryGetProperty("amount", out var amt))
                await RecordInvoiceAsync(sub, pid, amt.GetInt64(), null, null, ct);
            if (eventType == "invoice.paid" && invoice is { } inv && Str(inv, "payment_id") is { } ipid)
                await RecordInvoiceAsync(sub, ipid, inv.TryGetProperty("amount_paid", out var ap) ? ap.GetInt64() : 0, Str(inv, "id"), Str(inv, "short_url"), ct);
            if (sub.Status is SubscriptionStatus.Authenticated or SubscriptionStatus.Active) await ReplaceOthersAsync(sub, ct);
        }, ct);
    }

    /// <summary>Background reconciliation: trial reminders, missed webhooks, test-mode renewals, then re-derive.</summary>
    public async Task ReconcileAsync(DateTimeOffset now, CancellationToken ct)
    {
        var subs = await db.Subscriptions.Where(s => s.Status != SubscriptionStatus.Cancelled && s.Status != SubscriptionStatus.Completed && s.Status != SubscriptionStatus.Expired).ToListAsync(ct);
        foreach (var sub in subs.Where(s => s.Gateway == "razorpay" && s.Status != SubscriptionStatus.Created))
        {
            try { if (await gateways.ByName("razorpay")!.GetAsync(sub.GatewaySubscriptionId!, ct) is { } fresh) await UpdateFromGatewayAsync(sub, fresh, ct); }
            catch (Exception e) when (e is PaymentGatewayException or HttpRequestException or TaskCanceledException)
            {
                log.LogWarning(e, "Couldn't reconcile subscription {SubscriptionId}", sub.GatewaySubscriptionId);
            }
        }
        await MutateAsync(async () =>
        {
            foreach (var sub in subs)
            {
                if (sub.Status == SubscriptionStatus.Created && sub.CreatedAt < now.AddDays(-1)) { sub.Status = SubscriptionStatus.Expired; sub.EndedAt = now; }
                if (sub.Gateway != "test") continue;
                // Test mode stands in for Razorpay's scheduler: first charge at the start date, renewals, scheduled changes.
                if (sub.Status == SubscriptionStatus.Authenticated && sub.StartAt <= now) await StartTestPeriodAsync(sub, now, ct);
                else if (sub.Status == SubscriptionStatus.Active && sub.CurrentPeriodEnd <= now)
                {
                    if (sub.CancelAtPeriodEnd) { sub.Status = SubscriptionStatus.Cancelled; sub.EndedAt = now; }
                    else
                    {
                        if (sub.PendingPlanCode is { } next) { sub.PlanCode = next; sub.PendingPlanCode = null; }
                        await StartTestPeriodAsync(sub, sub.CurrentPeriodEnd!.Value, ct);
                    }
                }
                sub.UpdatedAt = now;
            }
            var t = await db.Tenants.FirstAsync(x => x.Id == Tid, ct);
            if (t.Status == TenantStatus.Trialing && t.TrialReminderSentAt is null && t.TrialEndsAt is { } end && end > now && end <= now.AddDays(3)
                && !subs.Any(s => s.Status is SubscriptionStatus.Authenticated or SubscriptionStatus.Active))
            {
                t.TrialReminderSentAt = now;
                foreach (var to in await OwnerEmailsAsync(ct)) email.TrialEnding(db, Tid, to, t.Name, BillingUrl, end);
            }
        }, ct, now);
    }

    /// <summary>Platform: suspend or lift a platform suspension. Lifting re-derives the billing state rather than forcing Active.</summary>
    public Task SetPlatformSuspensionAsync(bool suspended, string? reason, Guid? actor, CancellationToken ct) => MutateAsync(async () =>
    {
        var t = await db.Tenants.FirstAsync(x => x.Id == Tid, ct);
        if (suspended) t.SuspensionReason = SuspensionReason.Platform;
        else if (t.SuspensionReason == SuspensionReason.Platform) t.SuspensionReason = null;
        audit.Record(db, suspended ? "tenant.suspended" : "tenant.reactivated", "tenant", Tid, new { reason }, actorOverride: actor);
    }, ct);

    /// <summary>Platform: assign a plan without payment (e.g. an enterprise contract), or end a manual plan (null).</summary>
    public Task AssignManualPlanAsync(string? planCode, string? note, Guid? actor, CancellationToken ct) => MutateAsync(async () =>
    {
        var subs = await db.Subscriptions.ToListAsync(ct);
        if (subs.Any(s => s.IsOpen && s.Gateway != "manual"))
            throw AppException.Conflict("This store pays through a subscription. They need to cancel it before a plan can be assigned.");
        var now = DateTimeOffset.UtcNow;
        foreach (var m in subs.Where(s => s.IsOpen && s.Gateway == "manual")) { m.Status = SubscriptionStatus.Cancelled; m.EndedAt = now; m.UpdatedAt = now; }
        if (planCode is not null)
        {
            var plan = await plans.GetAsync(planCode, ct);
            if (plan.Code != planCode || plan.Code == Plans.TrialCode) throw AppException.Invalid("planCode", "Choose a paid plan.");
            db.Subscriptions.Add(new Subscription
            {
                Id = Guid.CreateVersion7(), PlanCode = plan.Code, Gateway = "manual", Status = SubscriptionStatus.Active, CurrentPeriodStart = now,
                Note = note, CreatedAt = now, UpdatedAt = now,
            });
        }
        audit.Record(db, "billing.plan_assigned", "tenant", Tid, new { plan = planCode, note }, actorOverride: actor);
    }, ct);

    // ---------- Internals ----------

    private string BillingUrl => $"{(config["App:PublicUrl"] ?? "").TrimEnd('/')}/admin/billing";

    private async Task<PlanDefinition> PurchasableAsync(string code, CancellationToken ct)
    {
        var plan = (await plans.AllAsync(ct)).FirstOrDefault(p => p.Code == code);
        if (plan is null || !plan.IsPublic || plan.Code == Plans.TrialCode) throw AppException.Invalid("planCode", "Choose one of the plans shown.");
        return plan;
    }

    private IBillingGateway RequireGateway(PlanDefinition plan)
    {
        var gateway = gateways.Current ?? throw new AppException(503, ProblemTypes.PaymentsUnavailable, "Online billing isn't available yet.", "Contact support to choose a plan.");
        if (!gateway.IsTest && string.IsNullOrEmpty(plan.RazorpayPlanId))
            throw AppException.Unprocessable(ProblemTypes.PaymentsUnavailable, "This plan can't be bought online yet. Contact support.");
        return gateway;
    }

    private async Task UpdateFromGatewayAsync(Subscription sub, GatewaySubscription g, CancellationToken ct)
    {
        if (g.Status != SubscriptionStatus.Created || sub.Status == SubscriptionStatus.Created) sub.Status = g.Status;
        if (g.CurrentStart is not null) sub.CurrentPeriodStart = g.CurrentStart;
        if (g.CurrentEnd is not null) sub.CurrentPeriodEnd = g.CurrentEnd;
        if (g.PlanId is { Length: > 0 } pid && (await plans.AllAsync(ct)).FirstOrDefault(p => p.RazorpayPlanId == pid) is { } mapped && mapped.Code != sub.PlanCode)
        {
            sub.PlanCode = mapped.Code;
            if (sub.PendingPlanCode == mapped.Code) sub.PendingPlanCode = null;
        }
        if (sub.Status is SubscriptionStatus.Cancelled or SubscriptionStatus.Completed or SubscriptionStatus.Expired) sub.EndedAt ??= DateTimeOffset.UtcNow;
        sub.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private static GatewaySubscription FromEntity(JsonElement e) => new(Str(e, "id") ?? "", Str(e, "plan_id"), BillingStatuses.Parse(Str(e, "status")),
        BillingStatuses.FromUnix(Long(e, "current_start")), BillingStatuses.FromUnix(Long(e, "current_end")), BillingStatuses.FromUnix(Long(e, "start_at")), Str(e, "short_url"));

    private static string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static long? Long(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : null;

    /// <summary>Once a new subscription is set up, earlier open ones end now (a plan being cancelled at period end keeps running).</summary>
    private async Task ReplaceOthersAsync(Subscription keep, CancellationToken ct)
    {
        var others = await db.Subscriptions.Where(s => s.Id != keep.Id).ToListAsync(ct);
        foreach (var o in others.Where(o => o.IsOpen && o.Gateway != "manual" && !(o.Status == SubscriptionStatus.Active && o.CancelAtPeriodEnd)))
        {
            if (gateways.ByName(o.Gateway) is { } g && o.GatewaySubscriptionId is { } gid)
            {
                try { await g.CancelAsync(gid, atPeriodEnd: false, ct); }
                catch (Exception e) when (e is PaymentGatewayException or HttpRequestException or TaskCanceledException)
                {
                    log.LogError(e, "Couldn't cancel replaced subscription {SubscriptionId}; cancel it in the Razorpay Dashboard", gid);
                }
            }
            o.Status = SubscriptionStatus.Cancelled;
            o.EndedAt = DateTimeOffset.UtcNow;
            o.UpdatedAt = DateTimeOffset.UtcNow;
        }
    }

    private async Task StartTestPeriodAsync(Subscription sub, DateTimeOffset from, CancellationToken ct)
    {
        sub.Status = SubscriptionStatus.Active;
        sub.CurrentPeriodStart = from;
        sub.CurrentPeriodEnd = from.AddMonths(1);
        var plan = await plans.GetAsync(sub.PlanCode, ct);
        await RecordInvoiceAsync(sub, "pay_test_" + Guid.NewGuid().ToString("N")[..14], PaymentMath.ToPaise(Plans.WithGst(plan.MonthlyPrice)), null, null, ct);
    }

    private async Task RecordInvoiceAsync(Subscription sub, string paymentId, long amountPaise, string? invoiceId, string? url, CancellationToken ct)
    {
        var inv = await db.BillingInvoices.FirstOrDefaultAsync(i => i.GatewayPaymentId == paymentId, ct)
            ?? db.BillingInvoices.Local.FirstOrDefault(i => i.GatewayPaymentId == paymentId);
        if (inv is null)
        {
            inv = new BillingInvoice
            {
                Id = Guid.CreateVersion7(), SubscriptionId = sub.Id, GatewayPaymentId = paymentId, PlanCode = sub.PlanCode,
                Amount = PaymentMath.FromPaise(amountPaise), PeriodStart = sub.CurrentPeriodStart, PeriodEnd = sub.CurrentPeriodEnd, PaidAt = DateTimeOffset.UtcNow,
            };
            db.BillingInvoices.Add(inv);
        }
        if (invoiceId is not null) inv.GatewayInvoiceId = invoiceId;
        if (url is not null && Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps) inv.InvoiceUrl = url;
        if (inv.Amount == 0 && amountPaise > 0) inv.Amount = PaymentMath.FromPaise(amountPaise);
    }

    private async Task<List<string>> OwnerEmailsAsync(CancellationToken ct)
    {
        var tid = Tid;
        return await db.Memberships.Where(m => m.TenantId == tid && m.Role == MemberRole.Owner && m.Status == MembershipStatus.Active)
            .Select(m => m.User!.Email).ToListAsync(ct);
    }

    /// <summary>
    /// Runs a change under the store's row lock, then re-derives the store's status and plan from its subscriptions and
    /// applies the side effects of a transition (audit, emails, session refresh, storefront refresh).
    /// </summary>
    private async Task MutateAsync(Func<Task> change, CancellationToken ct, DateTimeOffset? at = null)
    {
        var tid = Tid;
        bool changed, visibilityChanged;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await Plans.LockTenantAsync(db, tid, ct);
            await change();
            await db.SaveChangesAsync(ct);
            var t = await db.Tenants.FirstAsync(x => x.Id == tid, ct);
            var subs = await db.Subscriptions.ToListAsync(ct);
            var now = at ?? DateTimeOffset.UtcNow;
            var next = BillingRules.Derive(t.SuspensionReason, t.TrialEndsAt, t.GraceEndsAt, t.PlanCode, subs, now);
            var before = (t.Status, t.PlanCode, t.SuspensionReason, t.GraceEndsAt);
            changed = before != (next.Status, next.PlanCode, next.Reason, next.GraceEndsAt);
            var wasDown = t.Status is TenantStatus.Suspended or TenantStatus.Cancelled;
            var isDown = next.Status is TenantStatus.Suspended or TenantStatus.Cancelled;
            visibilityChanged = wasDown != isDown;
            if (changed)
            {
                var from = t.Status;
                t.Status = next.Status;
                t.PlanCode = next.PlanCode;
                t.SuspensionReason = next.Reason;
                t.GraceEndsAt = next.GraceEndsAt;
                t.UpdatedAt = DateTimeOffset.UtcNow;
                if (from != next.Status)
                {
                    audit.Record(db, "billing.status_changed", "tenant", tid, new { from = from.ToString(), to = next.Status.ToString(), plan = next.PlanCode, reason = next.Reason?.ToString() });
                    await NotifyAsync(t, from, next, ct);
                }
                await db.SaveChangesAsync(ct);
            }
            await tx.CommitAsync(ct);
        }
        if (changed) await Session.InvalidateTenantAsync(db, cache, tid, ct);
        if (visibilityChanged) revalidator.Enqueue(tid);
    }

    private async Task NotifyAsync(Tenant t, TenantStatus from, BillingState next, CancellationToken ct)
    {
        var owners = await OwnerEmailsAsync(ct);
        var plan = await plans.GetAsync(next.PlanCode, ct);
        foreach (var to in owners)
        {
            switch (next.Status)
            {
                case TenantStatus.PastDue: email.PaymentFailed(db, t.Id, to, t.Name, BillingUrl, next.GraceEndsAt!.Value); break;
                case TenantStatus.Suspended when next.Reason is SuspensionReason.PaymentFailed or SuspensionReason.TrialExpired:
                    email.StoreSuspended(db, t.Id, to, t.Name, BillingUrl, next.Reason == SuspensionReason.TrialExpired); break;
                case TenantStatus.Active when from != TenantStatus.Active: email.SubscriptionActive(db, t.Id, to, t.Name, plan.Name, BillingUrl); break;
            }
        }
    }
}

/// <summary>Runs billing work for one store in its own scope with that store's tenant context (jobs, webhooks, platform).</summary>
public static class BillingScope
{
    public static async Task RunAsync(IServiceScopeFactory scopes, Guid tenantId, Func<BillingService, Task> work)
    {
        await using var scope = scopes.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId, null);
        await work(scope.ServiceProvider.GetRequiredService<BillingService>());
    }
}
