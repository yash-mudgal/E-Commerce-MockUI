using System.Globalization;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Customers;
using ShopMint.Api.Modules.Orders;

namespace ShopMint.Api.Modules.Reports;

/// <summary>An inclusive range of Indian calendar days, as UTC instants [Start, End).</summary>
public sealed record ReportRange(DateOnly From, DateOnly To)
{
    public static readonly TimeSpan Ist = TimeSpan.FromMinutes(330);
    public const int MaxDays = 366;

    // PostgreSQL timestamptz parameters must be UTC.
    public DateTimeOffset Start => new DateTimeOffset(From.ToDateTime(TimeOnly.MinValue), Ist).ToUniversalTime();
    public DateTimeOffset End => new DateTimeOffset(To.AddDays(1).ToDateTime(TimeOnly.MinValue), Ist).ToUniversalTime();

    public static DateOnly IstDate(DateTimeOffset t) => DateOnly.FromDateTime(t.ToOffset(Ist).DateTime);

    /// <summary>Parses yyyy-MM-dd dates; defaults to the last 30 days ending today (India time).</summary>
    public static ReportRange Parse(string? from, string? to, DateTimeOffset now)
    {
        var today = IstDate(now);
        var t = to is null ? today : DateOnly.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var td) ? td
            : throw AppException.Invalid("to", "Use a date like 2026-11-30.");
        var f = from is null ? t.AddDays(-29) : DateOnly.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var fd) ? fd
            : throw AppException.Invalid("from", "Use a date like 2026-11-01.");
        if (f > t) throw AppException.Invalid("from", "The start date must be on or before the end date.");
        if (t.DayNumber - f.DayNumber + 1 > MaxDays) throw AppException.Invalid("from", $"Choose at most {MaxDays} days.");
        return new ReportRange(f, t);
    }
}

public sealed record SalesTotals(int Orders, int Units, decimal GrossSales, decimal Discounts, decimal Shipping, decimal Taxable, decimal Cgst, decimal Sgst,
    decimal Igst, decimal Tax, decimal Total, decimal Refunds, decimal NetSales, decimal AverageOrderValue);
public sealed record SalesPeriod(DateOnly Start, int Orders, decimal Total, decimal Refunds, decimal NetSales);
public sealed record SalesByPayment(string Method, int Orders, decimal Total, decimal NetSales);
public sealed record ProductSales(string Title, int Units, decimal Revenue);
public sealed record StateSales(string StateCode, string StateName, int Orders, decimal Total);
public sealed record CancelledSummary(int Orders, decimal Total);
public sealed record SalesReport(DateOnly From, DateOnly To, string GroupBy, SalesTotals Totals, IReadOnlyList<SalesPeriod> Series,
    IReadOnlyList<SalesByPayment> ByPayment, IReadOnlyList<ProductSales> TopProducts, IReadOnlyList<StateSales> ByState, CancelledSummary Cancelled);

public sealed record GstRow(string StateCode, string StateName, decimal Rate, int Invoices, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, decimal Total);
public sealed record HsnRow(string Code, string Description, decimal Rate, int Quantity, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst);
public sealed record GstReport(DateOnly From, DateOnly To, int Invoices, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, decimal Total,
    IReadOnlyList<GstRow> ByStateAndRate, IReadOnlyList<HsnRow> Hsn, CancelledSummary CancelledInvoices);

/// <summary>
/// Sales and GST reports computed from orders' stored amounts, so they always add up to the orders themselves (ADR-033).
/// Sales count orders placed in the range that were confirmed and not cancelled (the same rule as the dashboard),
/// net of refunds. The GST report counts tax invoices issued in the range.
/// </summary>
public sealed class ReportService(AppDbContext db)
{
    public const int MaxOrders = 50_000;

    private IQueryable<Order> Counted(ReportRange r) => db.Orders.AsNoTracking().Where(o => o.PlacedAt >= r.Start && o.PlacedAt < r.End
        && o.Status != OrderStatus.PendingPayment && o.Status != OrderStatus.Cancelled && o.Status != OrderStatus.Expired);

