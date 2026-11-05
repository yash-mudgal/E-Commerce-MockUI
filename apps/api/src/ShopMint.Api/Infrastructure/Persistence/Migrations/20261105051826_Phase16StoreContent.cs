using System;
using Microsoft.EntityFrameworkCore.Migrations;
using ShopMint.Api.Infrastructure.Persistence;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase16StoreContent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "collections",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    description = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    tag = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    published = table.Column<bool>(type: "boolean", nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_collections", x => x.id);
                    table.ForeignKey(
                        name: "fk_collections_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "store_pages",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    title = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    body = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    published = table.Column<bool>(type: "boolean", nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_store_pages", x => x.id);
                    table.ForeignKey(
                        name: "fk_store_pages_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "storefront_settings",
                columns: table => new
                {
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    hero_heading = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    hero_text = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    hero_media_id = table.Column<Guid>(type: "uuid", nullable: true),
                    announcement = table.Column<string>(type: "character varying(140)", maxLength: 140, nullable: true),
                    show_categories = table.Column<bool>(type: "boolean", nullable: false),
                    show_new_arrivals = table.Column<bool>(type: "boolean", nullable: false),
                    show_sale = table.Column<bool>(type: "boolean", nullable: false),
                    featured_collection_id = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_storefront_settings", x => x.tenant_id);
                    table.ForeignKey(
                        name: "fk_storefront_settings_collections_featured_collection_id",
                        column: x => x.featured_collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_storefront_settings_product_media_hero_media_id",
                        column: x => x.hero_media_id,
                        principalTable: "product_media",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_storefront_settings_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_collections_tenant_id_slug",
                table: "collections",
                columns: new[] { "tenant_id", "slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_store_pages_tenant_id_slug",
                table: "store_pages",
                columns: new[] { "tenant_id", "slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_storefront_settings_featured_collection_id",
                table: "storefront_settings",
                column: "featured_collection_id");

            migrationBuilder.CreateIndex(
                name: "ix_storefront_settings_hero_media_id",
                table: "storefront_settings",
                column: "hero_media_id");

            migrationBuilder.Sql(RlsSql.Phase16StoreContent());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "store_pages");

            migrationBuilder.DropTable(
                name: "storefront_settings");

            migrationBuilder.DropTable(
                name: "collections");
        }
    }
}
