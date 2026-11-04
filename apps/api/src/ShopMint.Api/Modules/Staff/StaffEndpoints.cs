using FluentValidation;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Notifications;
using ShopMint.Api.Modules.Platform;

namespace ShopMint.Api.Modules.Staff;

public sealed record StaffMemberDto(Guid UserId, string Name, string Email, string Role, DateTimeOffset JoinedAt, DateTimeOffset? LastLoginAt, bool IsYou);
public sealed record InvitationDto(Guid Id, string Email, string Role, string InvitedBy, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, bool Expired);
public sealed record StaffSeats(int Used, int? Max);
public sealed record StaffOverview(IReadOnlyList<StaffMemberDto> Members, IReadOnlyList<InvitationDto> Invitations, StaffSeats Seats);

public sealed record InviteRequest(string Email, string Role);
public sealed record ChangeRoleRequest(string Role);

public sealed record InvitationPreview(string StoreName, string Email, string Role, string InvitedBy, DateTimeOffset ExpiresAt, bool AccountExists);
public sealed record AcceptInvitationRequest(string Token, string? Name, string? Password);

public sealed class InviteValidator : AbstractValidator<InviteRequest>
{
    public InviteValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
        RuleFor(x => x.Role).Must(r => StaffRules.ParseAssignable(r) is not null).WithMessage("Choose Manager or Staff.");
    }
}

public sealed class ChangeRoleValidator : AbstractValidator<ChangeRoleRequest>
{
    public ChangeRoleValidator() =>
        RuleFor(x => x.Role).Must(r => StaffRules.ParseAssignable(r) is not null).WithMessage("Choose Manager or Staff.");
}

public sealed class AcceptInvitationValidator : AbstractValidator<AcceptInvitationRequest>
{
    public AcceptInvitationValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Name).MaximumLength(120);
        RuleFor(x => x.Password!).StrongPassword().When(x => x.Password is not null);
    }
}

/// <summary>
/// Who may manage whom. A person can only invite, re-role or remove people ranked below them, and can only
/// grant roles below their own. Ownership is never granted through invitations or role changes (an explicit
/// ownership transfer comes later). So an Owner manages Managers and Staff, and a Manager manages Staff.
/// </summary>
public static class StaffRules
{
    public static int Rank(MemberRole r) => r switch { MemberRole.Owner => 3, MemberRole.Manager => 2, _ => 1 };

    public static MemberRole? ParseAssignable(string? role) =>
        Enum.TryParse<MemberRole>(role, ignoreCase: true, out var r) && r != MemberRole.Owner && Enum.IsDefined(r) ? r : null;

    public static bool CanGrant(MemberRole actor, MemberRole role) => role != MemberRole.Owner && Rank(actor) > Rank(role);
    public static bool CanManage(MemberRole actor, MemberRole target) => target != MemberRole.Owner && Rank(actor) > Rank(target);
}

