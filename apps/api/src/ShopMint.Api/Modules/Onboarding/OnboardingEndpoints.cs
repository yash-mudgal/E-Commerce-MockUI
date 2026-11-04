using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Onboarding;

public sealed record OnboardingStep(string Key, string Title, string Description, bool Done, bool Required);
public sealed record OnboardingStatus(bool IsLive, DateTimeOffset? LaunchedAt, bool CanLaunch, IReadOnlyList<OnboardingStep> Steps);

/// <summary>
/// The launch checklist, computed from real store state (nothing is stored per step, so it can't drift).
/// Launching publishes the storefront. Until then shoppers see a "coming soon" page.
/// Required before launch: a confirmed owner email (contact for customers and to stop throwaway spam stores),
/// a support email shown to shoppers, and at least one active product with stock to sell.
/// </summary>
public static class OnboardingEndpoints
{
    public static void Map(RouteGroupBuilder admin)
    {
        var g = admin.MapGroup("/onboarding").WithTags("Onboarding");
        g.MapGet("/", Get).RequireAuthorization(Session.TenantMemberPolicy);
        g.MapPost("/launch", Launch).RequirePermission(Permissions.SettingsWrite);
    }

    private static async Task<IResult> Get(AppDbContext db, TenantContext tenant, CancellationToken ct) =>
        Results.Ok(await Compute(db, tenant.RequireTenant(), ct));

    public static async Task<OnboardingStatus> Compute(AppDbContext db, Guid tid, CancellationToken ct)
    {
        var t = await db.Tenants.AsNoTracking().Where(x => x.Id == tid)
            .Select(x => new { x.SupportEmail, x.Gstin, x.LegalName, x.Tagline, x.BrandColor, x.LaunchedAt }).FirstAsync(ct);
        var ownerVerified = await db.Memberships.AnyAsync(m => m.TenantId == tid && m.Role == MemberRole.Owner && m.User!.EmailVerifiedAt != null, ct);
        var sellable = await db.Products.AnyAsync(p => p.Status == ProductStatus.Active
            && p.Variants.Any(v => v.IsActive && v.StockLevels.Any(s => s.OnHand - s.Reserved > 0)), ct);
        var team = await db.Memberships.AnyAsync(m => m.TenantId == tid && m.Role != MemberRole.Owner, ct)
            || await db.Invitations.AnyAsync(ct);

        List<OnboardingStep> steps =
        [
            new("verify_email", "Confirm the owner's email", "We send order alerts and account notices here.", ownerVerified, true),
            new("store_details", "Add a support email for shoppers", "Shown on your storefront so customers can reach you.", t.SupportEmail is not null, true),
            new("first_product", "Add a product that's ready to sell", "At least one active product with stock in hand.", sellable, true),
            new("branding", "Make the storefront yours", "Write a tagline and pick a brand colour.", t.Tagline is not null, false),
            new("tax", "Add your GST details", "Your legal name and GSTIN appear on tax invoices.", t.Gstin is not null && t.LegalName is not null, false),
            new("team", "Invite your team", "Give staff their own logins instead of sharing yours.", team, false),
        ];
        var isLive = t.LaunchedAt is not null;
        return new OnboardingStatus(isLive, t.LaunchedAt, !isLive && steps.Where(s => s.Required).All(s => s.Done), steps);
    }

    private static async Task<IResult> Launch(AppDbContext db, TenantContext tenant, AuditWriter audit, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        var status = await Compute(db, tid, ct);
        if (status.IsLive) return Results.Ok(status);
        var missing = status.Steps.Where(s => s.Required && !s.Done).ToList();
        if (missing.Count > 0)
            throw new AppException(422, ProblemTypes.LaunchRequirements, "Your store isn't ready to launch yet.",
                "Finish these steps first: " + string.Join("; ", missing.Select(s => s.Title)) + ".");

        var t = await db.Tenants.FirstAsync(x => x.Id == tid, ct);
        t.LaunchedAt = DateTimeOffset.UtcNow;
        t.UpdatedAt = t.LaunchedAt.Value;
        audit.Record(db, "store.launched", "tenant", tid);
        await db.SaveChangesAsync(ct);
        return Results.Ok(await Compute(db, tid, ct));
    }
}
