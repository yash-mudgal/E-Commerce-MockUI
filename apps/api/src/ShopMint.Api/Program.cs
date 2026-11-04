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
var config = builder.Configuration;
var env = builder.Environment;

string Cs(string name) => config.GetConnectionString(name)
    ?? throw new InvalidOperationException($"Connection string '{name}' is not configured. See apps/api/README.md.");

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
if (env.IsProduction() && string.IsNullOrWhiteSpace(config["App:PublicUrl"]))
    throw new InvalidOperationException("App:PublicUrl must be set in production (used for links in emails).");

var app = builder.Build();

// ---------- CLI commands (local development and deploy jobs) ----------
if (args.Length > 0 && args[0] == "setup-db")
{
    // Local only: creates roles + database using a superuser connection (ConnectionStrings:Admin).
    static Npgsql.NpgsqlConnectionStringBuilder B(string cs) => new(cs);
    var owner = B(Cs("Migrations"));
    await DatabaseBootstrapper.EnsureAsync(Cs("Admin"), owner.Database!,
        new(owner.Password!, B(Cs("App")).Password!, B(Cs("Platform")).Password!));
    Console.WriteLine($"Database '{owner.Database}' and roles are ready.");
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
var storefront = StorefrontEndpoints.Map(api);
CustomerEndpoints.Map(storefront, admin);
CheckoutEndpoints.Map(storefront);
UnsubscribeEndpoint.Map(storefront);
RazorpayWebhookEndpoint.Map(api);
BillingWebhookEndpoint.Map(api);
PlatformEndpoints.Map(api);

app.Run();

public partial class Program;
