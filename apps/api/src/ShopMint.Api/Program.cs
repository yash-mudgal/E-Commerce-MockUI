using Microsoft.AspNetCore.DataProtection;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using FluentValidation;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Catalog;
using ShopMint.Api.Modules.Customers;
using ShopMint.Api.Modules.Dashboard;
using ShopMint.Api.Modules.Identity;
using ShopMint.Api.Modules.Inventory;
using ShopMint.Api.Modules.Notifications;
using ShopMint.Api.Modules.Orders;
using ShopMint.Api.Modules.Billing;
using ShopMint.Api.Modules.Onboarding;
using ShopMint.Api.Modules.Platform;
using ShopMint.Api.Modules.Staff;
using ShopMint.Api.Modules.Store;
using ShopMint.Api.Modules.Storefront;
using ShopMint.Api.Seeding;

var builder = WebApplication.CreateBuilder(args);
// The API only takes small JSON bodies (files go straight to object storage), so cap request bodies at 1 MB.
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 1_048_576);
var config = builder.Configuration;
var env = builder.Environment;

string Cs(string name) => DbConnections.Build(config, name)
    ?? throw new InvalidOperationException($"Connection string '{name}' is not configured (ConnectionStrings:{name}, or Database:Host plus Database:Passwords:{name}). See apps/api/README.md.");

// ---------- Logging: structured JSON outside Development ----------
if (!env.IsDevelopment())
{
    builder.Logging.ClearProviders();
    builder.Logging.AddJsonConsole(o => { o.IncludeScopes = true; o.UseUtcTimestamp = true; });
}

// ---------- Persistence + tenancy ----------
builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<TenantConnectionInterceptor>();
builder.Services.AddDbContext<AppDbContext>((sp, o) => o
    .UseNpgsql(Cs("App"))
    .UseSnakeCaseNamingConvention()
    .AddInterceptors(sp.GetRequiredService<TenantConnectionInterceptor>()));
builder.Services.AddDbContext<PlatformDbContext>(o => o.UseNpgsql(Cs("Platform")).UseSnakeCaseNamingConvention());
// Session cookies and other protected payloads are encrypted with a key ring stored in PostgreSQL, so every API
// instance shares it and sign-ins survive redeploys (ADR-036). Only the platform role can read the table.
builder.Services.AddDataProtection().SetApplicationName("ShopMint").PersistKeysToDbContext<PlatformDbContext>();

