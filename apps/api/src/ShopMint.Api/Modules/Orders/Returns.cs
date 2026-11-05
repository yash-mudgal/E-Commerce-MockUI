using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Customers;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Notifications;

namespace ShopMint.Api.Modules.Orders;

public enum ReturnStatus { Requested, Approved, Rejected, Received, Refunded, Closed }
public enum ReturnReason { Damaged, WrongItem, SizeOrFit, NotAsDescribed, ChangedMind, Other }
public enum ReturnResolution { Refund, Exchange }

/// <summary>
/// A shopper's request to return items from a delivered order, within the store's return window. The store approves
/// or rejects it, marks the parcel received (optionally restocking), and refunds through the normal refund flow or
/// closes it after an exchange.
/// </summary>
public sealed class ReturnRequest : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public Guid CustomerId { get; set; }
    public ReturnReason Reason { get; set; }
    public ReturnResolution Resolution { get; set; }
    public string? Note { get; set; }
    public ReturnStatus Status { get; set; }
    /// <summary>The store's message to the shopper (why rejected, how to send the parcel…).</summary>
    public string? StoreNote { get; set; }
    public bool Restocked { get; set; }
    public Guid? RefundId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public uint Version { get; set; }
    public List<ReturnLine> Lines { get; set; } = [];
}

public sealed class ReturnLine : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ReturnRequestId { get; set; }
    public Guid OrderLineId { get; set; }
    public int Quantity { get; set; }
}

public sealed record ReturnLineRequest(Guid OrderLineId, int Quantity);
public sealed record CreateReturnRequest(string Reason, string Resolution, string? Note, ReturnLineRequest[] Lines);
public sealed record ReturnableLine(Guid OrderLineId, string ProductTitle, string? VariantLabel, int Ordered, int Returnable, decimal UnitRefund);
public sealed record ReturnLineDto(Guid OrderLineId, string ProductTitle, string? VariantLabel, int Quantity, decimal Value);
public sealed record ReturnDto(Guid Id, Guid OrderId, int OrderNumber, string Status, string Reason, string Resolution, string? Note, string? StoreNote,
    bool Restocked, decimal Value, decimal? RefundedAmount, IReadOnlyList<ReturnLineDto> Lines, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    string? CustomerName = null, string? CustomerEmail = null);
public sealed record ShopperReturns(bool CanRequest, string? Reason, DateTimeOffset? Deadline, IReadOnlyList<ReturnableLine> Lines, IReadOnlyList<ReturnDto> Returns);
public sealed record ReturnNoteRequest(string? Note);
public sealed record ReceiveReturnRequest(bool Restock);
public sealed record RefundReturnRequest(decimal Amount);

public sealed class CreateReturnValidator : AbstractValidator<CreateReturnRequest>
{
    public CreateReturnValidator()
    {
        RuleFor(x => x.Reason).Must(r => Enum.TryParse<ReturnReason>(r, true, out _)).WithMessage("Choose a reason.");
        RuleFor(x => x.Resolution).Must(r => Enum.TryParse<ReturnResolution>(r, true, out _)).WithMessage("Choose a refund or an exchange.");
        RuleFor(x => x.Note).MaximumLength(1000);
        RuleFor(x => x.Lines).NotEmpty().WithMessage("Choose at least one item to return.");
        RuleForEach(x => x.Lines).Must(l => l.Quantity >= 1).WithMessage("Quantities start at 1.");
    }
}

public sealed class ReturnNoteValidator : AbstractValidator<ReturnNoteRequest>
{
    public ReturnNoteValidator() => RuleFor(x => x.Note).MaximumLength(1000);
}

public static class ReturnEndpoints
{
    public static readonly ReturnStatus[] Counting = [ReturnStatus.Requested, ReturnStatus.Approved, ReturnStatus.Received, ReturnStatus.Refunded, ReturnStatus.Closed];

