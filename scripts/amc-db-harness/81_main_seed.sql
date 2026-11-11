-- Production-shaped AMC data in main's state: 28 proposals across the
-- statuses production has, three of them signed (like the early signed
-- records), settings overrides and audit rows.
\set ON_ERROR_STOP on
INSERT INTO public.roles (id, name) VALUES ('00000000-0000-0000-0000-0000000000f1', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.user_profile (id, email, full_name, role_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local', 'Owner One', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000a2', 'approver@test.local', 'Approver Two', '00000000-0000-0000-0000-0000000000f1')
ON CONFLICT DO NOTHING;

INSERT INTO public.amc_submissions (owner_id, status, customer, property, services, final_price,
  submitted_at, decided_at, proposal_sent_at, client_decision, client_decided_at, client_decided_by_name,
  client_rejected_reason, signed_by_name, signed_at, sent_back_reason)
SELECT CASE WHEN g % 2 = 0 THEN '00000000-0000-0000-0000-0000000000a1'::uuid ELSE '00000000-0000-0000-0000-0000000000a2'::uuid END,
       s.status,
       jsonb_build_object('customerName', 'Seed ' || g, 'customerId', 'YFI' || (1800 + g),
                          'startDate', '2026-10-01', 'endDate', '2027-09-30'),
       jsonb_build_object('propertyAddress', 'Villa ' || g, 'unitType', 'villa'),
       '[{"serviceId":"ac-ppm","units":1,"frequency":4,"ticked":true}]'::jsonb,
       1000 + g,
       CASE WHEN s.status <> 'draft' THEN now() END,
       CASE WHEN s.status NOT IN ('draft','awaiting_approval') THEN now() END,
       CASE WHEN s.status IN ('proposal_sent','proposal_rejected','proposal_approved','contract_sent','signed') THEN now() END,
       CASE WHEN s.status = 'proposal_rejected' THEN 'rejected'
            WHEN s.status IN ('proposal_approved','contract_sent','signed') THEN 'approved' END,
       CASE WHEN s.status IN ('proposal_rejected','proposal_approved','contract_sent','signed') THEN now() END,
       CASE WHEN s.status IN ('proposal_rejected','proposal_approved','contract_sent','signed') THEN 'Client ' || g END,
       CASE WHEN s.status = 'proposal_rejected' THEN 'Too expensive' END,
       CASE WHEN s.status = 'signed' THEN 'Client ' || g END,
       CASE WHEN s.status = 'signed' THEN now() END,
       CASE WHEN s.status = 'sent_back' THEN 'Fix the prices' END
  FROM generate_series(1, 28) g
  JOIN LATERAL (SELECT (ARRAY['draft','draft','draft','draft','draft','draft','draft','draft','draft','draft',
                              'awaiting_approval','awaiting_approval','sent_back','approved','approved',
                              'proposal_sent','proposal_sent','proposal_sent','proposal_rejected',
                              'proposal_approved','proposal_approved','contract_sent','contract_sent',
                              'draft','draft','signed','signed','signed'])[g] AS status) s ON true;

INSERT INTO public.amc_settings (id, overrides) VALUES (1, '{"vatPercent":5}') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.amc_audit_events (entity_type, entity_id, event_type, actor_label, payload)
SELECT 'submission', id, 'created', 'Seed', '{}' FROM public.amc_submissions;