    private static async Task<List<T>> CappedAsync<T>(IQueryable<T> q, CancellationToken ct)
    {
        var rows = await q.Take(MaxOrders + 1).ToListAsync(ct);
        if (rows.Count > MaxOrders) throw AppException.Unprocessable(ProblemTypes.Validation, $"That range has more than {MaxOrders:N0} orders. Choose a shorter range.");
        return rows;
    }

    public async Task<SalesReport> SalesAsync(ReportRange r, string? groupBy, CancellationToken ct)
    {
        var group = groupBy is "week" or "month" ? groupBy : "day";
        var orders = await CappedAsync(Counted(r).OrderBy(o => o.PlacedAt).Select(o => new
        {
            o.Id, o.PlacedAt, o.PaymentMethod, o.ShipStateCode, o.Subtotal, o.Discount, o.Shipping, o.Taxable, o.Cgst, o.Sgst, o.Igst, o.Total, o.RefundedTotal,
            Units = o.Lines.Sum(l => l.Quantity),
        }), ct);
        var counted = Counted(r);
        var lines = await db.OrderLines.AsNoTracking().Where(l => counted.Any(o => o.Id == l.OrderId))
            .GroupBy(l => l.ProductTitle).Select(g => new { Title = g.Key, Units = g.Sum(x => x.Quantity), Revenue = g.Sum(x => x.LineTotal) })
            .OrderByDescending(p => p.Revenue).ThenBy(p => p.Title).Take(10).ToListAsync(ct);
        var top = lines.Select(p => new ProductSales(p.Title, p.Units, p.Revenue)).ToList();

        decimal total = orders.Sum(o => o.Total), refunds = orders.Sum(o => o.RefundedTotal);
        decimal cgst = orders.Sum(o => o.Cgst), sgst = orders.Sum(o => o.Sgst), igst = orders.Sum(o => o.Igst);
        var totals = new SalesTotals(orders.Count, orders.Sum(o => o.Units), orders.Sum(o => o.Subtotal), orders.Sum(o => o.Discount), orders.Sum(o => o.Shipping),
            orders.Sum(o => o.Taxable), cgst, sgst, igst, cgst + sgst + igst, total, refunds, total - refunds,
            orders.Count == 0 ? 0 : Math.Round(total / orders.Count, 2, MidpointRounding.AwayFromZero));

        var byPeriod = orders.GroupBy(o => PeriodStart(ReportRange.IstDate(o.PlacedAt), group)).ToDictionary(g => g.Key, g => g.ToList());
        var series = new List<SalesPeriod>();
        for (var p = PeriodStart(r.From, group); p <= r.To; p = Next(p, group))
        {
            var g = byPeriod.GetValueOrDefault(p) ?? [];
            decimal t = g.Sum(o => o.Total), rf = g.Sum(o => o.RefundedTotal);
            series.Add(new SalesPeriod(p, g.Count, t, rf, t - rf));
        }
        var byPayment = orders.GroupBy(o => o.PaymentMethod).OrderBy(g => g.Key)
            .Select(g => new SalesByPayment(g.Key == PaymentMethod.Cod ? "cod" : "online", g.Count(), g.Sum(o => o.Total), g.Sum(o => o.Total - o.RefundedTotal))).ToList();
        var byState = orders.GroupBy(o => o.ShipStateCode)
            .Select(g => new StateSales(g.Key, IndianStates.ByCode.GetValueOrDefault(g.Key, g.Key), g.Count(), g.Sum(o => o.Total)))
            .OrderByDescending(s => s.Total).ToList();
        // Cancelled after confirmation (they had an invoice); unpaid orders that simply expired aren't sales.
        var cancelled = await db.Orders.AsNoTracking().Where(o => o.PlacedAt >= r.Start && o.PlacedAt < r.End && o.Status == OrderStatus.Cancelled && o.InvoiceNumber != null)
            .GroupBy(o => 1).Select(g => new CancelledSummary(g.Count(), g.Sum(o => o.Total))).FirstOrDefaultAsync(ct) ?? new CancelledSummary(0, 0);
        return new SalesReport(r.From, r.To, group, totals, series, byPayment, top, byState, cancelled);
    }

    public static DateOnly PeriodStart(DateOnly d, string group) => group switch
    {
        "week" => d.AddDays(-(((int)d.DayOfWeek + 6) % 7)), // weeks start on Monday
        "month" => new DateOnly(d.Year, d.Month, 1),
        _ => d,
    };

