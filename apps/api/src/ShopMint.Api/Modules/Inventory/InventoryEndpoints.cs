using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Catalog;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Platform;

namespace ShopMint.Api.Modules.Inventory;

// ---------- Contracts ----------

public sealed record LocationDto(Guid Id, string Name, string Code, string? StateCode, bool IsDefault, int UnitsOnHand, int VariantsStocked);
public sealed record LocationsOverview(IReadOnlyList<LocationDto> Locations, int? MaxLocations);
public sealed record LocationRequest(string Name, string Code, string? StateCode, bool IsDefault = false);

public sealed record StockAtLocation(Guid LocationId, int OnHand, int Reserved);
public sealed record InventoryItem(Guid VariantId, Guid ProductId, string ProductTitle, string ProductStatus, string Sku, string[] OptionValues,
    bool IsActive, int OnHand, int Reserved, int Available, bool LowStock, IReadOnlyList<StockAtLocation> Levels);

public sealed record AdjustmentLine(Guid VariantId, int? Delta, int? CountedOnHand);
public sealed record AdjustmentRequest(Guid LocationId, string Reason, string? Note, List<AdjustmentLine> Lines);
public sealed record TransferLine(Guid VariantId, int Quantity);
public sealed record TransferRequest(Guid FromLocationId, Guid ToLocationId, string? Note, List<TransferLine> Lines);
public sealed record AdjustmentResult(Guid BatchId, IReadOnlyList<InventoryItem> Items);

public sealed record MovementDto(Guid Id, DateTimeOffset At, Guid VariantId, string? Sku, string? ProductTitle, Guid LocationId, string? LocationName,
    int Delta, string Reason, string? Note, string? ActorName, Guid? BatchId);

public sealed class LocationValidator : AbstractValidator<LocationRequest>
{
    public LocationValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Code).NotEmpty().MaximumLength(16).Matches("^[A-Za-z0-9_-]+$").WithMessage("Use letters, numbers, - and _ only.");
        RuleFor(x => x.StateCode).Matches("^[0-9]{2}$").When(x => !string.IsNullOrEmpty(x.StateCode)).WithMessage("Use the 2-digit GST state code.");
    }
}

public sealed class AdjustmentValidator : AbstractValidator<AdjustmentRequest>
{
    public AdjustmentValidator()
    {
        RuleFor(x => x.Reason).Must(r => InventoryRules.ParseManualReason(r) is not null)
            .WithMessage("Choose a reason: received, correction, damaged, lost or customer return.");
        RuleFor(x => x.Note).MaximumLength(500);
        RuleFor(x => x.Lines).NotEmpty().WithMessage("Add at least one item.")
            .Must(l => l is null || l.Count <= 100).WithMessage("Adjust up to 100 items at a time.")
            .Must(l => l is null || l.Select(x => x.VariantId).Distinct().Count() == l.Count).WithMessage("Each item may appear once.");
        RuleForEach(x => x.Lines).ChildRules(l =>
        {
            l.RuleFor(x => x).Must(x => x.Delta.HasValue ^ x.CountedOnHand.HasValue).WithName("line")
                .WithMessage("Give either a change in units or a counted quantity.");
            l.RuleFor(x => x.Delta).NotEqual(0).InclusiveBetween(-1_000_000, 1_000_000).When(x => x.Delta.HasValue);
            l.RuleFor(x => x.CountedOnHand).InclusiveBetween(0, 1_000_000).When(x => x.CountedOnHand.HasValue);
        });
    }
}

public sealed class TransferValidator : AbstractValidator<TransferRequest>
{
    public TransferValidator()
    {
        RuleFor(x => x.ToLocationId).NotEqual(x => x.FromLocationId).WithMessage("Choose two different locations.");
        RuleFor(x => x.Note).MaximumLength(500);
        RuleFor(x => x.Lines).NotEmpty().Must(l => l is null || l.Count <= 100)
            .Must(l => l is null || l.Select(x => x.VariantId).Distinct().Count() == l.Count).WithMessage("Each item may appear once.");
        RuleForEach(x => x.Lines).ChildRules(l => l.RuleFor(x => x.Quantity).InclusiveBetween(1, 1_000_000));
    }
}

public static class InventoryRules
{
    /// <summary>Reasons a person may record. Sale, Initial and transfers are written by the system.</summary>
    public static StockMovementReason? ParseManualReason(string? reason) => reason?.ToLowerInvariant() switch
    {
        "receipt" => StockMovementReason.Receipt,
        "correction" => StockMovementReason.Correction,
        "damaged" => StockMovementReason.Damaged,
        "lost" => StockMovementReason.Lost,
        "return" => StockMovementReason.Return,
        _ => null,
    };

