using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;

namespace ShopMint.Api.Modules.Storefront;

/// <summary>Tells the web tier that a store's cached storefront pages are out of date.</summary>
public interface IStorefrontRevalidator
{
    void Enqueue(Guid tenantId);
}

/// <summary>
/// Collects tenants whose storefront changed and, in the background, asks the web app to drop the cached pages for
/// each of the store's hosts (POST Web:RevalidateUrl with the shared secret). Best effort: if the web app can't be
/// reached, cached pages still expire on their own within minutes.
/// </summary>
public sealed class StorefrontRevalidator : BackgroundService, IStorefrontRevalidator
{
    private readonly Channel<Guid> _queue = Channel.CreateBounded<Guid>(new BoundedChannelOptions(10_000) { FullMode = BoundedChannelFullMode.DropOldest });
    private readonly IServiceScopeFactory _scopes;
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;
    private readonly ILogger<StorefrontRevalidator> _log;

    public StorefrontRevalidator(IServiceScopeFactory scopes, IHttpClientFactory http, IConfiguration config, ILogger<StorefrontRevalidator> log)
    {
        _scopes = scopes;
        _http = http;
        _config = config;
        _log = log;
    }

    public void Enqueue(Guid tenantId) => _queue.Writer.TryWrite(tenantId);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var url = _config["Web:RevalidateUrl"];
        var secret = _config["Web:RevalidateSecret"];
        var enabled = !string.IsNullOrWhiteSpace(url) && !string.IsNullOrWhiteSpace(secret);
        if (!enabled) _log.LogInformation("Storefront revalidation is off (Web:RevalidateUrl or Web:RevalidateSecret not set); pages refresh on their cache schedule.");

        while (await _queue.Reader.WaitToReadAsync(stoppingToken))
        {
            // Coalesce bursts (a product save touches several rows) into one call.
            await Task.Delay(300, stoppingToken);
            var tenants = new HashSet<Guid>();
            while (_queue.Reader.TryRead(out var t)) tenants.Add(t);
            if (!enabled || tenants.Count == 0) continue;
            try
            {
                await using var scope = _scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
                var hosts = await db.TenantDomains.AsNoTracking().Where(d => tenants.Contains(d.TenantId)).Select(d => d.Host).ToListAsync(stoppingToken);
                var tags = hosts.SelectMany(h => new[] { $"store:{h}", $"store:{h}:catalog" }).ToArray();
                if (tags.Length == 0) continue;
                using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(new { tags }) };
                req.Headers.Add("X-Revalidate-Secret", secret);
                using var res = await _http.CreateClient("revalidate").SendAsync(req, stoppingToken);
                if (!res.IsSuccessStatusCode) _log.LogWarning("Storefront revalidation returned {Status}", (int)res.StatusCode);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogWarning(ex, "Storefront revalidation failed; pages will refresh on their cache schedule");
            }
        }
    }
}

/// <summary>
/// Admin route filter: after a successful write (any non-GET that didn't fail), the store's storefront cache is
/// refreshed. Handlers commit before returning, so this runs after the change is visible.
/// </summary>
public sealed class StorefrontRevalidationFilter(TenantContext tenant, IStorefrontRevalidator revalidator) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var result = await next(ctx);
        if (!HttpMethods.IsGet(ctx.HttpContext.Request.Method) && tenant.TenantId is { } tid
            && result is not IStatusCodeHttpResult { StatusCode: >= 400 })
            revalidator.Enqueue(tid);
        return result;
    }
}
