-- 20261024100000_finance_line_ledger: Ready marks, partial invoicing and the
-- Ready-to-invoice workflow per FSM work order. FSM is read live by the
-- server, which passes each line's id, name and amount; nothing here reads
-- schema fsm.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT harness.expect(
  has_table_privilege('service_role', 'finance.line_states', 'SELECT')
  AND NOT has_table_privilege('service_role', 'finance.line_states', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'finance.line_invoices', 'INSERT')
  AND NOT has_table_privilege('service_role', 'finance.work_order_states', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'finance.line_states', 'SELECT'),
  'the server reads the ledger and changes it only through its functions');

-- A work order with three lines as FSM gave them: 5,000, 3,000 and 2,000 before VAT.
\set wl_lines '[{"id":"LL1","name":"Paint","amount":5000},{"id":"LL2","name":"Tile","amount":3000},{"id":"LL3","name":"Grout","amount":2000}]'

-- Ready: one line, then the whole work order; repeating changes nothing.
SELECT harness.expect(finance.set_lines_ready('WL', 'WO-L', '[{"id":"LL1","name":"Paint","amount":5000}]', true, NULL, 'Coordinator') = 1, 'one line marked Ready');
SELECT harness.expect(finance.set_lines_ready('WL', 'WO-L', :'wl_lines', true, NULL, 'Coordinator') = 2, 'the whole work order: only the two not yet Ready change');
SELECT harness.expect(finance.set_lines_ready('WL', 'WO-L', :'wl_lines', true, NULL, 'Coordinator') = 0, 'marking again changes nothing');
SELECT harness.expect(
  (SELECT name = 'Tile' AND amount = 3000 AND work_order_number = 'WO-L' FROM finance.line_states WHERE fsm_line_id = 'LL2'),
  'each line keeps the name and amount FSM gave');
SELECT harness.expect(finance.set_lines_ready('WL', 'WO-L', '[{"id":"LL3","name":"Grout","amount":2000}]', false, NULL, 'Coordinator', 'Not finished') = 1, 'a mark can be taken off');
SELECT harness.expect_error($q$SELECT finance.set_lines_ready('WX', 'WO-X', '[{"id":"LL1","name":"Paint","amount":5000}]', true, NULL, 'x')$q$, '23514', 'a line of another work order is refused');
SELECT harness.expect_error($q$SELECT finance.set_lines_ready('WL', 'WO-L', '[{"name":"No id","amount":1}]', true, NULL, 'x')$q$, '23514', 'a line without its FSM id is refused');

-- Partial: 3,000 of LL1's 5,000 and all of LL2.
SELECT harness.expect(
  finance.record_line_invoice('key-inv-0001', 'MAHER-101', '2026-10-15', 6300,
    '[{"line":"LL1","amount":3000,"work_order":"WL","work_order_number":"WO-L","name":"Paint","line_amount":5000},
      {"line":"LL2","amount":3000,"work_order":"WL","work_order_number":"WO-L","name":"Tile","line_amount":3000}]', NULL, 'Finance') IS NOT NULL,
  'an invoice covering part of one line and all of another is recorded');
SELECT harness.expect(
  (SELECT invoiced_amount = 3000 FROM finance.line_states WHERE fsm_line_id = 'LL1')
  AND (SELECT invoiced_amount = 3000 FROM finance.line_states WHERE fsm_line_id = 'LL2'),
  'LL1 is partly invoiced (3,000 of 5,000); LL2 in full');
SELECT harness.expect(
  finance.record_line_invoice('key-inv-0001', 'MAHER-101', '2026-10-15', 6300,
    '[{"line":"LL1","amount":3000,"work_order":"WL","line_amount":5000}]', NULL, 'Finance')
  = (SELECT id FROM finance.line_invoices WHERE idempotency_key = 'key-inv-0001'),
  'a retried submission returns the first invoice and records nothing new');
SELECT harness.expect((SELECT invoiced_amount = 3000 FROM finance.line_states WHERE fsm_line_id = 'LL1'), 'and LL1 is unchanged');

