\set ON_ERROR_STOP on
-- Business completion (20261006150000): notifications, signed archive,
-- private bucket, assessment photos.
SET ROLE service_role;

-- 1. Settings: one row, defaults are configuration with automation OFF.
DO $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM public.amc_notification_settings WHERE id = 1;
  IF s IS NULL THEN RAISE EXCEPTION 'settings row missing'; END IF;
  IF s.reminder_auto_enabled OR s.entitlement_email_enabled OR NOT s.workflow_email_enabled
     OR s.reminder_thresholds <> '{60,30,15}' OR s.reminder_channels <> '{in_app}' OR s.reminder_recipients <> '{owner}' THEN
    RAISE EXCEPTION 'unexpected defaults: %', row_to_json(s);
  END IF;
  BEGIN
    UPDATE public.amc_notification_settings SET reminder_recipients = '{everyone}' WHERE id = 1;
    RAISE EXCEPTION 'unknown recipient accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_notification_settings SET reminder_thresholds = '{0}' WHERE id = 1;
    RAISE EXCEPTION 'zero threshold accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_notification_settings (id) VALUES (2);
    RAISE EXCEPTION 'second settings row accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- 2. Notifications: one row per event key, recipient and channel.
INSERT INTO public.amc_notifications (event, submission_id, recipient_user_id, channel, dedupe_key, title, body, status)
VALUES ('proposal_submitted', gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'in_app', 'k1', 't', 'b', 'delivered');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_notifications (event, recipient_user_id, channel, dedupe_key, title, body)
    VALUES ('proposal_submitted', '00000000-0000-0000-0000-000000000001', 'in_app', 'k1', 't', 'b');
    RAISE EXCEPTION 'duplicate notification accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- the same key by email, or to someone else, is a different row
  INSERT INTO public.amc_notifications (event, recipient_user_id, recipient_email, channel, dedupe_key, title, body)
  VALUES ('proposal_submitted', '00000000-0000-0000-0000-000000000001', 'owner@test.local', 'email', 'k1', 't', 'b');
  INSERT INTO public.amc_notifications (event, recipient_email, channel, dedupe_key, title, body)
  VALUES ('proposal_submitted', 'Extra@Test.Local', 'email', 'k1', 't', 'b');
  BEGIN
    INSERT INTO public.amc_notifications (event, recipient_email, channel, dedupe_key, title, body)
    VALUES ('proposal_submitted', 'extra@test.local', 'email', 'k1', 't', 'b');
    RAISE EXCEPTION 'case-variant email duplicate accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_notifications (event, channel, dedupe_key, title, body) VALUES ('proposal_submitted', 'in_app', 'k2', 't', 'b');
    RAISE EXCEPTION 'notification without recipient accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_notifications (event, recipient_email, channel, dedupe_key, title, body) VALUES ('made_up', 'x@y.z', 'email', 'k3', 't', 'b');
    RAISE EXCEPTION 'unknown event accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- 3. Signed archive: immutable once written.
INSERT INTO public.amc_submissions (id, owner_id, status, signed_by_name, signed_at)
VALUES ('97b00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'signed', 'Client', now());
INSERT INTO public.amc_signed_documents (submission_id, proposal_number, signed_by_name, signed_at, archived_when,
  settings_source, content, content_sha256, storage_path, content_type, byte_size, file_sha256)
VALUES ('97b00000-0000-0000-0000-000000000001', 'AMC-1', 'Client', now(), 'at_signing', 'contract_settings_snapshot',
  '{"v":1}', repeat('a', 64), 'signed-contracts/x/1.pdf', 'application/pdf', 10, repeat('b', 64));
DO $$
BEGIN
  BEGIN
    UPDATE public.amc_signed_documents SET signed_by_name = 'Someone else';
    RAISE EXCEPTION 'archive changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_signed_documents;
    RAISE EXCEPTION 'archive deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    TRUNCATE public.amc_signed_documents;
    RAISE EXCEPTION 'archive truncated';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_signed_documents (submission_id, proposal_number, signed_by_name, signed_at, archived_when,
      settings_source, content, content_sha256, storage_path, content_type, byte_size, file_sha256)
    VALUES ('97b00000-0000-0000-0000-000000000001', 'AMC-1', 'Client', now(), 'after_signing', 'contract_settings_snapshot',
      '{"v":1}', repeat('a', 64), 'signed-contracts/x/2.pdf', 'application/pdf', 10, repeat('b', 64));
    RAISE EXCEPTION 'second archive for one contract accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_submissions WHERE id = '97b00000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'signed proposal with an archive deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
RESET ROLE;

-- 4. The bucket is private and has no storage policy (service role only).
DO $$
BEGIN
  IF (SELECT public FROM storage.buckets WHERE id = 'amc-documents') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'amc-documents bucket is not private';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND (qual ILIKE '%amc-documents%' OR with_check ILIKE '%amc-documents%')) THEN
    RAISE EXCEPTION 'a storage policy opens amc-documents';
  END IF;
