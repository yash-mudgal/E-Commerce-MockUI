using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;

namespace ShopMint.Api.Modules.Orders;

/// <summary>
/// Razorpay webhooks, one URL per store (/api/webhooks/razorpay/{tenantId}). The tenant in the URL only selects which
/// store's webhook secret to check: the HMAC signature over the raw body proves the event came from that store's
/// Razorpay account. Orders are found through our stored gateway order IDs, never from payload notes. Each event is
/// recorded in an inbox so redeliveries are ignored; all handlers are idempotent anyway.
/// </summary>
public static class RazorpayWebhookEndpoint
{
    public static void Map(RouteGroupBuilder api) =>
        api.MapPost("/webhooks/razorpay/{tenantId:guid}", Handle).WithTags("Webhooks").AllowAnonymous().DisableAntiforgery();

    private static async Task<IResult> Handle(Guid tenantId, HttpContext http, TenantContext tenant, AppDbContext db, SecretBox box,
        OrderService orders, ILoggerFactory lf, CancellationToken ct)
    {
        var log = lf.CreateLogger("ShopMint.Webhooks");
        http.Request.EnableBuffering();
        string body;
        using (var reader = new StreamReader(http.Request.Body, Encoding.UTF8, leaveOpen: true)) body = await reader.ReadToEndAsync(ct);
        if (body.Length > 1_000_000) return Results.StatusCode(413);

        tenant.Set(tenantId, null);
        var settings = await db.PaymentSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (settings is null || !box.Available) return Results.NotFound();
        if (!PaymentMath.VerifyWebhookSignature(box.Open(settings.RazorpayWebhookSecretEnc), body, http.Request.Headers["X-Razorpay-Signature"]))
        {
            log.LogWarning("Rejected Razorpay webhook with a bad signature for tenant {TenantId}", tenantId);
            return Results.Unauthorized();
        }

        var eventId = http.Request.Headers["X-Razorpay-Event-Id"].ToString();
        if (string.IsNullOrEmpty(eventId)) eventId = "sha256:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(body)));
        if (await db.WebhookEvents.AnyAsync(e => e.Gateway == "razorpay" && e.EventId == eventId, ct)) return Results.Ok(new { duplicate = true });

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var type = root.TryGetProperty("event", out var ev) ? ev.GetString() ?? "" : "";
        var payload = root.TryGetProperty("payload", out var p) ? p : default;

        switch (type)
        {
            case "payment.captured":
            case "order.paid":
                if (Entity(payload, "payment") is { } pay && Str(pay, "order_id") is { } orderId && Str(pay, "id") is { } paymentId
                    && pay.TryGetProperty("amount", out var amount))
                    await orders.MarkPaidAsync(orderId, paymentId, amount.GetInt64(), "webhook", ct);
                break;
            case "payment.failed":
                if (Entity(payload, "payment") is { } failed && Str(failed, "order_id") is { } failedOrder)
                    await orders.MarkFailedAsync(failedOrder, Str(failed, "error_description"), ct);
                break;
            case "refund.processed":
            case "refund.failed":
                if (Entity(payload, "refund") is { } refund && Str(refund, "id") is { } refundId)
                    await orders.RefundUpdatedAsync(refundId, type == "refund.processed", ct);
                break;
            default:
                log.LogInformation("Ignoring Razorpay event {EventType}", type);
                break;
        }

        db.WebhookEvents.Add(new WebhookEvent { Gateway = "razorpay", EventId = eventId, EventType = type.Length > 60 ? type[..60] : type, ReceivedAt = DateTimeOffset.UtcNow });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { /* the same event processed concurrently; its effects are idempotent */ }
        return Results.Ok(new { received = true });
    }

    private static JsonElement? Entity(JsonElement payload, string name) =>
        payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty(name, out var wrapper) && wrapper.TryGetProperty("entity", out var e) ? e : null;

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>Every minute: unpaid orders past their 15-minute window are reconciled with the gateway, then expired.</summary>
public sealed class OrderExpiryJob(IServiceScopeFactory scopes, ILogger<OrderExpiryJob> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await RunOnceAsync(scopes, stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Order expiry run failed"); }
        }
    }

    public static async Task<int> RunOnceAsync(IServiceScopeFactory scopes, CancellationToken ct)
    {
        List<(Guid Id, Guid TenantId)> due;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var platform = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
            var now = DateTimeOffset.UtcNow;
            due = (await platform.Orders.AsNoTracking().Where(o => o.Status == OrderStatus.PendingPayment && o.ReservedUntil < now)
                .OrderBy(o => o.ReservedUntil).Take(200).Select(o => new { o.Id, o.TenantId }).ToListAsync(ct))
                .Select(x => (x.Id, x.TenantId)).ToList();
        }
        foreach (var (id, tid) in due)
        {
            // Each order runs in its own scope under its own tenant, so RLS and the tenant filters apply as for a request.
            await using var scope = scopes.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tid, null);
            await scope.ServiceProvider.GetRequiredService<OrderService>().ReconcileOrExpireAsync(id, ct);
        }
        return due.Count;
    }
}
