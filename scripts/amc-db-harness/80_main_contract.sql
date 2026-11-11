-- The live (origin/main) application's database contract, replayed as the
-- roles main actually uses. Each check prints PASS/FAIL; nothing aborts.
-- Run inside a transaction that the caller rolls back.
--   service_role : every AMC API route, scheduling routes, fsm-client
--   authenticated: estimates routes, zoho-file, api/test (cookie client, anon key + session)
--   anon         : pg_graphql (AuthContext settings, settings pages), password reset actions
\set ON_ERROR_STOP off
SET client_min_messages = notice;

CREATE OR REPLACE FUNCTION pg_temp.chk(name text, q text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RAISE NOTICE 'PASS %', name;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'FAIL % : % (%)', name, SQLERRM, SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.chk(text, text) TO PUBLIC;

-- ===================== AMC module (service role) =====================
SET ROLE service_role;
SELECT pg_temp.chk('amc.create_draft', $q$
  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES ('00000000-0000-0000-0000-0000000000a1', 'draft', '{"propertyAddress":"Villa 1"}',
    '{"customerName":"COMPAT"}', '{}', '[]', 0, 0, 1000, '{}', now()) RETURNING *
$q$);
SELECT pg_temp.chk('amc.proposal_number_default', $q$
  SELECT 1 / (count(*) FILTER (WHERE proposal_number ~ '^AMC-[0-9]{4}-[0-9]{4,}$') = count(*) AND count(*) = 1)::int
    FROM public.amc_submissions WHERE customer->>'customerName' = 'COMPAT'
$q$);
SELECT pg_temp.chk('amc.list_page', $q$
  SELECT id, owner_id, proposal_number, status, property, customer, discount_percent, discount_amount, final_price,
         generated_documents, submitted_at, decided_at, sent_back_reason, proposal_sent_at, contract_sent_at,
         client_decision, client_decided_at, client_decided_by_name, client_rejected_reason, signed_by_name,
         signed_at, created_at, updated_at
    FROM public.amc_submissions
   WHERE owner_id = '00000000-0000-0000-0000-0000000000a1' AND status = 'draft'
   ORDER BY created_at DESC, id LIMIT 25 OFFSET 0
$q$);
SELECT pg_temp.chk('amc.list_count', $q$
  SELECT count(id) FROM public.amc_submissions WHERE status = 'draft'
$q$);
SELECT pg_temp.chk('amc.read_one_star', $q$
  SELECT * FROM public.amc_submissions WHERE customer->>'customerName' = 'COMPAT'
$q$);
SELECT pg_temp.chk('amc.owner_update', $q$
  UPDATE public.amc_submissions SET services = '[{"serviceId":"ac-ppm"}]', final_price = 1200, updated_at = now()
   WHERE customer->>'customerName' = 'COMPAT' AND owner_id = '00000000-0000-0000-0000-0000000000a1' RETURNING *
$q$);
SELECT pg_temp.chk('amc.submit', $q$
  UPDATE public.amc_submissions SET status = 'awaiting_approval', submitted_at = now(),
         submitted_by = '00000000-0000-0000-0000-0000000000a1', updated_at = now()
   WHERE customer->>'customerName' = 'COMPAT' AND status = 'draft' RETURNING id
$q$);
SELECT pg_temp.chk('amc.pending_approvals', $q$
  SELECT id, owner_id, proposal_number, customer, final_price, submitted_at FROM public.amc_submissions
   WHERE status = 'awaiting_approval' AND owner_id <> '00000000-0000-0000-0000-0000000000a2'
   ORDER BY submitted_at DESC LIMIT 50
$q$);
SELECT pg_temp.chk('amc.approve', $q$
  UPDATE public.amc_submissions SET status = 'approved', decided_at = now(),
         decided_by = '00000000-0000-0000-0000-0000000000a2', updated_at = now()
   WHERE customer->>'customerName' = 'COMPAT' AND status = 'awaiting_approval' RETURNING id
$q$);
SELECT pg_temp.chk('amc.send_proposal', $q$
  UPDATE public.amc_submissions SET status = 'proposal_sent', proposal_token_hash = 'compat-hash-1',
         proposal_token_hint = 'abcd', proposal_token_expires_at = now() + interval '30 days',
         proposal_sent_at = now(), updated_at = now()
   WHERE customer->>'customerName' = 'COMPAT' AND status = 'approved' RETURNING id
$q$);
SELECT pg_temp.chk('amc.token_lookup', $q$
  SELECT 1 / count(*)::int FROM public.amc_submissions
   WHERE proposal_token_hash = 'compat-hash-1' OR contract_token_hash = 'compat-hash-1'
$q$);
SELECT pg_temp.chk('amc.client_approve', $q$
  UPDATE public.amc_submissions SET status = 'proposal_approved', client_decision = 'approved',
         client_decided_at = now(), client_decided_by_name = 'Client', updated_at = now()
   WHERE customer->>'customerName' = 'COMPAT' AND status = 'proposal_sent' RETURNING id
$q$);
SELECT pg_temp.chk('amc.send_contract', $q$
  UPDATE public.amc_submissions SET status = 'contract_sent', contract_token_hash = 'compat-hash-2',
         contract_token_expires_at = now() + interval '30 days', contract_sent_at = now(), updated_at = now()
   WHERE customer->>'customerName' = 'COMPAT' AND status = 'proposal_approved' RETURNING id
$q$);
SELECT pg_temp.chk('amc.sign', $q$
  UPDATE public.amc_submissions SET status = 'signed', signed_by_name = 'Client Name', signed_at = now(), updated_at = now()
   WHERE customer->>'customerName' = 'COMPAT' AND status = 'contract_sent' RETURNING id
$q$);
SELECT pg_temp.chk('amc.settings_snapshot', $q$
  UPDATE public.amc_submissions SET settings_snapshot = '{"vat":5}'
   WHERE customer->>'customerName' = 'COMPAT' AND settings_snapshot IS NULL
$q$);
SELECT pg_temp.chk('amc.settings_upsert', $q$
  INSERT INTO public.amc_settings (id, overrides, updated_at) VALUES (1, '{"x":1}', now())
  ON CONFLICT (id) DO UPDATE SET overrides = EXCLUDED.overrides, updated_at = EXCLUDED.updated_at RETURNING overrides
$q$);
SELECT pg_temp.chk('amc.settings_read', $q$ SELECT overrides FROM public.amc_settings WHERE id = 1 $q$);
SELECT pg_temp.chk('amc.audit_insert_submission', $q$
  INSERT INTO public.amc_audit_events (entity_type, entity_id, event_type, actor_id, actor_label, origin, payload)
  SELECT 'submission', id, 'signed', NULL, 'Client', 'client', '{}' FROM public.amc_submissions
   WHERE customer->>'customerName' = 'COMPAT'
$q$);
SELECT pg_temp.chk('amc.audit_insert_settings', $q$
  INSERT INTO public.amc_audit_events (entity_type, entity_id, event_type, actor_label, payload)
  VALUES ('settings', NULL, 'settings_updated', 'Admin', '{}')
$q$);
SELECT pg_temp.chk('amc.audit_history', $q$
  SELECT event_type, actor_label, origin, justification, payload, created_at FROM public.amc_audit_events
   WHERE entity_type = 'submission' ORDER BY created_at LIMIT 200
$q$);
SELECT pg_temp.chk('amc.audit_settings_history', $q$
  SELECT id, actor_label, payload, created_at FROM public.amc_audit_events
   WHERE entity_type = 'settings' ORDER BY created_at DESC LIMIT 20
$q$);
-- The audit trail is never rewritten: main's rules silently ignore an UPDATE;
-- from 20261007100000 a trigger refuses it with an error. Either passes.
-- (Main itself never updates or deletes audit rows.)
SELECT pg_temp.chk('amc.audit_append_only', $q$
  DO $d$ BEGIN
    BEGIN
      UPDATE public.amc_audit_events SET actor_label = 'x' WHERE entity_type = 'settings';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'amc_audit_events is append-only%' THEN RAISE; END IF;
    END;
    IF EXISTS (SELECT 1 FROM public.amc_audit_events WHERE actor_label = 'x') THEN RAISE EXCEPTION 'audit rewritten'; END IF;
  END $d$
$q$);
SELECT pg_temp.chk('amc.delete_draft_submission', $q$
  WITH d AS (INSERT INTO public.amc_submissions (owner_id) VALUES ('00000000-0000-0000-0000-0000000000a1') RETURNING id)
  DELETE FROM public.amc_submissions WHERE id IN (SELECT id FROM d)
$q$);
-- Scheduling (service role) writes its audit rows.
SELECT pg_temp.chk('sched.audit_insert_service_role', $q$
  INSERT INTO public.schedule_audit_events (action) VALUES ('compat')
$q$);
SELECT pg_temp.chk('todos.service_role_rw', $q$
  SELECT count(*) FROM public.todos
$q$);
SELECT pg_temp.chk('zoho.token_read_service_role', $q$
  SELECT 1 / count(oauth_access_token)::int FROM public.settings WHERE id = 1
$q$);
RESET ROLE;

-- ====== Live non-AMC paths that touch tables the hardening locks down ======
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT pg_temp.chk('estimates.token_read_authenticated', $q$
  SELECT 1 / count(oauth_access_token)::int FROM public.settings WHERE id = 1
$q$);
SELECT pg_temp.chk('estimates.revisions_insert_authenticated', $q$
  INSERT INTO public.estimate_revisions (root_quotation_number) VALUES ('Q-1') RETURNING id
$q$);
SELECT pg_temp.chk('estimates.revisions_read_authenticated', $q$
  SELECT id, root_quotation_number FROM public.estimate_revisions LIMIT 5
$q$);
SELECT pg_temp.chk('estimates.service_items_rw_authenticated', $q$
  WITH i AS (INSERT INTO public.estimate_service_items (quotation_id) VALUES ('Q-1') RETURNING id)
  UPDATE public.estimate_service_items SET quotation_id = 'Q-2' WHERE id IN (SELECT id FROM i)
$q$);
RESET ROLE;

SET ROLE anon;
SELECT pg_temp.chk('graphql.settings_branding_anon', $q$
  SELECT 1 / count(*)::int FROM (SELECT id, type, site_name, logo_url, primary_color FROM public.settings WHERE type = 'admin') s
$q$);
SELECT pg_temp.chk('graphql.settings_with_token_anon', $q$
  SELECT 1 / count(oauth_access_token)::int FROM public.settings WHERE type = 'admin'
$q$);
SELECT pg_temp.chk('graphql.settings_update_anon', $q$
  UPDATE public.settings SET site_name = site_name WHERE id = 1
$q$);
SELECT pg_temp.chk('auth.password_reset_insert_anon', $q$
  INSERT INTO public.password_resets (email, token, expires_at) VALUES ('u@test.local', 'COMPAT', now() + interval '1 hour')
$q$);
SELECT pg_temp.chk('auth.password_reset_read_anon', $q$
  SELECT 1 / count(*)::int FROM public.password_resets WHERE token = 'RESET-TOKEN'
$q$);
-- Main's browser GraphQL (anon key): users, roles, permission rows.
SELECT pg_temp.chk('graphql.users_read_anon', $q$
  SELECT id, email, full_name FROM public.user_profile LIMIT 5
$q$);
SELECT pg_temp.chk('graphql.role_access_write_anon', $q$
  INSERT INTO public.role_access (role_id, resource, action) SELECT id, 'amc', 'approve' FROM public.roles LIMIT 1
$q$);
SELECT pg_temp.chk('graphql.user_update_anon', $q$
  UPDATE public.user_profile SET full_name = full_name WHERE id = '00000000-0000-0000-0000-0000000000a1'
$q$);
RESET ROLE;
-- Main's file uploads (saveFile) run with a signed-in session.
SET ROLE authenticated;
SELECT pg_temp.chk('uploads.insert_authenticated', $q$
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('uploads', 'public/compat.png', '00000000-0000-0000-0000-0000000000a1')
$q$);
RESET ROLE;
