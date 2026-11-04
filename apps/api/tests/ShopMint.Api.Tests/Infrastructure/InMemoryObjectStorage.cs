using System.Collections.Concurrent;
using ShopMint.Api.Modules.Catalog;

namespace ShopMint.Api.Tests.Infrastructure;

/// <summary>Stands in for S3 in integration tests. Tests "upload" by calling <see cref="Put"/> with the key from the ticket.</summary>
public sealed class InMemoryObjectStorage : IObjectStorage
{
    public const string Host = "https://storage.test";
    private readonly ConcurrentDictionary<string, (byte[] Bytes, string ContentType)> _objects = new();

    public bool Configured => true;

    public Task<PresignedUpload> PresignPutAsync(string key, string contentType, TimeSpan ttl, CancellationToken ct) =>
        Task.FromResult(new PresignedUpload($"{Host}/upload/{key}?sig=test", new Dictionary<string, string> { ["Content-Type"] = contentType },
            DateTimeOffset.UtcNow.Add(ttl)));

    public Task<StoredObject?> HeadAsync(string key, CancellationToken ct) =>
        Task.FromResult(_objects.TryGetValue(key, out var o) ? new StoredObject(o.Bytes.Length, o.ContentType) : null);

    public Task<byte[]> ReadPrefixAsync(string key, int count, CancellationToken ct) =>
        Task.FromResult(_objects[key].Bytes.Take(count).ToArray());

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        _objects.TryRemove(key, out _);
        return Task.CompletedTask;
    }

    public string PublicUrl(string key) => $"{Host}/media/{key}";

    public void Put(string key, byte[] bytes, string contentType) => _objects[key] = (bytes, contentType);
    public bool Exists(string key) => _objects.ContainsKey(key);

    /// <summary>Key from an upload URL issued by <see cref="PresignPutAsync"/>.</summary>
    public static string KeyFromUploadUrl(string url) => new Uri(url).AbsolutePath["/upload/".Length..];

    public static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52, 1, 2, 3];
    public static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1];
}
