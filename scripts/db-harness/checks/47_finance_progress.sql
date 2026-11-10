-- 20261026100000_finance_progress: Operations records "X % done" against a
-- work order or a line, to invoice or for revenue only. Runs on 45 and 46's
-- data (WL: LL1 5,000 and LL3 2,000 invoiced in full, LL2 3,500 with 3,000
-- invoiced, LL4 1,000 with nothing invoiced; WF excluded).
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT harness.expect(
  has_function_privilege('service_role', 'finance.record_progress(text, text, jsonb, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'finance.record_progress(text, text, jsonb, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'finance.record_progress(text, text, jsonb, uuid, text, text)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'finance.progress_entries', 'SELECT'),
  'only the server may record or read progress');

CREATE TEMP TABLE before_progress AS
  SELECT (SELECT count(*) FROM finance.line_invoices) AS invoices,
         (SELECT array_agg(fsm_line_id || ':' || ready || ':' || invoiced_amount ORDER BY fsm_line_id)
            FROM finance.line_states WHERE fsm_work_order_id = 'WL') AS lines;

SELECT harness.expect(finance.record_progress('WL', 'WO-L',
  '[{"line":"LL4","name":"Sealant","percent":60,"purpose":"invoice","value":1000},
    {"line":"LL2","name":"Tile","percent":90,"purpose":"revenue_only","value":3500}]', NULL, 'Coordinator', 'Half the floor') = 2,
  'two lines recorded, one to invoice and one for revenue only');
SELECT harness.expect(finance.record_progress('WL', 'WO-L', '[{"line":null,"name":null,"percent":25,"purpose":"revenue_only","value":11500}]', NULL, 'Coordinator') = 1,
  'the whole work order can be recorded too');
SELECT harness.expect(
  (SELECT count(*) = 3 FROM finance.progress_entries WHERE fsm_work_order_id = 'WL')
  AND (SELECT percent = 60 AND purpose = 'invoice' AND value_before_vat = 1000 AND note = 'Half the floor'
         FROM finance.progress_entries WHERE fsm_line_id = 'LL4')
  AND (SELECT fsm_line_id IS NULL FROM finance.progress_entries WHERE percent = 25),
  'each entry keeps its line, percent, purpose, value and note');
SELECT harness.expect(
  (SELECT count(*) = 3 FROM finance.line_events WHERE event_type = 'progress_recorded' AND fsm_work_order_id = 'WL')
  AND (SELECT amount = 600 AND to_status = 'invoice' AND note = '60.00% done, to invoice. Half the floor'
         FROM finance.line_events WHERE event_type = 'progress_recorded' AND fsm_line_id = 'LL4'),
  'each entry is in the history with its value');
SELECT harness.expect(
  (SELECT count(*) FROM finance.line_invoices) = (SELECT invoices FROM before_progress)
  AND (SELECT array_agg(fsm_line_id || ':' || ready || ':' || invoiced_amount ORDER BY fsm_line_id)
         FROM finance.line_states WHERE fsm_work_order_id = 'WL') = (SELECT lines FROM before_progress),
  'recording progress invoices nothing and changes no line');

SELECT harness.expect_error(
  $q$SELECT finance.record_progress('WL', 'WO-L', '[{"line":"LL2","name":"Tile","percent":50,"purpose":"invoice","value":3500}]', NULL, 'x')$q$,
  '23514', 'a line cannot be put below what is already invoiced (3,000 of 3,500)');
SELECT harness.expect(finance.record_progress('WL', 'WO-L', '[{"line":"LL1","name":"Paint","percent":100,"purpose":"invoice","value":5000}]', NULL, 'x') = 1,
  'exactly what is invoiced is allowed');
SELECT harness.expect_error(
  $q$SELECT finance.record_progress('WL', 'WO-L', '[{"line":"LL4","percent":101,"purpose":"invoice","value":1000}]', NULL, 'x')$q$,
  '23514', 'more than 100 % is refused');
SELECT harness.expect_error(
  $q$SELECT finance.record_progress('WL', 'WO-L', '[{"line":"LL4","percent":10,"purpose":"bill","value":1000}]', NULL, 'x')$q$,
  '23514', 'an unknown purpose is refused');
SELECT harness.expect_error($q$SELECT finance.record_progress('WL', 'WO-L', '[]', NULL, 'x')$q$, '23514', 'no lines is refused');
SELECT harness.expect_error(
  $q$SELECT finance.record_progress('WS', 'WO-S', '[{"line":"LL4","percent":10,"purpose":"invoice","value":1000}]', NULL, 'x')$q$,
  '23514', 'a line of another work order is refused');
SELECT harness.expect_error(
  $q$SELECT finance.record_progress('WF', 'WO-F', '[{"line":null,"percent":10,"purpose":"invoice","value":100}]', NULL, 'x')$q$,
  '23514', 'an excluded work order is refused');

SELECT harness.expect_error($q$UPDATE finance.progress_entries SET percent = 1$q$, 'P0001', 'an entry cannot be changed');
SELECT harness.expect_error($q$DELETE FROM finance.progress_entries$q$, 'P0001', 'an entry cannot be deleted');
SELECT harness.expect(
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'finance' AND p.proname = 'record_progress' AND p.prosrc LIKE '%fsm.%'),
  'recording progress does not read the FSM copy');

DROP TABLE before_progress;