    public static void Map(RouteGroupBuilder storefront, RouteGroupBuilder admin)
    {
        var s = storefront.MapGroup("/account/orders/{orderId:guid}/returns").WithTags("Returns");
        s.MapGet("/", ForShopper);
        s.MapPost("/", Create).Validate<CreateReturnRequest>().RequireRateLimiting("reviews");

        var a = admin.MapGroup("/returns").WithTags("Returns");
        a.MapGet("/", AdminList).RequirePermission(Permissions.OrdersRead);
        a.MapPost("/{id:guid}/approve", (Guid id, ReturnNoteRequest r, ReturnService svc, CancellationToken ct) => svc.MoveAsync(id, ReturnStatus.Approved, r.Note, ct))
            .Validate<ReturnNoteRequest>().RequirePermission(Permissions.OrdersFulfil);
        a.MapPost("/{id:guid}/reject", (Guid id, ReturnNoteRequest r, ReturnService svc, CancellationToken ct) => svc.MoveAsync(id, ReturnStatus.Rejected, r.Note, ct))
            .Validate<ReturnNoteRequest>().RequirePermission(Permissions.OrdersFulfil);
        a.MapPost("/{id:guid}/close", (Guid id, ReturnNoteRequest r, ReturnService svc, CancellationToken ct) => svc.MoveAsync(id, ReturnStatus.Closed, r.Note, ct))
            .Validate<ReturnNoteRequest>().RequirePermission(Permissions.OrdersFulfil);
        a.MapPost("/{id:guid}/receive", (Guid id, ReceiveReturnRequest r, ReturnService svc, CancellationToken ct) => svc.ReceiveAsync(id, r.Restock, ct))
            .RequirePermission(Permissions.OrdersFulfil);
        a.MapPost("/{id:guid}/refund", (Guid id, RefundReturnRequest r, ReturnService svc, CancellationToken ct) => svc.RefundAsync(id, r.Amount, ct))
            .RequirePermission(Permissions.OrdersRefund);
    }

    private static async Task<IResult> ForShopper(Guid orderId, ReturnService svc, CustomerSession session, CancellationToken ct) =>
        Results.Ok(await svc.ForShopperAsync(await session.RequireAsync(ct), orderId, ct));

    private static async Task<IResult> Create(Guid orderId, CreateReturnRequest req, ReturnService svc, CustomerSession session, CancellationToken ct) =>
        Results.Created($"/api/storefront/account/orders/{orderId}/returns", await svc.CreateAsync(await session.RequireAsync(ct), orderId, req, ct));

    private static async Task<IResult> AdminList([FromQuery] string? status, [FromQuery] Guid? orderId, [FromQuery] int? page, AppDbContext db, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, 25);
        var q = db.ReturnRequests.AsNoTracking();
        if (orderId is { } oid) q = q.Where(r => r.OrderId == oid);
        if (!string.IsNullOrEmpty(status))
        {
            if (!Enum.TryParse<ReturnStatus>(status, true, out var st)) throw AppException.Invalid("status", "Unknown status.");
            q = q.Where(r => r.Status == st);
        }
        var total = await q.CountAsync(ct);
        var ids = await q.OrderByDescending(r => r.UpdatedAt).Skip((pg - 1) * size).Take(size).Select(r => r.Id).ToListAsync(ct);
        var items = await ReturnService.LoadAsync(db, ids, withCustomer: true, ct);
        var open = await db.ReturnRequests.CountAsync(r => r.Status == ReturnStatus.Requested || r.Status == ReturnStatus.Approved || r.Status == ReturnStatus.Received, ct);
        return Results.Ok(new { items, page = pg, pageSize = size, totalCount = total, open });
    }
}

public sealed class ReturnService(AppDbContext db, TenantContext tenant, OrderService orders, AuditWriter audit, EmailOutbox email, IConfiguration config)
{
    private static readonly Dictionary<ReturnStatus, ReturnStatus[]> Allowed = new()
    {
        [ReturnStatus.Approved] = [ReturnStatus.Requested],
        [ReturnStatus.Rejected] = [ReturnStatus.Requested],
        [ReturnStatus.Received] = [ReturnStatus.Approved],
        [ReturnStatus.Refunded] = [ReturnStatus.Received],
        [ReturnStatus.Closed] = [ReturnStatus.Approved, ReturnStatus.Received],
    };

    /// <summary>The refund value of one unit of a line: what the shopper actually paid for it (after discount, with GST).</summary>
    public static decimal UnitRefund(OrderLine l) => l.Quantity == 0 ? 0 : Math.Round(l.LineTotal / l.Quantity, 2, MidpointRounding.AwayFromZero);

