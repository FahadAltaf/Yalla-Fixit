-- 20261021100000_finance_core: the queue, invoices, exclusions and progress.
-- Built on the BRD's worked example Q-1042 (§5.1 Step 2): AED 60,000,
-- 12 lines of 5,000, invoiced as lines 1-5, 6-9 and 10-12.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Access: the server reads, and changes only through the functions.
SELECT harness.expect(
  NOT has_schema_privilege('anon', 'finance', 'USAGE') AND NOT has_schema_privilege('authenticated', 'finance', 'USAGE')
  AND has_schema_privilege('service_role', 'finance', 'USAGE')
  AND has_table_privilege('service_role', 'finance.queue_items', 'SELECT')
  AND NOT has_table_privilege('service_role', 'finance.queue_items', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'finance.invoices', 'INSERT'),
  'the server role reads finance tables and writes none directly');

-- The FSM side of Q-1042.
SELECT fsm.upsert_estimates('[{"fsm_estimate_id":"EQ","number":"Q-1042","status":"Converted to Work Order","sub_total":60000,"grand_total":63000,"modified_time":"2026-09-01T08:00:00Z"}]');
SELECT fsm.upsert_work_orders('[{"fsm_work_order_id":"WQ","number":"WO-1042","status":"In Progress","fsm_estimate_id":"EQ","modified_time":"2026-09-01T08:00:00Z"}]');
SELECT fsm.sync_line_items('WQ', '2026-09-30T18:00:00Z', (
  SELECT jsonb_agg(jsonb_build_object(
    'fsm_line_id', 'LQ' || n, 'name', 'Line ' || n, 'quantity', 1, 'unit_price', 5000,
    'line_amount', 5000, 'amount', 5000, 'sequence', n,
    'status', CASE WHEN n <= 5 THEN 'Completed' ELSE 'In Progress' END,
    'modified_time', '2026-09-30T17:00:00Z'))
  FROM generate_series(1, 12) AS n));

-- Month 1 (TC03): lines 1-5.
SELECT harness.expect(
  finance.create_queue_item('wq-m1', 'WQ', ARRAY['LQ1','LQ2','LQ3','LQ4','LQ5']) IS NOT NULL, 'month 1 item made from lines 1-5');
SELECT harness.expect(
  (SELECT value = 25000 AND line_count = 5 AND status = 'pending' AND quotation_total = 60000
   FROM finance.queue_items WHERE trigger_key = 'wq-m1'),
  'it shows 5 lines worth AED 25,000, pending, against a 60,000 quotation');
SELECT harness.expect(
  finance.create_queue_item('wq-m1', 'WQ', ARRAY['LQ1','LQ2','LQ3','LQ4','LQ5'])
  = (SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'),
  'a replayed trigger returns the same item');
SELECT harness.expect((SELECT count(*) = 1 FROM finance.queue_items), 'and makes no second one');
SELECT harness.expect_error($q$SELECT finance.create_queue_item('wq-dup', 'WQ', ARRAY['LQ5'])$q$, '23514',
  'a line already in an item cannot be queued again');
SELECT harness.expect_error($q$SELECT finance.create_queue_item('wq-early', 'WQ', ARRAY['LQ6'])$q$, '23514',
  'a line not yet completed cannot be queued');
SELECT harness.expect_error($q$SELECT finance.create_queue_item('wq-twice', 'WQ', ARRAY['LQ6','LQ6'])$q$, '23514',
  'a line listed twice is refused');

-- Finance works it (Step 4), then invoices it (Step 7).
SELECT harness.expect(
  finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'), 'pick_up', 'pending',
                       '00000000-0000-0000-0000-000000000002', 'Finance One') = 'in_progress',
  'Finance picks it up');
SELECT harness.expect_error($q$SELECT finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'),
  'pick_up', 'pending', '00000000-0000-0000-0000-000000000001', 'Finance Two')$q$, '40001',
  'a second person acting on what they saw as pending is refused');
SELECT harness.expect_error($q$SELECT finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'),
  'put_on_hold', 'in_progress', NULL, 'Finance One', '  ')$q$, '23514', 'on hold needs a reason');
SELECT harness.expect_error($q$SELECT finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'),
  'resume', 'in_progress', NULL, 'Finance One')$q$, '23514', 'only an item on hold can be resumed');
