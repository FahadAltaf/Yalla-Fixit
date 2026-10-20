-- 20261020130000_fsm_read_model: the guarded writers, crews and the lease.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Server-only.
SELECT harness.expect(
  NOT has_schema_privilege('anon', 'fsm', 'USAGE') AND NOT has_schema_privilege('authenticated', 'fsm', 'USAGE')
  AND has_schema_privilege('service_role', 'fsm', 'USAGE'),
  'only the service role may use the fsm schema');
SELECT harness.expect(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'fsm' AND grantee IN ('anon', 'authenticated')),
  'no anon/authenticated grants on fsm tables');
SELECT harness.expect(
  has_table_privilege('service_role', 'fsm.estimates', 'SELECT')
  AND has_table_privilege('service_role', 'fsm.sync_runs', 'INSERT')
  AND has_table_privilege('service_role', 'fsm.sync_runs', 'UPDATE'),
  'the service role can read the copy and log runs');
SELECT harness.expect(
  NOT has_function_privilege('anon', 'fsm.upsert_estimates(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'fsm.sync_claim(text, uuid, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'fsm.sync_line_items(text, timestamptz, jsonb)', 'EXECUTE'),
  'only the service role may call the writers');
SELECT harness.expect((SELECT count(*) = 3 FROM fsm.sync_state), 'three sync resources seeded once');

-- Quotations: insert, replay, out of order, status change.
SELECT harness.expect(
  fsm.upsert_estimates('[{"fsm_estimate_id":"E1","number":"Q-1042","status":"New","grand_total":1000,"modified_time":"2026-10-01T08:00:00Z"}]')
  = '{"written": 1, "skipped": 0, "events": 1}'::jsonb, 'new quotation written with its first status event');
SELECT harness.expect(
  fsm.upsert_estimates('[{"fsm_estimate_id":"E1","number":"Q-1042","status":"New","grand_total":1000,"modified_time":"2026-10-01T08:00:00Z"}]')
  = '{"written": 1, "skipped": 0, "events": 0}'::jsonb, 'a replayed page adds no event');
SELECT harness.expect(
  fsm.upsert_estimates('[{"fsm_estimate_id":"E1","number":"Q-1042","status":"Approved","grand_total":1100,"modified_time":"2026-10-03T08:00:00Z"}]')
  = '{"written": 1, "skipped": 0, "events": 1}'::jsonb, 'a status change appends one event');
SELECT harness.expect(
  fsm.upsert_estimates('[{"fsm_estimate_id":"E1","number":"Q-1042","status":"New","grand_total":1000,"modified_time":"2026-10-02T08:00:00Z"}]')
  = '{"written": 0, "skipped": 1, "events": 0}'::jsonb, 'an older record is skipped');
SELECT harness.expect(
  (SELECT status = 'Approved' AND grand_total = 1100 AND status_changed_at = '2026-10-03T08:00:00Z' AND NOT status_since_estimated
   FROM fsm.estimates WHERE fsm_estimate_id = 'E1'),
  'the newer copy stands, with the time its status changed');
SELECT harness.expect(
  (SELECT string_agg(coalesce(from_status, '-') || '>' || to_status, ',' ORDER BY fsm_modified_time)
   FROM fsm.estimate_status_events WHERE fsm_estimate_id = 'E1') = '->New,New>Approved',
  'history reads New, then Approved');
SELECT harness.expect_error($q$SELECT fsm.upsert_estimates('[{"fsm_estimate_id":"E2","status":"New"}]')$q$,
  'P0001', 'a quotation without Modified_Time is refused');
SELECT fsm.upsert_estimates('[{"fsm_estimate_id":"E3","status":"New","grand_total":99.999,"modified_time":"2026-10-01T08:00:00Z"}]');
SELECT harness.expect((SELECT grand_total FROM fsm.estimates WHERE fsm_estimate_id = 'E3') = 100.00,
  'money is stored to two places');

-- Work orders and lines.
SELECT harness.expect_error($q$SELECT fsm.sync_line_items('W1', now(), '[]')$q$, 'P0001',
  'lines for an unknown work order are refused');
SELECT fsm.upsert_work_orders('[{"fsm_work_order_id":"W1","number":"WO-1","status":"In Progress","fsm_estimate_id":"E1","modified_time":"2026-10-03T09:00:00Z"}]');
SELECT harness.expect(
  fsm.sync_line_items('W1', '2026-10-03T10:00:00Z', '[
    {"fsm_line_id":"L1","name":"Paint","quantity":2,"unit_price":100,"line_amount":200,"amount":200,"status":"In Progress","sequence":1,"modified_time":"2026-10-03T09:00:00Z"},
    {"fsm_line_id":"L2","name":"Tile","quantity":1,"unit_price":300,"line_amount":300,"amount":300,"status":"New","sequence":2,"modified_time":"2026-10-03T09:00:00Z"}]')
  = '{"written": 2, "skipped": 0, "events": 2, "removed": 0, "stale": false}'::jsonb, 'two lines written');
SELECT harness.expect(
  fsm.sync_line_items('W1', '2026-10-04T10:00:00Z', '[
    {"fsm_line_id":"L1","name":"Paint","quantity":2,"unit_price":100,"line_amount":200,"amount":200,"status":"Completed","sequence":1,"modified_time":"2026-10-04T09:05:36Z"}]')
  = '{"written": 1, "skipped": 0, "events": 1, "removed": 1, "stale": false}'::jsonb,
  'a completed line appends an event; a line gone from the work order is marked removed');
SELECT harness.expect(
  (SELECT removed_at = '2026-10-04T10:00:00Z' FROM fsm.line_items WHERE fsm_line_id = 'L2')
  AND (SELECT count(*) = 2 FROM fsm.line_items WHERE fsm_work_order_id = 'W1'),
  'a removed line is kept, with when it went');
SELECT harness.expect((fsm.sync_line_items('W1', '2026-10-03T12:00:00Z', '[]')->>'stale')::boolean,
  'a detail older than the last one applied is reported stale');
SELECT harness.expect((SELECT status = 'Completed' AND removed_at IS NULL FROM fsm.line_items WHERE fsm_line_id = 'L1'),
  'and changes nothing');
SELECT harness.expect(
  (fsm.sync_line_items('W1', '2026-10-05T10:00:00Z', '[
    {"fsm_line_id":"L1","status":"Completed","modified_time":"2026-10-04T09:05:36Z"},
    {"fsm_line_id":"L2","name":"Tile","status":"New","modified_time":"2026-10-03T09:00:00Z"}]')->>'removed')::int = 0,
  'nothing removed when both lines are present');
SELECT harness.expect((SELECT removed_at IS NULL FROM fsm.line_items WHERE fsm_line_id = 'L2'),
  'a line that comes back is no longer removed');
SELECT harness.expect(
  (SELECT count(*) = 1 FROM fsm.line_status_events WHERE fsm_line_id = 'L1' AND to_status = 'Completed'),
  'the completion is recorded once across replays');

-- Appointments and crews.
SELECT fsm.upsert_appointments('[{"fsm_appointment_id":"A1","fsm_work_order_id":"W1","status":"Completed","scheduled_start":"2026-10-04T04:00:00Z","scheduled_end":"2026-10-04T06:00:00Z","actual_start":"2026-10-04T04:10:00Z","actual_end":"2026-10-04T06:05:00Z","lead_technician_fsm_id":"T1","modified_time":"2026-10-04T06:06:00Z"}]');
SELECT harness.expect(
  fsm.set_appointment_crew('A1', '2026-10-04T07:00:00Z', '[{"technician_fsm_id":"T1","is_lead":true},{"technician_fsm_id":"T2"},{"technician_fsm_id":"T2"}]'),
  'the crew is applied');
SELECT harness.expect(
  (SELECT count(*) = 2 FROM fsm.appointment_resources WHERE fsm_appointment_id = 'A1')
  AND (SELECT is_lead FROM fsm.appointment_resources WHERE fsm_appointment_id = 'A1' AND technician_fsm_id = 'T1'),
  'a crew of two, the lead marked, a repeated member counted once');
SELECT harness.expect(NOT fsm.set_appointment_crew('A1', '2026-10-04T06:30:00Z', '[{"technician_fsm_id":"T9"}]'),
  'an older crew read is refused');
SELECT harness.expect((SELECT count(*) = 2 FROM fsm.appointment_resources WHERE fsm_appointment_id = 'A1'),
  'and leaves the crew as it was');
SELECT harness.expect_error(
  $q$SELECT fsm.upsert_appointments('[{"fsm_appointment_id":"A2","actual_start":"2026-10-04T06:00:00Z","actual_end":"2026-10-04T05:00:00Z","modified_time":"2026-10-04T06:06:00Z"}]')$q$,
  '23514', 'an actual end before its start is refused');

-- The lease.
SELECT harness.expect(fsm.sync_claim('estimates', '11111111-1111-4111-8111-111111111111', 600), 'first run claims the resource');
SELECT harness.expect(NOT fsm.sync_claim('estimates', '22222222-2222-4222-8222-222222222222', 600), 'a second run is refused while the first holds it');
SELECT harness.expect(NOT fsm.sync_release('estimates', '22222222-2222-4222-8222-222222222222', true, NULL, '2026-10-09T00:00:00Z'),
  'a run that does not hold the claim cannot release it');
SELECT harness.expect(fsm.sync_release('estimates', '11111111-1111-4111-8111-111111111111', true, NULL, '2026-10-05T00:00:00Z'),
  'the holder releases with its watermark');
SELECT harness.expect(fsm.sync_claim('estimates', '22222222-2222-4222-8222-222222222222', 600)
  AND fsm.sync_release('estimates', '22222222-2222-4222-8222-222222222222', false, 'FSM 503', '2026-10-01T00:00:00Z'),
  'the next run claims after release');
SELECT harness.expect(
  (SELECT watermark = '2026-10-05T00:00:00Z' AND consecutive_failures = 1 AND last_error = 'FSM 503' AND lease_owner IS NULL
   FROM fsm.sync_state WHERE resource = 'estimates'),
  'the watermark never moves back; the failure is counted');
UPDATE fsm.sync_state SET lease_owner = '33333333-3333-4333-8333-333333333333', lease_until = now() - interval '1 second'
WHERE resource = 'work_orders';
SELECT harness.expect(fsm.sync_claim('work_orders', '44444444-4444-4444-8444-444444444444', 600),
  'an expired lease (a crashed run) can be taken over');

SET ROLE anon;
SELECT harness.expect_error($q$SELECT fsm.upsert_estimates('[]')$q$, '42501', 'anon cannot call a writer');
RESET ROLE;
SET ROLE authenticated;
SELECT harness.expect_error($q$SELECT 1 FROM fsm.estimates$q$, '42501', 'authenticated cannot read the read model');
RESET ROLE;

-- The server role, which the sync runs as, can do the whole job through the
-- functions (they run with the caller's rights, so this proves the grants).
SET ROLE service_role;
SELECT harness.expect(fsm.sync_claim('appointments', '55555555-5555-4555-8555-555555555555', 60), 'service role claims');
SELECT harness.expect(
  (fsm.upsert_estimates('[{"fsm_estimate_id":"E9","status":"New","modified_time":"2026-10-09T00:00:00Z"}]')->>'written')::int = 1,
  'service role writes through the functions');
INSERT INTO fsm.sync_runs (resource, kind) VALUES ('appointments', 'incremental');
SELECT harness.expect(fsm.sync_release('appointments', '55555555-5555-4555-8555-555555555555', true, NULL, now()), 'service role logs a run and releases');
RESET ROLE;
