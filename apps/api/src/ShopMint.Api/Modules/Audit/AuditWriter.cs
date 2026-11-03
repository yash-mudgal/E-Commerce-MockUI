using System.Text.Json;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;

namespace ShopMint.Api.Modules.Audit;

/// <summary>
/// Adds audit entries to the caller's DbContext, so they commit atomically with the change they describe.
/// The database grants the app role INSERT/SELECT only on audit_log.
/// </summary>
public sealed class AuditWriter(TenantContext tenant, IHttpContextAccessor http)
{
    public void Record(AppDbContext db, string action, string? entityType = null, object? entityId = null,
        object? data = null, Guid? tenantIdOverride = null, Guid? actorOverride = null)
    {
        var ctx = http.HttpContext;
        db.AuditLog.Add(new AuditEntry
        {
            Id = Guid.CreateVersion7(),
            TenantId = tenantIdOverride ?? tenant.TenantId,
            ActorUserId = actorOverride ?? tenant.UserId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId?.ToString(),
            Data = data is null ? null : JsonSerializer.Serialize(data),
            CorrelationId = ctx?.TraceIdentifier,
            Ip = ctx?.Connection.RemoteIpAddress?.ToString(),
            At = DateTimeOffset.UtcNow,
        });
    }
}