END $$;

-- 5. Photos: added and removed while draft; fixed once completed.
SET ROLE service_role;
INSERT INTO public.customers (id, name) VALUES ('97b10000-0000-0000-0000-000000000001', 'Photo Customer');
INSERT INTO public.customer_properties (id, customer_id, label) VALUES ('97b20000-0000-0000-0000-000000000001', '97b10000-0000-0000-0000-000000000001', 'Villa P');
INSERT INTO public.amc_assessments (id, customer_id, property_id) VALUES
  ('97b30000-0000-0000-0000-000000000001', '97b10000-0000-0000-0000-000000000001', '97b20000-0000-0000-0000-000000000001'),
  ('97b30000-0000-0000-0000-000000000002', '97b10000-0000-0000-0000-000000000001', '97b20000-0000-0000-0000-000000000001');
INSERT INTO public.amc_assessment_photos (id, assessment_id, storage_path, content_type, byte_size, file_sha256) VALUES
  ('97b40000-0000-0000-0000-000000000001', '97b30000-0000-0000-0000-000000000001', 'assessments/a/1.jpg', 'image/jpeg', 100, repeat('c', 64)),
  ('97b40000-0000-0000-0000-000000000002', '97b30000-0000-0000-0000-000000000001', 'assessments/a/2.jpg', 'image/jpeg', 100, repeat('d', 64)),
  ('97b40000-0000-0000-0000-000000000003', '97b30000-0000-0000-0000-000000000002', 'assessments/b/1.png', 'image/png', 100, repeat('e', 64));
DELETE FROM public.amc_assessment_photos WHERE id = '97b40000-0000-0000-0000-000000000002';
UPDATE public.amc_assessments SET status = 'completed', completed_at = now(), assessed_on = current_date
 WHERE id = '97b30000-0000-0000-0000-000000000001';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_assessment_photos (assessment_id, storage_path, content_type, byte_size, file_sha256)
    VALUES ('97b30000-0000-0000-0000-000000000001', 'assessments/a/3.jpg', 'image/jpeg', 100, repeat('f', 64));
    RAISE EXCEPTION 'photo added to a completed assessment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_assessment_photos WHERE id = '97b40000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'photo removed from a completed assessment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_assessment_photos SET caption = 'x' WHERE id = '97b40000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'photo changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_assessment_photos (assessment_id, storage_path, content_type, byte_size, file_sha256)
    VALUES ('97b30000-0000-0000-0000-000000000002', 'assessments/b/2.svg', 'image/svg+xml', 100, repeat('f', 64));
    RAISE EXCEPTION 'svg accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
-- a draft's photos go with it
DELETE FROM public.amc_assessments WHERE id = '97b30000-0000-0000-0000-000000000002';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.amc_assessment_photos WHERE assessment_id = '97b30000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'draft photos left behind';
  END IF;
  IF (SELECT count(*) FROM public.amc_assessment_photos WHERE assessment_id = '97b30000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'completed assessment lost a photo';
  END IF;
END $$;
RESET ROLE;

-- 6. The API roles see none of it.
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.amc_notifications LIMIT 1;
    RAISE EXCEPTION 'authenticated can read notifications';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.amc_signed_documents LIMIT 1;
    RAISE EXCEPTION 'authenticated can read the archive';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\echo 97b business completion: all checks pass
