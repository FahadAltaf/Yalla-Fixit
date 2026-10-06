#!/usr/bin/env bash
# Main compatibility harness (local PostgreSQL 15, never production).
#  1. Build main's AMC state from origin/main's own migration files
#     (read with git show; origin/main is never checked out).
#  2. Seed production-shaped data (28 proposals).
#  3. Replay main's database contract (80_main_contract.sql) at baseline,
#     then after EACH new migration in order, each time in a rolled-back
#     transaction. Prints a PASS/FAIL matrix.
#  4. Apply every new migration a second time (idempotency).
set -uo pipefail
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/15/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/.out"; mkdir -p "$OUT"
NEW="$REPO/supabase/migrations"
DATA="$OUT/data-compat"
PORT=55433
PSQL=("$PGBIN/psql.exe" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d amc_compat)

rm -rf "$DATA"
"$PGBIN/initdb.exe" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
"$PGBIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$OUT/pg-compat.log" -w start >/dev/null
trap '"$PGBIN/pg_ctl.exe" -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true' EXIT
"$PGBIN/createdb.exe" -h 127.0.0.1 -p "$PORT" -U postgres amc_compat

"${PSQL[@]}" -f "$HERE/00_supabase_shim.sql" >/dev/null || exit 1
echo "== main's AMC migrations (from origin/main, read-only)"
for f in 20260721120000_create_amc_submissions 20260915120000_amc_harden_submissions \
         20260915130000_amc_settings_and_audit 20260916100000_amc_approval_flow \
         20260916105000_amc_proposal_numbers 20260916110000_amc_client_links \
         20260922130000_amc_contract_settings_snapshot; do
  git -C "$REPO" show "origin/main:supabase/migrations/$f.sql" > "$OUT/main_$f.sql"
  "${PSQL[@]}" -f "$OUT/main_$f.sql" >/dev/null || { echo "FAILED $f"; exit 1; }
  echo "   $f"
done
"${PSQL[@]}" -f "$HERE/81_main_seed.sql" >/dev/null || exit 1

contract() {
  local label="$1"
  { echo "BEGIN;"; cat "$HERE/80_main_contract.sql"; echo "ROLLBACK;"; } |
    "$PGBIN/psql.exe" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d amc_compat 2>&1 |
    grep -oE "(PASS|FAIL) .*" | sed "s/^/$label | /"
}

contract "00 main baseline" > "$OUT/compat-results.txt"
MIGS=$(ls "$NEW" | grep -E '^2026100[5-9][0-9]{6}_.*\.sql$' | sort)
i=0
for f in $MIGS; do
  i=$((i+1))
  if "${PSQL[@]}" -f "$NEW/$f" >/dev/null 2>"$OUT/err.txt"; then
    contract "$(printf '%02d' $i) +$f" >> "$OUT/compat-results.txt"
  else
    echo "APPLY FAILED: $f"; cat "$OUT/err.txt"; exit 1
  fi
done
echo "== idempotency: every new migration applied a second time"
for f in $MIGS; do
  "${PSQL[@]}" -f "$NEW/$f" >/dev/null 2>"$OUT/err.txt" || { echo "RE-APPLY FAILED: $f"; cat "$OUT/err.txt"; exit 1; }
done
echo "   ok"
contract "99 after re-apply" >> "$OUT/compat-results.txt"

echo "== matrix (FAIL lines; every check not listed passed)"
grep "| FAIL" "$OUT/compat-results.txt" || echo "   (no failures)"
echo "== totals"
awk -F' \\| ' '{split($2,a," "); s[$1]=s[$1]; if (a[1]=="PASS") p[$1]++; else f[$1]++} END {for (k in s) printf "   %-60s pass=%d fail=%d\n", k, p[k], f[k]}' "$OUT/compat-results.txt" | sort
