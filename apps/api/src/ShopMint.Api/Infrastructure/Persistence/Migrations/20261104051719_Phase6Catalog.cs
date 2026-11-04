using System;
using Microsoft.EntityFrameworkCore.Migrations;
using ShopMint.Api.Infrastructure.Persistence;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6Catalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "batch_id",
                table: "stock_movements",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "note",
                table: "stock_movements",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<uint>(
                name: "xmin",
                table: "categories",
                type: "xid",
                rowVersion: true,
                nullable: false,
                defaultValue: 0u);

            migrationBuilder.CreateTable(
                name: "product_media",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    storage_key = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    content_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    alt_text = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: true),
                    position = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    uploaded_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_product_media", x => x.id);
                    table.CheckConstraint("ck_media_size_positive", "size_bytes >= 0");
                    table.ForeignKey(
                        name: "fk_product_media_products_tenant_id_product_id",
                        columns: x => new { x.tenant_id, x.product_id },
                        principalTable: "products",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_product_media_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_stock_movements_tenant_id_at",
                table: "stock_movements",
                columns: new[] { "tenant_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_product_media_status_created_at",
                table: "product_media",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_product_media_storage_key",
                table: "product_media",
                column: "storage_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_product_media_tenant_id_product_id_position",
                table: "product_media",
                columns: new[] { "tenant_id", "product_id", "position" });
        
            // RLS and grants for product_media. See RlsSql.Phase6Catalog.
            migrationBuilder.Sql(RlsSql.Phase6Catalog());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "product_media");

            migrationBuilder.DropIndex(
                name: "ix_stock_movements_tenant_id_at",
                table: "stock_movements");

            migrationBuilder.DropColumn(
                name: "batch_id",
                table: "stock_movements");

            migrationBuilder.DropColumn(
                name: "note",
                table: "stock_movements");

            migrationBuilder.DropColumn(
                name: "xmin",
                table: "categories");
        }
    }
}