-- Limits.
SELECT harness.expect_error(
  $q$SELECT finance.record_line_invoice('key-inv-0002', 'MAHER-102', '2026-10-20', 2500, '[{"line":"LL1","amount":2500,"work_order":"WL","line_amount":5000}]', NULL, 'Finance')$q$,
  '23514', 'a line cannot be invoiced beyond its amount (2,000 left, 2,500 asked)');
SELECT harness.expect((SELECT count(*) = 0 FROM finance.line_invoices WHERE idempotency_key = 'key-inv-0002'), 'and a refused invoice leaves nothing behind');
SELECT harness.expect_error(
  $q$SELECT finance.record_line_invoice('key-inv-0005', 'MAHER-105', '2026-10-20', 100, '[{"line":"LL1","amount":100,"work_order":"WZ","line_amount":5000}]', NULL, 'Finance')$q$,
  '23514', 'a line cannot be invoiced as part of another work order');
SELECT harness.expect_error(
  $q$SELECT finance.record_line_invoice('key-inv-0006', 'MAHER-106', '2026-10-20', 100, '[{"line":"LL1","amount":100}]', NULL, 'Finance')$q$,
  '23514', 'a line without its work order and amount is refused');
SELECT harness.expect_error(
  $q$SELECT finance.record_line_invoice('key-inv-0003', ' maher-101 ', '2026-10-20', 100, '[{"line":"LL3","amount":100,"work_order":"WL","line_amount":2000}]', NULL, 'Finance')$q$,
  '23505', 'a MAHER number is recorded once, whatever its case or spacing');

-- The rest of LL1, and invoicing a line that was not Ready marks it.
SELECT harness.expect(
  finance.record_line_invoice('key-inv-0004', 'MAHER-104', '2026-10-25', 4000,
    '[{"line":"LL1","amount":2000,"work_order":"WL","line_amount":5000},{"line":"LL3","amount":2000,"work_order":"WL","line_amount":2000}]', NULL, 'Finance') IS NOT NULL,
  'the rest of LL1 and all of LL3 on a second invoice');
SELECT harness.expect(
  (SELECT invoiced_amount = 5000 FROM finance.line_states WHERE fsm_line_id = 'LL1')
  AND (SELECT ready AND invoiced_amount = 2000 FROM finance.line_states WHERE fsm_line_id = 'LL3'),
  'LL1 now in full; LL3 invoiced and marked Ready by it');
SELECT harness.expect((SELECT count(*) = 4 FROM finance.line_events WHERE event_type = 'invoiced'), 'each allocation is in the history');

-- Append-only.
SELECT harness.expect_error($q$DELETE FROM finance.line_invoices$q$, 'P0001', 'an invoice cannot be deleted');
SELECT harness.expect_error($q$UPDATE finance.line_invoice_allocations SET amount = 1$q$, 'P0001', 'an allocation cannot be changed');
SELECT harness.expect_error($q$DELETE FROM finance.line_events$q$, 'P0001', 'the history cannot be deleted');

-- The Ready-to-invoice workflow on a work order.
SELECT finance.set_lines_ready('WF', 'WO-F', '[{"id":"LF1","name":"Paint","amount":1000}]', true, NULL, 'Coordinator');
SELECT harness.expect(finance.wo_apply_action('WF', 'pick_up', 'open', NULL, 'Finance', NULL, 'WO-F') = 'in_progress', 'a work order is picked up');
SELECT harness.expect(
  (SELECT assignee_label = 'Finance' AND work_order_number = 'WO-F' FROM finance.work_order_states WHERE fsm_work_order_id = 'WF'),
  'by the person, with the work order number kept');
