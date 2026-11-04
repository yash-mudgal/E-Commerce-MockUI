using System.Net;
using Microsoft.Extensions.Configuration;
using Npgsql;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules.Storefront;

namespace ShopMint.Api.Tests.Unit;

public class DbConnectionsTests
{
    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value)).Build();

    private static readonly (string, string)[] Parts =
    [
        ("Database:Host", "db.internal"), ("Database:Name", "shopmint"), ("Database:AdminUsername", "master"),
        ("Database:Passwords:App", "app-pw"), ("Database:Passwords:Platform", "platform-pw"),
        ("Database:Passwords:Migrations", "owner-pw"), ("Database:Passwords:Admin", "master-pw"),
        ("Database:RootCertificate", "/app/certs/rds-global-bundle.pem"),
    ];

    [Fact]
    public void An_explicit_connection_string_wins()
    {
        var cfg = Config([.. Parts, ("ConnectionStrings:App", "Host=localhost;Username=x")]);
        Assert.Equal("Host=localhost;Username=x", DbConnections.Build(cfg, "App"));
    }

    [Fact]
    public void Built_from_parts_with_fixed_role_names_and_verified_tls()
    {
        var cfg = Config(Parts);
        var app = new NpgsqlConnectionStringBuilder(DbConnections.Build(cfg, "App"));
        Assert.Equal(("db.internal", 5432, "shopmint", Roles.App, "app-pw"), (app.Host, app.Port, app.Database, app.Username, app.Password));
        Assert.Equal(SslMode.VerifyFull, app.SslMode);
        Assert.Equal("/app/certs/rds-global-bundle.pem", app.RootCertificate);
        Assert.Equal(40, app.MaxPoolSize);
        Assert.Equal(Roles.Platform, new NpgsqlConnectionStringBuilder(DbConnections.Build(cfg, "Platform")).Username);
        Assert.Equal(Roles.Owner, new NpgsqlConnectionStringBuilder(DbConnections.Build(cfg, "Migrations")).Username);
        var admin = new NpgsqlConnectionStringBuilder(DbConnections.Build(cfg, "Admin"));
        Assert.Equal(("master", "postgres"), (admin.Username, admin.Database));
    }

    [Fact]
    public void Missing_parts_mean_not_configured()
    {
        Assert.Null(DbConnections.Build(Config(), "App"));
        Assert.Null(DbConnections.Build(Config(("Database:Host", "db.internal")), "App"));
        Assert.Null(DbConnections.Build(Config([.. Parts.Where(p => p.Item1 != "Database:AdminUsername")]), "Admin"));
        Assert.Null(DbConnections.Build(Config(Parts), "Unknown"));
    }
}

public class RevalidationTargetsTests
{
    private static readonly Uri Url = new("http://web.shopmint.internal:3000/internal/revalidate");

    private static Func<string, CancellationToken, Task<IPAddress[]>> Resolver(params string[] ips) =>
        (_, _) => Task.FromResult(ips.Select(IPAddress.Parse).ToArray());

    [Fact]
    public async Task Every_web_task_gets_the_call_when_fanning_out()
    {
        var targets = await RevalidationTargets.ResolveAsync(Url, true, Resolver("10.0.1.5", "10.0.2.7", "10.0.1.5"), CancellationToken.None);
        Assert.Equal(["http://10.0.1.5:3000/internal/revalidate", "http://10.0.2.7:3000/internal/revalidate"], targets.Select(t => t.ToString()));
    }

    [Fact]
    public async Task Ipv6_addresses_are_bracketed()
    {
        var targets = await RevalidationTargets.ResolveAsync(Url, true, Resolver("fd00::5"), CancellationToken.None);
        Assert.Equal("http://[fd00::5]:3000/internal/revalidate", Assert.Single(targets).ToString());
    }

    [Fact]
    public async Task Without_fan_out_or_addresses_the_url_is_used_as_is()
    {
        Assert.Equal(Url, Assert.Single(await RevalidationTargets.ResolveAsync(Url, false, Resolver("10.0.1.5"), CancellationToken.None)));
        Assert.Equal(Url, Assert.Single(await RevalidationTargets.ResolveAsync(Url, true, Resolver(), CancellationToken.None)));
        var literal = new Uri("http://127.0.0.1:3000/internal/revalidate");
        Assert.Equal(literal, Assert.Single(await RevalidationTargets.ResolveAsync(literal, true, (_, _) => throw new InvalidOperationException("not resolved"), CancellationToken.None)));
    }
}