// ---------- HTTP plumbing ----------
builder.Services.AddHttpContextAccessor();
builder.Services.AddMemoryCache();
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    ctx.ProblemDetails.Extensions["traceId"] = ctx.HttpContext.TraceIdentifier;
    ctx.ProblemDetails.Instance ??= ctx.HttpContext.Request.Path;
});
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new DecimalStringConverter());
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    if (config.GetValue("Proxy:TrustAll", false))
    {
        // Development/compose only: the API is reachable solely through the web tier.
        o.KnownIPNetworks.Clear();
        o.KnownProxies.Clear();
    }
    foreach (var cidr in config.GetSection("Proxy:KnownNetworks").Get<string[]>() ?? [])
        o.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(cidr));
    // Behind CloudFront the edge function overwrites this header with the viewer's IP (browsers can't set it), so rate
    // limits see the shopper rather than a CloudFront edge address. Only honoured from Proxy:KnownNetworks.
    if (config["Proxy:ClientIpHeader"] is { Length: > 0 } clientIpHeader) o.ForwardedForHeaderName = clientIpHeader;
});
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.Headers.RetryAfter = "60";
        await ctx.HttpContext.RequestServices.GetRequiredService<IProblemDetailsService>().WriteAsync(new ProblemDetailsContext
        {
            HttpContext = ctx.HttpContext,
            ProblemDetails = new ProblemDetails { Status = 429, Type = ProblemTypes.RateLimited, Title = "Too many requests. Try again in a minute." },
        });
    };
    var authLimit = config.GetValue("RateLimiting:AuthPerMinute", 10);
    o.AddPolicy("auth", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = authLimit, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    // Feedback: per signed-in user, so one store's team can't flood the inbox.
    o.AddPolicy("feedback", http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst(ShopMint.Api.Modules.Identity.SessionClaims.UserId)?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = ShopMint.Api.Modules.Feedback.FeedbackEndpoints.PerUserPerHour, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
    // Reviews: per client address; a shopper writes or edits a handful at most.
    o.AddPolicy("reviews", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = config.GetValue("RateLimiting:ReviewsPerHour", 20), Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
    var checkoutLimit = config.GetValue("RateLimiting:CheckoutPerMinute", 20);
    o.AddPolicy("checkout", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = checkoutLimit, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database", tags: ["ready"]);

// ---------- Modules ----------
builder.Services.AddMerchantSessions(config, env);
builder.Services.AddCustomerSessions(config, env);
builder.Services.AddScoped<CartService>();
builder.Services.AddSingleton<SecretBox>();
builder.Services.AddHttpClient(RazorpayGateway.ClientName, c =>
{
    c.BaseAddress = new Uri(config["Payments:Razorpay:BaseUrl"] ?? "https://api.razorpay.com/v1/");
    c.Timeout = TimeSpan.FromSeconds(15);
});
builder.Services.AddSingleton<RazorpayGateway>();
builder.Services.AddSingleton<TestGateway>();
builder.Services.AddScoped<PaymentResolver>();
builder.Services.AddScoped<OrderService>();
builder.Services.AddScoped<ReturnService>();
builder.Services.AddHostedService<OrderExpiryJob>();
builder.Services.AddScoped<PlanCatalog>();
builder.Services.AddSingleton<RazorpayBillingGateway>();
builder.Services.AddSingleton<TestBillingGateway>();
builder.Services.AddSingleton<BillingGatewayResolver>();
builder.Services.AddScoped<BillingService>();
builder.Services.AddHostedService<BillingJob>();
builder.Services.AddScoped<ShopMint.Api.Modules.Reports.ReportService>();
builder.Services.AddHostedService<NotificationJob>();
if (env.IsProduction() && config.GetValue("Payments:AllowTestMode", false))
    throw new InvalidOperationException("Payments:AllowTestMode must be false in production.");
builder.Services.AddHostedService<CartJanitor>();
builder.Services.AddHttpClient("revalidate", c => c.Timeout = TimeSpan.FromSeconds(5));
builder.Services.AddSingleton<StorefrontRevalidator>();
builder.Services.AddSingleton<IStorefrontRevalidator>(sp => sp.GetRequiredService<StorefrontRevalidator>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<StorefrontRevalidator>());
builder.Services.AddValidatorsFromAssemblyContaining<Program>(includeInternalTypes: true);
builder.Services.AddScoped<AuditWriter>();
builder.Services.AddScoped<ProductService>();
builder.Services.Configure<EmailOptions>(config.GetSection("Email"));
builder.Services.AddScoped<EmailOutbox>();
builder.Services.AddTransient<IEmailSender, SmtpEmailSender>();
builder.Services.AddHostedService<EmailDispatcher>();
builder.Services.Configure<MediaOptions>(config.GetSection("Media"));
builder.Services.AddSingleton<IObjectStorage, S3ObjectStorage>();
builder.Services.AddHostedService<MediaJanitor>();
if (!string.IsNullOrWhiteSpace(config["Media:Bucket"]) && string.IsNullOrWhiteSpace(config["Media:PublicBaseUrl"]))
    throw new InvalidOperationException("Media:PublicBaseUrl must be set when Media:Bucket is configured.");
// Server-only settings are checked when serving (args empty); one-off commands such as deploy-db and verify-db don't need them.
if (env.IsProduction() && args.Length == 0 && string.IsNullOrWhiteSpace(config["App:PublicUrl"]))
    throw new InvalidOperationException("App:PublicUrl must be set in production (used for links in emails).");
if (env.IsProduction() && config.GetValue("Proxy:TrustAll", false))
    throw new InvalidOperationException("Proxy:TrustAll must be false in production; list the load balancer and web subnets in Proxy:KnownNetworks.");
// Merchants' Razorpay secrets and everyone's two-step secrets are encrypted with this key; platform admins can't work without it.
if (env.IsProduction() && args.Length == 0 && string.IsNullOrWhiteSpace(config["Payments:SecretsKey"]))
    throw new InvalidOperationException("Payments:SecretsKey must be set in production (32 random bytes, base64, from the secrets manager).");

var app = builder.Build();

// ---------- CLI commands (local development and deploy jobs) ----------
if (args.Length > 0 && args[0] is "setup-db" or "deploy-db")
{
    // Creates the three roles (with the passwords from their connection settings) and the database, using an
    // administrative connection: a local superuser (setup-db) or the managed database's master user (deploy-db, run by
    // the release pipeline as a one-off task before new code starts). deploy-db then applies migrations. Idempotent.
    static Npgsql.NpgsqlConnectionStringBuilder B(string cs) => new(cs);
    var owner = B(Cs("Migrations"));
    await DatabaseBootstrapper.EnsureAsync(Cs("Admin"), owner.Database!,
        new(owner.Password!, B(Cs("App")).Password!, B(Cs("Platform")).Password!));
    Console.WriteLine($"Database '{owner.Database}' and roles are ready.");
    if (args[0] == "deploy-db")
    {
        await Migrator.MigrateAsync(Cs("Migrations"));
        Console.WriteLine("Migrations applied.");
    }
    return;
}
if (args is ["verify-db"])
{
    var checks = await DbVerifier.RunAsync(Cs("Migrations"), Cs("App"), Cs("Platform"));
    DbVerifier.Print(checks, Console.Out);
    Environment.ExitCode = checks.All(c => c.Ok) ? 0 : 1;
    return;
}
if (args is ["platform-admin", "grant" or "revoke", var adminEmail])
{
    await using var scope = app.Services.CreateAsyncScope();
    var ok = await PlatformAdminOperator.SetAsync(scope.ServiceProvider.GetRequiredService<PlatformDbContext>(), adminEmail, args[1] == "grant", Console.Out);
    Environment.ExitCode = ok ? 0 : 2;
    return;
}
if (args is ["reset-mfa", var mfaEmail])
{
    await using var scope = app.Services.CreateAsyncScope();
    var ok = await MfaOperator.ResetAsync(scope.ServiceProvider.GetRequiredService<PlatformDbContext>(), mfaEmail, Console.Out);
    Environment.ExitCode = ok ? 0 : 2;
    return;
}
if (args.Length > 0 && args[0] is "migrate" or "seed")
{
    await Migrator.MigrateAsync(Cs("Migrations"));
    Console.WriteLine("Migrations applied.");
    if (args[0] == "seed")
    {
        await using var scope = app.Services.CreateAsyncScope();
        await DemoSeeder.SeedAsync(scope.ServiceProvider.GetRequiredService<PlatformDbContext>(), config, Console.Out);
    }
    return;
}
if (config.GetValue("Database:MigrateOnStartup", false))
    await Migrator.MigrateAsync(Cs("Migrations"));

// ---------- Pipeline ----------
app.UseForwardedHeaders();
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h.XContentTypeOptions = "nosniff";
    h.XFrameOptions = "DENY";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    // JSON only: nothing here should ever be rendered or framed as a page.
    h.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";
    h["Cross-Origin-Resource-Policy"] = "same-origin";
    if (!env.IsDevelopment()) h.StrictTransportSecurity = "max-age=63072000; includeSubDomains";
    h.CacheControl = "no-store";
    await next();
});
app.UseMiddleware<CsrfHeaderMiddleware>();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

if (!env.IsProduction()) app.MapOpenApi();

app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains("ready") });

