using System;
using Microsoft.EntityFrameworkCore.Migrations;
using ShopMint.Api.Infrastructure.Persistence;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase17ReturnsDelivery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "deliver_only_to_zones",
                table: "tenants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "delivery_max_days",
                table: "tenants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "delivery_min_days",
                table: "tenants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "return_window_days",
                table: "tenants",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "return_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    customer_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    resolution = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    store_note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    restocked = table.Column<bool>(type: "boolean", nullable: false),
                    refund_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_return_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_return_requests_customers_customer_id",
                        column: x => x.customer_id,
                        principalTable: "customers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_return_requests_orders_order_id",
                        column: x => x.order_id,
                        principalTable: "orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_return_requests_refunds_refund_id",
                        column: x => x.refund_id,
                        principalTable: "refunds",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_return_requests_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "shipping_zones",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    pincode_prefixes = table.Column<string[]>(type: "text[]", nullable: false),
                    fee = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: true),
                    free_shipping_threshold = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: true),
                    min_days = table.Column<int>(type: "integer", nullable: false),
                    max_days = table.Column<int>(type: "integer", nullable: false),
                    cod_available = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_shipping_zones", x => x.id);
                    table.ForeignKey(
                        name: "fk_shipping_zones_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "return_lines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    return_request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_line_id = table.Column<Guid>(type: "uuid", nullable: false),
                    quantity = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_return_lines", x => x.id);
                    table.CheckConstraint("ck_return_lines_quantity", "quantity > 0");
                    table.ForeignKey(
                        name: "fk_return_lines_order_lines_order_line_id",
                        column: x => x.order_line_id,
                        principalTable: "order_lines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_return_lines_return_requests_return_request_id",
                        column: x => x.return_request_id,
                        principalTable: "return_requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_return_lines_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_return_lines_order_line_id",
                table: "return_lines",
                column: "order_line_id");

            migrationBuilder.CreateIndex(
                name: "ix_return_lines_return_request_id",
                table: "return_lines",
                column: "return_request_id");

            migrationBuilder.CreateIndex(
                name: "ix_return_lines_tenant_id",
                table: "return_lines",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_return_requests_customer_id",
                table: "return_requests",
                column: "customer_id");

            migrationBuilder.CreateIndex(
                name: "ix_return_requests_order_id",
                table: "return_requests",
                column: "order_id");

            migrationBuilder.CreateIndex(
                name: "ix_return_requests_refund_id",
                table: "return_requests",
                column: "refund_id");

            migrationBuilder.CreateIndex(
                name: "ix_return_requests_tenant_id_status_updated_at",
                table: "return_requests",
                columns: new[] { "tenant_id", "status", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_shipping_zones_tenant_id",
                table: "shipping_zones",
                column: "tenant_id");

            migrationBuilder.Sql(RlsSql.Phase17ReturnsDelivery());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "return_lines");

            migrationBuilder.DropTable(
                name: "shipping_zones");

            migrationBuilder.DropTable(
                name: "return_requests");

            migrationBuilder.DropColumn(
                name: "deliver_only_to_zones",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "delivery_max_days",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "delivery_min_days",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "return_window_days",
                table: "tenants");
        }
    }
}
