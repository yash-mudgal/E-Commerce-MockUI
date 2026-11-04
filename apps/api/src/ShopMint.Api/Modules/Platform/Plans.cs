using ShopMint.Api.Common;

namespace ShopMint.Api.Modules.Platform;

/// <summary>
/// Plan entitlements. Prices and limits come from the mock (Basic ₹999, Pro ₹2,499, Enterprise ₹7,999).
/// They live in code for now; Phase 9 moves them to the <c>plans</c> table with Razorpay Subscriptions.
/// </summary>
public sealed record PlanDefinition(string Code, string Name, decimal MonthlyPrice, int? MaxProducts, int? MaxStaff, int? MaxLocations, bool CustomDomain);

public static class Plans
{
    public static readonly PlanDefinition Trial = new("trial", "Trial", 0, 100, 2, 1, false);
    public static readonly PlanDefinition Basic = new("basic", "Basic", 999, 500, 2, 1, false);
    public static readonly PlanDefinition Pro = new("pro", "Pro", 2499, 5000, 10, 3, true);
    public static readonly PlanDefinition Enterprise = new("enterprise", "Enterprise", 7999, null, null, null, true);

    public static readonly IReadOnlyList<PlanDefinition> All = [Trial, Basic, Pro, Enterprise];
    public static PlanDefinition Get(string code) => All.FirstOrDefault(p => p.Code == code) ?? Trial;

    public const int TrialDays = 14;

    public static void EnsureLocationCapacity(string planCode, int currentCount)
    {
        var plan = Get(planCode);
        if (plan.MaxLocations is { } max && currentCount >= max)
            throw AppException.Unprocessable(ProblemTypes.EntitlementExceeded,
                $"Your {plan.Name} plan includes {max} stock {(max == 1 ? "location" : "locations")}. Upgrade your plan to add more.");
    }

    public static void EnsureProductCapacity(string planCode, int currentCount)
    {
        var plan = Get(planCode);
        if (plan.MaxProducts is { } max && currentCount >= max)
            throw AppException.Unprocessable(ProblemTypes.EntitlementExceeded,
                $"Your {plan.Name} plan allows up to {max} products. Upgrade your plan to add more.");
    }
}
