using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Billing;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Modules.Reports;

namespace ShopMint.Api.Modules.Platform;

public sealed record StoreCounts(int Total, int Trialing, int Active, int PastDue, int Suspended, int Cancelled, int Launched);
public sealed record PlanRevenue(string Plan, string Name, int Stores, decimal MonthlyPrice, decimal Mrr);
public sealed record Revenue(decimal Mrr, int PayingStores, decimal PastDueMrr, IReadOnlyList<PlanRevenue> ByPlan);
public sealed record Funnel(int SignedUp, int EmailConfirmed, int AddedProduct, int Launched, int FirstOrder, int OnPaidPlan);
public sealed record Commerce(int Orders, decimal NetSales, int StoresWithOrders);
public sealed record Payments(int Captured, int Failed, decimal? SuccessRate);
public sealed record EmailHealth(int Sent, int Failed, int StuckPending);
public sealed record WeekRow(DateOnly WeekStart, int Signups, int Launches, int Orders, decimal NetSales);
public sealed record PlatformMetricsReport(DateOnly From, DateOnly To, DateTimeOffset AsOf, StoreCounts Stores, Revenue Revenue, Funnel Funnel,
    Commerce Commerce, Payments Payments, EmailHealth Email, IReadOnlyList<WeekRow> Weeks);

/// <summary>
/// Platform KPIs for operators, computed from the database on request (nothing is sampled or estimated):
/// store lifecycle now; monthly recurring revenue from stores currently active on a paid plan (plan prices exclude GST;
/// past-due stores are shown separately as at risk); the onboarding funnel for stores created in the range; orders and
/// net sales in the range using the merchants' sales-report rule (ADR-033), so the figures match their reports; online
/// payment success; email delivery health; and a weekly series in Indian weeks starting Monday.
/// </summary>
public static class PlatformMetrics
{
    public const int EmailStuckMinutes = 15;