var api = app.MapGroup("/api");
AuthEndpoints.Map(api);
MfaEndpoints.Map(api);
AccountEndpoints.Map(api);
var admin = api.MapGroup("/admin").RequireAuthorization(Session.TenantMemberPolicy).AddEndpointFilter<AdminTenantFilter>()
    .AddEndpointFilter<StorefrontRevalidationFilter>();
StoreEndpoints.Map(admin);
CatalogEndpoints.Map(admin);
MediaEndpoints.Map(admin);
InventoryEndpoints.Map(admin);
AdminOrderEndpoints.Map(admin);
PaymentSettingsEndpoints.Map(admin);
BillingEndpoints.Map(admin);
ShopMint.Api.Modules.Reports.ReportEndpoints.Map(admin);
NotificationPrefs.Map(admin);
DashboardEndpoints.Map(admin);
StaffEndpoints.Map(admin, api);
OnboardingEndpoints.Map(admin);
AuditEndpoints.Map(admin);
ShopMint.Api.Modules.Feedback.FeedbackEndpoints.MapAdmin(admin);
var storefront = StorefrontEndpoints.Map(api);
CustomerEndpoints.Map(storefront, admin);
CheckoutEndpoints.Map(storefront);
ShopMint.Api.Modules.Reviews.ReviewEndpoints.Map(storefront, admin);
ShopContentEndpoints.Map(storefront, admin);
ShopMint.Api.Modules.Store.Delivery.Map(storefront, admin);
ReturnEndpoints.Map(storefront, admin);
GiftCards.Map(storefront, admin);
ShopMint.Api.Modules.Customers.Newsletter.Map(storefront, admin);
UnsubscribeEndpoint.Map(storefront);
RazorpayWebhookEndpoint.Map(api);
BillingWebhookEndpoint.Map(api);
PlatformEndpoints.Map(api);

app.Run();

public partial class Program;