    public static async Task<List<ReturnDto>> LoadAsync(AppDbContext db, IReadOnlyCollection<Guid> ids, bool withCustomer, CancellationToken ct)
    {
        var rows = await db.ReturnRequests.AsNoTracking().Include(r => r.Lines).Where(r => ids.Contains(r.Id)).ToListAsync(ct);
        var orderIds = rows.Select(r => r.OrderId).Distinct().ToList();
        var orderInfo = await db.Orders.AsNoTracking().Where(o => orderIds.Contains(o.Id)).Select(o => new { o.Id, o.Number, o.CustomerName, o.Email }).ToDictionaryAsync(o => o.Id, ct);
        var lineIds = rows.SelectMany(r => r.Lines.Select(l => l.OrderLineId)).Distinct().ToList();
        var lines = await db.OrderLines.AsNoTracking().Where(l => lineIds.Contains(l.Id)).ToDictionaryAsync(l => l.Id, ct);
        var refundIds = rows.Where(r => r.RefundId != null).Select(r => r.RefundId!.Value).ToList();
        var refunds = await db.Refunds.AsNoTracking().Where(r => refundIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, r => r.Amount, ct);
        return rows.OrderBy(r => ids.ToList().IndexOf(r.Id)).Select(r =>
        {
            var ls = r.Lines.Select(l => { var ol = lines[l.OrderLineId]; return new ReturnLineDto(ol.Id, ol.ProductTitle, ol.VariantLabel, l.Quantity, UnitRefund(ol) * l.Quantity); }).ToList();
            var o = orderInfo[r.OrderId];
            return new ReturnDto(r.Id, r.OrderId, o.Number, r.Status.ToString(), r.Reason.ToString(), r.Resolution.ToString(), r.Note, r.StoreNote, r.Restocked,
                ls.Sum(l => l.Value), r.RefundId is { } rid && refunds.TryGetValue(rid, out var amt) ? amt : null, ls, r.CreatedAt, r.UpdatedAt,
                withCustomer ? o.CustomerName : null, withCustomer ? o.Email : null);
        }).ToList();
    }

