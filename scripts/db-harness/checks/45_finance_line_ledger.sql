-- 20261024100000_finance_line_ledger: Ready marks and partial invoicing per line.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT harness.expect(
  has_table_privilege('service_role', 'finance.line_states', 'SELECT')
  AND NOT has_table_privilege('service_role', 'finance.line_states', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'finance.line_invoices', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'finance.line_states', 'SELECT'),
  'the server reads the ledger and changes it only through its functions');

-- A work order with three lines: 5,000, 3,000 and 2,000 before VAT.
SELECT fsm.upsert_work_orders('[{"fsm_work_order_id":"WL","number":"WO-L","status":"In Progress","modified_time":"2026-10-01T08:00:00Z"}]');
SELECT fsm.sync_line_items('WL', '2026-10-01T09:00:00Z',
  '[{"fsm_line_id":"LL1","name":"Paint","amount":5000,"line_amount":5250,"status":"Completed","sequence":1,"modified_time":"2026-10-01T08:00:00Z"},
    {"fsm_line_id":"LL2","name":"Tile","amount":3000,"line_amount":3150,"status":"Completed","sequence":2,"modified_time":"2026-10-01T08:00:00Z"},
    {"fsm_line_id":"LL3","name":"Grout","amount":2000,"line_amount":2100,"status":"In Progress","sequence":3,"modified_time":"2026-10-01T08:00:00Z"}]');

-- Ready: one line, then the whole work order; repeating changes nothing.
SELECT harness.expect(finance.set_lines_ready('WL', ARRAY['LL1'], true, NULL, 'Coordinator') = 1, 'one line marked Ready');
SELECT harness.expect(finance.set_lines_ready('WL', ARRAY['LL1','LL2','LL3'], true, NULL, 'Coordinator') = 2, 'the whole work order: only the two not yet Ready change');
SELECT harness.expect(finance.set_lines_ready('WL', ARRAY['LL1','LL2','LL3'], true, NULL, 'Coordinator') = 0, 'marking again changes nothing');
SELECT harness.expect(finance.set_lines_ready('WL', ARRAY['LL3'], false, NULL, 'Coordinator', 'Not finished') = 1, 'a mark can be taken off');
SELECT harness.expect_error($q$SELECT finance.set_lines_ready('WL', ARRAY['NOPE'], true, NULL, 'x')$q$, '23514', 'a line not on the work order is refused');

-- Partial: 3,000 of LL1's 5,000 and all of LL2.
SELECT harness.expect(
  finance.record_line_invoice('key-inv-0001', 'MAHER-101', '2026-10-15', 6300,
    '[{"line":"LL1","amount":3000},{"line":"LL2","amount":3000}]', NULL, 'Finance') IS NOT NULL,
  'an invoice covering part of one line and all of another is recorded');
SELECT harness.expect(
  (SELECT invoiced_amount = 3000 FROM finance.line_states WHERE fsm_line_id = 'LL1')
  AND (SELECT invoiced_amount = 3000 FROM finance.line_states WHERE fsm_line_id = 'LL2'),
  'LL1 is partly invoiced (3,000 of 5,000); LL2 in full');
SELECT harness.expect(
  finance.record_line_invoice('key-inv-0001', 'MAHER-101', '2026-10-15', 6300, '[{"line":"LL1","amount":3000}]', NULL, 'Finance')
  = (SELECT id FROM finance.line_invoices WHERE idempotency_key = 'key-inv-0001'),
  'a retried submission returns the first invoice and records nothing new');
SELECT harness.expect((SELECT invoiced_amount = 3000 FROM finance.line_states WHERE fsm_line_id = 'LL1'), 'and LL1 is unchanged');

-- Limits.
SELECT harness.expect_error(
  $q$SELECT finance.record_line_invoice('key-inv-0002', 'MAHER-102', '2026-10-20', 2500, '[{"line":"LL1","amount":2500}]', NULL, 'Finance')$q$,
  '23514', 'a line cannot be invoiced beyond its amount (2,000 left, 2,500 asked)');
SELECT harness.expect(
  (SELECT count(*) = 0 FROM finance.line_invoices WHERE idempotency_key = 'key-inv-0002'),
  'and a refused invoice leaves nothing behind');
SELECT harness.expect_error(
  $q$SELECT finance.record_line_invoice('key-inv-0003', ' maher-101 ', '2026-10-20', 100, '[{"line":"LL3","amount":100}]', NULL, 'Finance')$q$,
  '23505', 'a MAHER number is recorded once, whatever its case or spacing');

-- The rest of LL1, and invoicing a line that was not Ready marks it.
SELECT harness.expect(
  finance.record_line_invoice('key-inv-0004', 'MAHER-104', '2026-10-25', 4000,
    '[{"line":"LL1","amount":2000},{"line":"LL3","amount":2000}]', NULL, 'Finance') IS NOT NULL,
  'the rest of LL1 and all of LL3 on a second invoice');
SELECT harness.expect(
  (SELECT invoiced_amount = 5000 FROM finance.line_states WHERE fsm_line_id = 'LL1')
  AND (SELECT ready AND invoiced_amount = 2000 FROM finance.line_states WHERE fsm_line_id = 'LL3'),
  'LL1 now in full; LL3 invoiced and marked Ready by it');
SELECT harness.expect(
  (SELECT count(*) = 4 FROM finance.line_events WHERE event_type = 'invoiced'),
  'each allocation is in the history');

-- Append-only.
SELECT harness.expect_error($q$DELETE FROM finance.line_invoices$q$, 'P0001', 'an invoice cannot be deleted');
SELECT harness.expect_error($q$UPDATE finance.line_invoice_allocations SET amount = 1$q$, 'P0001', 'an allocation cannot be changed');
SELECT harness.expect_error($q$DELETE FROM finance.line_events$q$, 'P0001', 'the history cannot be deleted');
