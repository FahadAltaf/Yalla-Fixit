\set ON_ERROR_STOP on
-- Phase 1 (20261007110000): configuration, AMC to-dos, job runs, and the
-- name-pattern checks on audit, notifications and todos.

INSERT INTO public.user_profile (id, email) VALUES ('97e00000-0000-0000-0000-000000000001', 'platform@test.local')
  ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_config', 'amc_todos', 'amc_job_runs'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '% is granted to a browser role', t;
    END IF;
  END LOOP;

  -- Config keys: section names only.
  INSERT INTO public.amc_config (key, value) VALUES ('proposals', '{"validityDays": 30}');
  BEGIN
    INSERT INTO public.amc_config (key, value) VALUES ('Bad key!', '{}');
    RAISE EXCEPTION 'a bad config key was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Audit: any lowercase record type; nothing else.
  INSERT INTO public.amc_audit_events (entity_type, event_type) VALUES ('enquiry', 'status_changed');
  INSERT INTO public.amc_audit_events (entity_type, event_type) VALUES ('submission', 'still_allowed');
  BEGIN
    INSERT INTO public.amc_audit_events (entity_type, event_type) VALUES ('Bad Type', 'x');
    RAISE EXCEPTION 'a bad audit entity type was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Notifications: new event names and record links.
  INSERT INTO public.amc_notifications (event, recipient_user_id, channel, dedupe_key, title, body, entity_type, entity_id, status)
  VALUES ('todo_escalated', '97e00000-0000-0000-0000-000000000001', 'in_app', 'k97e', 't', 'b', 'enquiry', gen_random_uuid(), 'delivered');
  BEGIN
    INSERT INTO public.amc_notifications (event, recipient_user_id, channel, dedupe_key, title, body)
    VALUES ('Bad Event!', '97e00000-0000-0000-0000-000000000001', 'in_app', 'k97e-2', 't', 'b');
    RAISE EXCEPTION 'a bad notification event was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Todos: live types still work; 'amc_…' types allowed; anything else refused.
  INSERT INTO public.todos (owner_id, title, description, deadline_at, related_type, related_id)
  VALUES ('97e00000-0000-0000-0000-000000000001', 'live type', 'd', now(), 'appointment', 'A-1');
  INSERT INTO public.todos (owner_id, title, description, deadline_at, related_type, related_id)
  VALUES ('97e00000-0000-0000-0000-000000000001', 'amc type', 'd', now(), 'amc_visit', gen_random_uuid()::text);
  BEGIN
    INSERT INTO public.todos (owner_id, title, description, deadline_at, related_type)
    VALUES ('97e00000-0000-0000-0000-000000000001', 'bad', 'd', now(), 'random_type');
    RAISE EXCEPTION 'an unknown related type was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- AMC to-dos: one per dedupe key.
  INSERT INTO public.amc_todos (kind, entity_type, entity_id, dedupe_key) VALUES ('renewal_due', 'contract', gen_random_uuid(), 'dup-97e');
  BEGIN
    INSERT INTO public.amc_todos (kind, entity_type, entity_id, dedupe_key) VALUES ('renewal_due', 'contract', gen_random_uuid(), 'dup-97e');
    RAISE EXCEPTION 'a duplicate AMC to-do was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- The browser roles cannot read the configuration.
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.amc_config LIMIT 1;
    RAISE EXCEPTION 'authenticated can read amc_config';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\echo 97e platform: all checks pass
