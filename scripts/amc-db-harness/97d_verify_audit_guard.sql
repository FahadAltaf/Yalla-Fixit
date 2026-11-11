\set ON_ERROR_STOP on
-- Phase 0 (20261007100000): the AMC audit trail refuses changes loudly, and
-- deleting a user who appears in it is an ordinary foreign-key refusal.

INSERT INTO public.user_profile (id, email) VALUES ('97d00000-0000-0000-0000-000000000001', 'auditor@test.local');
INSERT INTO public.amc_audit_events (entity_type, event_type, actor_id, actor_label)
VALUES ('settings', 'settings_updated', '97d00000-0000-0000-0000-000000000001', 'Auditor');

DO $$
BEGIN
  -- No silent rules left.
  IF EXISTS (SELECT 1 FROM pg_rules WHERE tablename = 'amc_audit_events') THEN
    RAISE EXCEPTION 'a rule remains on amc_audit_events';
  END IF;

  -- Deleting the actor: a clean foreign-key violation, never the old internal error.
  BEGIN
    DELETE FROM public.user_profile WHERE id = '97d00000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'deleting an audited user was allowed';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
    WHEN internal_error THEN RAISE EXCEPTION 'still the internal RI error';
  END;
  IF NOT EXISTS (SELECT 1 FROM public.amc_audit_events WHERE actor_id = '97d00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'the audit row lost its actor';
  END IF;

  -- UPDATE and DELETE raise instead of silently doing nothing.
  BEGIN
    UPDATE public.amc_audit_events SET event_type = 'tampered' WHERE actor_id = '97d00000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'an audit row was updated';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'amc_audit_events is append-only%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.amc_audit_events WHERE actor_id = '97d00000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'an audit row was deleted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'amc_audit_events is append-only%' THEN RAISE; END IF;
  END;

  IF (SELECT confdeltype FROM pg_constraint WHERE conname = 'amc_audit_events_actor_id_fkey') <> 'a' THEN
    RAISE EXCEPTION 'actor FK is not NO ACTION';
  END IF;
END $$;
\echo 97d audit guard: all checks pass
