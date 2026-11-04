#!/bin/sh
# Runs once when the postgres container initialises an empty volume (docker-compose only).
# Mirrors DatabaseBootstrapper.EnsureAsync. Passwords come from the compose environment.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE shopmint_owner LOGIN PASSWORD '${SHOPMINT_OWNER_PASSWORD}';
CREATE ROLE shopmint_app LOGIN NOBYPASSRLS PASSWORD '${SHOPMINT_APP_PASSWORD}';
CREATE ROLE shopmint_platform LOGIN BYPASSRLS PASSWORD '${SHOPMINT_PLATFORM_PASSWORD}';
CREATE DATABASE shopmint OWNER shopmint_owner;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname shopmint <<SQL
GRANT CONNECT ON DATABASE shopmint TO shopmint_app, shopmint_platform;
GRANT USAGE ON SCHEMA public TO shopmint_app, shopmint_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE shopmint_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shopmint_app, shopmint_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE shopmint_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO shopmint_app, shopmint_platform;
SQL
