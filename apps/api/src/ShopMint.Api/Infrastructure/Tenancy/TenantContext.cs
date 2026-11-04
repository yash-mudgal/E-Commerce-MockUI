using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ShopMint.Api.Modules;

namespace ShopMint.Api.Infrastructure.Tenancy;

/// <summary>
/// Per-request tenant and user identity. It is set only by server-side resolution: the session (admin), the
/// request host (storefront) or a job row (background work). It is never set from request bodies.
/// </summary>
public sealed class TenantContext
{
    public Guid? TenantId { get; private set; }
    public Guid? UserId { get; private set; }
    public TenantStatus? TenantStatus { get; private set; }

    public void Set(Guid? tenantId, Guid? userId, TenantStatus? status = null)
    {
        TenantId = tenantId;
        UserId = userId;
        TenantStatus = status;
    }

    public Guid RequireTenant() =>
        TenantId ?? throw new InvalidOperationException("No tenant resolved for this operation.");
}

/// <summary>
/// Pushes the tenant and user into PostgreSQL session settings every time EF opens a pooled connection, so
/// RLS policies see the current request's identity. Empty settings match no rows, so the default is to fail
/// closed.
/// </summary>
public sealed class TenantConnectionInterceptor(TenantContext tenant) : DbConnectionInterceptor
{
    private const string Sql =
        "select set_config('app.tenant_id', @t, false), set_config('app.user_id', @u, false)";

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        using var cmd = Build(connection);
        cmd.ExecuteNonQuery();
    }

    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        await using var cmd = Build(connection);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private DbCommand Build(DbConnection connection)
    {
        var cmd = connection.CreateCommand();
        cmd.CommandText = Sql;
        AddParam(cmd, "t", tenant.TenantId?.ToString() ?? "");
        AddParam(cmd, "u", tenant.UserId?.ToString() ?? "");
        return cmd;
    }

    private static void AddParam(DbCommand cmd, string name, string value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
