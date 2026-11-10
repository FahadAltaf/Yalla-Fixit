#!/usr/bin/env bash
# Throwaway local Postgres 15 for the Finance & Reports migrations.
#
# Builds the production shape of the tables this project touches
# (00_shim.sql, read from production's API description on 20 Oct 2026),
# applies every migration from 20261020000000 on TWICE (the second pass
# proves they are idempotent), then runs checks/*.sql, which raise on the
# first failed expectation. Never touches production. See README.md.
set -euo pipefail
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/15/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS="$(cd "$HERE/../.." && pwd)/supabase/migrations"
FIRST="${FIRST_MIGRATION:-20261020000000}"
OUT="$HERE/.out"; mkdir -p "$OUT"
DATA="$OUT/data"
PORT="${PORT:-55433}"
PSQL=("$PGBIN/psql.exe" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d harness)

rm -rf "$DATA"
"$PGBIN/initdb.exe" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
"$PGBIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$OUT/pg.log" -w start >/dev/null
trap '"$PGBIN/pg_ctl.exe" -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true' EXIT
"$PGBIN/createdb.exe" -h 127.0.0.1 -p "$PORT" -U postgres harness

echo "== shim"
"${PSQL[@]}" -f "$HERE/00_shim.sql"

mapfile -t FILES < <(ls "$MIGRATIONS" | grep -E '^[0-9]{14}_.*\.sql$' | awk -v first="$FIRST" 'substr($0, 1, 14) >= first' | sort)
for pass in 1 2; do
  echo "== migrations, pass $pass"
  for f in "${FILES[@]}"; do
    # Single transaction (-1), as production applies them; pass 2's
    # "already exists, skipping" notices are expected and hidden.
    echo "   $f"; PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -1 -f "$MIGRATIONS/$f" >/dev/null
  done
done

echo "== checks"
for f in "$HERE"/checks/*.sql; do
  echo "   $(basename "$f")"; "${PSQL[@]}" -f "$f"
done
echo "== all checks passed"