SELECT harness.expect_error($q$SELECT finance.wo_apply_action('WF', 'pick_up', 'open', NULL, 'Finance')$q$, '40001', 'a stale screen is refused');
SELECT harness.expect(finance.wo_apply_action('WF', 'put_on_hold', 'in_progress', NULL, 'Finance', 'Client dispute') = 'on_hold', 'put on hold with a reason');
SELECT harness.expect(finance.wo_apply_action('WF', 'raise_query', 'on_hold', NULL, 'Finance', 'Which lines?') = 'query_raised', 'a query from on hold');
SELECT harness.expect(finance.wo_apply_action('WF', 'answer_query', 'query_raised', NULL, 'Coordinator', 'Lines 1') = 'on_hold', 'answering returns it to on hold');
SELECT harness.expect((SELECT hold_reason = 'Client dispute' FROM finance.work_order_states WHERE fsm_work_order_id = 'WF'), 'with the hold reason kept');
SELECT harness.expect(finance.wo_apply_action('WF', 'resume', 'on_hold', NULL, 'Finance') = 'in_progress', 'resumed');
SELECT harness.expect_error($q$SELECT finance.wo_apply_action('WF', 'put_on_hold', 'in_progress', NULL, 'Finance')$q$, '23514', 'a hold needs a reason');

-- Not to be invoiced: requested, invoicing refused while it waits, rejected, then verified.
SELECT harness.expect(finance.request_wo_exclusion('WF', 'AMC PPM visit', NULL, '{}', NULL, 'Coordinator', 'WO-F') IS NOT NULL, 'a work order is marked not to be invoiced');
SELECT harness.expect_error(
  $q$SELECT finance.record_line_invoice('key-inv-0101', 'MAHER-201', '2026-10-20', 1000, '[{"line":"LF1","amount":1000,"work_order":"WF","line_amount":1000}]', NULL, 'Finance')$q$,
  '23514', 'it cannot be invoiced while the request waits');
SELECT harness.expect_error($q$SELECT finance.request_wo_exclusion('WF', 'Again', NULL, '{}', NULL, 'x')$q$, '23514', 'one open request at a time');
SELECT harness.expect_error(
  $q$SELECT finance.decide_wo_exclusion((SELECT id FROM finance.wo_exclusions WHERE fsm_work_order_id = 'WF' AND decision IS NULL), 'rejected', NULL, NULL, 'Behrouz')$q$,
  '23514', 'a rejection needs a note');
SELECT harness.expect(
  finance.decide_wo_exclusion((SELECT id FROM finance.wo_exclusions WHERE fsm_work_order_id = 'WF' AND decision IS NULL), 'rejected', 'It is chargeable', NULL, 'Behrouz') = 'in_progress',
  'rejected: the work order stays where it was');
SELECT finance.request_wo_exclusion('WF', 'AMC PPM visit', NULL, '{}', NULL, 'Coordinator');
SELECT harness.expect(
  finance.decide_wo_exclusion((SELECT id FROM finance.wo_exclusions WHERE fsm_work_order_id = 'WF' AND decision IS NULL), 'verified', NULL, NULL, 'Behrouz') = 'excluded',
  'verified: the work order is Excluded');
SELECT harness.expect_error(
  $q$SELECT finance.record_line_invoice('key-inv-0102', 'MAHER-202', '2026-10-20', 1000, '[{"line":"LF1","amount":1000,"work_order":"WF","line_amount":1000}]', NULL, 'Finance')$q$,
  '23514', 'an excluded work order cannot be invoiced');
SELECT harness.expect_error($q$SELECT finance.wo_apply_action('WF', 'pick_up', 'excluded', NULL, 'Finance')$q$, '23514', 'an excluded work order takes no workflow action');
SELECT harness.expect(
  (SELECT count(*) = 10 FROM finance.line_events WHERE fsm_work_order_id = 'WF'),
  'every step is in the history (1 ready mark, 5 workflow, 4 exclusion; refused ones leave nothing)');
SELECT harness.expect_error($q$SELECT finance.request_wo_exclusion('WL', 'Late', NULL, '{}', NULL, 'x')$q$, '23514', 'work already invoiced cannot be excluded');
SELECT harness.expect(
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'finance'
                AND p.proname IN ('set_lines_ready', 'record_line_invoice', 'wo_apply_action', 'request_wo_exclusion', 'decide_wo_exclusion')
                AND p.prosrc LIKE '%fsm.%'),
  'none of the ledger functions reads the FSM copy');
