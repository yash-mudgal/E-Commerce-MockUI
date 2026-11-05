using System;
using Microsoft.EntityFrameworkCore.Migrations;
using ShopMint.Api.Infrastructure.Persistence;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase15ReviewsWishlist : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "product_reviews",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    customer_id = table.Column<Guid>(type: "uuid", nullable: false),
                    rating = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    body = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    reply = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    replied_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_product_reviews", x => x.id);
                    table.CheckConstraint("ck_product_reviews_rating", "rating BETWEEN 1 AND 5");
                    table.ForeignKey(
                        name: "fk_product_reviews_customers_customer_id",
                        column: x => x.customer_id,
                        principalTable: "customers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_product_reviews_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_product_reviews_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "wishlist_items",
                columns: table => new
                {
                    customer_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_wishlist_items", x => new { x.customer_id, x.product_id });
                    table.ForeignKey(
                        name: "fk_wishlist_items_customers_customer_id",
                        column: x => x.customer_id,
                        principalTable: "customers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_wishlist_items_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_wishlist_items_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_product_reviews_customer_id",
                table: "product_reviews",
                column: "customer_id");

            migrationBuilder.CreateIndex(
                name: "ix_product_reviews_product_id_status",
                table: "product_reviews",
                columns: new[] { "product_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_product_reviews_tenant_id_product_id_customer_id",
                table: "product_reviews",
                columns: new[] { "tenant_id", "product_id", "customer_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_product_reviews_tenant_id_status_updated_at",
                table: "product_reviews",
                columns: new[] { "tenant_id", "status", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_wishlist_items_product_id",
                table: "wishlist_items",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_wishlist_items_tenant_id",
                table: "wishlist_items",
                column: "tenant_id");

            migrationBuilder.Sql(RlsSql.Phase15ReviewsWishlist());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "product_reviews");

            migrationBuilder.DropTable(
                name: "wishlist_items");
        }
    }
}
