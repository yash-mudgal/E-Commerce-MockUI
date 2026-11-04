using FluentValidation;
using ShopMint.Api.Common;

namespace ShopMint.Api.Modules.Catalog;

public sealed record CategoryRequest(string Name, string? Slug, Guid? ParentId, int Position = 0);
public sealed record CategoryDto(Guid Id, string Name, string Slug, Guid? ParentId, int Position, int ProductCount, string Version);

public sealed record VariantInput(Guid? Id, string Sku, string[]? OptionValues, decimal Price, decimal Mrp, decimal? Cost,
    int? StockOnHand, bool IsActive = true);

public sealed record ProductRequest(string Title, string? Slug, string? Description, Guid? CategoryId, string Status,
    string? HsnCode, decimal GstRate, string[]? OptionNames, string[]? Tags, List<VariantInput> Variants);

public sealed record VariantDto(Guid Id, string Sku, string[] OptionValues, decimal Price, decimal Mrp, decimal? Cost,
    int StockOnHand, int Reserved, bool IsActive);

public sealed record ProductDto(Guid Id, string Title, string Slug, string Description, Guid? CategoryId, string? CategoryName,
    string Status, string? HsnCode, decimal GstRate, string[] OptionNames, string[] Tags, IReadOnlyList<VariantDto> Variants,
    IReadOnlyList<MediaDto> Media, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, string Version);

public sealed record ProductListItem(Guid Id, string Title, string Slug, string Status, Guid? CategoryId, string? CategoryName,
    int VariantCount, string? PrimarySku, decimal? PriceMin, decimal? PriceMax, int TotalStock, DateTimeOffset UpdatedAt, string? ThumbnailUrl);

public static class GstRates
{
    /// <summary>Indian GST slabs that apply to goods (incl. 0.25% rough diamonds and 3% gold).</summary>
    public static readonly decimal[] Allowed = [0m, 0.25m, 3m, 5m, 12m, 18m, 28m];
}

public sealed class CategoryValidator : AbstractValidator<CategoryRequest>
{
    public CategoryValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(80);
        RuleFor(x => x.Slug).MaximumLength(100).Matches(Slug.Pattern()).When(x => !string.IsNullOrEmpty(x.Slug))
            .WithMessage("Use lowercase letters, numbers and hyphens.");
        RuleFor(x => x.Position).InclusiveBetween(0, 10_000);
    }
}

public sealed class ProductValidator : AbstractValidator<ProductRequest>
{
    public static readonly string[] Statuses = ["draft", "active", "archived"];

    public ProductValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Slug).MaximumLength(220).Matches(Slug.Pattern()).When(x => !string.IsNullOrEmpty(x.Slug))
            .WithMessage("Use lowercase letters, numbers and hyphens.");
        RuleFor(x => x.Description).MaximumLength(10_000);
        RuleFor(x => x.Status).NotEmpty().Must(s => Statuses.Contains(s?.ToLowerInvariant()))
            .WithMessage("Status must be draft, active or archived.");
        RuleFor(x => x.HsnCode).Matches("^[0-9]{4}([0-9]{2}){0,2}$").When(x => !string.IsNullOrEmpty(x.HsnCode))
            .WithMessage("HSN code must be 4, 6 or 8 digits.");
        RuleFor(x => x.GstRate).Must(r => GstRates.Allowed.Contains(r))
            .WithMessage("GST rate must be one of 0, 0.25, 3, 5, 12, 18 or 28.");
        RuleFor(x => x.OptionNames).Must(o => o is null || o.Length <= 3).WithMessage("A product can have at most 3 options.")
            .Must(o => o is null || o.All(n => !string.IsNullOrWhiteSpace(n) && n.Length <= 30)).WithMessage("Option names must be 1–30 characters.")
            .Must(o => o is null || o.Distinct(StringComparer.OrdinalIgnoreCase).Count() == o.Length).WithMessage("Option names must be unique.");
        RuleFor(x => x.Tags).Must(t => t is null || (t.Length <= 20 && t.All(s => s.Length <= 40)))
            .WithMessage("Up to 20 tags of at most 40 characters.");
        RuleFor(x => x.Variants).NotEmpty().WithMessage("Add at least one variant.")
            .Must(v => v is null || v.Count <= 100).WithMessage("A product can have at most 100 variants.")
            .Must(v => v is null || v.Select(x => x.Sku?.Trim().ToUpperInvariant()).Distinct().Count() == v.Count)
            .WithMessage("Each variant needs a unique SKU.")
            .Must(v => v is null || v.Select(x => string.Join('\u001f', (x.OptionValues ?? []).Select(s => s.Trim().ToLowerInvariant()))).Distinct().Count() == v.Count)
            .WithMessage("Each variant needs a unique combination of option values.");
        RuleForEach(x => x.Variants).ChildRules(v =>
        {
            v.RuleFor(x => x.Sku).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9._/-]+$")
                .WithMessage("SKU may contain letters, numbers and . _ / - only.");
            v.RuleFor(x => x.Price).GreaterThan(0).LessThanOrEqualTo(10_000_000).PrecisionScale(14, 2, true);
            v.RuleFor(x => x.Mrp).GreaterThanOrEqualTo(x => x.Price).WithMessage("MRP must be at least the selling price.")
                .LessThanOrEqualTo(10_000_000).PrecisionScale(14, 2, true);
            v.RuleFor(x => x.Cost).GreaterThanOrEqualTo(0).When(x => x.Cost.HasValue);
            v.RuleFor(x => x.StockOnHand).InclusiveBetween(0, 1_000_000).When(x => x.StockOnHand.HasValue);
        });
        RuleFor(x => x).Must(p => p.Variants is null || p.Variants.All(v => (v.OptionValues?.Length ?? 0) == (p.OptionNames?.Length ?? 0)
                && (v.OptionValues ?? []).All(s => !string.IsNullOrWhiteSpace(s) && s.Length <= 40)))
            .WithName("variants").WithMessage("Every variant needs one value (1–40 characters) for each option.");
    }
}
