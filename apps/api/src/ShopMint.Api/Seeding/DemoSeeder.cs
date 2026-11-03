using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ShopMint.Api.Infrastructure.Persistence;
using ShopMint.Api.Modules;
using ShopMint.Api.Modules.Identity;

namespace ShopMint.Api.Seeding;

/// <summary>
/// Local development fixtures, based on the three stores from the original mock. Every store is labelled
/// "Demo store" in its tagline. Idempotent: existing slugs are skipped. Never run against production.
/// </summary>
public static class DemoSeeder
{
    private sealed record P(string Cat, string Title, decimal Price, decimal Mrp, decimal Gst, string Hsn, string Sizes, string Colours, string Desc, int Stock);
    private sealed record T(string Slug, string Name, string Tagline, string Color, string State, string Gstin, string Legal, (string Slug, string Name)[] Cats, P[] Products);

    private static readonly T[] Tenants =
    [
        new("desithreads", "Desi Threads", "Handpicked Indian fashion and crafts", "#6d28d9", "27", "27AAGCD4821M1Z3", "Desi Threads Retail Pvt. Ltd.",
            [("ethnic-wear", "Ethnic Wear"), ("mens-fashion", "Men's Fashion"), ("footwear", "Footwear"), ("handicrafts", "Handicrafts")],
            [
                new("ethnic-wear", "Jaipuri Cotton Anarkali Kurta", 1299, 2499, 12, "6204", "S,M,L,XL", "Indigo,Mustard", "Hand block-printed Jaipuri cotton with a flared anarkali silhouette and three-quarter sleeves.", 14),
                new("ethnic-wear", "Lucknowi Chikankari Kurti", 899, 1599, 5, "6206", "S,M,L", "White", "Delicate hand chikankari on breathable georgette-cotton, straight fit.", 6),
                new("ethnic-wear", "Banarasi Silk Saree", 6499, 9999, 12, "5007", "", "Maroon,Royal Blue", "Pure Banarasi silk with zari buttis and a rich pallu.", 4),
                new("mens-fashion", "Linen Blend Formal Shirt", 1149, 1899, 12, "6205", "38,40,42", "Sky Blue,White", "Breathable linen-cotton shirt, regular fit.", 20),
                new("mens-fashion", "Cotton Nehru Jacket", 1799, 2999, 12, "6203", "M,L,XL", "", "Structured Nehru jacket in textured cotton.", 0),
                new("footwear", "Kolhapuri Leather Chappal", 899, 1499, 5, "6403", "7,8,9,10", "", "GI-tagged hand-stitched Kolhapuri in vegetable-tanned leather.", 9),
                new("handicrafts", "Jaipur Blue Pottery Vase", 1299, 1999, 12, "6913", "", "", "Quartz-based blue pottery with Persian floral motifs.", 3),
                new("handicrafts", "Channapatna Wooden Toy Set", 799, 1199, 12, "9503", "", "", "Lac-coloured, non-toxic wooden toys from Karnataka.", 25),
            ]),
        new("masalabox", "Masala Box", "Single-origin spices and teas", "#c2410c", "29", "29AAMCM5512Q1Z8", "Masala Box Foods LLP",
            [("spices", "Spices"), ("tea", "Tea & Coffee"), ("pantry", "Pantry")],
            [
                new("spices", "Kashmiri Mongra Saffron 1g", 349, 450, 5, "0910", "", "", "Grade A1 Pampore saffron, GI tagged.", 40),
                new("spices", "Stone-ground Garam Masala", 179, 220, 5, "0910", "100g,200g", "", "Small-batch blend of 14 whole spices, no fillers.", 60),
                new("spices", "Malabar Black Pepper 250g", 299, 380, 5, "0904", "", "", "Bold Tellicherry garbled pepper from Wayanad farms.", 8),
                new("tea", "Darjeeling First Flush Tea 250g", 649, 899, 5, "0902", "", "", "Spring-plucked muscatel from a Kurseong estate, whole leaf.", 18),
                new("pantry", "A2 Desi Cow Ghee 1L", 1099, 1350, 12, "0405", "", "", "Bilona-churned A2 Gir cow ghee, glass jar.", 12),
            ]),
        new("kaarigar", "Kaarigar Home", "Artisan homeware from across India", "#0f766e", "07", "07AAKCK7781L1Z2", "Kaarigar Home Pvt. Ltd.",
            [("decor", "Decor"), ("kitchen", "Kitchen"), ("textiles", "Textiles")],
            [
                new("decor", "Dhokra Brass Figurine", 1899, 2799, 12, "8306", "", "", "Lost-wax cast Dhokra tribal art from Bastar.", 5),
                new("kitchen", "Cast Iron Dosa Tawa 12in", 1099, 1650, 12, "7321", "", "", "Pre-seasoned cast iron tawa for crisp dosas and rotis.", 15),
                new("kitchen", "Pure Copper Water Bottle 1L", 799, 1299, 12, "7418", "", "Hammered,Plain", "Ayurvedic tamra bottle with leak-proof cap.", 30),
                new("textiles", "Kashmiri Pashmina Shawl", 5999, 8999, 12, "6214", "", "Natural,Maroon", "Handspun Changthangi pashmina with sozni embroidery.", 2),
            ]),
    ];

