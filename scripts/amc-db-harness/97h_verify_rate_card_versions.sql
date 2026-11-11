\set ON_ERROR_STOP on
-- Phase 4 (20261007140000): rate card versions and proposal versions.

DO $$
DECLARE
  owner uuid := '00000000-0000-0000-0000-000000000001';
  card_id uuid;
  s uuid;
  v integer;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_rate_card_versions', 'amc_submission_versions'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '% is granted to a browser role', t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.amc_lock_proposal_version(uuid, integer, text, text, uuid, jsonb, text, text, text, integer, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.amc_lock_proposal_version(uuid, integer, text, text, uuid, jsonb, text, text, text, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'browser roles can lock proposal versions';
  END IF;

  -- A published card is history.
  INSERT INTO public.amc_rate_card_versions (effective_from, card, reason, changed_by)
  VALUES (current_date, '{"items": [], "packages": [], "promotions": []}', 'First card', owner) RETURNING id INTO card_id;
  BEGIN
    UPDATE public.amc_rate_card_versions SET reason = 'edited' WHERE id = card_id;
    RAISE EXCEPTION 'a published card was edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_rate_card_versions WHERE id = card_id;
    RAISE EXCEPTION 'a published card was deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Live main's insert (no Phase 4 columns) still works and gets the defaults.
  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES (owner, 'draft', '{"propertyAddress":"Villa 9","unitType":"villa"}', '{"customerName":"VERSIONS","paymentTerms":"annual"}',
    '{}', '[]', 0, 0, 1000, '{}', now()) RETURNING id INTO s;
  IF (SELECT current_version FROM public.amc_submissions WHERE id = s) <> 1
     OR (SELECT below_floor FROM public.amc_submissions WHERE id = s) THEN
    RAISE EXCEPTION 'Phase 4 defaults missing on a main-style insert';
  END IF;
  BEGIN
    UPDATE public.amc_submissions SET payment_plan = 'annual' WHERE id = s;
    RAISE EXCEPTION 'an unknown payment plan was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_submissions SET payment_plan = 'fifty_fifty', property_type = 'clinic', rate_card_version_id = card_id WHERE id = s;

  -- A draft has not been shared: it is edited in place, not versioned.
  BEGIN
    PERFORM public.amc_lock_proposal_version(s, 1, 'discount', 'More discount', owner, '{}'::jsonb, 'h', 'proposal-versions/x/v1-a.pdf', 'application/pdf', 10, 'f');
    RAISE EXCEPTION 'a draft was versioned';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Shared: V1 is locked and V2 opens as a draft, the link revoked.
  UPDATE public.amc_submissions SET status = 'proposal_sent', proposal_token_hash = 'v-hash', proposal_sent_at = now() WHERE id = s;
  v := public.amc_lock_proposal_version(s, 1, 'scope_down', 'Plumbing dropped', owner, '{"services": []}'::jsonb, 'h1', 'proposal-versions/x/v1-b.pdf', 'application/pdf', 10, 'f1');
  IF v <> 2 THEN RAISE EXCEPTION 'expected version 2, got %', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.amc_submissions WHERE id = s AND status = 'draft' AND current_version = 2
                   AND version_reason = 'scope_down' AND proposal_token_hash IS NULL AND proposal_sent_at IS NULL) THEN
    RAISE EXCEPTION 'V2 did not open as a draft with the link revoked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.amc_submission_versions WHERE submission_id = s AND version_no = 1
                   AND status_at_lock = 'proposal_sent' AND payment_plan = 'fifty_fifty' AND reason IS NULL) THEN
    RAISE EXCEPTION 'V1 was not locked as it was';
  END IF;

  -- The same version cannot be locked twice; a locked version never changes.
  UPDATE public.amc_submissions SET status = 'proposal_rejected' WHERE id = s;
  BEGIN
    PERFORM public.amc_lock_proposal_version(s, 1, 'other', 'Again', owner, '{}'::jsonb, 'h', 'proposal-versions/x/v1-c.pdf', 'application/pdf', 10, 'f');
    RAISE EXCEPTION 'a stale version was locked';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_submission_versions SET summary = 'rewritten' WHERE submission_id = s;
    RAISE EXCEPTION 'a locked version was changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_submissions WHERE id = s;
    RAISE EXCEPTION 'a proposal with locked versions was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_submission_versions WHERE submission_id = s;
    RAISE EXCEPTION 'a locked version was deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
\echo 97h rate card and versions: all checks pass
