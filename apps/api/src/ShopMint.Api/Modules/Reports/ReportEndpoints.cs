using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using ShopMint.Api.Modules.Customers;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Orders;

namespace ShopMint.Api.Modules.Reports;

/// <summary>
/// CSV for spreadsheets. Text fields that start with a formula character are prefixed with an apostrophe so a
/// customer name like "=HYPERLINK(...)" can't run as a formula when the file is opened (CSV injection).
/// </summary>
public static class Csv
{
    public static string Text(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        if (s[0] is '=' or '+' or '-' or '@' or '\t' or '\r') s = "'" + s;
        return s.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? "\"" + s.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : s;
    }

    public static string Num(decimal v) => v.ToString("0.00", CultureInfo.InvariantCulture);
    public static string Date(DateTimeOffset? t) => t is null ? "" : t.Value.ToOffset(ReportRange.Ist).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);

    public static IResult File(string name, StringBuilder body) =>
        Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(body.ToString())).ToArray(), "text/csv; charset=utf-8", name);
}

public static class ReportEndpoints
{
    public static void Map(RouteGroupBuilder admin)
    {
        var g = admin.MapGroup("/reports").WithTags("Reports");
        g.MapGet("/sales", async (ReportService s, [FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? groupBy, CancellationToken ct) =>
            Results.Ok(await s.SalesAsync(ReportRange.Parse(from, to, DateTimeOffset.UtcNow), groupBy, ct))).RequirePermission(Permissions.ReportsRead);
        g.MapGet("/gst", async (ReportService s, [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct) =>
            Results.Ok(await s.GstAsync(ReportRange.Parse(from, to, DateTimeOffset.UtcNow), ct))).RequirePermission(Permissions.ReportsRead);
        // Customer names, emails and addresses: needs order access as well as reports.
        g.MapGet("/orders.csv", OrdersCsv).RequirePermission(Permissions.ReportsRead).RequirePermission(Permissions.OrdersRead);
        g.MapGet("/gst.csv", GstCsv).RequirePermission(Permissions.ReportsRead);
        g.MapGet("/hsn.csv", HsnCsv).RequirePermission(Permissions.ReportsRead);
    }

    private static string Suffix(ReportRange r) => $"{r.From:yyyy-MM-dd}-to-{r.To:yyyy-MM-dd}";

    private static async Task<IResult> OrdersCsv(ReportService s, [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
    {
        var r = ReportRange.Parse(from, to, DateTimeOffset.UtcNow);
        var sb = new StringBuilder("Order,Placed (IST),Status,Payment method,Payment status,Customer,Email,Phone,City,State,PIN,Subtotal,Discount,Coupon,Delivery,Taxable,CGST,SGST,IGST,Total,Refunded,Net,Invoice,Invoice date (IST)\r\n");
        foreach (var o in await s.OrdersAsync(r, ct))
        {
            sb.Append(o.Number).Append(',').Append(Csv.Date(o.PlacedAt)).Append(',').Append(o.Status).Append(',')
              .Append(o.PaymentMethod == PaymentMethod.Cod ? "COD" : "Online").Append(',').Append(o.PaymentStatus).Append(',')
              .Append(Csv.Text(o.CustomerName)).Append(',').Append(Csv.Text(o.Email)).Append(',').Append(Csv.Text(o.ShipPhone)).Append(',')
              .Append(Csv.Text(o.ShipCity)).Append(',').Append(Csv.Text(IndianStates.ByCode.GetValueOrDefault(o.ShipStateCode, o.ShipStateCode))).Append(',')
              .Append(Csv.Text(o.ShipPincode)).Append(',').Append(Csv.Num(o.Subtotal)).Append(',').Append(Csv.Num(o.Discount)).Append(',')
              .Append(Csv.Text(o.CouponCode)).Append(',').Append(Csv.Num(o.Shipping)).Append(',').Append(Csv.Num(o.Taxable)).Append(',')
              .Append(Csv.Num(o.Cgst)).Append(',').Append(Csv.Num(o.Sgst)).Append(',').Append(Csv.Num(o.Igst)).Append(',').Append(Csv.Num(o.Total)).Append(',')
              .Append(Csv.Num(o.RefundedTotal)).Append(',').Append(Csv.Num(o.Total - o.RefundedTotal)).Append(',').Append(Csv.Text(o.InvoiceNumber)).Append(',')
              .Append(Csv.Date(o.InvoiceIssuedAt)).Append("\r\n");
        }
        return Csv.File($"orders-{Suffix(r)}.csv", sb);
    }

    private static async Task<IResult> GstCsv(ReportService s, [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
    {
        var r = ReportRange.Parse(from, to, DateTimeOffset.UtcNow);
        var rep = await s.GstAsync(r, ct);
        var sb = new StringBuilder("Place of supply,State code,Rate %,Invoices,Taxable value,CGST,SGST,IGST,Invoice value\r\n");
        foreach (var x in rep.ByStateAndRate)
            sb.Append(Csv.Text(x.StateName)).Append(',').Append(x.StateCode).Append(',').Append(Csv.Num(x.Rate)).Append(',').Append(x.Invoices).Append(',')
              .Append(Csv.Num(x.Taxable)).Append(',').Append(Csv.Num(x.Cgst)).Append(',').Append(Csv.Num(x.Sgst)).Append(',').Append(Csv.Num(x.Igst)).Append(',')
              .Append(Csv.Num(x.Total)).Append("\r\n");
        return Csv.File($"gst-{Suffix(r)}.csv", sb);
    }

    private static async Task<IResult> HsnCsv(ReportService s, [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
    {
        var r = ReportRange.Parse(from, to, DateTimeOffset.UtcNow);
        var rep = await s.GstAsync(r, ct);
        var sb = new StringBuilder("HSN/SAC,Description,Rate %,Quantity,Taxable value,CGST,SGST,IGST\r\n");
        foreach (var x in rep.Hsn)
            sb.Append(Csv.Text(x.Code)).Append(',').Append(Csv.Text(x.Description)).Append(',').Append(Csv.Num(x.Rate)).Append(',').Append(x.Quantity).Append(',')
              .Append(Csv.Num(x.Taxable)).Append(',').Append(Csv.Num(x.Cgst)).Append(',').Append(Csv.Num(x.Sgst)).Append(',').Append(Csv.Num(x.Igst)).Append("\r\n");
        return Csv.File($"hsn-{Suffix(r)}.csv", sb);
    }
}
