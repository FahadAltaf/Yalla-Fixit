\set ON_ERROR_STOP on
-- Phase 3 (20261007130000): enquiry pipeline and site visit.

DO $$
DECLARE
  c uuid;
  p uuid;
  e uuid;
  e2 uuid;
  a uuid;
  num text;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_enquiries', 'amc_enquiry_follow_ups'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '% is granted to a browser role', t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.amc_next_enquiry_number()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.amc_next_enquiry_number()', 'EXECUTE') THEN
    RAISE EXCEPTION 'browser roles can allocate enquiry numbers';
  END IF;

  INSERT INTO public.customers (name, lifecycle) VALUES ('Enquiry test prospect', 'prospect') RETURNING id INTO c;
  INSERT INTO public.customer_properties (customer_id, label, unit_type, property_category) VALUES (c, 'Clinic 3', 'clinic', 'commercial') RETURNING id INTO p;

  -- Numbering and defaults.
  INSERT INTO public.amc_enquiries (source, customer_id, contact_name, contact_phone, need)
  VALUES ('Website', c, 'Sara', '0501234567', 'PPM for a clinic') RETURNING id, enquiry_number INTO e, num;
  IF num !~ '^ENQ-[0-9]{4}-[0-9]{4,}$' THEN RAISE EXCEPTION 'bad enquiry number %', num; END IF;
  IF (SELECT stage FROM public.amc_enquiries WHERE id = e) <> 'New Enquiry' THEN RAISE EXCEPTION 'default stage is not New Enquiry'; END IF;

  -- A contact who can be reached; Lost with its reason.
  BEGIN
    INSERT INTO public.amc_enquiries (source, customer_id, contact_name, need) VALUES ('Website', c, 'Nobody', 'Anything');
    RAISE EXCEPTION 'an unreachable contact was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_enquiries SET stage = 'Lost' WHERE id = e;
    RAISE EXCEPTION 'Lost without a reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.amc_enquiries (source, customer_id, contact_name, contact_email, need)
  VALUES ('Referral', c, 'Omar', 'omar@example.com', 'Second enquiry') RETURNING id INTO e2;
  UPDATE public.amc_enquiries SET stage = 'Lost', lost_reason = 'Price' WHERE id = e2;

  -- Follow-ups are kept: the enquiry and the client cannot be deleted under them.
  INSERT INTO public.amc_enquiry_follow_ups (enquiry_id, channel, outcome) VALUES (e, 'call', 'Spoke to Sara');
  BEGIN
    INSERT INTO public.amc_enquiry_follow_ups (enquiry_id, channel, outcome) VALUES (e, 'fax', 'Sent');
    RAISE EXCEPTION 'an unknown channel was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_enquiries WHERE id = e;
    RAISE EXCEPTION 'an enquiry with follow-ups was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.customers WHERE id = c;
    RAISE EXCEPTION 'a prospect with enquiries was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Site visit on the assessment.
  INSERT INTO public.amc_assessments (customer_id, property_id, enquiry_id, scheduled_at, asset_counts)
  VALUES (c, p, e, now() + interval '2 days', '{"ac-ppm": 6}') RETURNING id INTO a;
  BEGIN
    UPDATE public.amc_assessments SET asset_counts = '[1, 2]' WHERE id = a;
    RAISE EXCEPTION 'asset counts that are not an object were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_assessments SET attendance = 'teleported' WHERE id = a;
    RAISE EXCEPTION 'an unknown attendance was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_assessments SET attendance = 'client_no_show' WHERE id = a;
  BEGIN
    UPDATE public.amc_assessments SET status = 'completed', completed_at = now(), assessed_on = current_date WHERE id = a;
    RAISE EXCEPTION 'a missed visit was completed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_assessments SET attendance = 'attended', status = 'completed', completed_at = now(), assessed_on = current_date WHERE id = a;

  -- Follow-ups copied into the communication log keep their link.
  INSERT INTO public.amc_communication_log (customer_id, enquiry_id, channel, direction, summary) VALUES (c, e, 'call', 'outbound', 'Spoke to Sara');
END $$;
\echo 97g enquiries: all checks pass
