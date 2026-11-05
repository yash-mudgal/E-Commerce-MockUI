using System;
using Microsoft.EntityFrameworkCore.Migrations;
using ShopMint.Api.Infrastructure.Persistence;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase18GiftCardsNewsletter : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "gift_card_amount",
                table: "orders",
                type: "numeric(14,2)",
                precision: 14,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<Guid>(
                name: "gift_card_id",
                table: "orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "gift_card_restored",
                table: "orders",
                type: "numeric(14,2)",
                precision: 14,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateTable(
                name: "gift_cards",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    last4 = table.Column<string>(type: "character varying(4)", maxLength: 4, nullable: false),
                    initial_value = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    balance = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    recipient_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    recipient_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    note = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_gift_cards", x => x.id);
                    table.CheckConstraint("ck_gift_cards_balance", "balance >= 0 AND balance <= initial_value");
                    table.ForeignKey(
                        name: "fk_gift_cards_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "newsletter_subscribers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    normalized_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    confirmed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    unsubscribed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_newsletter_subscribers", x => x.id);
                    table.ForeignKey(
                        name: "fk_newsletter_subscribers_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "gift_card_transactions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    gift_card_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_id = table.Column<Guid>(type: "uuid", nullable: true),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    amount = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    balance_after = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_gift_card_transactions", x => x.id);
                    table.ForeignKey(
                        name: "fk_gift_card_transactions_gift_cards_gift_card_id",
                        column: x => x.gift_card_id,
                        principalTable: "gift_cards",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_gift_card_transactions_orders_order_id",
                        column: x => x.order_id,
                        principalTable: "orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_gift_card_transactions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_orders_gift_card_id",
                table: "orders",
                column: "gift_card_id");

            migrationBuilder.CreateIndex(
                name: "ix_gift_card_transactions_gift_card_id_at",
                table: "gift_card_transactions",
                columns: new[] { "gift_card_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_gift_card_transactions_order_id",
                table: "gift_card_transactions",
                column: "order_id");

            migrationBuilder.CreateIndex(
                name: "ix_gift_card_transactions_tenant_id",
                table: "gift_card_transactions",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_gift_cards_tenant_id_code_hash",
                table: "gift_cards",
                columns: new[] { "tenant_id", "code_hash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_gift_cards_tenant_id_created_at",
                table: "gift_cards",
                columns: new[] { "tenant_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_newsletter_subscribers_tenant_id_normalized_email",
                table: "newsletter_subscribers",
                columns: new[] { "tenant_id", "normalized_email" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_newsletter_subscribers_tenant_id_status_updated_at",
                table: "newsletter_subscribers",
                columns: new[] { "tenant_id", "status", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_newsletter_subscribers_token_hash",
                table: "newsletter_subscribers",
                column: "token_hash");

            migrationBuilder.AddForeignKey(
                name: "fk_orders_gift_cards_gift_card_id",
                table: "orders",
                column: "gift_card_id",
                principalTable: "gift_cards",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql(RlsSql.Phase18GiftCardsNewsletter());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_orders_gift_cards_gift_card_id",
                table: "orders");

            migrationBuilder.DropTable(
                name: "gift_card_transactions");

            migrationBuilder.DropTable(
                name: "newsletter_subscribers");

            migrationBuilder.DropTable(
                name: "gift_cards");

            migrationBuilder.DropIndex(
                name: "ix_orders_gift_card_id",
                table: "orders");

            migrationBuilder.DropColumn(
                name: "gift_card_amount",
                table: "orders");

            migrationBuilder.DropColumn(
                name: "gift_card_id",
                table: "orders");

            migrationBuilder.DropColumn(
                name: "gift_card_restored",
                table: "orders");
        }
    }
}
