using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ShopMint.Api.Common;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Infrastructure.Tenancy;
using ShopMint.Api.Modules.Audit;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Modules.Catalog;

// ---------- Storage port and adapters ----------

public sealed record PresignedUpload(string Url, IReadOnlyDictionary<string, string> Headers, DateTimeOffset ExpiresAt);
public sealed record StoredObject(long Size, string? ContentType);

/// <summary>Object storage used for product media. S3 in production (MinIO locally); an in-memory fake in tests.</summary>
public interface IObjectStorage
{
    bool Configured { get; }
    Task<PresignedUpload> PresignPutAsync(string key, string contentType, TimeSpan ttl, CancellationToken ct);
    Task<StoredObject?> HeadAsync(string key, CancellationToken ct);
    /// <summary>Reads up to <paramref name="count"/> bytes from the start of the object (for type sniffing).</summary>
    Task<byte[]> ReadPrefixAsync(string key, int count, CancellationToken ct);
    Task DeleteAsync(string key, CancellationToken ct);
    string PublicUrl(string key);
}

public sealed class MediaOptions
{
    /// <summary>S3 endpoint for MinIO or other S3-compatible stores. Empty for AWS S3.</summary>
    public string? ServiceUrl { get; set; }
    /// <summary>
    /// Endpoint browsers use for uploads, when it differs from <see cref="ServiceUrl"/> (docker-compose: the API reaches
    /// http://minio:9000, browsers reach http://localhost:9000). Presigned URLs are signed for this host.
    /// </summary>
    public string? PublicServiceUrl { get; set; }
    public string Region { get; set; } = "ap-south-1";
    /// <summary>Empty disables uploads (the API answers 503 with a clear message).</summary>
    public string? Bucket { get; set; }
    /// <summary>Optional static keys (local MinIO). In AWS leave empty and use the task role.</summary>
    public string? AccessKey { get; set; }
    /// <summary>Secret: environment variable Media__SecretKey only.</summary>
    public string? SecretKey { get; set; }
    public bool ForcePathStyle { get; set; } = true;
    /// <summary>Public base URL that serves objects by key (CDN or bucket URL), e.g. https://media.shopmint.in.</summary>
    public string? PublicBaseUrl { get; set; }
}

public sealed class S3ObjectStorage : IObjectStorage, IDisposable
{
    private readonly MediaOptions _o;
    private readonly AmazonS3Client? _client;
    private readonly AmazonS3Client? _signer;

    public S3ObjectStorage(IOptions<MediaOptions> options)
    {
        _o = options.Value;
        if (string.IsNullOrWhiteSpace(_o.Bucket)) return;
        _client = Create(_o.ServiceUrl);
        // Signing makes no network call; a second client only changes which host the URL is signed for.
        _signer = string.IsNullOrWhiteSpace(_o.PublicServiceUrl) ? _client : Create(_o.PublicServiceUrl);
    }

    private AmazonS3Client Create(string? serviceUrl)
    {
        var config = new AmazonS3Config { ForcePathStyle = _o.ForcePathStyle, RegionEndpoint = RegionEndpoint.GetBySystemName(_o.Region) };
        if (!string.IsNullOrWhiteSpace(serviceUrl))
        {
            config.ServiceURL = serviceUrl;
            config.AuthenticationRegion = _o.Region;
        }
        return string.IsNullOrEmpty(_o.AccessKey)
            ? new AmazonS3Client(config)
            : new AmazonS3Client(new BasicAWSCredentials(_o.AccessKey, _o.SecretKey), config);
    }

    public bool Configured => _client is not null;
    private AmazonS3Client Client => _client ?? throw MediaRules.NotConfigured();

    public async Task<PresignedUpload> PresignPutAsync(string key, string contentType, TimeSpan ttl, CancellationToken ct)
    {
        var expires = DateTimeOffset.UtcNow.Add(ttl);
        var req = new GetPreSignedUrlRequest
        {
            BucketName = _o.Bucket, Key = key, Verb = HttpVerb.PUT, Expires = expires.UtcDateTime, ContentType = contentType,
            Protocol = (_o.PublicServiceUrl ?? _o.ServiceUrl)?.StartsWith("http://", StringComparison.OrdinalIgnoreCase) == true ? Protocol.HTTP : Protocol.HTTPS,
        };
        var url = await (_signer ?? throw MediaRules.NotConfigured()).GetPreSignedURLAsync(req);
        return new PresignedUpload(url, new Dictionary<string, string> { ["Content-Type"] = contentType }, expires);
    }

