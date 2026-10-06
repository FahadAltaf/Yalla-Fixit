#!/usr/bin/env bash
# Throwaway local Postgres 15: rebuild the AMC tables as production has
# them (the seven v2 migrations), apply every migration from 20261005 on
# TWICE (idempotency), then run the behavioural and schema checks 90-97.
# Never touches production. See README.md.
set -euo pipefail
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/15/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WT="$(cd "$HERE/../.." && pwd)/supabase/migrations"
OUT="$HERE/.out"; mkdir -p "$OUT"
DATA="$OUT/data"
PORT=55432
PSQL=("$PGBIN/psql.exe" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d amc_test)

rm -rf "$DATA"
"$PGBIN/initdb.exe" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
"$PGBIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$OUT/pg.log" -w start >/dev/null
trap '"$PGBIN/pg_ctl.exe" -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true' EXIT
"$PGBIN/createdb.exe" -h 127.0.0.1 -p "$PORT" -U postgres amc_test

echo "== shim"
"${PSQL[@]}" -f "$HERE/00_supabase_shim.sql"

echo "== production AMC migrations (v2)"
for f in 20260721120000_create_amc_submissions 20260915120000_amc_harden_submissions \
         20260915130000_amc_settings_and_audit 20260916100000_amc_approval_flow \
         20260916105000_amc_proposal_numbers 20260916110000_amc_client_links \
         20260922130000_amc_contract_settings_snapshot; do
  echo "   $f"; "${PSQL[@]}" -f "$WT/$f.sql" >/dev/null
done

for pass in 1 2; do
  echo "== hardening migrations, pass $pass"
  for f in $(ls "$WT" | grep -E '^2026100[5-9][0-9]{6}_.*\.sql$' | sort); do
    echo "   $f"; "${PSQL[@]}" -f "$WT/$f" >/dev/null
  done
done

echo "== extra checks"
for f in "$HERE"/9[0-7]_*.sql; do
  echo "   $(basename "$f")"; "${PSQL[@]}" -f "$f"
done
