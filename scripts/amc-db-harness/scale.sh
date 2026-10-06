#!/usr/bin/env bash
# Synthetic scale + EXPLAIN + two-session concurrency tests. Local only.
set -euo pipefail
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/15/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/.out"; mkdir -p "$OUT"
NEW="$REPO/supabase/migrations"
DATA="$OUT/data-scale"
PORT=55434
P=("$PGBIN/psql.exe" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d amc_scale)

rm -rf "$DATA"
"$PGBIN/initdb.exe" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
"$PGBIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$OUT/pg-scale.log" -w start >/dev/null
trap '"$PGBIN/pg_ctl.exe" -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true' EXIT
"$PGBIN/createdb.exe" -h 127.0.0.1 -p "$PORT" -U postgres amc_scale
"${P[@]}" -f "$HERE/00_supabase_shim.sql" >/dev/null
for f in 20260721120000_create_amc_submissions 20260915120000_amc_harden_submissions \
         20260915130000_amc_settings_and_audit 20260916100000_amc_approval_flow \
         20260916105000_amc_proposal_numbers 20260916110000_amc_client_links \
         20260922130000_amc_contract_settings_snapshot; do
  git -C "$REPO" show "origin/main:supabase/migrations/$f.sql" > "$OUT/main_$f.sql"
  "${P[@]}" -f "$OUT/main_$f.sql" >/dev/null 2>&1
done
for f in $(ls "$NEW" | grep -E '^2026100[5-9][0-9]{6}_.*\.sql$' | sort); do "${P[@]}" -f "$NEW/$f" >/dev/null 2>&1; done

echo "== synthetic data"
start=$(date +%s)
"${P[@]}" -f "$HERE/98_scale_data.sql"
echo "   generated in $(( $(date +%s) - start ))s"

echo "== EXPLAIN"
"${P[@]}" -f "$HERE/99_explain.sql" > "$OUT/explain.txt" 2>&1
grep -E "^### |Execution Time|Seq Scan on (amc_|customers|customer_)" "$OUT/explain.txt"

echo "== concurrency (two real sessions)"
bash "$HERE/concurrency.sh" "$PORT"
