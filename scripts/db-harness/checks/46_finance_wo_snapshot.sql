-- 20261025100000_finance_work_order_snapshot: what a work order looked like
-- in FSM when the portal last acted on it. Runs on 45's data (WL with three
-- lines, two Ready and invoiced in part; WF excluded).
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT harness.expect(
  has_function_privilege('service_role', 'finance.snapshot_work_order(text, jsonb, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'finance.snapshot_work_order(text, jsonb, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'finance.snapshot_work_order(text, jsonb, jsonb)', 'EXECUTE'),
  'only the server may keep a snapshot');

CREATE TEMP TABLE before_snapshot AS
  SELECT (SELECT status FROM finance.work_order_states WHERE fsm_work_order_id = 'WL') AS status,
         (SELECT array_agg(fsm_line_id || ':' || ready || ':' || invoiced_amount ORDER BY fsm_line_id)
            FROM finance.line_states WHERE fsm_work_order_id = 'WL') AS lines,
         (SELECT count(*) FROM finance.line_events) AS events;

-- WL as FSM has it now: Tile went up to 3,500 and a fourth line was added.
SELECT finance.snapshot_work_order('WL',
  '{"number":"WO-L","client":"Driven Properties","quotation":"Q-18092","coordinator":"Sara","status":"In Progress","type":"Reactive","created_at":"2026-10-01T08:00:00Z","sub_total":11500}',
  '[{"id":"LL1","name":"Paint","amount":5000},{"id":"LL2","name":"Tile","amount":3500},{"id":"LL3","name":"Grout","amount":2000},{"id":"LL4","name":"Sealant","amount":1000}]');

SELECT harness.expect(
  (SELECT client_name = 'Driven Properties' AND quotation_number = 'Q-18092' AND coordinator_name = 'Sara'
          AND fsm_status = 'In Progress' AND work_order_type = 'Reactive' AND sub_total = 11500
          AND fsm_created_at = '2026-10-01T08:00:00Z' AND seen_at IS NOT NULL
   FROM finance.work_order_states WHERE fsm_work_order_id = 'WL'),
  'the work order keeps client, quotation, coordinator, FSM status, type, raised at and value');
SELECT harness.expect(
  (SELECT status FROM finance.work_order_states WHERE fsm_work_order_id = 'WL') = coalesce((SELECT status FROM before_snapshot), 'open'),
  'its workflow status is untouched');
SELECT harness.expect(
  (SELECT amount = 3500 FROM finance.line_states WHERE fsm_line_id = 'LL2')
  AND (SELECT NOT ready AND invoiced_amount = 0 AND amount = 1000 AND name = 'Sealant' FROM finance.line_states WHERE fsm_line_id = 'LL4'),
  'every line is kept with its current amount; a new line starts not Ready');
SELECT harness.expect(
  (SELECT array_agg(fsm_line_id || ':' || ready || ':' || invoiced_amount ORDER BY fsm_line_id)
     FROM finance.line_states WHERE fsm_work_order_id = 'WL' AND fsm_line_id <> 'LL4') = (SELECT lines FROM before_snapshot),
  'Ready marks and invoiced amounts are untouched');
SELECT harness.expect((SELECT count(*) FROM finance.line_events) = (SELECT events FROM before_snapshot), 'a snapshot writes no history');

-- A work order nobody had acted on starts Open.
SELECT finance.snapshot_work_order('WS', '{"number":"WO-S","client":"Emaar","sub_total":250}', '[{"id":"LS1","name":"Visit","amount":250}]');
SELECT harness.expect(
  (SELECT status = 'open' AND assignee_id IS NULL AND client_name = 'Emaar' AND quotation_number IS NULL FROM finance.work_order_states WHERE fsm_work_order_id = 'WS'),
  'a new work order starts Open');
SELECT finance.snapshot_work_order('WS', '{"number":"WO-S","client":"Emaar","sub_total":250}', '[]');
SELECT harness.expect((SELECT count(*) = 1 FROM finance.line_states WHERE fsm_work_order_id = 'WS'), 'no lines leaves the lines kept as they are');

SELECT harness.expect_error(
  $q$SELECT finance.snapshot_work_order('WS', '{"number":"WO-S"}', '[{"id":"LL1","name":"Paint","amount":5000}]')$q$,
  '23514', 'a line of another work order is refused');
SELECT harness.expect_error($q$SELECT finance.snapshot_work_order('WS', '{}', '[{"name":"No id","amount":1}]')$q$, '23514', 'a line without its FSM id is refused');
SELECT harness.expect_error($q$SELECT finance.snapshot_work_order('', '{}', '[]')$q$, '23514', 'a work order needs its id');
SELECT harness.expect(
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'finance' AND p.proname = 'snapshot_work_order' AND p.prosrc LIKE '%fsm.%'),
  'the snapshot does not read the FSM copy');

DROP TABLE before_snapshot;
