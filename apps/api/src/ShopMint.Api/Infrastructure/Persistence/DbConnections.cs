using Npgsql;

namespace ShopMint.Api.Infrastructure.Persistence;

/// <summary>
/// Connection strings for the API's roles. An explicit <c>ConnectionStrings:{name}</c> wins (local development, tests,
/// docker-compose). Otherwise the string is built from parts, which is how ECS injects them: <c>Database:Host</c>,
/// <c>Port</c>, <c>Name</c> and <c>SslMode</c> as plain settings, and each role's password from the secrets manager as
/// <c>Database:Passwords:{App|Platform|Migrations|Admin}</c>. Usernames are fixed role names, except the managed
/// database's master user (<c>Database:AdminUsername</c>), used only by <c>deploy-db</c>.
/// </summary>
public static class DbConnections
{
    public static string? Build(IConfiguration config, string name)
    {
        var explicitCs = config.GetConnectionString(name);
        if (!string.IsNullOrWhiteSpace(explicitCs)) return explicitCs;

        var host = config["Database:Host"];
        if (string.IsNullOrWhiteSpace(host)) return null;
        var user = name switch
        {
            "App" => Roles.App,
            "Platform" => Roles.Platform,
            "Migrations" => Roles.Owner,
            "Admin" => config["Database:AdminUsername"],
            _ => null,
        };
        var password = config[$"Database:Passwords:{name}"];
        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(password)) return null;

        var b = new NpgsqlConnectionStringBuilder
        {
            Host = host,
            Port = config.GetValue("Database:Port", 5432),
            // The master user connects to the maintenance database to create ShopMint's database and roles.
            Database = name == "Admin" ? "postgres" : config["Database:Name"] ?? "shopmint",
            Username = user,
            Password = password,
            // Verify the server certificate by default (the RDS CA bundle ships in the image, see Database:RootCertificate).
            SslMode = Enum.Parse<SslMode>(config["Database:SslMode"] ?? nameof(SslMode.VerifyFull), ignoreCase: true),
            // Per role and per task: keep (tasks × roles × pool) under the database's max_connections.
            MaxPoolSize = config.GetValue("Database:MaxPoolSize", 40),
        };
        var root = config["Database:RootCertificate"];
        if (!string.IsNullOrWhiteSpace(root)) b.RootCertificate = root;
        return b.ConnectionString;
    }
}
