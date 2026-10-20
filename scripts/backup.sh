#!/usr/bin/env sh
#
# Dump the whole event database to a file. SPEC.md §10.2: all state lives in
# Postgres — results, the draft, the audit trail and every photo — so one
# pg_dump is a complete backup and one pg_restore is a complete recovery.
#
# Run it from a laptop against the real database, the same way migrations and
# seeds run (SPEC.md §16.1). Use the DIRECT connection string, not the pooling
# one the Worker uses: pg_dump needs a session-level connection and a
# transaction-mode pooler refuses it or fails partway. It writes to ./backups,
# which is gitignored. Takes seconds; the whole database is a few megabytes.
#
#   npm run db:backup                           # uses DATABASE_URL from .env
#   DATABASE_URL='<direct url>' npm run db:backup
#
# Restore into an EMPTY database (drop and recreate it first, or use a fresh
# one and point DATABASE_URL at it):
#
#   pg_restore --no-owner --no-privileges -d "$DATABASE_URL" backups/<file>.dump
#
# Needs either a pg_dump at least as new as the server (17) on the laptop, or
# Docker, in which case the postgres:17-alpine image supplies one.

set -eu

cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^DATABASE_URL=' .env | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set and .env has none." >&2
  exit 1
fi

mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="backups/kfless-games-${stamp}.dump"

# A dump that failed halfway is worse than none: it looks like a backup.
trap 'status=$?; if [ "$status" -ne 0 ]; then rm -f "$out"; echo "backup failed; removed $out" >&2; fi' EXIT

# Custom format: compressed, and pg_restore can pick tables out of it.
#
# pg_dump refuses to run against a server newer than itself, and the compose
# database is Postgres 17 (docker-compose.yml). A Mac often has an older one
# on PATH, so an old local tool is skipped in favour of the postgres:17 image.
SERVER_MAJOR=17
local_major=0
if command -v pg_dump >/dev/null 2>&1; then
  local_major="$(pg_dump --version | sed -E 's/.*[^0-9]([0-9]+)\.[0-9].*/\1/')"
fi

if [ "${local_major:-0}" -ge "$SERVER_MAJOR" ] 2>/dev/null; then
  pg_dump --format=custom --no-owner --no-privileges --file="$out" "$DATABASE_URL"
else
  if [ "$local_major" -gt 0 ]; then
    echo "local pg_dump is version $local_major; the server is $SERVER_MAJOR. Using the postgres:$SERVER_MAJOR-alpine image." >&2
  else
    echo "pg_dump not found on PATH; using the postgres:$SERVER_MAJOR-alpine image." >&2
  fi
  # host.docker.internal lets the container reach a database on this machine.
  url="$(printf '%s' "$DATABASE_URL" | sed 's/@localhost/@host.docker.internal/; s/@127\.0\.0\.1/@host.docker.internal/')"
  docker run --rm "postgres:${SERVER_MAJOR}-alpine" pg_dump --format=custom --no-owner --no-privileges "$url" > "$out"
fi

size="$(wc -c < "$out" | tr -d ' ')"
echo "wrote $out ($size bytes)"
