using System;
using Microsoft.EntityFrameworkCore.Migrations;
using ShopMint.Api.Infrastructure.Persistence;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase8Orders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "business_address",
                table: "tenants",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "cod_enabled",
                table: "tenants",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<decimal>(
                name: "cod_max_order_value",
                table: "tenants",
                type: "numeric(14,2)",
                precision: 14,
                scale: 2,
                nullable: false,
                defaultValue: 5000m);

            migrationBuilder.AddColumn<decimal>(
                name: "free_shipping_threshold",
                table: "tenants",
                type: "numeric(14,2)",
                precision: 14,
                scale: 2,
                nullable: true);

            // Existing stores get the same shipping defaults as new ones: ₹49, free from ₹499.
            // Forced RLS applies to the table owner too, so lift it for this one statement.
            migrationBuilder.Sql("""
                ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
                UPDATE tenants SET free_shipping_threshold = 499;
                ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
                """);

            migrationBuilder.AddColumn<decimal>(
                name: "shipping_fee",
                table: "tenants",
                type: "numeric(14,2)",
                precision: 14,
                scale: 2,
                nullable: false,
                defaultValue: 49m);

            migrationBuilder.CreateTable(
                name: "coupons",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    value = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    min_subtotal = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    max_discount = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: true),
                    starts_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ends_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    usage_limit = table.Column<int>(type: "integer", nullable: true),
                    per_customer_limit = table.Column<int>(type: "integer", nullable: false),
                    times_used = table.Column<int>(type: "integer", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_coupons", x => x.id);
                    table.CheckConstraint("ck_coupon_usage_valid", "usage_limit IS NULL OR times_used <= usage_limit");
                    table.CheckConstraint("ck_coupon_value_positive", "value > 0");
                    table.ForeignKey(
                        name: "fk_coupons_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "orders",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    customer_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    customer_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ship_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ship_phone = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: false),
                    ship_line1 = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ship_line2 = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ship_city = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ship_state_code = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    ship_pincode = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    payment_method = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    payment_status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    subtotal = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    discount = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    shipping = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    taxable = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    cgst = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    sgst = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    igst = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    total = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    refunded_total = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    coupon_id = table.Column<Guid>(type: "uuid", nullable: true),
                    coupon_code = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    idempotency_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    placed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    reserved_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    paid_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    cancelled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    cancel_reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    invoice_number = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    invoice_issued_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    seller_state_code = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    seller_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    seller_legal_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    seller_gstin = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: true),
                    seller_address = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_orders", x => x.id);
                    table.UniqueConstraint("ak_orders_tenant_id_id", x => new { x.tenant_id, x.id });
                    table.CheckConstraint("ck_order_refunded_valid", "refunded_total >= 0 AND refunded_total <= total");
                    table.CheckConstraint("ck_order_total_nonneg", "total >= 0");
                    table.ForeignKey(
                        name: "fk_orders_customers_tenant_id_customer_id",
                        columns: x => new { x.tenant_id, x.customer_id },
                        principalTable: "customers",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_orders_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "tenant_counters",
                columns: table => new
                {
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    value = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tenant_counters", x => new { x.tenant_id, x.name });
                    table.ForeignKey(
                        name: "fk_tenant_counters_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "tenant_payment_settings",
                columns: table => new
                {
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    razorpay_key_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    razorpay_key_secret_enc = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    razorpay_webhook_secret_enc = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tenant_payment_settings", x => x.tenant_id);
                    table.ForeignKey(
                        name: "fk_tenant_payment_settings_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "webhook_events",
                columns: table => new
                {
                    gateway = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    event_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_webhook_events", x => new { x.gateway, x.event_id });
                    table.ForeignKey(
                        name: "fk_webhook_events_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "order_lines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    variant_id = table.Column<Guid>(type: "uuid", nullable: true),
                    location_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    variant_label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    sku = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    hsn_code = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    gst_rate = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    unit_price = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    mrp = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    quantity = table.Column<int>(type: "integer", nullable: false),
                    gross = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    discount_allocated = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    taxable = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    cgst = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    sgst = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    igst = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    line_total = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_order_lines", x => x.id);
                    table.CheckConstraint("ck_order_line_quantity", "quantity > 0");
                    table.ForeignKey(
                        name: "fk_order_lines_orders_tenant_id_order_id",
                        columns: x => new { x.tenant_id, x.order_id },
                        principalTable: "orders",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_order_lines_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "payment_attempts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    gateway = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    gateway_order_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    gateway_payment_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    amount = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    failure_reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_payment_attempts", x => x.id);
                    table.ForeignKey(
                        name: "fk_payment_attempts_orders_tenant_id_order_id",
                        columns: x => new { x.tenant_id, x.order_id },
                        principalTable: "orders",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_payment_attempts_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "refunds",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    amount = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    gateway_refund_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    processed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_refunds", x => x.id);
                    table.CheckConstraint("ck_refund_amount_positive", "amount > 0");
                    table.ForeignKey(
                        name: "fk_refunds_orders_tenant_id_order_id",
                        columns: x => new { x.tenant_id, x.order_id },
                        principalTable: "orders",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_refunds_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "shipments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    carrier = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    tracking_number = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    tracking_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    shipped_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    delivered_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_shipments", x => x.id);
                    table.ForeignKey(
                        name: "fk_shipments_orders_tenant_id_order_id",
                        columns: x => new { x.tenant_id, x.order_id },
                        principalTable: "orders",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_shipments_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_coupons_tenant_id_code",
                table: "coupons",
                columns: new[] { "tenant_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_order_lines_tenant_id_order_id",
                table: "order_lines",
                columns: new[] { "tenant_id", "order_id" });

            migrationBuilder.CreateIndex(
                name: "ix_order_lines_tenant_id_variant_id",
                table: "order_lines",
                columns: new[] { "tenant_id", "variant_id" });

            migrationBuilder.CreateIndex(
                name: "ix_orders_status_reserved_until",
                table: "orders",
                columns: new[] { "status", "reserved_until" });

            migrationBuilder.CreateIndex(
                name: "ix_orders_tenant_id_customer_id_idempotency_key",
                table: "orders",
                columns: new[] { "tenant_id", "customer_id", "idempotency_key" },
                unique: true,
                filter: "idempotency_key IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_orders_tenant_id_invoice_number",
                table: "orders",
                columns: new[] { "tenant_id", "invoice_number" },
                unique: true,
                filter: "invoice_number IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_orders_tenant_id_number",
                table: "orders",
                columns: new[] { "tenant_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_orders_tenant_id_status_placed_at",
                table: "orders",
                columns: new[] { "tenant_id", "status", "placed_at" });

            migrationBuilder.CreateIndex(
                name: "ix_payment_attempts_gateway_gateway_order_id",
                table: "payment_attempts",
                columns: new[] { "gateway", "gateway_order_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_payment_attempts_tenant_id_order_id",
                table: "payment_attempts",
                columns: new[] { "tenant_id", "order_id" });

            migrationBuilder.CreateIndex(
                name: "ix_refunds_gateway_refund_id",
                table: "refunds",
                column: "gateway_refund_id",
                unique: true,
                filter: "gateway_refund_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_refunds_tenant_id_order_id",
                table: "refunds",
                columns: new[] { "tenant_id", "order_id" });

            migrationBuilder.CreateIndex(
                name: "ix_shipments_tenant_id_order_id",
                table: "shipments",
                columns: new[] { "tenant_id", "order_id" });

            migrationBuilder.CreateIndex(
                name: "ix_webhook_events_tenant_id",
                table: "webhook_events",
                column: "tenant_id");
        
            // RLS and grants for orders, payments, coupons and counters. See RlsSql.Phase8Orders.
            migrationBuilder.Sql(RlsSql.Phase8Orders());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "coupons");

            migrationBuilder.DropTable(
                name: "order_lines");

            migrationBuilder.DropTable(
                name: "payment_attempts");

            migrationBuilder.DropTable(
                name: "refunds");

            migrationBuilder.DropTable(
                name: "shipments");

            migrationBuilder.DropTable(
                name: "tenant_counters");

            migrationBuilder.DropTable(
                name: "tenant_payment_settings");

            migrationBuilder.DropTable(
                name: "webhook_events");

            migrationBuilder.DropTable(
                name: "orders");

            migrationBuilder.DropColumn(
                name: "business_address",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "cod_enabled",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "cod_max_order_value",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "free_shipping_threshold",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "shipping_fee",
                table: "tenants");
        }
    }
}
