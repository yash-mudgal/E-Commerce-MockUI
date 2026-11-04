using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using ShopMint.Api.Infrastructure.Persistence;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase11Security : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<List<string>>(
                name: "recovery_code_hashes",
                table: "users",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]"); // existing users have no recovery codes

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "totp_enabled_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "totp_last_step",
                table: "users",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "totp_pending_secret_enc",
                table: "users",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "totp_secret_enc",
                table: "users",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "data_protection_keys",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    friendly_name = table.Column<string>(type: "text", nullable: true),
                    xml = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_data_protection_keys", x => x.id);
                });

            migrationBuilder.Sql(RlsSql.Phase11Security());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "data_protection_keys");

            migrationBuilder.DropColumn(
                name: "recovery_code_hashes",
                table: "users");

            migrationBuilder.DropColumn(
                name: "totp_enabled_at",
                table: "users");

            migrationBuilder.DropColumn(
                name: "totp_last_step",
                table: "users");

            migrationBuilder.DropColumn(
                name: "totp_pending_secret_enc",
                table: "users");

            migrationBuilder.DropColumn(
                name: "totp_secret_enc",
                table: "users");
        }
    }
}