public static class StaffEndpoints
{
    public static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);
    private static readonly PasswordHasher<User> Hasher = new();

    public static void Map(RouteGroupBuilder admin, RouteGroupBuilder api)
    {
        var g = admin.MapGroup("/staff").WithTags("Staff").RequirePermission(Permissions.StaffManage);
        g.MapGet("/", List);
        g.MapPost("/invitations", Invite).Validate<InviteRequest>();
        g.MapPost("/invitations/{id:guid}/resend", Resend);
        g.MapDelete("/invitations/{id:guid}", Revoke);
        g.MapPatch("/{userId:guid}", ChangeRole).Validate<ChangeRoleRequest>();
        g.MapDelete("/{userId:guid}", Remove);

        var pub = api.MapGroup("/auth/invitations").WithTags("Invitations").RequireRateLimiting("auth");
        pub.MapGet("/{token}", Preview).AllowAnonymous();
        pub.MapPost("/accept", Accept).Validate<AcceptInvitationRequest>().AllowAnonymous();
    }

    // ---------- Admin ----------

    private static async Task<IResult> List(AppDbContext db, TenantContext tenant, CancellationToken ct) =>
        Results.Ok(await Overview(db, tenant, ct));

    private static async Task<StaffOverview> Overview(AppDbContext db, TenantContext tenant, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        var now = DateTimeOffset.UtcNow;
        var members = await db.Memberships.AsNoTracking()
            .Where(m => m.TenantId == tid && m.Status == MembershipStatus.Active)
            .OrderBy(m => m.Role).ThenBy(m => m.CreatedAt)
            .Select(m => new StaffMemberDto(m.UserId, m.User!.Name, m.User.Email, m.Role.ToString(), m.CreatedAt, m.User.LastLoginAt, m.UserId == tenant.UserId))
            .ToListAsync(ct);
        var invitations = await (from i in db.Invitations.AsNoTracking()
                                 join u in db.Users.AsNoTracking() on i.InvitedByUserId equals u.Id
                                 where i.AcceptedAt == null && i.RevokedAt == null
                                 orderby i.CreatedAt descending
                                 select new InvitationDto(i.Id, i.Email, i.Role.ToString(), u.Name, i.CreatedAt, i.ExpiresAt, i.ExpiresAt <= now))
            .ToListAsync(ct);
        var plan = Plans.Get(await db.Tenants.Where(t => t.Id == tid).Select(t => t.PlanCode).FirstAsync(ct));
        var used = members.Count(m => m.Role != nameof(MemberRole.Owner)) + invitations.Count(i => !i.Expired);
        return new StaffOverview(members, invitations, new StaffSeats(used, plan.MaxStaff));
    }

    private static async Task<IResult> Invite(InviteRequest req, HttpContext http, AppDbContext db, TenantContext tenant,
        AuditWriter audit, EmailOutbox email, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        var actorRole = http.User.GetRole()!.Value;
        var role = StaffRules.ParseAssignable(req.Role)!.Value;
        if (!StaffRules.CanGrant(actorRole, role))
            throw AppException.Forbidden($"As {Article(actorRole)} {actorRole} you can invite people with a lower role than yours.");

        var address = req.Email.Trim();
        var normalized = AuthEndpoints.Normalize(address);
        var now = DateTimeOffset.UtcNow;
        if (await db.Memberships.AnyAsync(m => m.TenantId == tid && m.User!.NormalizedEmail == normalized, ct))
            throw AppException.Conflict("This person is already a member of your store.");
        if (await db.Invitations.AnyAsync(i => i.NormalizedEmail == normalized && i.AcceptedAt == null && i.RevokedAt == null && i.ExpiresAt > now, ct))
            throw AppException.Conflict("This person already has a pending invitation. Resend it instead.");
        await EnsureSeatAvailable(db, tid, ct);

        var (token, hash) = SecureToken.Create();
        var invitation = new Invitation
        {
            Id = Guid.CreateVersion7(), Email = address, NormalizedEmail = normalized, Role = role, TokenHash = hash,
            InvitedByUserId = tenant.UserId!.Value, ExpiresAt = now.Add(InvitationLifetime), LastSentAt = now, CreatedAt = now,
        };
        db.Invitations.Add(invitation);
        await QueueInvitationEmail(db, email, tid, invitation, token, ct);
        audit.Record(db, "staff.invited", "invitation", invitation.Id, new { email = address, role = role.ToString() });
        await db.SaveChangesAsync(ct);

        var inviter = await db.Users.Where(u => u.Id == invitation.InvitedByUserId).Select(u => u.Name).FirstAsync(ct);
        return Results.Created($"/api/admin/staff/invitations/{invitation.Id}",
            new InvitationDto(invitation.Id, invitation.Email, role.ToString(), inviter, now, invitation.ExpiresAt, false));
    }

    private static async Task<IResult> Resend(Guid id, HttpContext http, AppDbContext db, TenantContext tenant, AuditWriter audit,
        EmailOutbox email, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        var invitation = await db.Invitations.FirstOrDefaultAsync(i => i.Id == id && i.AcceptedAt == null && i.RevokedAt == null, ct)
            ?? throw AppException.NotFound("Invitation");
        if (!StaffRules.CanGrant(http.User.GetRole()!.Value, invitation.Role))
            throw AppException.Forbidden("You can't resend an invitation for a role at or above your own.");
        var now = DateTimeOffset.UtcNow;
        if (now - invitation.LastSentAt < AccountEndpoints.ResendGap)
            throw new AppException(429, ProblemTypes.RateLimited, "Please wait a minute before resending this invitation.");
        // An expired invitation takes a seat again when it is renewed.
        if (invitation.ExpiresAt <= now) await EnsureSeatAvailable(db, tid, ct);

        // A fresh token: any earlier link stops working.
        var (token, hash) = SecureToken.Create();
        invitation.TokenHash = hash;
        invitation.ExpiresAt = now.Add(InvitationLifetime);
        invitation.LastSentAt = now;
        await QueueInvitationEmail(db, email, tid, invitation, token, ct);
        audit.Record(db, "staff.invitation_resent", "invitation", invitation.Id, new { email = invitation.Email });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Revoke(Guid id, HttpContext http, AppDbContext db, AuditWriter audit, CancellationToken ct)
    {
        var invitation = await db.Invitations.FirstOrDefaultAsync(i => i.Id == id && i.AcceptedAt == null && i.RevokedAt == null, ct)
            ?? throw AppException.NotFound("Invitation");
        if (!StaffRules.CanGrant(http.User.GetRole()!.Value, invitation.Role))
            throw AppException.Forbidden("You can't revoke an invitation for a role at or above your own.");
        invitation.RevokedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "staff.invitation_revoked", "invitation", invitation.Id, new { email = invitation.Email });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> ChangeRole(Guid userId, ChangeRoleRequest req, HttpContext http, AppDbContext db,
        TenantContext tenant, AuditWriter audit, IMemoryCache cache, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        var actorRole = http.User.GetRole()!.Value;
        var membership = await TargetMembership(db, tid, userId, tenant, ct);
        var role = StaffRules.ParseAssignable(req.Role)!.Value;
        if (!StaffRules.CanManage(actorRole, membership.Role) || !StaffRules.CanGrant(actorRole, role))
            throw AppException.Forbidden("You can only change roles of people below you, to a role below yours.");
        if (membership.Role == role) return Results.Ok(await Overview(db, tenant, ct));

        var from = membership.Role;
        membership.Role = role;
        var email = await db.Users.Where(u => u.Id == userId).Select(u => u.Email).FirstAsync(ct);
        audit.Record(db, "staff.role_changed", "user", userId, new { email, from = from.ToString(), to = role.ToString() });
        await db.SaveChangesAsync(ct);
        // The member's session carries the old role, so it is rejected on their next request; they sign in again.
        Session.Invalidate(cache, userId, tid);
        return Results.Ok(await Overview(db, tenant, ct));
    }

    private static async Task<IResult> Remove(Guid userId, HttpContext http, AppDbContext db, TenantContext tenant, AuditWriter audit,
        IMemoryCache cache, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        var membership = await TargetMembership(db, tid, userId, tenant, ct);
        if (!StaffRules.CanManage(http.User.GetRole()!.Value, membership.Role))
            throw AppException.Forbidden("You can only remove people with a lower role than yours.");
        var email = await db.Users.Where(u => u.Id == userId).Select(u => u.Email).FirstAsync(ct);
        db.Memberships.Remove(membership);
        audit.Record(db, "staff.removed", "user", userId, new { email, role = membership.Role.ToString() });
        await db.SaveChangesAsync(ct);
        Session.Invalidate(cache, userId, tid);
        return Results.NoContent();
    }

    private static async Task<Membership> TargetMembership(AppDbContext db, Guid tid, Guid userId, TenantContext tenant, CancellationToken ct)
    {
        if (userId == tenant.UserId) throw AppException.Forbidden("You can't change your own role or remove yourself.");
        return await db.Memberships.FirstOrDefaultAsync(m => m.TenantId == tid && m.UserId == userId, ct)
            ?? throw AppException.NotFound("Team member");
    }

    private static async Task EnsureSeatAvailable(AppDbContext db, Guid tid, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var plan = Plans.Get(await db.Tenants.Where(t => t.Id == tid).Select(t => t.PlanCode).FirstAsync(ct));
        if (plan.MaxStaff is not { } max) return;
        var used = await db.Memberships.CountAsync(m => m.TenantId == tid && m.Role != MemberRole.Owner && m.Status == MembershipStatus.Active, ct)
            + await db.Invitations.CountAsync(i => i.AcceptedAt == null && i.RevokedAt == null && i.ExpiresAt > now, ct);
        if (used >= max)
            throw AppException.Unprocessable(ProblemTypes.EntitlementExceeded,
                $"Your {plan.Name} plan includes {max} team {(max == 1 ? "seat" : "seats")} besides the owner, and all are in use or invited. Remove someone or upgrade your plan.");
    }

    private static async Task QueueInvitationEmail(AppDbContext db, EmailOutbox email, Guid tid, Invitation invitation, string token, CancellationToken ct)
    {
        var storeName = await db.Tenants.Where(t => t.Id == tid).Select(t => t.Name).FirstAsync(ct);
        var inviter = await db.Users.Where(u => u.Id == invitation.InvitedByUserId).Select(u => u.Name).FirstAsync(ct);
        email.Invitation(db, tid, invitation.Email, storeName, inviter, invitation.Role, token);
    }

    private static string Article(MemberRole r) => r == MemberRole.Owner ? "an" : "a";

    // ---------- Public: preview and accept ----------

    private sealed record ResolvedInvitation(Guid Id, Guid TenantId, string Email, string NormalizedEmail, MemberRole Role,
        string StoreName, string InvitedBy, DateTimeOffset ExpiresAt);

    /// <summary>
    /// Resolves a pending invitation from its token. The invitee has no tenant context yet, so this single lookup by
    /// token hash uses the platform role. Everything after it runs under the invitation's tenant with RLS enforced.
    /// </summary>
    private static async Task<ResolvedInvitation> Resolve(PlatformDbContext platform, string raw, CancellationToken ct)
    {
        var invalid = new AppException(404, ProblemTypes.InvalidToken, "This invitation is invalid or has expired.",
            "Ask the store owner to send you a new invitation.");
        if (!SecureToken.LooksValid(raw)) throw invalid;
        var hash = SecureToken.Hash(raw);
        var now = DateTimeOffset.UtcNow;
        return await (from i in platform.Invitations.AsNoTracking()
                      join t in platform.Tenants.AsNoTracking() on i.TenantId equals t.Id
                      join u in platform.Users.AsNoTracking() on i.InvitedByUserId equals u.Id
                      where i.TokenHash == hash && i.AcceptedAt == null && i.RevokedAt == null && i.ExpiresAt > now
                            && t.Status != TenantStatus.Suspended && t.Status != TenantStatus.Cancelled
                      select new ResolvedInvitation(i.Id, i.TenantId, i.Email, i.NormalizedEmail, i.Role, t.Name, u.Name, i.ExpiresAt))
            .FirstOrDefaultAsync(ct) ?? throw invalid;
    }

    private static async Task<IResult> Preview(string token, PlatformDbContext platform, CancellationToken ct)
    {
        var inv = await Resolve(platform, token, ct);
        var exists = await platform.Users.AnyAsync(u => u.NormalizedEmail == inv.NormalizedEmail, ct);
        return Results.Ok(new InvitationPreview(inv.StoreName, inv.Email, inv.Role.ToString(), inv.InvitedBy, inv.ExpiresAt, exists));
    }

    /// <summary>
    /// Accepts an invitation. A new person sets their name and password here (the link proves they own the address).
    /// Someone who already has an account must be signed in as that account, so a leaked link can't attach a store
    /// to another person's login.
    /// </summary>
    private static async Task<IResult> Accept(AcceptInvitationRequest req, HttpContext http, PlatformDbContext platform,
        AppDbContext db, TenantContext tenant, AuditWriter audit, IMemoryCache cache, CancellationToken ct)
    {
        var inv = await Resolve(platform, req.Token, ct);
        var now = DateTimeOffset.UtcNow;
        var existing = await platform.Users.AsNoTracking().Where(u => u.NormalizedEmail == inv.NormalizedEmail)
            .Select(u => new { u.Id }).FirstOrDefaultAsync(ct);

        Guid userId;
        if (existing is not null)
        {
            var signedIn = http.User.Identity?.IsAuthenticated == true ? http.User.GetUserId() : null;
            if (signedIn is null)
                throw new AppException(401, ProblemTypes.SignInRequired, "Sign in to accept this invitation.",
                    $"You already have a ShopMint account for {inv.Email}. Sign in with it, then open the invitation link again.");
            if (signedIn != existing.Id)
                throw AppException.Forbidden($"This invitation is for {inv.Email}. Sign out and sign in with that account to accept it.");
            userId = existing.Id;
        }
        else
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(req.Name)) errors["name"] = ["Enter your name."];
            if (string.IsNullOrEmpty(req.Password)) errors["password"] = ["Choose a password."];
            if (errors.Count > 0) throw new AppException(400, ProblemTypes.Validation, "One or more validation errors occurred.", null, errors);
            userId = Guid.CreateVersion7();
        }

        tenant.Set(inv.TenantId, userId);
        var invitation = await db.Invitations.FirstAsync(i => i.Id == inv.Id, ct);
        if (await db.Memberships.AnyAsync(m => m.TenantId == inv.TenantId && m.UserId == userId, ct))
            throw AppException.Conflict("You're already a member of this store.");

        User user;
        if (existing is null)
        {
            user = new User
            {
                Id = userId, Email = inv.Email, NormalizedEmail = inv.NormalizedEmail, Name = req.Name!.Trim(),
                EmailVerifiedAt = now, CreatedAt = now, LastLoginAt = now,
            };
            user.PasswordHash = Hasher.HashPassword(user, req.Password!);
            db.Users.Add(user);
        }
        else
        {
            user = await db.Users.FirstAsync(u => u.Id == userId, ct);
            user.EmailVerifiedAt ??= now;
        }

        var membership = new Membership { Id = Guid.CreateVersion7(), TenantId = inv.TenantId, UserId = userId, Role = inv.Role, CreatedAt = now };
        db.Memberships.Add(membership);
        invitation.AcceptedAt = now;
        audit.Record(db, "staff.invitation_accepted", "user", userId, new { email = inv.Email, role = inv.Role.ToString() });
        await db.SaveChangesAsync(ct);

        Session.Invalidate(cache, userId, inv.TenantId);
        await http.SignInAsync(Session.Scheme, Session.Principal(user, membership));
        return Results.Ok(await AuthEndpoints.BuildMe(db, userId, membership, ct));
    }
}