    /// <summary>Receipts and returns add stock; damage and loss remove it; a correction can go either way.</summary>
    public static string? DirectionProblem(StockMovementReason reason, int delta) => reason switch
    {
        StockMovementReason.Receipt or StockMovementReason.Return when delta < 0 => "Received and returned stock must increase the count.",
        StockMovementReason.Damaged or StockMovementReason.Lost when delta > 0 => "Damaged or lost stock must decrease the count.",
        _ => null,
    };
}

// ---------- Endpoints ----------

/// <summary>
/// Stock per variant and location. Every change is a ledger row (stock_movements) written in the same transaction
/// as the level change. Rows are locked (SELECT … FOR UPDATE) so concurrent adjustments, transfers and, later,
/// checkout reservations serialise on the affected levels. Stock can never drop below what is reserved.
/// </summary>
public static class InventoryEndpoints
{
    public static void Map(RouteGroupBuilder admin)
    {
        var loc = admin.MapGroup("/locations").WithTags("Inventory");
        loc.MapGet("/", ListLocations).RequirePermission(Permissions.CatalogRead);
        loc.MapPost("/", CreateLocation).Validate<LocationRequest>().RequirePermission(Permissions.SettingsWrite);
        loc.MapPut("/{id:guid}", UpdateLocation).Validate<LocationRequest>().RequirePermission(Permissions.SettingsWrite);
        loc.MapDelete("/{id:guid}", DeleteLocation).RequirePermission(Permissions.SettingsWrite);

        var inv = admin.MapGroup("/inventory").WithTags("Inventory");
        inv.MapGet("/", ListInventory).RequirePermission(Permissions.CatalogRead);
        inv.MapGet("/movements", ListMovements).RequirePermission(Permissions.CatalogRead);
        inv.MapPost("/adjustments", Adjust).Validate<AdjustmentRequest>().RequirePermission(Permissions.InventoryWrite);
        inv.MapPost("/transfers", Transfer).Validate<TransferRequest>().RequirePermission(Permissions.InventoryWrite);
    }

    // ----- Locations -----

    private static async Task<IResult> ListLocations(AppDbContext db, TenantContext tenant, CancellationToken ct) =>
        Results.Ok(await Overview(db, tenant.RequireTenant(), ct));

    private static async Task<LocationsOverview> Overview(AppDbContext db, Guid tid, CancellationToken ct)
    {
        var items = await db.Locations.AsNoTracking().OrderByDescending(l => l.IsDefault).ThenBy(l => l.Name)
            .Select(l => new LocationDto(l.Id, l.Name, l.Code, l.StateCode, l.IsDefault,
                db.StockLevels.Where(s => s.LocationId == l.Id).Sum(s => (int?)s.OnHand) ?? 0,
                db.StockLevels.Count(s => s.LocationId == l.Id && s.OnHand > 0)))
            .ToListAsync(ct);
        var plan = Plans.Get(await db.Tenants.Where(t => t.Id == tid).Select(t => t.PlanCode).FirstAsync(ct));
        return new LocationsOverview(items, plan.MaxLocations);
    }

