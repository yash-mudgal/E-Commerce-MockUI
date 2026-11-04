using System.Security.Claims;

namespace ShopMint.Api.Modules.Identity;

public static class Permissions
{
    public const string CatalogRead = "catalog.read";
    public const string CatalogWrite = "catalog.write";
    public const string CatalogDelete = "catalog.delete";
    public const string InventoryWrite = "inventory.write";
    public const string OrdersRead = "orders.read";
    public const string OrdersFulfil = "orders.fulfil";
    public const string OrdersRefund = "orders.refund";
    public const string SettingsWrite = "settings.write";
    public const string StaffManage = "staff.manage";
    public const string BillingManage = "billing.manage";
    public const string ReportsRead = "reports.read";
    public const string AuditRead = "audit.read";

    public static readonly string[] All =
    [
        CatalogRead, CatalogWrite, CatalogDelete, InventoryWrite, OrdersRead, OrdersFulfil, OrdersRefund,
        SettingsWrite, StaffManage, BillingManage, ReportsRead, AuditRead,
    ];

    private static readonly Dictionary<MemberRole, HashSet<string>> ByRole = new()
    {
        [MemberRole.Owner] = [.. All],
        [MemberRole.Manager] =
        [
            CatalogRead, CatalogWrite, CatalogDelete, InventoryWrite, OrdersRead, OrdersFulfil, OrdersRefund,
            StaffManage, ReportsRead, AuditRead,
        ],
        [MemberRole.Staff] = [CatalogRead, CatalogWrite, InventoryWrite, OrdersRead, OrdersFulfil, ReportsRead],
    };

    public static IReadOnlyCollection<string> For(MemberRole role) => ByRole[role];
    public static bool Has(MemberRole role, string permission) => ByRole[role].Contains(permission);
}

/// <summary>Claim names carried in the merchant session cookie.</summary>
public static class SessionClaims
{
    public const string UserId = "sub";
    public const string TenantId = "tid";
    public const string Role = "role";
    public const string SecurityStamp = "sstamp";
    public const string PlatformAdmin = "padm";

    public static Guid? GetUserId(this ClaimsPrincipal p) => Guid.TryParse(p.FindFirstValue(UserId), out var g) ? g : null;
    public static Guid? GetTenantId(this ClaimsPrincipal p) => Guid.TryParse(p.FindFirstValue(TenantId), out var g) ? g : null;
    public static MemberRole? GetRole(this ClaimsPrincipal p) =>
        Enum.TryParse<MemberRole>(p.FindFirstValue(Role), out var r) ? r : null;
    public static bool IsPlatformAdmin(this ClaimsPrincipal p) => p.FindFirstValue(PlatformAdmin) == "1";
}