    public static void Map(RouteGroupBuilder platform) =>
        platform.MapGet("/metrics", async (PlatformDbContext db, [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct) =>
            Results.Ok(await ComputeAsync(db, ReportRange.Parse(from, to, DateTimeOffset.UtcNow), DateTimeOffset.UtcNow, ct)));

    private static readonly OrderStatus[] NotCounted = [OrderStatus.PendingPayment, OrderStatus.Cancelled, OrderStatus.Expired];

    public static async Task<PlatformMetricsReport> ComputeAsync(PlatformDbContext db, ReportRange range, DateTimeOffset now, CancellationToken ct)
    {
        var (start, end) = (range.Start, range.End);

        // ---------- Stores now ----------
        var byStatus = await db.Tenants.AsNoTracking().GroupBy(t => t.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        int Count(TenantStatus s) => byStatus.FirstOrDefault(x => x.Key == s)?.Count ?? 0;
        var stores = new StoreCounts(byStatus.Sum(x => x.Count), Count(TenantStatus.Trialing), Count(TenantStatus.Active), Count(TenantStatus.PastDue),
            Count(TenantStatus.Suspended), Count(TenantStatus.Cancelled), await db.Tenants.CountAsync(t => t.LaunchedAt != null, ct));

        // ---------- Recurring revenue now ----------
        var plans = await db.Plans.AsNoTracking().ToDictionaryAsync(p => p.Code, ct);
        var paying = await db.Tenants.AsNoTracking()
            .Where(t => t.Status == TenantStatus.Active || t.Status == TenantStatus.PastDue)
            .GroupBy(t => new { t.PlanCode, t.Status }).Select(g => new { g.Key.PlanCode, g.Key.Status, Count = g.Count() }).ToListAsync(ct);
        decimal Price(string code) => plans.TryGetValue(code, out var p) ? p.MonthlyPrice : 0m;
        var byPlan = paying.Where(x => x.Status == TenantStatus.Active && Price(x.PlanCode) > 0)
            .Select(x => new PlanRevenue(x.PlanCode, plans[x.PlanCode].Name, x.Count, Price(x.PlanCode), Price(x.PlanCode) * x.Count))
            .OrderByDescending(x => x.Mrr).ToList();
        var revenue = new Revenue(byPlan.Sum(x => x.Mrr), byPlan.Sum(x => x.Stores),
            paying.Where(x => x.Status == TenantStatus.PastDue).Sum(x => Price(x.PlanCode) * x.Count), byPlan);

        // ---------- Onboarding funnel: stores created in the range ----------
        var cohort = db.Tenants.AsNoTracking().Where(t => t.CreatedAt >= start && t.CreatedAt < end);
        var funnel = new Funnel(
            await cohort.CountAsync(ct),
            await cohort.CountAsync(t => db.Memberships.Any(m => m.TenantId == t.Id && m.Role == MemberRole.Owner && m.User!.EmailVerifiedAt != null), ct),
            await cohort.CountAsync(t => db.Products.Any(p => p.TenantId == t.Id), ct),
            await cohort.CountAsync(t => t.LaunchedAt != null, ct),
            await cohort.CountAsync(t => db.Orders.Any(o => o.TenantId == t.Id && !NotCounted.Contains(o.Status)), ct),
            await cohort.CountAsync(t => (t.Status == TenantStatus.Active || t.Status == TenantStatus.PastDue)
                && db.Plans.Any(p => p.Code == t.PlanCode && p.MonthlyPrice > 0), ct));

        // ---------- Orders, payments, email in the range ----------
        var counted = db.Orders.AsNoTracking().Where(o => o.PlacedAt >= start && o.PlacedAt < end && !NotCounted.Contains(o.Status));
        var commerce = new Commerce(await counted.CountAsync(ct), await counted.SumAsync(o => o.Total - o.RefundedTotal, ct),
            await counted.Select(o => o.TenantId).Distinct().CountAsync(ct));
        var attempts = db.PaymentAttempts.AsNoTracking().Where(a => a.CreatedAt >= start && a.CreatedAt < end);
        var captured = await attempts.CountAsync(a => a.Status == PaymentAttemptStatus.Captured, ct);
        var failed = await attempts.CountAsync(a => a.Status == PaymentAttemptStatus.Failed, ct);
        var payments = new Payments(captured, failed, captured + failed == 0 ? null : Math.Round(100m * captured / (captured + failed), 1));
        var mail = db.OutboxEmails.AsNoTracking().Where(e => e.CreatedAt >= start && e.CreatedAt < end);
        var stuckBefore = now.AddMinutes(-EmailStuckMinutes);
        var email = new EmailHealth(await mail.CountAsync(e => e.Status == EmailStatus.Sent, ct), await mail.CountAsync(e => e.Status == EmailStatus.Failed, ct),
            await db.OutboxEmails.CountAsync(e => e.Status == EmailStatus.Pending && e.CreatedAt < stuckBefore, ct));

        return new PlatformMetricsReport(range.From, range.To, now, stores, revenue, funnel, commerce, payments, email,
            await WeeksAsync(db, range, ct));
    }

    /// <summary>Weekly series over the range (Indian weeks starting Monday), with empty weeks filled in.</summary>
    private static async Task<IReadOnlyList<WeekRow>> WeeksAsync(PlatformDbContext db, ReportRange range, CancellationToken ct)
    {
        const string week = "(date_trunc('week', {0} AT TIME ZONE 'Asia/Kolkata'))::date";
        var notCounted = NotCounted.Select(s => s.ToString()).ToArray();
        var signups = await GroupAsync(db, $"SELECT {string.Format(week, "created_at")}, count(*), 0::numeric FROM tenants WHERE created_at >= @s AND created_at < @e GROUP BY 1", range, null, ct);
        var launches = await GroupAsync(db, $"SELECT {string.Format(week, "launched_at")}, count(*), 0::numeric FROM tenants WHERE launched_at >= @s AND launched_at < @e GROUP BY 1", range, null, ct);
        var orders = await GroupAsync(db, $"""
            SELECT {string.Format(week, "placed_at")}, count(*), coalesce(sum(total - refunded_total), 0)
            FROM orders WHERE placed_at >= @s AND placed_at < @e AND NOT (status = ANY(@excluded)) GROUP BY 1
            """, range, notCounted, ct);

        var first = Monday(range.From);
        var rows = new List<WeekRow>();
        for (var w = first; w <= range.To; w = w.AddDays(7))
        {
            orders.TryGetValue(w, out var o);
            rows.Add(new WeekRow(w, signups.GetValueOrDefault(w).Count, launches.GetValueOrDefault(w).Count, o.Count, o.Sum));
        }
        return rows;
    }

    public static DateOnly Monday(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));

    private static async Task<Dictionary<DateOnly, (int Count, decimal Sum)>> GroupAsync(PlatformDbContext db, string sql, ReportRange range,
        string[]? excluded, CancellationToken ct)
    {
        var conn = (NpgsqlConnection)db.Database.GetDbConnection();
        var opened = conn.State != System.Data.ConnectionState.Open;
        if (opened) await conn.OpenAsync(ct);
        try
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("s", range.Start);
            cmd.Parameters.AddWithValue("e", range.End);
            if (excluded is not null) cmd.Parameters.AddWithValue("excluded", excluded);
            var result = new Dictionary<DateOnly, (int, decimal)>();
            await using DbDataReader r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                result[DateOnly.FromDateTime(r.GetDateTime(0))] = ((int)r.GetInt64(1), r.GetDecimal(2));
            return result;
        }
        finally
        {
            if (opened) await conn.CloseAsync();
        }
    }
}
