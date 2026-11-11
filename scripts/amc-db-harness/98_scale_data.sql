-- Synthetic AMC volume (local only): ~10k contracts and everything that
-- hangs off them, shaped like the app writes it.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
INSERT INTO public.roles (id, name) VALUES ('00000000-0000-0000-0000-0000000000f1', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.user_profile (id, email, full_name)
SELECT ('00000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, 'user' || g || '@test.local', 'User ' || g
  FROM generate_series(1, 25) g ON CONFLICT DO NOTHING;

-- 12k proposals: 10k signed (become contracts), 2k in other states.
INSERT INTO public.amc_submissions (id, owner_id, status, customer, property, services, final_price,
  signed_by_name, signed_at, created_at, submitted_at)
SELECT gen_random_uuid(),
       ('00000000-0000-0000-0000-' || lpad(to_hex(1 + g % 25), 12, '0'))::uuid,
       CASE WHEN g <= 10000 THEN 'signed' WHEN g % 3 = 0 THEN 'awaiting_approval' ELSE 'draft' END,
       jsonb_build_object('customerName', 'Customer ' || g, 'customerId', 'YFI' || (100000 + g)),
       jsonb_build_object('propertyAddress', 'Villa ' || g, 'unitType', 'villa'),
       '[]'::jsonb, 5000 + g % 4000,
       CASE WHEN g <= 10000 THEN 'Client ' || g END,
       CASE WHEN g <= 10000 THEN now() - (g % 700) * interval '1 day' END,
       now() - (g % 900) * interval '1 day',
       CASE WHEN g % 3 = 0 THEN now() - (g % 30) * interval '1 day' END
  FROM generate_series(1, 12000) g;

-- Clients and addresses (8k / 10k): Snagging's records, with AMC profiles (20261007170000).
INSERT INTO public.snagging_clients (id, name)
SELECT gen_random_uuid(), 'Customer ' || g FROM generate_series(1, 8000) g;
INSERT INTO public.amc_client_profiles (client_id, customer_ref)
SELECT id, 'YFI' || (100000 + substr(name, 10)::int) FROM public.snagging_clients WHERE name LIKE 'Customer %';
INSERT INTO public.snagging_properties (client_id, unit_label, property_type)
SELECT c.id, 'Villa ' || g, 'villa'
  FROM generate_series(1, 10000) g
  JOIN LATERAL (SELECT id FROM public.snagging_clients WHERE name = 'Customer ' || (1 + g % 8000)) c ON true;

-- 9,900 contracts (100 signed proposals stay pending). Dates spread so every display status occurs.
INSERT INTO public.amc_contracts (id, submission_id, proposal_number, status, customer, property,
  customer_name, customer_ref, property_label, account_managers, account_manager_names,
  start_date, end_date, term_months, subtotal, final_price, vat_amount, grand_total,
  signed_at, signed_by_name, cancelled_at, cancellation_reason, customer_id)
SELECT gen_random_uuid(), s.id, s.proposal_number,
       CASE WHEN s.rn % 50 = 0 THEN 'cancelled' ELSE 'active' END,
       s.customer, s.property, s.customer->>'customerName', s.customer->>'customerId', s.property->>'propertyAddress',
       jsonb_build_array(jsonb_build_object('name', 'Manager ' || (s.rn % 12))), 'Manager ' || (s.rn % 12),
       (current_date - (s.rn % 700)::int)::date, (current_date - (s.rn % 700)::int + 365)::date, 12,
       s.final_price, s.final_price, round(s.final_price * 0.05, 2), round(s.final_price * 1.05, 2),
       s.signed_at, s.signed_by_name,
       CASE WHEN s.rn % 50 = 0 THEN now() END, CASE WHEN s.rn % 50 = 0 THEN 'Customer left' END,
       (SELECT client_id FROM public.amc_client_profiles c WHERE c.customer_ref = s.customer->>'customerId')
  FROM (SELECT *, row_number() OVER (ORDER BY created_at, id) AS rn FROM public.amc_submissions WHERE status = 'signed') s
 WHERE s.rn <= 9900;

-- 8 entitlements per contract (~79k).
INSERT INTO public.amc_contract_entitlements (contract_id, service_id, service_label, sort_order, entitlement_type,
  call_out_class, units, frequency, included_quantity, contracted_price)
SELECT c.id, e.sid, e.label, e.ord, e.typ, e.cls, 1, 4,
       CASE WHEN e.typ IN ('visits', 'hours') THEN 12 END, 500
  FROM public.amc_contracts c
 CROSS JOIN (VALUES ('ac-ppm', 'AC PPM', 1, 'visits', NULL), ('handyman', 'Handyman', 2, 'hours', NULL),
                    ('plumbing', 'Plumbing', 3, 'visits', NULL), ('electrical', 'Electrical', 4, 'visits', NULL),
                    ('emergency', 'Emergency', 5, 'unlimited', 'emergency'),
                    ('non-emergency', 'Non-emergency', 6, 'unlimited', 'non_emergency'),
                    ('pest', 'Pest control', 7, 'visits', NULL), ('helpdesk', 'Helpdesk', 8, 'informational', NULL)
            ) AS e(sid, label, ord, typ, cls);

-- Usage through the ledger trigger (~150k rows): active contracts only.
INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source,
  external_type, external_reference, created_at)
SELECT e.contract_id, e.id, 'consumption', 1, now() - (n * 37 % 300) * interval '1 day', 'fsm',
       'fsm_appointment', 'APPT-' || e.id || '-' || n, now() - (n * 37 % 300) * interval '1 day'
  FROM public.amc_contract_entitlements e
  JOIN public.amc_contracts c ON c.id = e.contract_id AND c.status = 'active'
 CROSS JOIN generate_series(1, 3) n
 WHERE e.entitlement_type IN ('visits', 'hours', 'unlimited') AND e.sort_order <= 5;

-- FSM links (one per 2 contracts, ~5k) and their sync events.
INSERT INTO public.amc_fsm_links (contract_id, entitlement_id, fsm_work_order_id, fsm_appointment_id)
SELECT e.contract_id, e.id, 'WO-' || row_number() OVER (), 'AP-' || row_number() OVER ()
  FROM public.amc_contract_entitlements e WHERE e.service_id = 'ac-ppm' AND random() < 0.5;
INSERT INTO public.amc_fsm_sync_events (fsm_appointment_id, action, contract_id, link_id, status, attempts, last_attempt_at)
SELECT fsm_appointment_id, 'consume', contract_id, id, 'recorded', 1, now() FROM public.amc_fsm_links;

-- Assessments (5k, 12 items each) and additional quotes (10k).
INSERT INTO public.amc_assessments (customer_id, property_id, assessor_name, created_at)
SELECT p.customer_id, p.id, 'Assessor ' || (g % 7), now() - (g % 400) * interval '1 day'
  FROM generate_series(1, 5000) g
  JOIN LATERAL (SELECT id, client_id AS customer_id FROM public.snagging_properties OFFSET g LIMIT 1) p ON true;
INSERT INTO public.amc_assessment_items (assessment_id, item_key, category_key, category_label, label, sort_order)
SELECT a.id, k.item_key, k.category_key, k.category_label, k.label, k.sort_order
  FROM public.amc_assessments a CROSS JOIN public.amc_assessment_checklist k;
INSERT INTO public.amc_additional_quotes (contract_id, service_key, service_label, requested_for, eligibility,
  standard_price, discount_percent, discount_amount, final_price)
SELECT c.id, 'carpentry', 'Carpentry', current_date, 'standard_charge', 300, 0, 0, 300
  FROM public.amc_contracts c CROSS JOIN generate_series(1, 1) WHERE random() < 1.0;

ANALYZE;
SELECT 'amc_submissions' t, count(*) FROM public.amc_submissions UNION ALL
SELECT 'amc_contracts', count(*) FROM public.amc_contracts UNION ALL
SELECT 'amc_contract_entitlements', count(*) FROM public.amc_contract_entitlements UNION ALL
SELECT 'amc_entitlement_usage', count(*) FROM public.amc_entitlement_usage UNION ALL
SELECT 'amc_fsm_links', count(*) FROM public.amc_fsm_links UNION ALL
SELECT 'amc_fsm_sync_events', count(*) FROM public.amc_fsm_sync_events UNION ALL
SELECT 'snagging_clients', count(*) FROM public.snagging_clients UNION ALL
SELECT 'snagging_properties', count(*) FROM public.snagging_properties UNION ALL
SELECT 'amc_assessments', count(*) FROM public.amc_assessments UNION ALL
SELECT 'amc_assessment_items', count(*) FROM public.amc_assessment_items UNION ALL
SELECT 'amc_additional_quotes', count(*) FROM public.amc_additional_quotes;