    private static async Task<IResult> CreateLocation(LocationRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, CancellationToken ct)
    {
        var tid = tenant.RequireTenant();
        var plan = Plans.Get(await db.Tenants.Where(t => t.Id == tid).Select(t => t.PlanCode).FirstAsync(ct));
        Plans.EnsureLocationCapacity(plan.Code, await db.Locations.CountAsync(ct));
        var code = req.Code.Trim().ToUpperInvariant();
        if (await db.Locations.AnyAsync(l => l.Code == code, ct)) throw AppException.Invalid("code", "Another location already uses this code.");
        var location = new Location
        {
            Id = Guid.CreateVersion7(), Name = req.Name.Trim(), Code = code, StateCode = Blank(req.StateCode), CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Locations.Add(location);
        if (req.IsDefault) await MakeDefault(db, location, ct);
        audit.Record(db, "inventory.location_created", "location", location.Id, new { location.Name, location.Code });
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/admin/locations/{location.Id}", await Overview(db, tid, ct));
    }

    private static async Task<IResult> UpdateLocation(Guid id, LocationRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, CancellationToken ct)
    {
        var location = await db.Locations.FirstOrDefaultAsync(l => l.Id == id, ct) ?? throw AppException.NotFound("Location");
        var code = req.Code.Trim().ToUpperInvariant();
        if (await db.Locations.AnyAsync(l => l.Code == code && l.Id != id, ct)) throw AppException.Invalid("code", "Another location already uses this code.");
        location.Name = req.Name.Trim();
        location.Code = code;
        location.StateCode = Blank(req.StateCode);
        if (req.IsDefault && !location.IsDefault) await MakeDefault(db, location, ct);
        if (!req.IsDefault && location.IsDefault)
            throw AppException.Invalid("isDefault", "Make another location the default instead.");
        audit.Record(db, "inventory.location_updated", "location", id, new { location.Name, location.Code, location.IsDefault });
        await db.SaveChangesAsync(ct);
        return Results.Ok(await Overview(db, tenant.RequireTenant(), ct));
    }

    private static async Task<IResult> DeleteLocation(Guid id, AppDbContext db, AuditWriter audit, CancellationToken ct)
    {
        var location = await db.Locations.FirstOrDefaultAsync(l => l.Id == id, ct) ?? throw AppException.NotFound("Location");
        if (location.IsDefault) throw AppException.Conflict("The default location can't be deleted. Make another location the default first.");
        if (await db.StockLevels.AnyAsync(s => s.LocationId == id && (s.OnHand > 0 || s.Reserved > 0), ct))
            throw AppException.Conflict("This location still holds stock. Transfer or adjust it to zero first.");
        await db.StockLevels.Where(s => s.LocationId == id).ExecuteDeleteAsync(ct);
        db.Locations.Remove(location);
        audit.Record(db, "inventory.location_deleted", "location", id, new { location.Name, location.Code });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task MakeDefault(AppDbContext db, Location location, CancellationToken ct)
    {
        foreach (var other in await db.Locations.Where(l => l.IsDefault && l.Id != location.Id).ToListAsync(ct)) other.IsDefault = false;
        location.IsDefault = true;
    }

    // ----- Stock -----

    private static async Task<IResult> ListInventory(AppDbContext db, TenantContext tenant, [FromQuery] string? q, [FromQuery] Guid? locationId,
        [FromQuery] string? stock, [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, pageSize);
        var threshold = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.LowStockThreshold).FirstAsync(ct);
        var query = db.ProductVariants.AsNoTracking()
            .Join(db.Products.Where(p => p.Status != ProductStatus.Archived), v => v.ProductId, p => p.Id, (v, p) => new { v, p });
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = $"%{CatalogEndpoints.EscapeLike(q.Trim())}%";
            query = query.Where(x => EF.Functions.ILike(x.p.Title, term, "\\") || EF.Functions.ILike(x.v.Sku, term, "\\"));
        }
        // Totals at the chosen location, or across all locations.
        var shaped = query.Select(x => new
        {
            x.v, x.p,
            OnHand = x.v.StockLevels.Where(s => locationId == null || s.LocationId == locationId).Sum(s => (int?)s.OnHand) ?? 0,
            Reserved = x.v.StockLevels.Where(s => locationId == null || s.LocationId == locationId).Sum(s => (int?)s.Reserved) ?? 0,
        });
        shaped = stock switch
        {
            null or "" or "all" => shaped,
            "low" => shaped.Where(x => x.OnHand - x.Reserved > 0 && x.OnHand - x.Reserved <= threshold),
            "out" => shaped.Where(x => x.OnHand - x.Reserved <= 0),
            _ => throw AppException.Invalid("stock", "Use all, low or out."),
        };
        var total = await shaped.CountAsync(ct);
        var rows = await shaped.OrderBy(x => x.p.Title).ThenBy(x => x.v.Position).Skip((pg - 1) * size).Take(size)
            .Select(x => new
            {
                x.v.Id, ProductId = x.p.Id, x.p.Title, x.p.Status, x.v.Sku, x.v.OptionValues, x.v.IsActive, x.OnHand, x.Reserved,
                Levels = x.v.StockLevels.Select(s => new StockAtLocation(s.LocationId, s.OnHand, s.Reserved)).ToList(),
            })
            .ToListAsync(ct);
        var items = rows.Select(r => new InventoryItem(r.Id, r.ProductId, r.Title, r.Status.ToString().ToLowerInvariant(), r.Sku, r.OptionValues,
            r.IsActive, r.OnHand, r.Reserved, r.OnHand - r.Reserved, r.OnHand - r.Reserved > 0 && r.OnHand - r.Reserved <= threshold, r.Levels)).ToList();
        return Results.Ok(new Paged<InventoryItem>(items, pg, size, total));
    }