    public static async Task SeedAsync(PlatformDbContext db, IConfiguration config, TextWriter output)
    {
        var password = config["Seed:Password"];
        var generated = string.IsNullOrEmpty(password);
        if (generated) password = Convert.ToBase64String(RandomNumberGenerator.GetBytes(12));
        var hasher = new PasswordHasher<User>();
        var domain = config["Platform:StorefrontDomain"] ?? "shopmint.in";
        var now = DateTimeOffset.UtcNow;

        User EnsureUser(string email, string name, bool platformAdmin)
        {
            var normalized = AuthEndpoints.Normalize(email);
            var existing = db.Users.Local.FirstOrDefault(u => u.NormalizedEmail == normalized)
                ?? db.Users.FirstOrDefault(u => u.NormalizedEmail == normalized);
            if (existing is not null) return existing;
            var u = new User { Id = Guid.CreateVersion7(), Email = email, NormalizedEmail = normalized, Name = name, IsPlatformAdmin = platformAdmin, CreatedAt = now };
            u.PasswordHash = hasher.HashPassword(u, password!);
            db.Users.Add(u);
            output.WriteLine($"  user {email}{(platformAdmin ? " (platform admin)" : "")}");
            return u;
        }

        EnsureUser("admin@shopmint.local", "Platform Admin", true);

        foreach (var t in Tenants)
        {
            if (await db.Tenants.AnyAsync(x => x.Slug == t.Slug)) { output.WriteLine($"  tenant {t.Slug} exists, skipped"); continue; }
            var tenant = new Tenant
            {
                Id = Guid.CreateVersion7(), Slug = t.Slug, Name = t.Name, Status = TenantStatus.Active, PlanCode = "pro",
                Tagline = $"{t.Tagline} · Demo store", BrandColor = t.Color, StateCode = t.State, Gstin = t.Gstin, LegalName = t.Legal,
                SupportEmail = $"support@{t.Slug}.demo", CreatedAt = now, UpdatedAt = now,
            };
            tenant.Domains.Add(new TenantDomain { Id = Guid.CreateVersion7(), Host = $"{t.Slug}.{domain}", Kind = DomainKind.Subdomain, VerifiedAt = now, CreatedAt = now });
            db.Tenants.Add(tenant);
            var owner = EnsureUser($"owner@{t.Slug}.demo", $"{t.Name} Owner", false);
            var staff = EnsureUser($"staff@{t.Slug}.demo", $"{t.Name} Staff", false);
            db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), TenantId = tenant.Id, UserId = owner.Id, Role = MemberRole.Owner, CreatedAt = now });
            db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), TenantId = tenant.Id, UserId = staff.Id, Role = MemberRole.Staff, CreatedAt = now.AddSeconds(1) });
            var location = new Location { Id = Guid.CreateVersion7(), TenantId = tenant.Id, Name = "Primary warehouse", Code = "MAIN", StateCode = t.State, IsDefault = true, CreatedAt = now };
            db.Locations.Add(location);

            var cats = t.Cats.Select((c, i) => new Category { Id = Guid.CreateVersion7(), TenantId = tenant.Id, Name = c.Name, Slug = c.Slug, Position = i, CreatedAt = now, UpdatedAt = now }).ToList();
            db.Categories.AddRange(cats);

            var n = 0;
            foreach (var p in t.Products)
            {
                var axes = new List<(string Name, string[] Values)>();
                if (p.Sizes.Length > 0) axes.Add(("Size", p.Sizes.Split(',')));
                if (p.Colours.Length > 0) axes.Add(("Colour", p.Colours.Split(',')));
                var combos = axes.Aggregate(new List<string[]> { Array.Empty<string>() },
                    (acc, axis) => acc.SelectMany(prefix => axis.Values.Select(v => prefix.Append(v).ToArray())).ToList());

                var product = new Product
                {
                    Id = Guid.CreateVersion7(), TenantId = tenant.Id, CategoryId = cats.First(c => c.Slug == p.Cat).Id, Title = p.Title,
                    Slug = Common.Slug.From(p.Title), Description = p.Desc, Status = ProductStatus.Active, HsnCode = p.Hsn, GstRate = p.Gst,
                    OptionNames = axes.Select(a => a.Name).ToArray(), CreatedAt = now.AddMinutes(-n * 37), UpdatedAt = now.AddMinutes(-n * 37),
                };
                n++;
                var vi = 0;
                foreach (var combo in combos)
                {
                    var variant = new ProductVariant
                    {
                        Id = Guid.CreateVersion7(), TenantId = tenant.Id, ProductId = product.Id, OptionValues = combo, Price = p.Price, Mrp = p.Mrp,
                        Cost = Math.Round(p.Price * 0.55m), Position = vi,
                        Sku = $"{t.Slug[..2].ToUpperInvariant()}-{n:D3}" + (combo.Length > 0 ? "-" + string.Join("-", combo.Select(c => Common.Slug.From(c).ToUpperInvariant())) : ""),
                    };
                    // Spread stock across variants; the first variant of a low-stock product gets the remainder.
                    var qty = combos.Count == 1 ? p.Stock : Math.Max(0, p.Stock / combos.Count + (vi == 0 ? p.Stock % combos.Count : 0));
                    variant.StockLevels.Add(new StockLevel { TenantId = tenant.Id, VariantId = variant.Id, LocationId = location.Id, OnHand = qty });
                    db.StockMovements.Add(new StockMovement { Id = Guid.CreateVersion7(), TenantId = tenant.Id, VariantId = variant.Id, LocationId = location.Id, Delta = qty, Reason = StockMovementReason.Initial, At = now });
                    product.Variants.Add(variant);
                    vi++;
                }
                db.Products.Add(product);
            }
            output.WriteLine($"  tenant {t.Slug} → http://{t.Slug}.{domain}:3000 ({t.Products.Length} products)");
        }

        await db.SaveChangesAsync();
        output.WriteLine(generated
            ? $"Seeded. Generated password for all demo users: {password}  (set Seed:Password to choose one)"
            : "Seeded. Demo users use the password from Seed:Password.");
    }
}
