#!/usr/bin/env bash
# Local restore drill (Docker): back up a ShopMint database running in a PostgreSQL container, restore it into a brand-new
# PostgreSQL 16 server, and verify the copy with `verify-db` (the same command used after a real RDS restore).
# The AWS procedure (point-in-time restore of RDS) is in docs/runbooks/restore.md; this script rehearses the logical
# backup path and the verification end to end on one machine.
#
#   ops/restore-drill-local.sh <source-container> <role-password-prefix-file>
#
# The source container must hold the database "shopmint" created by `deploy-db`. Role passwords are read from the
# environment (DRILL_OWNER_PW, DRILL_APP_PW, DRILL_PLATFORM_PW); nothing is written to the repository.
set -euo pipefail
SRC=${1:?source container}
TARGET=${DRILL_TARGET:-shopmint-restore-drill}
PORT=${DRILL_PORT:-55433}
WORK=$(mktemp -d)
: "${DRILL_OWNER_PW:?}" "${DRILL_APP_PW:?}" "${DRILL_PLATFORM_PW:?}"
API_DIR="$(cd "$(dirname "$0")/../apps/api/src/ShopMint.Api" && pwd)"

verify() {  # verify-db against a port, printing its report
  (cd "$API_DIR" && env -i PATH="$PATH" HOME="$HOME" DOTNET_CLI_HOME="$HOME" ASPNETCORE_ENVIRONMENT=Production \
    Database__Host=localhost Database__Port="$1" Database__SslMode=Disable \
    Database__Passwords__Migrations="$DRILL_OWNER_PW" Database__Passwords__App="$DRILL_APP_PW" Database__Passwords__Platform="$DRILL_PLATFORM_PW" \
    dotnet run --no-launch-profile --no-build -- verify-db)
}
counts() { grep '^PASS  row counts' | sed 's/^PASS  row counts: //'; }

echo "== 1. Verify the source and record row counts"
SRC_PORT=$(docker port "$SRC" 5432/tcp | head -1 | sed 's/.*://')
verify "$SRC_PORT" | tee "$WORK/before.txt"
grep -q "Database verified." "$WORK/before.txt"

echo "== 2. Back up (roles + database, custom format)"
start=$(date +%s)
docker exec "$SRC" pg_dumpall -U postgres --roles-only > "$WORK/roles.sql"
docker exec "$SRC" pg_dump -U postgres -Fc shopmint > "$WORK/shopmint.dump"
ls -l "$WORK/shopmint.dump" | awk '{print "   dump size:", $5, "bytes"}'

echo "== 3. Restore into a new PostgreSQL 16 server ($TARGET on port $PORT)"
docker rm -f "$TARGET" >/dev/null 2>&1 || true
docker run -d --name "$TARGET" -e POSTGRES_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -dc A-Za-z0-9)" -p "$PORT:5432" postgres:16 >/dev/null
for _ in $(seq 1 60); do docker exec "$TARGET" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
# The superuser already exists in the new server; every other role is recreated with its password hash.
grep -v -E '^(CREATE|ALTER) ROLE postgres( |;)' "$WORK/roles.sql" | docker exec -i "$TARGET" psql -q -U postgres -v ON_ERROR_STOP=1 >/dev/null
docker exec "$TARGET" createdb -U postgres -O shopmint_owner shopmint
docker exec -i "$TARGET" pg_restore -U postgres -d shopmint --exit-on-error < "$WORK/shopmint.dump"
echo "   restored in $(( $(date +%s) - start )) s"

echo "== 4. Verify the restored copy"
verify "$PORT" | tee "$WORK/after.txt"
grep -q "Database verified." "$WORK/after.txt"
if [ "$(counts < "$WORK/before.txt")" = "$(counts < "$WORK/after.txt")" ]; then
  echo "PASS  row counts match the source"
else
  echo "FAIL  row counts differ"; diff <(counts < "$WORK/before.txt" | tr ' ' '\n') <(counts < "$WORK/after.txt" | tr ' ' '\n') || true; exit 1
fi
rm -rf "$WORK"
echo "Restore drill passed. The restored server is still running as $TARGET on port $PORT (docker rm -f $TARGET to remove)."
