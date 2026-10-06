#!/usr/bin/env bash
# Two real sessions racing on the same rows. Session A takes its locks and
# sleeps 2 s before committing; session B starts 0.5 s later. Pass = the
# database outcome is the one a single serial order would give.
set -uo pipefail
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/15/bin}"
PORT="$1"
Q() { "$PGBIN/psql.exe" -X -q -t -A -h 127.0.0.1 -p "$PORT" -U postgres -d amc_scale "$@"; }
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "   PASS $1 ($2)"; ok=$((ok+1)); else echo "   FAIL $1: got '$2' expected '$3'"; bad=$((bad+1)); fi; }

# Fixture: a contract with a 1-visit allowance.
Q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
SET ROLE service_role;
INSERT INTO public.amc_submissions (id, owner_id, status, signed_by_name, signed_at) VALUES
 ('c0c00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'signed', 'C', now()),
 ('c0c00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'signed', 'C', now()),
 ('c0c00000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'signed', 'C', now());
SELECT public.amc_activate_contract(
  '{"id":"c0c10000-0000-0000-0000-000000000001","submission_id":"c0c00000-0000-0000-0000-000000000001","proposal_number":"R","customer":{},"property":{},"start_date":"2026-01-01","end_date":"2027-01-01","subtotal":1,"final_price":1,"vat_amount":0,"grand_total":1,"signed_at":"2026-01-01","signed_by_name":"C"}',
  '[{"id":"c0c20000-0000-0000-0000-000000000001","service_id":"ac","service_label":"AC","entitlement_type":"visits","units":1,"frequency":1,"included_quantity":1,"contracted_price":0}]');
SELECT public.amc_activate_contract(
  '{"id":"c0c10000-0000-0000-0000-000000000003","submission_id":"c0c00000-0000-0000-0000-000000000003","proposal_number":"R3","customer":{},"property":{},"start_date":"2026-01-01","end_date":"2027-01-01","subtotal":1,"final_price":1,"vat_amount":0,"grand_total":1,"signed_at":"2026-01-01","signed_by_name":"C"}',
  '[{"id":"c0c20000-0000-0000-0000-000000000003","service_id":"ac","service_label":"AC","entitlement_type":"visits","units":1,"frequency":1,"included_quantity":5,"contracted_price":0}]');
SQL
CID=$(Q -c "SELECT id FROM public.amc_contracts WHERE submission_id = 'c0c00000-0000-0000-0000-000000000001'")
EID=$(Q -c "SELECT id FROM public.amc_contract_entitlements WHERE contract_id = '$CID'")
CID3=$(Q -c "SELECT id FROM public.amc_contracts WHERE submission_id = 'c0c00000-0000-0000-0000-000000000003'")
EID3=$(Q -c "SELECT id FROM public.amc_contract_entitlements WHERE contract_id = '$CID3'")

# C1. Two consumptions of the last remaining visit.
Q -c "SET ROLE service_role; BEGIN; INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at) VALUES ('$CID', '$EID', 'consumption', 1, now()); SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
sleep 0.5
Q -c "SET ROLE service_role; INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at) VALUES ('$CID', '$EID', 'consumption', 1, now());" >/dev/null 2>&1
wait
check "C1 last visit consumed once" "$(Q -c "SELECT count(*) || '/' || (SELECT used_quantity FROM public.amc_contract_entitlements WHERE id = '$EID') FROM public.amc_entitlement_usage WHERE entitlement_id = '$EID'")" "1/1.00"

# C2. Two activations of the same signed proposal.
ACT="SET ROLE service_role; SELECT public.amc_activate_contract('{\"submission_id\":\"c0c00000-0000-0000-0000-000000000002\",\"proposal_number\":\"R2\",\"customer\":{},\"property\":{},\"start_date\":\"2026-01-01\",\"end_date\":\"2027-01-01\",\"subtotal\":1,\"final_price\":1,\"vat_amount\":0,\"grand_total\":1,\"signed_at\":\"2026-01-01\",\"signed_by_name\":\"C\"}', '[{\"service_id\":\"ac\",\"service_label\":\"AC\",\"entitlement_type\":\"visits\",\"units\":1,\"frequency\":1,\"included_quantity\":2,\"contracted_price\":0}]')"
Q -c "BEGIN; $ACT; SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
sleep 0.5
Q -c "$ACT" >/dev/null 2>&1
wait
check "C2 one contract per proposal, with its services" "$(Q -c "SELECT count(DISTINCT c.id) || '/' || count(e.id) FROM public.amc_contracts c LEFT JOIN public.amc_contract_entitlements e ON e.contract_id = c.id WHERE c.submission_id = 'c0c00000-0000-0000-0000-000000000002'")" "1/1"

# C3. Two corrections that together would take back more than recorded.
UID1=$(Q -c "SET ROLE service_role; INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at) VALUES ('$CID3', '$EID3', 'consumption', 1, now()) RETURNING id" | tail -1)
CORR="SET ROLE service_role; INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, notes, corrects_usage_id) VALUES ('$CID3', '$EID3', 'correction', -1, now(), 'wrong', '$UID1')"
Q -c "BEGIN; $CORR; SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
sleep 0.5
Q -c "$CORR" >/dev/null 2>&1
wait
check "C3 corrections never exceed the entry" "$(Q -c "SELECT count(*) || '/' || (SELECT used_quantity FROM public.amc_contract_entitlements WHERE id = '$EID3') FROM public.amc_entitlement_usage WHERE corrects_usage_id = '$UID1'")" "1/0.00"

# C4. Cancellation racing a consumption: the consumption waits, then is refused.
Q -c "SET ROLE service_role; BEGIN; UPDATE public.amc_contracts SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'race' WHERE id = '$CID3'; SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
sleep 0.5
Q -c "SET ROLE service_role; INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at) VALUES ('$CID3', '$EID3', 'consumption', 1, now());" >/dev/null 2>&1
wait
check "C4 no consumption on a contract cancelled meanwhile" "$(Q -c "SELECT count(*) FROM public.amc_entitlement_usage WHERE entitlement_id = '$EID3' AND kind = 'consumption'")" "1"

# C5. Same FSM appointment logged twice at once: one row (the app retries as an update on 23505).
LOG="SET ROLE service_role; INSERT INTO public.amc_fsm_sync_events (fsm_appointment_id, action, status, attempts) VALUES ('RACE-1', 'consume', 'pending', 1)"
Q -c "BEGIN; $LOG; SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
sleep 0.5
ERR=$(Q -c "$LOG" 2>&1 >/dev/null | grep -o "duplicate key" | head -1)
wait
check "C5 one sync row per appointment+action, loser sees 23505" "$(Q -c "SELECT count(*) FROM public.amc_fsm_sync_events WHERE fsm_appointment_id = 'RACE-1'")/$ERR" "1/duplicate key"

# C6. Two renewal proposals for the same contract.
REN="SET ROLE service_role; INSERT INTO public.amc_submissions (owner_id, status, renewal_of_contract_id) VALUES ('00000000-0000-0000-0000-000000000001', 'draft', '$CID')"
Q -c "BEGIN; $REN; SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
sleep 0.5
Q -c "$REN" >/dev/null 2>&1
wait
check "C6 one renewal proposal per contract" "$(Q -c "SELECT count(*) FROM public.amc_submissions WHERE renewal_of_contract_id = '$CID'")" "1"

# C7. The same reminder created twice at once.
REM="SET ROLE service_role; INSERT INTO public.amc_renewal_reminders (contract_id, threshold_days, remind_on) VALUES ('$CID', 30, current_date)"
Q -c "BEGIN; $REM; SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
sleep 0.5
Q -c "$REM" >/dev/null 2>&1
wait
check "C7 one reminder per contract and threshold" "$(Q -c "SELECT count(*) FROM public.amc_renewal_reminders WHERE contract_id = '$CID'")" "1"

echo "   concurrency: $ok passed, $bad failed"
[ "$bad" -eq 0 ]