SELECT harness.expect(
  finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'), 'raise_query', 'in_progress',
                       NULL, 'Finance One', 'Which PO number?') = 'query_raised'
  AND finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'), 'answer_query', 'query_raised',
                       NULL, 'Coordinator', 'PO-77') = 'in_progress',
  'a query goes to the coordinator and the answer returns it to In Progress');
SELECT harness.expect_error($q$SELECT finance.record_invoice((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'),
  'key-m1-aaaa', 'MAH-1', '2026-10-01', 24000, NULL, NULL, 'Finance One')$q$, '23514',
  'an amount different from the queue value needs a reason (TC06)');
SELECT harness.expect(
  finance.record_invoice((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'),
    'key-m1-bbbb', 'MAH-1', '2026-10-01', 25000, NULL, '00000000-0000-0000-0000-000000000002', 'Finance One') IS NOT NULL,
  'invoice recorded at the queue value');
SELECT harness.expect(
  finance.record_invoice((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'),
    'key-m1-bbbb', 'MAH-1', '2026-10-01', 25000, NULL, NULL, 'Finance One')
  = (SELECT id FROM finance.invoices WHERE idempotency_key = 'key-m1-bbbb'),
  'a retried submission returns the same invoice');
SELECT harness.expect_error($q$SELECT finance.record_invoice((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'),
  'key-m1-cccc', 'MAH-9', '2026-10-01', 25000, NULL, NULL, 'Finance Two')$q$, '40001',
  'a second, different invoice on the same item is refused');
SELECT harness.expect(
  (SELECT completion_percent = 41.7 AND invoiced_value = 25000 AND remaining_value = 35000
   FROM finance.estimate_progress WHERE fsm_estimate_id = 'EQ'),
  'Q-1042 after month 1: 25,000 invoiced, 41.7 %, 35,000 remaining');

-- Month 2 (TC04): lines 6-9 complete; the new item shows only those.
SELECT fsm.sync_line_items('WQ', '2026-10-31T18:00:00Z', (
  SELECT jsonb_agg(jsonb_build_object(
    'fsm_line_id', 'LQ' || n, 'name', 'Line ' || n, 'quantity', 1, 'unit_price', 5000,
    'line_amount', 5000, 'amount', 5000, 'sequence', n,
    'status', CASE WHEN n <= 9 THEN 'Completed' ELSE 'In Progress' END,
    'modified_time', CASE WHEN n BETWEEN 6 AND 9 THEN '2026-10-31T17:00:00Z' ELSE '2026-09-30T17:00:00Z' END))
  FROM generate_series(1, 12) AS n));
SELECT harness.expect_error($q$SELECT finance.create_queue_item('wq-m2-bad', 'WQ', ARRAY['LQ1','LQ6','LQ7','LQ8','LQ9'])$q$, '23514',
  'an invoiced line is never presented again');
SELECT finance.create_queue_item('wq-m2', 'WQ', ARRAY['LQ6','LQ7','LQ8','LQ9']);
SELECT harness.expect(
  (SELECT value = 20000 AND line_count = 4 FROM finance.queue_items WHERE trigger_key = 'wq-m2'),
  'month 2 item: lines 6-9 only, 20,000');
SELECT finance.record_invoice((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m2'),
  'key-m2-aaaa', 'MAH-2', '2026-11-01', 20000, NULL, NULL, 'Finance One');
SELECT harness.expect(
  (SELECT completion_percent = 75.0 AND invoiced_value = 45000 FROM finance.estimate_progress WHERE fsm_estimate_id = 'EQ'),
  'Q-1042 after month 2: 45,000 cumulative, 75.0 %');

-- Month 3, with an exclusion first (Step 5, TC05).
SELECT fsm.sync_line_items('WQ', '2026-11-30T18:00:00Z', (
  SELECT jsonb_agg(jsonb_build_object(
    'fsm_line_id', 'LQ' || n, 'name', 'Line ' || n, 'quantity', 1, 'unit_price', 5000,
    'line_amount', 5000, 'amount', 5000, 'sequence', n, 'status', 'Completed',
    'modified_time', CASE WHEN n >= 10 THEN '2026-11-30T17:00:00Z' ELSE '2026-10-31T17:00:00Z' END))
  FROM generate_series(1, 12) AS n));
SELECT finance.create_queue_item('wq-m3', 'WQ', ARRAY['LQ10','LQ11','LQ12']);
SELECT finance.request_exclusion((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m3'),
  'AMC PPM visit, already paid', NULL, ARRAY['finance-evidence/x.pdf'], NULL, 'Coordinator');
SELECT harness.expect_error($q$SELECT finance.request_exclusion((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m3'),
  'again', NULL, NULL, NULL, 'Coordinator')$q$, '23505', 'one open exclusion request per item');
SELECT harness.expect((SELECT status = 'pending' FROM finance.queue_items WHERE trigger_key = 'wq-m3'),
  'the item is not Excluded until verified');
SELECT harness.expect_error($q$SELECT finance.record_invoice((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m3'),
  'key-m3-aaaa', 'MAH-3', '2026-12-01', 15000, NULL, NULL, 'Finance One')$q$, '23514',
  'it cannot be invoiced while the request waits');
SELECT harness.expect_error($q$SELECT finance.decide_exclusion((SELECT id FROM finance.exclusions WHERE decision IS NULL),
  'rejected', NULL, NULL, 'Behrouz')$q$, '23514', 'a rejection needs a note');
SELECT harness.expect(
  finance.decide_exclusion((SELECT id FROM finance.exclusions WHERE decision IS NULL), 'rejected',
    'Not covered by the contract', NULL, 'Behrouz') = 'pending',
  'rejected: back to Pending with a note');
SELECT finance.record_invoice((SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m3'),
  'key-m3-bbbb', 'MAH-3', '2026-12-01', 15000, NULL, NULL, 'Finance One');
SELECT harness.expect(
  (SELECT completion_percent = 100.0 AND invoiced_value = 60000 AND remaining_value = 0
   FROM finance.estimate_progress WHERE fsm_estimate_id = 'EQ'),
  'Q-1042 after month 3: 60,000, 100 %');

-- A verified exclusion, on a separate job.
SELECT fsm.upsert_work_orders('[{"fsm_work_order_id":"WX","status":"In Progress","modified_time":"2026-09-01T08:00:00Z"}]');
SELECT fsm.sync_line_items('WX', '2026-09-30T18:00:00Z',
  '[{"fsm_line_id":"LX1","amount":800,"status":"Completed","modified_time":"2026-09-30T17:00:00Z"}]');
SELECT finance.create_queue_item('wx-1', 'WX', ARRAY['LX1']);
SELECT finance.request_exclusion((SELECT id FROM finance.queue_items WHERE trigger_key = 'wx-1'),
  'In-contract call-out', NULL, NULL, NULL, 'Coordinator');
SELECT harness.expect(
  finance.decide_exclusion((SELECT id FROM finance.exclusions WHERE decision IS NULL), 'verified', NULL, NULL, 'Behrouz') = 'excluded',
  'verified: Excluded');
SELECT harness.expect_error($q$SELECT finance.decide_exclusion((SELECT id FROM finance.exclusions
  WHERE queue_item_id = (SELECT id FROM finance.queue_items WHERE trigger_key = 'wx-1')), 'rejected', 'late', NULL, 'Behrouz')$q$,
  '40001', 'a request is decided once');
SELECT harness.expect_error($q$SELECT finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wx-1'),
  'pick_up', 'excluded', NULL, 'Finance One')$q$, '23514', 'an excluded item is closed');
SELECT harness.expect(
  (SELECT excluded_value = 0 FROM finance.estimate_progress WHERE fsm_estimate_id = 'EQ')
  AND (SELECT count(*) = 0 FROM finance.estimate_progress WHERE fsm_estimate_id IS NULL),
  'an excluded item without a quotation does not disturb Q-1042');

-- History: every step recorded, and nothing can rewrite it.
SELECT harness.expect(
  (SELECT string_agg(event_type, ',' ORDER BY id) FROM finance.queue_events
   WHERE queue_item_id = (SELECT id FROM finance.queue_items WHERE trigger_key = 'wq-m1'))
  = 'created,picked_up,query_raised,query_answered,invoiced',
  'month 1 history: created, picked up, query, answer, invoiced');
SELECT harness.expect_error($q$UPDATE finance.invoices SET amount = 1$q$, 'P0001', 'invoices cannot be edited');
SELECT harness.expect_error($q$DELETE FROM finance.queue_events$q$, 'P0001', 'history cannot be deleted');
SELECT harness.expect_error($q$DELETE FROM finance.queue_item_lines$q$, 'P0001', 'an item''s lines cannot be removed');

-- The server role can run the whole flow, and cannot shortcut it.
SET ROLE service_role;
SELECT fsm.upsert_work_orders('[{"fsm_work_order_id":"WS","status":"In Progress","modified_time":"2026-09-01T08:00:00Z"}]');
SELECT fsm.sync_line_items('WS', '2026-09-30T18:00:00Z',
  '[{"fsm_line_id":"LS1","amount":100,"status":"Completed","modified_time":"2026-09-30T17:00:00Z"}]');
SELECT harness.expect(finance.create_queue_item('ws-1', 'WS', ARRAY['LS1']) IS NOT NULL, 'service role creates an item');
SELECT harness.expect(
  finance.record_invoice((SELECT id FROM finance.queue_items WHERE trigger_key = 'ws-1'),
    'key-ws-aaaa', 'MAH-S', '2026-10-01', 100, NULL, NULL, 'Finance One') IS NOT NULL,
  'service role records an invoice through the function');
SELECT harness.expect_error($q$UPDATE finance.queue_items SET status = 'invoiced'$q$, '42501',
  'service role cannot change a status directly');
RESET ROLE;
SET ROLE anon;
SELECT harness.expect_error($q$SELECT finance.create_queue_item('a', 'WS', ARRAY['LS1'])$q$, '42501', 'anon cannot reach finance');
RESET ROLE;

-- 20261021110000: the list view (P4).
SELECT harness.expect(
  (SELECT work_order_number = 'WO-1042' AND quotation_number = 'Q-1042' AND completion_percent = 41.7 AND status = 'invoiced'
   FROM finance.queue_list WHERE number = (SELECT number FROM finance.queue_items WHERE trigger_key = 'wq-m1')),
  'list: month 1 item reads 41.7 % (this item, not counted twice)');
SELECT harness.expect(
  (SELECT completion_percent = 75.0 FROM finance.queue_list WHERE number = (SELECT number FROM finance.queue_items WHERE trigger_key = 'wq-m2')),
  'list: month 2 item reads 75.0 % (month 1 cumulative + this item)');
SELECT harness.expect(
  (SELECT completion_percent IS NULL AND quotation_number IS NULL FROM finance.queue_list
   WHERE number = (SELECT number FROM finance.queue_items WHERE trigger_key = 'wx-1')),
  'list: an item with no quotation has no completion %');
SELECT harness.expect(
  has_table_privilege('service_role', 'finance.queue_list', 'SELECT')
  AND NOT has_table_privilege('anon', 'finance.queue_list', 'SELECT'),
  'list view: server only');
SELECT harness.expect(
  (SELECT completion_percent = 100.0 FROM finance.queue_list WHERE number = (SELECT number FROM finance.queue_items WHERE trigger_key = 'wq-m3')),
  'list: month 3 item reads 100 %');

-- 20261021120000: a query raised while On Hold returns to On Hold with its reason.
SELECT fsm.upsert_work_orders('[{"fsm_work_order_id":"WH","status":"In Progress","modified_time":"2026-09-01T08:00:00Z"}]');
SELECT fsm.sync_line_items('WH', '2026-09-30T18:00:00Z',
  '[{"fsm_line_id":"LH1","amount":50,"status":"Completed","modified_time":"2026-09-30T17:00:00Z"}]');
SELECT finance.create_queue_item('wh-1', 'WH', ARRAY['LH1']);
SELECT finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wh-1'), 'put_on_hold', 'pending', NULL, 'Finance One', 'Waiting for PO');
SELECT finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wh-1'), 'raise_query', 'on_hold', NULL, 'Finance One', 'Which PO?');
SELECT harness.expect(
  finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wh-1'), 'answer_query', 'query_raised', NULL, 'Coordinator', 'PO-1') = 'on_hold',
  'a query raised while on hold is answered back to On Hold');
SELECT harness.expect(
  (SELECT hold_reason = 'Waiting for PO' AND query_text IS NULL FROM finance.queue_items WHERE trigger_key = 'wh-1'),
  'and keeps its hold reason');
SELECT harness.expect(
  finance.apply_action((SELECT id FROM finance.queue_items WHERE trigger_key = 'wh-1'), 'resume', 'on_hold', NULL, 'Finance One') = 'in_progress',
  'resumed');
SELECT harness.expect((SELECT hold_reason IS NULL FROM finance.queue_items WHERE trigger_key = 'wh-1'),
  'resuming clears the hold reason');
