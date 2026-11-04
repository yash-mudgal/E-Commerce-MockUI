using System;
using Microsoft.EntityFrameworkCore.Migrations;
using ShopMint.Api.Infrastructure.Persistence;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase9Billing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "grace_ends_at",
                table: "tenants",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "suspension_reason",
                table: "tenants",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "trial_reminder_sent_at",
                table: "tenants",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "plans",
                columns: table => new
                {
                    code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    monthly_price = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    max_products = table.Column<int>(type: "integer", nullable: true),
                    max_staff = table.Column<int>(type: "integer", nullable: true),
                    max_locations = table.Column<int>(type: "integer", nullable: true),
                    custom_domain = table.Column<bool>(type: "boolean", nullable: false),
                    is_public = table.Column<bool>(type: "boolean", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    razorpay_plan_id = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_plans", x => x.code);
                    table.CheckConstraint("ck_plan_price", "monthly_price >= 0");
                });

            migrationBuilder.CreateTable(
                name: "subscriptions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plan_code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    gateway = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    gateway_subscription_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    start_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    current_period_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    current_period_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    cancel_at_period_end = table.Column<bool>(type: "boolean", nullable: false),
                    pending_plan_code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    note = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_subscriptions", x => x.id);
                    table.ForeignKey(
                        name: "fk_subscriptions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "billing_invoices",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    subscription_id = table.Column<Guid>(type: "uuid", nullable: false),
                    gateway_payment_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    gateway_invoice_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    plan_code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    amount = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    period_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    period_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    paid_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    invoice_url = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_billing_invoices", x => x.id);
                    table.ForeignKey(
                        name: "fk_billing_invoices_subscriptions_subscription_id",
                        column: x => x.subscription_id,
                        principalTable: "subscriptions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_billing_invoices_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_billing_invoices_gateway_payment_id",
                table: "billing_invoices",
                column: "gateway_payment_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_billing_invoices_subscription_id",
                table: "billing_invoices",
                column: "subscription_id");

            migrationBuilder.CreateIndex(
                name: "ix_billing_invoices_tenant_id_paid_at",
                table: "billing_invoices",
                columns: new[] { "tenant_id", "paid_at" });

            migrationBuilder.CreateIndex(
                name: "ix_plans_razorpay_plan_id",
                table: "plans",
                column: "razorpay_plan_id",
                unique: true,
                filter: "razorpay_plan_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_subscriptions_gateway_subscription_id",
                table: "subscriptions",
                column: "gateway_subscription_id",
                unique: true,
                filter: "gateway_subscription_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_subscriptions_tenant_id_status",
                table: "subscriptions",
                columns: new[] { "tenant_id", "status" });

            // Plans move from code to data (same prices and limits as before; prices exclude GST).
            migrationBuilder.Sql("""
                INSERT INTO plans (code, name, monthly_price, max_products, max_staff, max_locations, custom_domain, is_public, sort_order, updated_at) VALUES
                  ('trial', 'Trial', 0, 100, 2, 1, false, false, 0, now()),
                  ('basic', 'Basic', 999, 500, 2, 1, false, true, 1, now()),
                  ('pro', 'Pro', 2499, 5000, 10, 3, true, true, 2, now()),
                  ('enterprise', 'Enterprise', 7999, NULL, NULL, NULL, true, true, 3, now());
                """);

            // Existing paid-plan stores keep their plan as a platform-assigned ("manual") subscription, so deriving their
            // billing state doesn't close them. Stores suspended before billing existed were suspended by the platform.
            // Runs before RLS is enabled on subscriptions; forced RLS on tenants is lifted for the one UPDATE.
            migrationBuilder.Sql("""
                INSERT INTO subscriptions (id, tenant_id, plan_code, gateway, status, current_period_start, cancel_at_period_end, note, created_at, updated_at)
                SELECT gen_random_uuid(), id, plan_code, 'manual', 'Active', now(), false, 'Plan held before billing was introduced', now(), now()
                FROM tenants WHERE plan_code <> 'trial' AND status IN ('Active', 'PastDue', 'Suspended');
                ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
                UPDATE tenants SET suspension_reason = 'Platform' WHERE status = 'Suspended';
                UPDATE tenants SET status = 'Active' WHERE status = 'PastDue' AND plan_code <> 'trial';
                ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
                """);

            migrationBuilder.Sql(RlsSql.Phase9Billing());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "billing_invoices");

            migrationBuilder.DropTable(
                name: "plans");

            migrationBuilder.DropTable(
                name: "subscriptions");

            migrationBuilder.DropColumn(
                name: "grace_ends_at",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "suspension_reason",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "trial_reminder_sent_at",
                table: "tenants");
        }
    }
}