    public async Task<StoredObject?> HeadAsync(string key, CancellationToken ct)
    {
        try
        {
            var m = await Client.GetObjectMetadataAsync(_o.Bucket, key, ct);
            return new StoredObject(m.ContentLength, m.Headers.ContentType);
        }
        catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<byte[]> ReadPrefixAsync(string key, int count, CancellationToken ct)
    {
        using var res = await Client.GetObjectAsync(new GetObjectRequest { BucketName = _o.Bucket, Key = key, ByteRange = new ByteRange(0, count - 1) }, ct);
        var buffer = new byte[count];
        var read = 0;
        while (read < count)
        {
            var n = await res.ResponseStream.ReadAsync(buffer.AsMemory(read, count - read), ct);
            if (n == 0) break;
            read += n;
        }
        return buffer[..read];
    }

    public Task DeleteAsync(string key, CancellationToken ct) => Client.DeleteObjectAsync(_o.Bucket, key, ct);

    public string PublicUrl(string key) =>
        (_o.PublicBaseUrl ?? throw new InvalidOperationException("Media:PublicBaseUrl is not configured.")).TrimEnd('/') + "/" + key;

    public void Dispose()
    {
        if (!ReferenceEquals(_signer, _client)) _signer?.Dispose();
        _client?.Dispose();
    }
}

// ---------- Rules ----------

public static class MediaRules
{
    public const long MaxBytes = 5 * 1024 * 1024;
    public const int MaxPerProduct = 10;
    public static readonly TimeSpan UploadWindow = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan PendingLifetime = TimeSpan.FromHours(1);

    /// <summary>Raster formats browsers display. SVG is excluded on purpose: it can carry script.</summary>
    public static readonly IReadOnlyDictionary<string, string> Extensions = new Dictionary<string, string>
    {
        ["image/jpeg"] = ".jpg", ["image/png"] = ".png", ["image/webp"] = ".webp",
    };

