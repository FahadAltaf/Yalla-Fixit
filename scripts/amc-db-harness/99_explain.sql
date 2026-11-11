-- EXPLAIN ANALYZE of the AMC queries the app runs, on the synthetic volume.
\set ON_ERROR_STOP on
SET ROLE service_role;
SELECT c.id AS cid, c.customer_ref AS cref, e.id AS eid, s.owner_id AS owner
  FROM public.amc_contracts c
  JOIN public.amc_submissions s ON s.id = c.submission_id
  JOIN public.amc_contract_entitlements e ON e.contract_id = c.id AND e.service_id = 'ac-ppm'
 WHERE c.status = 'active' ORDER BY c.id LIMIT 1 \gset
SELECT id AS uid FROM public.amc_entitlement_usage WHERE contract_id = :'cid' LIMIT 1 \gset
SELECT fsm_work_order_id AS wo FROM public.amc_fsm_links LIMIT 1 \gset

\echo '### Q1 contracts list: expiring tab, search, sort by end date, page 1'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT c.id, c.proposal_number, c.customer_name, c.end_date, c.grand_total, s.owner_id
  FROM public.amc_contracts c JOIN public.amc_submissions s ON s.id = c.submission_id
 WHERE c.status = 'active' AND c.start_date <= current_date AND c.end_date >= current_date
   AND c.end_date <= current_date + 30
   AND (c.customer_name ILIKE '%Customer 1%' OR c.proposal_number ILIKE '%Customer 1%' OR c.account_manager_names ILIKE '%Customer 1%')
 ORDER BY c.end_date LIMIT 10;
\echo '### Q1b contracts list count (count=exact), all tab, owner filter'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*) FROM public.amc_contracts c JOIN public.amc_submissions s ON s.id = c.submission_id
 WHERE s.owner_id = :'owner';
\echo '### Q2 contract detail: entitlements'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM public.amc_contract_entitlements WHERE contract_id = :'cid' ORDER BY sort_order;
\echo '### Q3 usage page for one contract'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, entitlement_id, kind, quantity, occurred_at FROM public.amc_entitlement_usage
 WHERE contract_id = :'cid' ORDER BY occurred_at DESC LIMIT 25;
\echo '### Q4 dashboard, approver (all contracts)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT public.amc_contracts_dashboard(NULL, current_date, 30, now() - interval '30 days');
\echo '### Q4b dashboard, one owner'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT public.amc_contracts_dashboard(:'owner', current_date, 30, now() - interval '30 days');
\echo '### Q4c dashboard recent usage (inner query, approver)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT u.id, c.proposal_number, e.service_label FROM public.amc_entitlement_usage u
  JOIN public.amc_contracts c ON c.id = u.contract_id
  JOIN public.amc_submissions s ON s.id = c.submission_id
  JOIN public.amc_contract_entitlements e ON e.id = u.entitlement_id
 ORDER BY u.created_at DESC LIMIT 6;
\echo '### Q4d dashboard 30-day consumption count (inner query, approver)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*) FROM public.amc_entitlement_usage WHERE kind = 'consumption' AND occurred_at >= now() - interval '30 days';
\echo '### Q5 pending activations (anti-join)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT s.id FROM public.amc_submissions s
 WHERE s.status = 'signed' AND NOT EXISTS (SELECT 1 FROM public.amc_contracts c WHERE c.submission_id = s.id)
 ORDER BY s.signed_at DESC, s.id LIMIT 1000;
\echo '### Q6 coverage lookup by customer reference'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT c.id FROM public.amc_contracts c WHERE c.customer_ref = :'cref';
\echo '### Q7 FSM links by work order'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, contract_id FROM public.amc_fsm_links WHERE fsm_work_order_id = :'wo' AND unlinked_at IS NULL;
\echo '### Q8 renewal proposal of a contract'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id FROM public.amc_submissions WHERE renewal_of_contract_id = :'cid' LIMIT 1;
\echo '### Q9 FSM consumed-once check'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id FROM public.amc_entitlement_usage WHERE entitlement_id = :'eid' AND external_type = 'fsm_appointment'
   AND external_reference = 'APPT-x' AND kind = 'consumption';
\echo '### Q10 corrections of one usage entry'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT quantity FROM public.amc_entitlement_usage WHERE corrects_usage_id = :'uid' AND kind = 'correction';
\echo '### Q11 assessments page 1 (newest first) with count'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT a.id, a.assessment_number FROM public.amc_assessments a ORDER BY a.created_at DESC, a.id LIMIT 25;
\echo '### Q12 sync events of a contract'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT fsm_appointment_id, status FROM public.amc_fsm_sync_events WHERE contract_id = :'cid' ORDER BY last_attempt_at DESC;
\echo '### Q13 reports: every contract with entitlements (one 1000-row page)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT c.id, (SELECT json_agg(e) FROM public.amc_contract_entitlements e WHERE e.contract_id = c.id)
  FROM public.amc_contracts c ORDER BY c.id LIMIT 1000 OFFSET 5000;
SELECT id AS after_id FROM public.amc_contracts ORDER BY id OFFSET 4999 LIMIT 1 \gset
\echo '### Q13b reports: the same page by key (id > last id)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT c.id, (SELECT json_agg(e) FROM public.amc_contract_entitlements e WHERE e.contract_id = c.id)
  FROM public.amc_contracts c WHERE c.id > :'after_id' ORDER BY c.id LIMIT 1000;
\echo '### Q14 MAIN: proposals list page (owner, newest first) at 12k proposals'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, proposal_number, status FROM public.amc_submissions WHERE owner_id = :'owner'
 ORDER BY created_at DESC, id LIMIT 25;
\echo '### Q15 MAIN: token lookup'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id FROM public.amc_submissions WHERE proposal_token_hash = 'x' OR contract_token_hash = 'x';
\echo '### T1 activation function: one contract with 8 services'
INSERT INTO public.amc_submissions (id, owner_id, status, signed_by_name, signed_at)
VALUES ('99000000-0000-0000-0000-000000000001', :'owner', 'signed', 'C', now());
EXPLAIN (ANALYZE, COSTS OFF)
SELECT public.amc_activate_contract(
  jsonb_build_object('submission_id', '99000000-0000-0000-0000-000000000001', 'proposal_number', 'T', 'customer', '{}'::jsonb,
    'property', '{}'::jsonb, 'start_date', current_date, 'end_date', current_date + 365, 'subtotal', 1, 'final_price', 1,
    'vat_amount', 0, 'grand_total', 1, 'signed_at', now(), 'signed_by_name', 'C'),
  (SELECT jsonb_agg(jsonb_build_object('service_id', 's' || g, 'service_label', 'S', 'entitlement_type', 'visits',
     'units', 1, 'frequency', 1, 'included_quantity', 4, 'contracted_price', 0)) FROM generate_series(1, 8) g));
RESET ROLE;
