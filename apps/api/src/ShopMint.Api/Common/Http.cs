using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace ShopMint.Api.Common;

/// <summary>Accepts or generates <c>X-Correlation-Id</c>, echoes it back and uses it as the trace identifier.</summary>
public sealed partial class CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> log)
{
    public const string Header = "X-Correlation-Id";

    [GeneratedRegex("^[A-Za-z0-9._-]{1,64}$")]
    private static partial Regex Valid();

    public async Task InvokeAsync(HttpContext ctx)
    {
        var incoming = ctx.Request.Headers[Header].ToString();
        var id = Valid().IsMatch(incoming) ? incoming : Guid.NewGuid().ToString("N");
        ctx.TraceIdentifier = id;
        ctx.Response.Headers[Header] = id;
        using (log.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id }))
            await next(ctx);
    }
}

/// <summary>
/// CSRF defence for cookie-authenticated APIs. Unsafe methods must carry <c>X-ShopMint-Csrf: 1</c>. Browsers
/// cannot attach custom headers to cross-site requests without a CORS preflight, and CORS is closed.
/// Webhooks are exempt because they are signature-verified instead.
/// </summary>
public sealed class CsrfHeaderMiddleware(RequestDelegate next, IProblemDetailsService problems)
{
    public const string Header = "X-ShopMint-Csrf";

    public async Task InvokeAsync(HttpContext ctx)
    {
        var m = ctx.Request.Method;
        var unsafeMethod = !(HttpMethods.IsGet(m) || HttpMethods.IsHead(m) || HttpMethods.IsOptions(m));
        if (unsafeMethod && ctx.Request.Path.StartsWithSegments("/api")
            && !ctx.Request.Path.StartsWithSegments("/api/webhooks")
            && ctx.Request.Headers[Header] != "1")
        {
            ctx.Response.StatusCode = 403;
            await problems.WriteAsync(new ProblemDetailsContext
            {
                HttpContext = ctx,
                ProblemDetails = new ProblemDetails { Status = 403, Type = ProblemTypes.Csrf,
                    Title = "Missing CSRF header.", Detail = $"Send the '{Header}: 1' header with this request." }
            });
            return;
        }
        await next(ctx);
    }
}

/// <summary>Serialises money and other decimals as invariant strings ("1299.00"). Accepts numbers or strings.</summary>
public sealed class DecimalStringConverter : JsonConverter<decimal>
{
    public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType switch
        {
            JsonTokenType.Number => reader.GetDecimal(),
            JsonTokenType.String when decimal.TryParse(reader.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) => d,
            _ => throw new JsonException("Expected a decimal number or numeric string."),
        };

    public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToString("0.00", CultureInfo.InvariantCulture));
}

public sealed record Paged<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public static class Paging
{
    public const int MaxPageSize = 100;
    public static (int Page, int Size) Normalize(int? page, int? size) =>
        (Math.Max(1, page ?? 1), Math.Clamp(size ?? 25, 1, MaxPageSize));
}

/// <summary>Runs the FluentValidation validator for <typeparamref name="T"/> before the handler.</summary>
public sealed class ValidationFilter<T> : IEndpointFilter where T : class
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var validator = ctx.HttpContext.RequestServices.GetService<IValidator<T>>();
        var arg = ctx.Arguments.OfType<T>().FirstOrDefault();
        if (validator is null) return await next(ctx);
        if (arg is null)
            return Results.Problem(statusCode: 400, type: ProblemTypes.Validation, title: "A request body is required.");
        var result = await validator.ValidateAsync(arg, ctx.HttpContext.RequestAborted);
        if (result.IsValid) return await next(ctx);
        var errors = result.Errors
            .GroupBy(e => JsonNamingPolicy.CamelCase.ConvertName(e.PropertyName.Split('.')[0]) + Rest(e.PropertyName))
            .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).Distinct().ToArray());
        return Results.ValidationProblem(errors, type: ProblemTypes.Validation, title: "One or more validation errors occurred.");
    }

    private static string Rest(string path)
    {
        var i = path.IndexOf('.');
        if (i < 0) return "";
        return "." + string.Join('.', path[(i + 1)..].Split('.').Select(JsonNamingPolicy.CamelCase.ConvertName));
    }
}

public static class EndpointExtensions
{
    public static RouteHandlerBuilder Validate<T>(this RouteHandlerBuilder b) where T : class =>
        b.AddEndpointFilter<ValidationFilter<T>>();
}

public static partial class Slug
{
    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonAlnum();

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    public static partial Regex Pattern();

    public static string From(string text)
    {
        var normalized = text.Normalize(NormalizationForm.FormKD);
        var ascii = new string(normalized.Where(c => c < 128).ToArray()).ToLowerInvariant();
        var slug = NonAlnum().Replace(ascii, "-").Trim('-');
        if (slug.Length > 80) slug = slug[..80].TrimEnd('-');
        return slug.Length == 0 ? "item" : slug;
    }
}