    private static DateOnly Next(DateOnly d, string group) => group switch { "week" => d.AddDays(7), "month" => d.AddMonths(1), _ => d.AddDays(1) };

    /// <summary>
    /// GST on invoices issued in the range (not cancelled), by place of supply and rate, plus an HSN summary. Delivery
    /// charges are reported at the rate they were taxed at (the order's highest item rate, SAC 9965).
    /// </summary>
    public async Task<GstReport> GstAsync(ReportRange r, CancellationToken ct)
    {
        var orders = await CappedAsync(db.Orders.AsNoTracking().AsSplitQuery().Include(o => o.Lines)
            .Where(o => o.InvoiceIssuedAt >= r.Start && o.InvoiceIssuedAt < r.End && o.Status != OrderStatus.Cancelled).OrderBy(o => o.InvoiceIssuedAt), ct);
        var parts = new List<(string State, decimal Rate, Guid Order, string Code, string Desc, int Qty, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst)>();
        foreach (var o in orders)
        {
            foreach (var l in o.Lines) parts.Add((o.ShipStateCode, l.GstRate, o.Id, l.HsnCode ?? "—", l.ProductTitle, l.Quantity, l.Taxable, l.Cgst, l.Sgst, l.Igst));
            var shipTaxable = o.Taxable - o.Lines.Sum(l => l.Taxable);
            if (o.Shipping > 0 || shipTaxable != 0)
                parts.Add((o.ShipStateCode, o.Lines.Count == 0 ? 0 : o.Lines.Max(l => l.GstRate), o.Id, "9965", "Delivery charges", 1, shipTaxable,
                    o.Cgst - o.Lines.Sum(l => l.Cgst), o.Sgst - o.Lines.Sum(l => l.Sgst), o.Igst - o.Lines.Sum(l => l.Igst)));
        }
        var byStateRate = parts.GroupBy(p => (p.State, p.Rate)).OrderBy(g => g.Key.State).ThenBy(g => g.Key.Rate)
            .Select(g => new GstRow(g.Key.State, IndianStates.ByCode.GetValueOrDefault(g.Key.State, g.Key.State), g.Key.Rate, g.Select(p => p.Order).Distinct().Count(),
                g.Sum(p => p.Taxable), g.Sum(p => p.Cgst), g.Sum(p => p.Sgst), g.Sum(p => p.Igst), g.Sum(p => p.Taxable + p.Cgst + p.Sgst + p.Igst))).ToList();
        var hsn = parts.GroupBy(p => (p.Code, p.Rate)).OrderBy(g => g.Key.Code).ThenBy(g => g.Key.Rate)
            .Select(g => new HsnRow(g.Key.Code, g.Key.Code == "9965" ? "Delivery charges" : g.Select(p => p.Desc).First(), g.Key.Rate, g.Sum(p => p.Qty),
                g.Sum(p => p.Taxable), g.Sum(p => p.Cgst), g.Sum(p => p.Sgst), g.Sum(p => p.Igst))).ToList();
        var cancelled = await db.Orders.AsNoTracking().Where(o => o.InvoiceIssuedAt >= r.Start && o.InvoiceIssuedAt < r.End && o.Status == OrderStatus.Cancelled)
            .GroupBy(o => 1).Select(g => new CancelledSummary(g.Count(), g.Sum(o => o.Total))).FirstOrDefaultAsync(ct) ?? new CancelledSummary(0, 0);
        return new GstReport(r.From, r.To, orders.Count, orders.Sum(o => o.Taxable), orders.Sum(o => o.Cgst), orders.Sum(o => o.Sgst), orders.Sum(o => o.Igst),
            orders.Sum(o => o.Total), byStateRate, hsn, cancelled);
    }

    /// <summary>Every order placed in the range (any status), for the orders CSV.</summary>
    public async Task<List<Order>> OrdersAsync(ReportRange r, CancellationToken ct) =>
        await CappedAsync(db.Orders.AsNoTracking().Where(o => o.PlacedAt >= r.Start && o.PlacedAt < r.End).OrderBy(o => o.Number), ct);
}
