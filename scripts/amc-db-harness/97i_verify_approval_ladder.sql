\set ON_ERROR_STOP on
-- Phase 5 (20261007150000): approval ladder, send log, the client's answer.

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  approver uuid := '00000000-0000-0000-0000-000000000002';
  s uuid;
  l1 uuid;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_approval_steps', 'amc_send_log'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '% is granted to a browser role', t;
    END IF;
  END LOOP;

  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES (owner_id, 'awaiting_approval', '{"propertyAddress":"Villa 7","unitType":"villa"}', '{"customerName":"LADDER"}',
    '{}', '[]', 25, 0, 60000, '{}', now()) RETURNING id INTO s;

  -- Two levels: level 1 open, level 2 waiting.
  INSERT INTO public.amc_approval_steps (submission_id, version_no, round, level, level_name, approver_ids, triggers, status, opened_at, escalate_at)
  VALUES (s, 1, 1, 1, 'Department head', ARRAY[approver], '[{"key":"discount","level":2,"detail":"25%"}]', 'pending', now(), now() + interval '24 hours')
  RETURNING id INTO l1;
  INSERT INTO public.amc_approval_steps (submission_id, version_no, round, level, level_name, triggers, status)
  VALUES (s, 1, 1, 2, 'Management', '[{"key":"discount","level":2,"detail":"25%"}]', 'waiting');

  -- One open level at a time.
  BEGIN
    UPDATE public.amc_approval_steps SET status = 'pending' WHERE submission_id = s AND level = 2;
    RAISE EXCEPTION 'two levels open at once';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- A decision is dated; a rejection or return says why.
  BEGIN
    UPDATE public.amc_approval_steps SET status = 'approved' WHERE id = l1;
    RAISE EXCEPTION 'an undated approval was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_approval_steps SET status = 'returned', decided_at = now(), decided_by = approver WHERE id = l1;
    RAISE EXCEPTION 'a return without a reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_approval_steps (submission_id, version_no, round, level, level_name) VALUES (s, 1, 1, 4, 'Board');
    RAISE EXCEPTION 'a level 4 was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_approval_steps SET status = 'approved', decided_at = now(), decided_by = approver WHERE id = l1;
  UPDATE public.amc_approval_steps SET status = 'pending', opened_at = now() WHERE submission_id = s AND level = 2;

  -- The send log is a record: appended, never changed.
  INSERT INTO public.amc_send_log (submission_id, version_no, document, channel, recipients, cc, outcome, sent_by)
  VALUES (s, 1, 'proposal', 'whatsapp', '[{"name":"Sara","address":"0501234567"}]', '{}', 'prepared', owner_id);
  BEGIN
    UPDATE public.amc_send_log SET outcome = 'sent' WHERE submission_id = s;
    RAISE EXCEPTION 'a send log row was changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_send_log (submission_id, document, channel, outcome) VALUES (s, 'proposal', 'pigeon', 'sent');
    RAISE EXCEPTION 'an unknown channel was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The client's third answer, beside live main's own client_decision.
  UPDATE public.amc_submissions SET status = 'proposal_rejected', client_decision = 'rejected', client_decided_at = now(), client_decided_by_name = 'Sara',
         client_rejected_reason = 'Revision requested: two more AC units', client_answer = 'revision_requested', client_answer_source = 'link' WHERE id = s;
  BEGIN
    UPDATE public.amc_submissions SET client_answer = 'maybe' WHERE id = s;
    RAISE EXCEPTION 'an unknown answer was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The ladder and the sends are kept with the proposal.
  BEGIN
    DELETE FROM public.amc_submissions WHERE id = s;
    RAISE EXCEPTION 'a proposal with approval history was deleted';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;
END $$;
\echo 97i approval ladder and sends: all checks pass
