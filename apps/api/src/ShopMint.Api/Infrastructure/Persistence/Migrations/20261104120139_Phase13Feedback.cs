using System;
using Microsoft.EntityFrameworkCore.Migrations;
using ShopMint.Api.Infrastructure.Persistence;

#nullable disable

namespace ShopMint.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase13Feedback : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "feedback",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    message = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    page = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    may_contact = table.Column<bool>(type: "boolean", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    team_note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_feedback", x => x.id);
                    table.ForeignKey(
                        name: "fk_feedback_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_feedback_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_feedback_status_created_at",
                table: "feedback",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_feedback_tenant_id",
                table: "feedback",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_feedback_user_id",
                table: "feedback",
                column: "user_id");

            migrationBuilder.Sql(RlsSql.Phase13Feedback());
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "feedback");
        }
    }
}