    private async Task<(Order Order, int WindowDays, DateTimeOffset? DeliveredAt)> OrderForShopperAsync(Customer c, Guid orderId, CancellationToken ct)
    {
        var order = await db.Orders.Include(o => o.Lines).Include(o => o.Shipments).FirstOrDefaultAsync(o => o.Id == orderId && o.CustomerId == c.Id, ct)
            ?? throw AppException.NotFound("Order");
        var window = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.ReturnWindowDays).FirstAsync(ct);
        return (order, window, order.Shipments.Max(s => s.DeliveredAt));
    }

    private async Task<Dictionary<Guid, int>> AlreadyReturningAsync(Guid orderId, CancellationToken ct) =>
        await db.ReturnLines.Where(l => db.ReturnRequests.Any(r => r.Id == l.ReturnRequestId && r.OrderId == orderId && ReturnEndpoints.Counting.Contains(r.Status)))
            .GroupBy(l => l.OrderLineId).Select(g => new { g.Key, Qty = g.Sum(l => l.Quantity) }).ToDictionaryAsync(x => x.Key, x => x.Qty, ct);

    private static string? Ineligible(Order o, int window, DateTimeOffset? deliveredAt, DateTimeOffset now) =>
        window <= 0 ? "This store doesn't accept returns on orders placed online. Contact the store if something is wrong."
        : o.Status != OrderStatus.Delivered || deliveredAt is null ? "You can request a return once your order has been delivered."
        : now > deliveredAt.Value.AddDays(window) ? $"The {window}-day return window for this order has ended."
        : null;

    public async Task<ShopperReturns> ForShopperAsync(Customer c, Guid orderId, CancellationToken ct)
    {
        var (order, window, deliveredAt) = await OrderForShopperAsync(c, orderId, ct);
        var taken = await AlreadyReturningAsync(orderId, ct);
        var lines = order.Lines.OrderBy(l => l.ProductTitle).Select(l => new ReturnableLine(l.Id, l.ProductTitle, l.VariantLabel, l.Quantity,
            Math.Max(0, l.Quantity - taken.GetValueOrDefault(l.Id)), UnitRefund(l))).ToList();
        var reason = Ineligible(order, window, deliveredAt, DateTimeOffset.UtcNow) ?? (lines.All(l => l.Returnable == 0) ? "Every item on this order is already in a return." : null);
        var ids = await db.ReturnRequests.Where(r => r.OrderId == orderId).OrderByDescending(r => r.CreatedAt).Select(r => r.Id).ToListAsync(ct);
        return new ShopperReturns(reason is null, reason, deliveredAt?.AddDays(window), lines, await LoadAsync(db, ids, withCustomer: false, ct));
    }

    public async Task<ReturnDto> CreateAsync(Customer c, Guid orderId, CreateReturnRequest req, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Serialise requests for the same order so two at once can't return the same items twice.
        await db.Database.ExecuteSqlAsync($"SELECT 1 FROM orders WHERE id = {orderId} FOR UPDATE", ct);
        var (order, window, deliveredAt) = await OrderForShopperAsync(c, orderId, ct);
        if (Ineligible(order, window, deliveredAt, DateTimeOffset.UtcNow) is { } why) throw AppException.Unprocessable(ProblemTypes.Conflict, why);
        var taken = await AlreadyReturningAsync(orderId, ct);
        foreach (var l in req.Lines.GroupBy(l => l.OrderLineId))
        {
            var line = order.Lines.FirstOrDefault(x => x.Id == l.Key) ?? throw AppException.Invalid("lines", "That item isn't on this order.");
            if (l.Sum(x => x.Quantity) > line.Quantity - taken.GetValueOrDefault(line.Id))
                throw AppException.Invalid("lines", $"You can return up to {line.Quantity - taken.GetValueOrDefault(line.Id)} of {line.ProductTitle}.");
        }
        var now = DateTimeOffset.UtcNow;
        var ret = new ReturnRequest
        {
            Id = Guid.CreateVersion7(), TenantId = tenant.RequireTenant(), OrderId = orderId, CustomerId = c.Id,
            Reason = Enum.Parse<ReturnReason>(req.Reason, true), Resolution = Enum.Parse<ReturnResolution>(req.Resolution, true),
            Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim(), Status = ReturnStatus.Requested, CreatedAt = now, UpdatedAt = now,
        };
        ret.Lines = req.Lines.GroupBy(l => l.OrderLineId).Select(g => new ReturnLine
        {
            Id = Guid.CreateVersion7(), TenantId = ret.TenantId, ReturnRequestId = ret.Id, OrderLineId = g.Key, Quantity = g.Sum(x => x.Quantity),
        }).ToList();
        db.ReturnRequests.Add(ret);
        audit.Record(db, "return.requested", "return", ret.Id, new { order.Number, ret.Reason, ret.Resolution });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return (await LoadAsync(db, [ret.Id], withCustomer: false, ct)).Single();
    }

    private async Task<ReturnRequest> LockAsync(Guid id, CancellationToken ct) =>
        await db.ReturnRequests.FromSql($"SELECT r.*, r.xmin FROM return_requests r WHERE r.id = {id} FOR UPDATE").Include(r => r.Lines).FirstOrDefaultAsync(ct)
        ?? throw AppException.NotFound("Return");

    private static void Guard(ReturnRequest r, ReturnStatus to)
    {
        if (!Allowed[to].Contains(r.Status))
            throw AppException.Conflict($"A return that is {r.Status.ToString().ToLowerInvariant()} can't be marked {to.ToString().ToLowerInvariant()}.");
    }

    public async Task<IResult> MoveAsync(Guid id, ReturnStatus to, string? note, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var r = await LockAsync(id, ct);
        Guard(r, to);
        if (to == ReturnStatus.Rejected && string.IsNullOrWhiteSpace(note)) throw AppException.Invalid("note", "Tell the shopper why the return was declined.");
        r.Status = to;
        if (!string.IsNullOrWhiteSpace(note)) r.StoreNote = note.Trim();
        r.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, $"return.{to.ToString().ToLowerInvariant()}", "return", r.Id, new { note });
        await NotifyAsync(r, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok((await LoadAsync(db, [id], withCustomer: true, ct)).Single());
    }

    /// <summary>The parcel arrived. Restocking puts the returned units back at the location each line was sold from.</summary>
    public async Task<IResult> ReceiveAsync(Guid id, bool restock, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var r = await LockAsync(id, ct);
        Guard(r, ReturnStatus.Received);
        var now = DateTimeOffset.UtcNow;
        if (restock)
        {
            var lineIds = r.Lines.Select(l => l.OrderLineId).ToList();
            var orderLines = await db.OrderLines.Where(l => lineIds.Contains(l.Id) && l.VariantId != null).ToListAsync(ct);
            var variantIds = orderLines.Select(l => l.VariantId!.Value).Distinct().ToArray();
            var levels = await db.StockLevels.FromSql($"SELECT * FROM stock_levels WHERE variant_id = ANY({variantIds}) ORDER BY variant_id, location_id FOR UPDATE").ToListAsync(ct);
            var number = await db.Orders.Where(o => o.Id == r.OrderId).Select(o => o.Number).FirstAsync(ct);
            foreach (var rl in r.Lines)
            {
                var ol = orderLines.FirstOrDefault(l => l.Id == rl.OrderLineId);
                var level = ol is null ? null : levels.FirstOrDefault(s => s.VariantId == ol.VariantId && s.LocationId == ol.LocationId);
                if (ol is null || level is null) continue; // product or location since deleted: nothing to put back
                level.OnHand += rl.Quantity;
                db.StockMovements.Add(new StockMovement
                {
                    Id = Guid.CreateVersion7(), VariantId = ol.VariantId!.Value, LocationId = ol.LocationId, Delta = rl.Quantity,
                    Reason = StockMovementReason.Return, Note = $"Return for order #{number}", BatchId = r.Id, ActorUserId = tenant.UserId, At = now,
                });
            }
            r.Restocked = true;
        }
        r.Status = ReturnStatus.Received;
        r.UpdatedAt = now;
        audit.Record(db, "return.received", "return", r.Id, new { restock });
        await NotifyAsync(r, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok((await LoadAsync(db, [id], withCustomer: true, ct)).Single());
    }

    /// <summary>Refunds through the order's refund flow (gateway or manual for COD), at most the returned items' value.</summary>
    public async Task<IResult> RefundAsync(Guid id, decimal amount, CancellationToken ct)
    {
        var r = await db.ReturnRequests.Include(x => x.Lines).FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw AppException.NotFound("Return");
        Guard(r, ReturnStatus.Refunded);
        var value = (await LoadAsync(db, [id], withCustomer: false, ct)).Single().Value;
        if (amount <= 0 || amount > value) throw AppException.Invalid("amount", $"Refund between ₹1 and {Money.Inr(value)} (the returned items' value).");
        var number = await db.Orders.Where(o => o.Id == r.OrderId).Select(o => o.Number).FirstAsync(ct);
        var refund = await orders.RefundAsync(r.OrderId, amount, $"Return for order #{number}", tenant.UserId, allowUnpaid: false, ct);
        if (refund.Status == RefundStatus.Failed) throw AppException.Unprocessable(ProblemTypes.PaymentsUnavailable, "The payment gateway couldn't refund this. Try again or refund manually.");
        db.ChangeTracker.Clear();
        var fresh = await db.ReturnRequests.FirstAsync(x => x.Id == id, ct);
        fresh.Status = ReturnStatus.Refunded;
        fresh.RefundId = refund.Id;
        fresh.UpdatedAt = DateTimeOffset.UtcNow;
        audit.Record(db, "return.refunded", "return", id, new { amount });
        await NotifyAsync(fresh, ct);
        await db.SaveChangesAsync(ct);
        return Results.Ok((await LoadAsync(db, [id], withCustomer: true, ct)).Single());
    }

    private async Task NotifyAsync(ReturnRequest r, CancellationToken ct)
    {
        var o = await db.Orders.AsNoTracking().Where(x => x.Id == r.OrderId).Select(x => new { x.Id, x.Number, x.Email, x.CustomerName }).FirstAsync(ct);
        var store = await db.Tenants.AsNoTracking().Where(t => t.Id == tenant.TenantId)
            .Select(t => new { t.Name, Host = t.Domains.OrderBy(d => d.Kind).Select(d => d.Host).FirstOrDefault() }).FirstAsync(ct);
        email.ReturnUpdated(db, tenant.RequireTenant(), store.Name, CustomerEndpoints.StorefrontUrl(config, store.Host ?? ""), o.Id, o.Number, o.Email, o.CustomerName, r.Status, r.StoreNote);
    }
}