    /// <summary>Detects the real format from the file's first bytes, whatever the client claimed.</summary>
    public static string? Sniff(ReadOnlySpan<byte> b)
    {
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b.Length >= 8 && b[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return "image/png";
        if (b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }

    public static string Key(Guid tenantId, Guid productId, Guid mediaId, string contentType) =>
        $"t/{tenantId:N}/p/{productId:N}/{mediaId:N}{Extensions[contentType]}";

    public static AppException NotConfigured() => new(503, ProblemTypes.MediaUnavailable, "Image uploads aren't available right now.",
        "Media storage isn't configured for this environment.");
}

// ---------- Contracts ----------

public sealed record MediaDto(Guid Id, string Url, string? AltText, int Position, string ContentType, long SizeBytes);
public sealed record UploadRequest(string ContentType, long SizeBytes, string? FileName);
public sealed record UploadTicket(Guid MediaId, string UploadUrl, string Method, IReadOnlyDictionary<string, string> Headers, DateTimeOffset ExpiresAt);
public sealed record AltTextRequest(string? AltText);
public sealed record MediaOrderRequest(List<Guid> MediaIds);

public sealed class UploadRequestValidator : AbstractValidator<UploadRequest>
{
    public UploadRequestValidator()
    {
        RuleFor(x => x.ContentType).Must(t => t is not null && MediaRules.Extensions.ContainsKey(t))
            .WithMessage("Upload a JPEG, PNG or WebP image.");
        RuleFor(x => x.SizeBytes).InclusiveBetween(1, MediaRules.MaxBytes).WithMessage("Images must be 5 MB or smaller.");
        RuleFor(x => x.FileName).MaximumLength(255);
    }
}

public sealed class AltTextValidator : AbstractValidator<AltTextRequest>
{
    public AltTextValidator() => RuleFor(x => x.AltText).MaximumLength(250);
}

public sealed class MediaOrderValidator : AbstractValidator<MediaOrderRequest>
{
    public MediaOrderValidator() => RuleFor(x => x.MediaIds).NotNull().Must(ids => ids is null || ids.Distinct().Count() == ids.Count)
        .WithMessage("Each image may appear once.");
}

// ---------- Endpoints ----------

/// <summary>
/// Upload flow: (1) POST uploads → a presigned PUT URL valid for 10 minutes; (2) the browser PUTs the file
/// straight to storage; (3) POST complete → the API inspects the stored object and only then shows it.
/// The client's claims (type, size) are never trusted: the stored object is measured and sniffed.
/// </summary>
public static class MediaEndpoints
{
    public static void Map(RouteGroupBuilder admin)
    {
        var g = admin.MapGroup("/products/{productId:guid}/media").WithTags("Catalog").RequirePermission(Permissions.CatalogWrite);
        g.MapPost("/uploads", StartUpload).Validate<UploadRequest>();
        g.MapPost("/{mediaId:guid}/complete", Complete);
        g.MapPatch("/{mediaId:guid}", UpdateAlt).Validate<AltTextRequest>();
        g.MapPut("/order", Reorder).Validate<MediaOrderRequest>();
        g.MapDelete("/{mediaId:guid}", Delete);
    }

    private static async Task<IResult> StartUpload(Guid productId, UploadRequest req, AppDbContext db, TenantContext tenant,
        IObjectStorage storage, CancellationToken ct)
    {
        if (!storage.Configured) throw MediaRules.NotConfigured();
        if (!await db.Products.AnyAsync(p => p.Id == productId, ct)) throw AppException.NotFound("Product");
        // Pending uploads count too, so parallel uploads can't exceed the limit.
        var since = DateTimeOffset.UtcNow - MediaRules.PendingLifetime;
        var count = await db.ProductMedia.CountAsync(m => m.ProductId == productId && (m.Status == MediaStatus.Ready || m.CreatedAt > since), ct);
        if (count >= MediaRules.MaxPerProduct)
            throw AppException.Unprocessable(ProblemTypes.EntitlementExceeded, $"A product can have up to {MediaRules.MaxPerProduct} images. Delete one to add another.");

        var tid = tenant.RequireTenant();
        var media = new ProductMedia
        {
            Id = Guid.CreateVersion7(), ProductId = productId, ContentType = req.ContentType, SizeBytes = req.SizeBytes,
            Status = MediaStatus.Pending, UploadedByUserId = tenant.UserId, CreatedAt = DateTimeOffset.UtcNow,
        };
        media.StorageKey = MediaRules.Key(tid, productId, media.Id, req.ContentType);
        db.ProductMedia.Add(media);
        await db.SaveChangesAsync(ct);

        var ticket = await storage.PresignPutAsync(media.StorageKey, req.ContentType, MediaRules.UploadWindow, ct);
        return Results.Created($"/api/admin/products/{productId}/media/{media.Id}",
            new UploadTicket(media.Id, ticket.Url, "PUT", ticket.Headers, ticket.ExpiresAt));
    }

    private static async Task<IResult> Complete(Guid productId, Guid mediaId, AppDbContext db, IObjectStorage storage,
        AuditWriter audit, ILoggerFactory lf, CancellationToken ct)
    {
        var media = await db.ProductMedia.FirstOrDefaultAsync(m => m.Id == mediaId && m.ProductId == productId, ct)
            ?? throw AppException.NotFound("Image");
        if (media.Status == MediaStatus.Ready) return Results.Ok(ToDto(media, storage));

        var stored = await storage.HeadAsync(media.StorageKey, ct)
            ?? throw new AppException(409, ProblemTypes.Conflict, "The upload hasn't finished.", "Upload the file, then try again.");
        string? problem = null;
        if (stored.Size > MediaRules.MaxBytes) problem = "Images must be 5 MB or smaller.";
        else if (stored.Size == 0) problem = "The uploaded file is empty.";
        else
        {
            var sniffed = MediaRules.Sniff(await storage.ReadPrefixAsync(media.StorageKey, 16, ct));
            if (sniffed is null) problem = "That file isn't a JPEG, PNG or WebP image.";
            else if (sniffed != media.ContentType) problem = "The file's contents don't match its type. Re-save it as JPEG, PNG or WebP and try again.";
        }
        if (problem is not null)
        {
            lf.CreateLogger("ShopMint.Media").LogWarning("Rejected upload {MediaId}: {Reason}", media.Id, problem);
            await storage.DeleteAsync(media.StorageKey, ct);
            db.ProductMedia.Remove(media);
            await db.SaveChangesAsync(ct);
            throw AppException.Unprocessable(ProblemTypes.InvalidMedia, problem);
        }

        media.SizeBytes = stored.Size;
        media.Status = MediaStatus.Ready;
        media.Position = (await db.ProductMedia.Where(m => m.ProductId == productId && m.Status == MediaStatus.Ready)
            .MaxAsync(m => (int?)m.Position, ct) ?? -1) + 1;
        audit.Record(db, "product.image_added", "product", productId, new { mediaId = media.Id });
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(media, storage));
    }

    private static async Task<IResult> UpdateAlt(Guid productId, Guid mediaId, AltTextRequest req, AppDbContext db, IObjectStorage storage, CancellationToken ct)
    {
        var media = await db.ProductMedia.FirstOrDefaultAsync(m => m.Id == mediaId && m.ProductId == productId && m.Status == MediaStatus.Ready, ct)
            ?? throw AppException.NotFound("Image");
        media.AltText = string.IsNullOrWhiteSpace(req.AltText) ? null : req.AltText.Trim();
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(media, storage));
    }

