namespace ShopMint.Api.Modules.Orders;

public sealed record PricedLine(decimal UnitPrice, int Quantity, decimal GstRate);

public sealed record TaxedLine(decimal Gross, decimal DiscountAllocated, decimal Net, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst)
{
    public decimal Tax => Cgst + Sgst + Igst;
}

public sealed record TaxBreakdown(IReadOnlyList<TaxedLine> Lines, decimal Subtotal, decimal Discount, decimal Taxable,
    decimal Cgst, decimal Sgst, decimal Igst, bool IntraState)
{
    public decimal Tax => Cgst + Sgst + Igst;
    public decimal Net => Subtotal - Discount;
}

/// <summary>
/// GST for GST-inclusive retail prices (ported from the mock's S.totals and S.gstSplit, using decimals).
/// <list type="bullet">
/// <item>An order-level discount is allocated to lines in proportion to their gross value. The last line takes the rounding remainder so allocations add up exactly.</item>
/// <item>Tax is extracted from the inclusive net amount: tax = net × r / (100 + r), rounded to paise per line.</item>
/// <item>Intra-state supply (place of supply equals the seller's state) splits tax into CGST + SGST. The odd paisa goes to CGST, so CGST + SGST equals the tax exactly. Inter-state supply is all IGST.</item>
/// </list>
/// Used by checkout and invoicing in Phase 8.
/// </summary>
public static class GstCalculator
{
    public static TaxBreakdown Calculate(IReadOnlyList<PricedLine> lines, decimal orderDiscount, string sellerStateCode, string placeOfSupplyStateCode)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(orderDiscount);
        var intra = string.Equals(sellerStateCode, placeOfSupplyStateCode, StringComparison.Ordinal);
        var grosses = lines.Select(l => l.UnitPrice * l.Quantity).ToList();
        var subtotal = grosses.Sum();
        var discount = Math.Min(orderDiscount, subtotal);

        var result = new List<TaxedLine>(lines.Count);
        var allocatedSoFar = 0m;
        for (var i = 0; i < lines.Count; i++)
        {
            var gross = grosses[i];
            var alloc = i == lines.Count - 1
                ? discount - allocatedSoFar
                : subtotal == 0 ? 0 : Round(discount * gross / subtotal);
            allocatedSoFar += alloc;
            var net = gross - alloc;
            var rate = lines[i].GstRate;
            var tax = Round(net * rate / (100 + rate));
            var taxable = net - tax;
            decimal cgst = 0, sgst = 0, igst = 0;
            if (intra)
            {
                sgst = Math.Floor(tax * 100 / 2) / 100;
                cgst = tax - sgst;
            }
            else igst = tax;
            result.Add(new TaxedLine(gross, alloc, net, taxable, cgst, sgst, igst));
        }

        return new TaxBreakdown(result, subtotal, discount, result.Sum(l => l.Taxable),
            result.Sum(l => l.Cgst), result.Sum(l => l.Sgst), result.Sum(l => l.Igst), intra);
    }

    private static decimal Round(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
}
