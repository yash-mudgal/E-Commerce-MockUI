using ShopMint.Api.Common;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Modules.Staff;
using ShopMint.Api.Modules.Store;

namespace ShopMint.Api.Tests.Unit;

public class GstCalculatorTests
{
    [Fact]
    public void Intra_state_inclusive_price_splits_into_equal_cgst_and_sgst()
    {
        var r = GstCalculator.Calculate([new PricedLine(1299m, 1, 12m)], 0, "27", "27");
        Assert.True(r.IntraState);
        Assert.Equal(139.18m, r.Tax);            // 1299 × 12 / 112 = 139.178…
        Assert.Equal(1159.82m, r.Taxable);
        Assert.Equal(69.59m, r.Cgst);
        Assert.Equal(69.59m, r.Sgst);
        Assert.Equal(0m, r.Igst);
    }

    [Fact]
    public void Inter_state_supply_is_all_igst()
    {
        var r = GstCalculator.Calculate([new PricedLine(1299m, 1, 12m)], 0, "27", "29");
        Assert.False(r.IntraState);
        Assert.Equal(139.18m, r.Igst);
        Assert.Equal(0m, r.Cgst + r.Sgst);
    }

    [Fact]
    public void Odd_paisa_goes_to_cgst_so_halves_sum_exactly()
    {
        var r = GstCalculator.Calculate([new PricedLine(0.35m, 1, 18m)], 0, "07", "07"); // tax 0.05
        Assert.Equal(0.05m, r.Tax);
        Assert.Equal(0.03m, r.Cgst);
        Assert.Equal(0.02m, r.Sgst);
    }

    [Fact]
    public void Discount_is_allocated_proportionally_and_sums_exactly()
    {
        var lines = new[] { new PricedLine(333.33m, 1, 5m), new PricedLine(333.33m, 1, 12m), new PricedLine(333.34m, 1, 18m) };
        var r = GstCalculator.Calculate(lines, 100m, "27", "29");
        Assert.Equal(100m, r.Lines.Sum(l => l.DiscountAllocated));
        Assert.Equal(900m, r.Net);
        Assert.All(r.Lines, l => Assert.Equal(l.Net, l.Taxable + l.Tax));
    }

    [Fact]
    public void Discount_never_exceeds_subtotal()
    {
        var r = GstCalculator.Calculate([new PricedLine(200m, 1, 5m)], 500m, "27", "27");
        Assert.Equal(200m, r.Discount);
        Assert.Equal(0m, r.Tax);
    }
}

public class BrandColorTests
{
    [Theory]
    [InlineData("#4f46e5", true)]   // indigo: ~6.3:1
    [InlineData("#0f766e", true)]   // teal 700
    [InlineData("#fbbf24", false)]  // amber 400: far too light for white text
    [InlineData("#22c55e", false)]  // green 500: ~2.3:1
    public void Requires_aa_contrast_with_white_text(string hex, bool ok) =>
        Assert.Equal(ok, BrandColor.ContrastWithWhite(hex) >= 4.5);

    [Theory]
    [InlineData("#abc", false)]
    [InlineData("4f46e5", false)]
    [InlineData("#4f46e5", true)]
    [InlineData("#zzzzzz", false)]
    public void Validates_hex(string hex, bool ok) => Assert.Equal(ok, BrandColor.IsValidHex(hex));
}

public class SlugAndPermissionTests
{
    [Theory]
    [InlineData("Jaipuri Cotton Anarkali Kurta", "jaipuri-cotton-anarkali-kurta")]
    [InlineData("  Café — Crème  ", "cafe-creme")]
    [InlineData("Men's 20000mAh Power-Bank!!", "men-s-20000mah-power-bank")]
    [InlineData("!!!", "item")]
    public void Slug_from_title(string input, string expected) => Assert.Equal(expected, Slug.From(input));

    [Fact]
    public void Owner_has_every_permission() => Assert.All(Permissions.All, p => Assert.True(Permissions.Has(MemberRole.Owner, p)));

    [Theory]
    [InlineData(Permissions.SettingsWrite)]
    [InlineData(Permissions.BillingManage)]
    [InlineData(Permissions.CatalogDelete)]
    [InlineData(Permissions.StaffManage)]
    [InlineData(Permissions.OrdersRefund)]
    public void Staff_cannot_perform_sensitive_actions(string permission) => Assert.False(Permissions.Has(MemberRole.Staff, permission));

    [Fact]
    public void Manager_cannot_change_settings_or_billing()
    {
        Assert.False(Permissions.Has(MemberRole.Manager, Permissions.SettingsWrite));
        Assert.False(Permissions.Has(MemberRole.Manager, Permissions.BillingManage));
    }
}

public class StaffRuleTests
{
    [Theory]
    [InlineData(MemberRole.Owner, MemberRole.Manager, true)]
    [InlineData(MemberRole.Owner, MemberRole.Staff, true)]
    [InlineData(MemberRole.Owner, MemberRole.Owner, false)]
    [InlineData(MemberRole.Manager, MemberRole.Staff, true)]
    [InlineData(MemberRole.Manager, MemberRole.Manager, false)]
    [InlineData(MemberRole.Staff, MemberRole.Staff, false)]
    public void Grant_only_below_own_rank_and_never_ownership(MemberRole actor, MemberRole role, bool allowed)
    {
        Assert.Equal(allowed, StaffRules.CanGrant(actor, role));
        Assert.Equal(allowed, StaffRules.CanManage(actor, role));
    }

    [Theory]
    [InlineData("staff", MemberRole.Staff)]
    [InlineData("Manager", MemberRole.Manager)]
    [InlineData("Owner", null)]
    [InlineData("0", null)]
    [InlineData("7", null)]
    [InlineData("", null)]
    public void Only_manager_and_staff_are_assignable(string input, MemberRole? expected) =>
        Assert.Equal(expected, StaffRules.ParseAssignable(input));
}

public class SecureTokenTests
{
    [Fact]
    public void Tokens_are_unique_url_safe_and_hashed()
    {
        var (a, hashA) = SecureToken.Create();
        var (b, _) = SecureToken.Create();
        Assert.NotEqual(a, b);
        Assert.True(SecureToken.LooksValid(a));
        Assert.Equal(64, hashA.Length);
        Assert.Equal(hashA, SecureToken.Hash(a));
        Assert.NotEqual(a, hashA);
        Assert.False(SecureToken.LooksValid("short"));
        Assert.False(SecureToken.LooksValid(a[..42] + "/"));
    }
}