    private static async Task<IResult> Adjust(AdjustmentRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, CancellationToken ct)
    {
        var reason = InventoryRules.ParseManualReason(req.Reason)!.Value;
        if (!await db.Locations.AnyAsync(l => l.Id == req.LocationId, ct)) throw AppException.Invalid("locationId", "Location not found.");
        var variantIds = req.Lines.Select(l => l.VariantId).ToList();
        await EnsureVariantsAsync(db, variantIds, ct);
        // Direction rules for explicit changes are input errors (400); counted quantities are checked once the current level is known.
        var directionErrors = req.Lines.Select((l, i) => (i, problem: l.Delta is { } d ? InventoryRules.DirectionProblem(reason, d) : null))
            .Where(x => x.problem is not null).ToDictionary(x => $"lines[{x.i}]", x => new[] { x.problem! });
        if (directionErrors.Count > 0)
            throw new AppException(400, ProblemTypes.Validation, "One or more validation errors occurred.", null, directionErrors);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var levels = await LockLevelsAsync(db, variantIds, [req.LocationId], ct);
        var batch = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        var errors = new Dictionary<string, string[]>();
        for (var i = 0; i < req.Lines.Count; i++)
        {
            var line = req.Lines[i];
            var level = Level(db, levels, line.VariantId, req.LocationId);
            var delta = line.Delta ?? (line.CountedOnHand!.Value - level.OnHand);
            if (InventoryRules.DirectionProblem(reason, delta) is { } dir) { errors[$"lines[{i}]"] = [dir]; continue; }
            if (level.OnHand + delta < level.Reserved)
            {
                errors[$"lines[{i}]"] = [level.Reserved > 0
                    ? $"Only {level.OnHand - level.Reserved} units are free here ({level.Reserved} are reserved for orders)."
                    : $"Only {level.OnHand} units are on hand here."];
                continue;
            }
            if (delta == 0) continue; // a count that matches is fine: nothing to record
            level.OnHand += delta;
            db.StockMovements.Add(new StockMovement
            {
                Id = Guid.CreateVersion7(), VariantId = line.VariantId, LocationId = req.LocationId, Delta = delta, Reason = reason,
                Note = Blank(req.Note), BatchId = batch, ActorUserId = tenant.UserId, At = now,
            });
        }
        if (errors.Count > 0)
            throw new AppException(409, ProblemTypes.InsufficientStock, "Some lines can't be applied.", "Nothing was changed.", errors);

        audit.Record(db, "inventory.adjusted", "location", req.LocationId,
            new { reason = reason.ToString(), lines = req.Lines.Count, note = Blank(req.Note), batch });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(new AdjustmentResult(batch, await ItemsAsync(db, tenant, variantIds, ct)));
    }

    private static async Task<IResult> Transfer(TransferRequest req, AppDbContext db, TenantContext tenant, AuditWriter audit, CancellationToken ct)
    {
        var locations = await db.Locations.Where(l => l.Id == req.FromLocationId || l.Id == req.ToLocationId).Select(l => l.Id).ToListAsync(ct);
        if (!locations.Contains(req.FromLocationId)) throw AppException.Invalid("fromLocationId", "Location not found.");
        if (!locations.Contains(req.ToLocationId)) throw AppException.Invalid("toLocationId", "Location not found.");
        var variantIds = req.Lines.Select(l => l.VariantId).ToList();
        await EnsureVariantsAsync(db, variantIds, ct);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var levels = await LockLevelsAsync(db, variantIds, [req.FromLocationId, req.ToLocationId], ct);
        var batch = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        var errors = new Dictionary<string, string[]>();
        for (var i = 0; i < req.Lines.Count; i++)
        {
            var line = req.Lines[i];
            var from = Level(db, levels, line.VariantId, req.FromLocationId);
            if (from.OnHand - from.Reserved < line.Quantity)
            {
                errors[$"lines[{i}]"] = [$"Only {Math.Max(0, from.OnHand - from.Reserved)} units are free to move from this location."];
                continue;
            }
            var to = Level(db, levels, line.VariantId, req.ToLocationId);
            from.OnHand -= line.Quantity;
            to.OnHand += line.Quantity;
            var note = Blank(req.Note);
            db.StockMovements.Add(new StockMovement { Id = Guid.CreateVersion7(), VariantId = line.VariantId, LocationId = req.FromLocationId,
                Delta = -line.Quantity, Reason = StockMovementReason.TransferOut, Note = note, BatchId = batch, ActorUserId = tenant.UserId, At = now });
            db.StockMovements.Add(new StockMovement { Id = Guid.CreateVersion7(), VariantId = line.VariantId, LocationId = req.ToLocationId,
                Delta = line.Quantity, Reason = StockMovementReason.TransferIn, Note = note, BatchId = batch, ActorUserId = tenant.UserId, At = now });
        }
        if (errors.Count > 0)
            throw new AppException(409, ProblemTypes.InsufficientStock, "Some lines can't be moved.", "Nothing was changed.", errors);

        audit.Record(db, "inventory.transferred", "location", req.FromLocationId,
            new { to = req.ToLocationId, lines = req.Lines.Count, units = req.Lines.Sum(l => l.Quantity), batch });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(new AdjustmentResult(batch, await ItemsAsync(db, tenant, variantIds, ct)));
    }

