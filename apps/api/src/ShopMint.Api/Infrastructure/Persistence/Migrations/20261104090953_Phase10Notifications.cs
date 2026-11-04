using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase10Notifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "abandoned_cart_emails",
                table: "tenants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "low_stock_digest_at",
                table: "tenants",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "low_stock_digest_hash",
                table: "tenants",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "notify_low_stock",
                table: "memberships",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "notify_new_orders",
                table: "memberships",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "purpose",
                table: "customer_tokens",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "PasswordReset"); // existing tokens are password-reset links

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "reminder_sent_at",
                table: "carts",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "abandoned_cart_emails",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "low_stock_digest_at",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "low_stock_digest_hash",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "notify_low_stock",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "notify_new_orders",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "purpose",
                table: "customer_tokens");

            migrationBuilder.DropColumn(
                name: "reminder_sent_at",
                table: "carts");
        }
    }
}
