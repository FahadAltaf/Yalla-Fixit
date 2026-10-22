-- 20261023100000_hr_compliance: waivers, outage batches, finalised months.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Server-only, and written only through the two functions.
SELECT harness.expect(
  NOT has_schema_privilege('anon', 'hr', 'USAGE') AND NOT has_schema_privilege('authenticated', 'hr', 'USAGE')
  AND has_schema_privilege('service_role', 'hr', 'USAGE')
  AND has_table_privilege('service_role', 'hr.waivers', 'SELECT')
  AND NOT has_table_privilege('service_role', 'hr.waivers', 'INSERT')
  AND NOT has_table_privilege('service_role', 'hr.compliance_statements', 'INSERT'),
  'the server role reads hr tables and writes none directly');

-- One waiver (TC13), retried: one row.
SELECT harness.expect(
  hr.record_waivers('[{"key":"T1|appointment_check_in|A1","technician":"T1","kind":"appointment_check_in","month":"2026-01","due_at":"2026-01-05T05:00:00Z"}]',
                    'No network', 'Basement, no signal', NULL, 'Coordinator') = 1,
  'a miss is waived with a reason');
SELECT harness.expect(
  hr.record_waivers('[{"key":"T1|appointment_check_in|A1","technician":"T1","kind":"appointment_check_in","month":"2026-01","due_at":"2026-01-05T05:00:00Z"}]',
                    'No network', NULL, NULL, 'Coordinator') = 0,
  'a retried waiver changes nothing');
SELECT harness.expect((SELECT count(*) = 1 FROM hr.waivers), 'one waiver row');
SELECT harness.expect_error(
  $q$SELECT hr.record_waivers('[{"key":"T1|shift_check_in|2026-01-06","technician":"T1","kind":"shift_check_in","month":"2026-01"}]', 'Overslept', NULL, NULL, 'x')$q$,
  '23514', 'a reason outside B4''s list is refused');

-- A confirmed outage for everyone, in one action.
SELECT harness.expect(
  hr.record_waivers(
    '[{"key":"T1|shift_check_in|2026-01-07","technician":"T1","kind":"shift_check_in","month":"2026-01","due_at":"2026-01-07T04:00:00Z"},
      {"key":"T2|shift_check_in|2026-01-07","technician":"T2","kind":"shift_check_in","month":"2026-01","due_at":"2026-01-07T04:00:00Z"}]',
    'App outage', 'FSM app down 08:00-09:30', NULL, 'Supervisor',
    '{"from":"2026-01-07T04:00:00Z","to":"2026-01-07T05:30:00Z","kinds":["shift_check_in"]}') = 2,
  'an outage waives every technician''s miss in one action');
SELECT harness.expect(
  (SELECT count(*) = 2 FROM hr.waivers w JOIN hr.waiver_batches b ON b.id = w.batch_id WHERE b.event_count = 2 AND b.kinds = '{shift_check_in}'),
  'both waivers belong to the batch, which records its window and kinds');

-- Append-only.
SELECT harness.expect_error($q$DELETE FROM hr.waivers$q$, 'P0001', 'a waiver cannot be deleted');
SELECT harness.expect_error($q$UPDATE hr.waiver_batches SET note = 'x'$q$, 'P0001', 'a batch cannot be edited');

-- Finalising: not before the cut-off, once only, frozen afterwards.
SELECT harness.expect_error(
  $q$SELECT hr.finalize_month('2026-01', ((now() AT TIME ZONE 'Asia/Dubai')::date + 1), '[]', '{}', NULL, 'HR')$q$,
  '23514', 'a month cannot be finalised while disputes are open');
SELECT harness.expect(
  hr.finalize_month('2026-01', '2026-02-25',
    '[{"technician":"T1","name":"Tech One","required":199,"performed":193,"missed":6,"waived":1,"compliance_percent":96.984925,"below_threshold":true,"penalty_before_cap":300,"penalty_payable":300}]',
    '{"thresholdPercent":97,"penaltyPerMissAed":50,"monthlyCapAed":500}', NULL, 'HR') = 1,
  'January is finalised with TC13''s figures and the settings used');
SELECT harness.expect(
  (SELECT compliance_percent < 97 AND penalty_payable = 300 FROM hr.compliance_statements WHERE month = '2026-01' AND technician_fsm_id = 'T1'),
  'the statement keeps the unrounded 96.98 % and AED 300');
SELECT harness.expect_error(
  $q$SELECT hr.finalize_month('2026-01', '2026-02-25', '[]', '{}', NULL, 'HR')$q$, '23505', 'a month is finalised once');
SELECT harness.expect_error(
  $q$SELECT hr.record_waivers('[{"key":"T1|shift_check_out|2026-01-08","technician":"T1","kind":"shift_check_out","month":"2026-01"}]', 'Device failure', NULL, NULL, 'x')$q$,
  '23514', 'no waiver once the month is final');
SELECT harness.expect_error($q$UPDATE hr.compliance_statements SET penalty_payable = 0$q$, 'P0001', 'a finalised statement cannot be changed');
SELECT harness.expect_error(
  $q$INSERT INTO hr.compliance_statements (month, technician_fsm_id, required, performed, missed, waived) VALUES ('2026-01', 'T9', 10, 5, 4, 0)$q$,
  '23514', 'required always equals performed plus missed');