    private static async Task<IResult> ListMovements(AppDbContext db, [FromQuery] Guid? variantId, [FromQuery] Guid? locationId,
        [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var (pg, size) = Paging.Normalize(page, pageSize);
        var q = db.StockMovements.AsNoTracking();
        if (variantId is { } v) q = q.Where(m => m.VariantId == v);
        if (locationId is { } l) q = q.Where(m => m.LocationId == l);
        var total = await q.CountAsync(ct);
        // Variants may have been deleted since; the ledger keeps their rows, so these joins are optional.
        var items = await (from m in q
                           join va in db.ProductVariants on m.VariantId equals va.Id into vs
                           from va in vs.DefaultIfEmpty()
                           join p in db.Products on va.ProductId equals p.Id into ps
                           from p in ps.DefaultIfEmpty()
                           join lo in db.Locations on m.LocationId equals lo.Id into ls
                           from lo in ls.DefaultIfEmpty()
                           join u in db.Users on m.ActorUserId equals u.Id into us
                           from u in us.DefaultIfEmpty()
                           orderby m.At descending, m.Id descending
                           select new MovementDto(m.Id, m.At, m.VariantId, va.Sku, p.Title, m.LocationId, lo.Name, m.Delta, m.Reason.ToString(), m.Note,
                               u.Name, m.BatchId))
            .Skip((pg - 1) * size).Take(size).ToListAsync(ct);
        return Results.Ok(new Paged<MovementDto>(items, pg, size, total));
    }

    // ----- Helpers -----

    private static async Task EnsureVariantsAsync(AppDbContext db, List<Guid> ids, CancellationToken ct)
    {
        // The tenant filter makes another store's variants invisible, so they fail here like unknown IDs.
        var found = await db.ProductVariants.Where(v => ids.Contains(v.Id)).CountAsync(ct);
        if (found != ids.Count) throw AppException.Invalid("lines", "One or more items were not found.");
    }

    /// <summary>Locks existing level rows for the duration of the transaction. RLS still applies to this raw query.</summary>
    private static Task<List<StockLevel>> LockLevelsAsync(AppDbContext db, List<Guid> variantIds, Guid[] locationIds, CancellationToken ct) =>
        db.StockLevels.FromSql($"""
            SELECT * FROM stock_levels WHERE variant_id = ANY({variantIds.ToArray()}) AND location_id = ANY({locationIds})
            ORDER BY variant_id, location_id FOR UPDATE
            """).ToListAsync(ct);

    private static StockLevel Level(AppDbContext db, List<StockLevel> levels, Guid variantId, Guid locationId)
    {
        var level = levels.FirstOrDefault(s => s.VariantId == variantId && s.LocationId == locationId);
        if (level is not null) return level;
        level = new StockLevel { VariantId = variantId, LocationId = locationId };
        db.StockLevels.Add(level);
        levels.Add(level);
        return level;
    }

    private static async Task<IReadOnlyList<InventoryItem>> ItemsAsync(AppDbContext db, TenantContext tenant, List<Guid> ids, CancellationToken ct)
    {
        var threshold = await db.Tenants.Where(t => t.Id == tenant.TenantId).Select(t => t.LowStockThreshold).FirstAsync(ct);
        var rows = await db.ProductVariants.AsNoTracking().Where(v => ids.Contains(v.Id))
            .Join(db.Products, v => v.ProductId, p => p.Id, (v, p) => new
            {
                v.Id, ProductId = p.Id, p.Title, p.Status, v.Sku, v.OptionValues, v.IsActive,
                Levels = v.StockLevels.Select(s => new StockAtLocation(s.LocationId, s.OnHand, s.Reserved)).ToList(),
            }).ToListAsync(ct);
        return rows.Select(r =>
        {
            int onHand = r.Levels.Sum(l => l.OnHand), reserved = r.Levels.Sum(l => l.Reserved);
            return new InventoryItem(r.Id, r.ProductId, r.Title, r.Status.ToString().ToLowerInvariant(), r.Sku, r.OptionValues, r.IsActive,
                onHand, reserved, onHand - reserved, onHand - reserved > 0 && onHand - reserved <= threshold, r.Levels);
        }).ToList();
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
