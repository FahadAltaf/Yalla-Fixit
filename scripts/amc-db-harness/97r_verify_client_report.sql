\set ON_ERROR_STOP on
-- Phase 12 (20261012130000): the client report's send record and the report indexes.
-- 97q re-runs the Phase 11 migration (its send-log list has no client_report), so this one is applied again first,
-- as the migrations apply in order in production.
\ir ../../supabase/migrations/20261012130000_amc_client_report.sql

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  s uuid;
  t text;
BEGIN
  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES (owner_id, 'proposal_approved', '{"propertyAddress":"Villa 3","unitType":"villa"}', '{"customerName":"REPORT"}',
    '{}', '[]', 0, 0, 3000, '{}', now()) RETURNING id INTO s;

  -- Every document the send log knew, plus the client report; nothing else.
  INSERT INTO public.amc_send_log (submission_id, version_no, document, channel, recipients, outcome)
  SELECT s, 1, d, 'email', '[]', 'no_recipient'
    FROM unnest(ARRAY['proposal', 'contract', 'instalment_reminder', 'visit_confirmation', 'visit_reminder', 'service_report',
                      'call_out_acknowledgement', 'additional_work_quotation', 'client_report']) AS d;
  BEGIN
    INSERT INTO public.amc_send_log (submission_id, version_no, document, channel, recipients, outcome)
    VALUES (s, 1, 'brochure', 'email', '[]', 'no_recipient');
    RAISE EXCEPTION 'an unknown document was logged';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  FOREACH t IN ARRAY ARRAY['idx_amc_call_outs_reported', 'idx_amc_payments_received', 'idx_amc_visits_closed'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE EXCEPTION 'index % is missing', t; END IF;
  END LOOP;
END $$;
\echo 97r client report: all checks pass