    private static async Task<IResult> Reorder(Guid productId, MediaOrderRequest req, AppDbContext db, IObjectStorage storage, CancellationToken ct)
    {
        var media = await db.ProductMedia.Where(m => m.ProductId == productId && m.Status == MediaStatus.Ready).ToListAsync(ct);
        if (!media.Select(m => m.Id).ToHashSet().SetEquals(req.MediaIds))
            throw AppException.Invalid("mediaIds", "List every image of this product exactly once.");
        for (var i = 0; i < req.MediaIds.Count; i++) media.Single(m => m.Id == req.MediaIds[i]).Position = i;
        await db.SaveChangesAsync(ct);
        return Results.Ok(media.OrderBy(m => m.Position).Select(m => ToDto(m, storage)).ToList());
    }

    private static async Task<IResult> Delete(Guid productId, Guid mediaId, AppDbContext db, IObjectStorage storage, AuditWriter audit,
        ILoggerFactory lf, CancellationToken ct)
    {
        var media = await db.ProductMedia.FirstOrDefaultAsync(m => m.Id == mediaId && m.ProductId == productId, ct)
            ?? throw AppException.NotFound("Image");
        db.ProductMedia.Remove(media);
        audit.Record(db, "product.image_removed", "product", productId, new { mediaId });
        await db.SaveChangesAsync(ct);
        await DeleteObjectsAsync(storage, [media.StorageKey], lf.CreateLogger("ShopMint.Media"), ct);
        return Results.NoContent();
    }

    public static MediaDto ToDto(ProductMedia m, IObjectStorage storage) =>
        new(m.Id, storage.PublicUrl(m.StorageKey), m.AltText, m.Position, m.ContentType, m.SizeBytes);

    /// <summary>Best effort after the database change commits; leftovers are harmless and logged.</summary>
    public static async Task DeleteObjectsAsync(IObjectStorage storage, IEnumerable<string> keys, ILogger log, CancellationToken ct)
    {
        if (!storage.Configured) return;
        foreach (var key in keys)
        {
            try { await storage.DeleteAsync(key, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogWarning(ex, "Could not delete stored object {Key}", key); }
        }
    }
}

/// <summary>Removes uploads that were started but never completed (and their objects, if any were written).</summary>
public sealed class MediaJanitor(IServiceScopeFactory scopes, ILogger<MediaJanitor> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(10));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await SweepAsync(scope.ServiceProvider.GetRequiredService<PlatformDbContext>(),
                    scope.ServiceProvider.GetRequiredService<IObjectStorage>(), log, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Media janitor run failed");
            }
        }
    }

    public static async Task<int> SweepAsync(PlatformDbContext db, IObjectStorage storage, ILogger log, CancellationToken ct)
    {
        var cutoff = DateTimeOffset.UtcNow - MediaRules.PendingLifetime;
        var stale = await db.ProductMedia.Where(m => m.Status == MediaStatus.Pending && m.CreatedAt < cutoff).Take(200).ToListAsync(ct);
        if (stale.Count == 0) return 0;
        db.ProductMedia.RemoveRange(stale);
        await db.SaveChangesAsync(ct);
        await MediaEndpoints.DeleteObjectsAsync(storage, stale.Select(m => m.StorageKey), log, ct);
        log.LogInformation("Removed {Count} abandoned uploads", stale.Count);
        return stale.Count;
    }
}
