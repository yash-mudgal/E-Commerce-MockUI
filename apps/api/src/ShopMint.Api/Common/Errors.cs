using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ShopMint.Api.Common;

/// <summary>Stable problem "type" slugs (see docs/API_DESIGN.md).</summary>
public static class ProblemTypes
{
    public const string Base = "https://docs.shopmint.in/errors/";
    public const string Validation = Base + "validation";
    public const string NotFound = Base + "not-found";
    public const string Conflict = Base + "conflict";
    public const string Concurrency = Base + "concurrency";
    public const string Forbidden = Base + "forbidden";
    public const string Unauthenticated = Base + "unauthenticated";
    public const string TenantSuspended = Base + "tenant-suspended";
    public const string EntitlementExceeded = Base + "entitlement-exceeded";
    public const string Csrf = Base + "csrf";
    public const string RateLimited = Base + "rate-limited";
    public const string InvalidToken = Base + "invalid-token";
    public const string SignInRequired = Base + "sign-in-required";
    public const string LaunchRequirements = Base + "launch-requirements";
    public const string MediaUnavailable = Base + "media-unavailable";
    public const string InvalidMedia = Base + "invalid-media";
    public const string InsufficientStock = Base + "insufficient-stock";
    public const string CartLimit = Base + "cart-limit";
    public const string CartChanged = Base + "cart-changed";
    public const string PaymentsUnavailable = Base + "payments-unavailable";
    public const string InvalidStateTransition = Base + "invalid-state-transition";
    public const string PaymentVerification = Base + "payment-verification";
    public const string StoreUnavailable = Base + "store-unavailable";
    public const string Internal = Base + "internal";
}

/// <summary>An expected business failure that maps to a specific HTTP problem.</summary>
public class AppException(int status, string type, string title, string? detail = null,
    IDictionary<string, string[]>? errors = null) : Exception(detail ?? title)
{
    public int Status { get; } = status;
    public string Type { get; } = type;
    public string Title { get; } = title;
    public string? Detail { get; } = detail;
    public IDictionary<string, string[]>? Errors { get; } = errors;

    public static AppException NotFound(string what) =>
        new(404, ProblemTypes.NotFound, $"{what} was not found.");
    public static AppException Conflict(string detail, string type = ProblemTypes.Conflict) =>
        new(409, type, "The request conflicts with the current state.", detail);
    public static AppException Forbidden(string detail, string type = ProblemTypes.Forbidden) =>
        new(403, type, "You do not have permission to perform this action.", detail);
    public static AppException Invalid(string field, string message) =>
        new(400, ProblemTypes.Validation, "One or more validation errors occurred.", null,
            new Dictionary<string, string[]> { [field] = [message] });
    public static AppException Unprocessable(string type, string detail) =>
        new(422, type, "The request cannot be processed.", detail);
}

/// <summary>
/// Turns exceptions into RFC 9457 problem responses. Unexpected exceptions are logged with the correlation ID
/// and returned without internal details. Known PostgreSQL constraint violations become 409s.
/// </summary>
public sealed class GlobalExceptionHandler(IProblemDetailsService problems, ILogger<GlobalExceptionHandler> log,
    IHostEnvironment env) : IExceptionHandler
{
    private static readonly Dictionary<string, string> UniqueMessages = new()
    {
        ["ux_product_variants_tenant_sku"] = "A variant with this SKU already exists in your store.",
        ["ix_categories_tenant_id_slug"] = "A category with this slug already exists.",
        ["ix_products_tenant_id_slug"] = "A product with this slug already exists.",
        ["ix_tenants_slug"] = "This store address is already taken.",
        ["ix_tenant_domains_host"] = "This store address is already taken.",
        ["ix_users_normalized_email"] = "An account with this email already exists.",
        ["ix_memberships_tenant_id_user_id"] = "This person is already a member of the store.",
        ["ix_locations_tenant_id_code"] = "Another location already uses this code.",
        ["ix_coupons_tenant_id_code"] = "A coupon with this code already exists.",
        ["ix_customers_tenant_id_normalized_email"] = "An account with this email already exists at this store. Sign in instead.",
        ["pk_stock_levels"] = "Stock was changed at the same moment by someone else. Try again.",
    };

    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception ex, CancellationToken ct)
    {
        ProblemDetails pd;
        switch (ex)
        {
            case AppException app:
                pd = app.Errors is null
                    ? new ProblemDetails()
                    : new ValidationProblemDetails(app.Errors);
                pd.Status = app.Status; pd.Type = app.Type; pd.Title = app.Title; pd.Detail = app.Detail;
                break;
            case DbUpdateConcurrencyException:
                pd = new ProblemDetails { Status = 409, Type = ProblemTypes.Concurrency,
                    Title = "The resource was changed by someone else.", Detail = "Reload and try again." };
                break;
            case DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg }:
                pd = new ProblemDetails { Status = 409, Type = ProblemTypes.Conflict, Title = "Duplicate value.",
                    Detail = UniqueMessages.GetValueOrDefault(pg.ConstraintName ?? "", "A record with these values already exists.") };
                break;
            case DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation } }:
                pd = new ProblemDetails { Status = 409, Type = ProblemTypes.Conflict, Title = "The record is in use.",
                    Detail = "It is referenced by other records." };
                break;
            case BadHttpRequestException bad:
                pd = new ProblemDetails { Status = bad.StatusCode, Type = ProblemTypes.Validation, Title = "The request is malformed." };
                break;
            default:
                log.LogError(ex, "Unhandled exception for {Method} {Path}", http.Request.Method, http.Request.Path);
                pd = new ProblemDetails { Status = 500, Type = ProblemTypes.Internal, Title = "An unexpected error occurred.",
                    Detail = env.IsDevelopment() ? ex.ToString() : null };
                break;
        }

        http.Response.StatusCode = pd.Status ?? 500;
        return await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = http, ProblemDetails = pd, Exception = ex });
    }
}
