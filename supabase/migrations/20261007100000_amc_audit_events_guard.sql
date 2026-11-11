-- =====================================================================
-- AMC audit trail: refuse changes loudly; keep the actor on user deletion
--
-- NOT APPLIED. Branch amc-hardening (Phase 0, 7 Oct 2026).
-- SAFE BEFORE CODE DEPLOY. Checked against origin/main, 7 Oct 2026: live
-- `main` only inserts into amc_audit_events and never updates or deletes
-- it, so nothing it does changes.
--
-- The problem (live in production since 20260915130000):
--   amc_audit_events is protected by two RULEs, "DO INSTEAD NOTHING" on
--   UPDATE and on DELETE, while actor_id is ON DELETE SET NULL. Deleting
--   a user who ever acted on a proposal makes the foreign key try to null
--   the actor; the rule silently cancels that update; PostgreSQL then
--   fails the delete with an internal referential-integrity error. And any
--   UPDATE or DELETE a bug might issue "succeeds" while changing nothing.
--
-- After this migration:
--   * UPDATE, DELETE and TRUNCATE raise a clear error (append-only
--     trigger instead of the silent rules).
--   * actor_id is ON DELETE NO ACTION: deleting a user who appears in the
--     audit trail is refused with an ordinary foreign-key error, which the
--     portal already turns into "Deactivate the user instead" (409). The
--     audit rows keep their actor.
-- Idempotent: safe to run twice.
-- =====================================================================

DROP RULE IF EXISTS amc_audit_events_no_update ON public.amc_audit_events;
DROP RULE IF EXISTS amc_audit_events_no_delete ON public.amc_audit_events;

CREATE OR REPLACE FUNCTION public.amc_audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'amc_audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

REVOKE ALL ON FUNCTION public.amc_audit_events_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS amc_audit_events_append_only_rows ON public.amc_audit_events;
CREATE TRIGGER amc_audit_events_append_only_rows
  BEFORE UPDATE OR DELETE ON public.amc_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.amc_audit_events_append_only();

DROP TRIGGER IF EXISTS amc_audit_events_append_only_truncate ON public.amc_audit_events;
CREATE TRIGGER amc_audit_events_append_only_truncate
  BEFORE TRUNCATE ON public.amc_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.amc_audit_events_append_only();

/* The actor stays recorded: a user in the trail is deactivated, not deleted. */
ALTER TABLE public.amc_audit_events
  DROP CONSTRAINT IF EXISTS amc_audit_events_actor_id_fkey;
ALTER TABLE public.amc_audit_events
  ADD CONSTRAINT amc_audit_events_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES public.user_profile(id) ON DELETE NO ACTION NOT VALID;
ALTER TABLE public.amc_audit_events VALIDATE CONSTRAINT amc_audit_events_actor_id_fkey;

-- ---------------------------------------------------------------------
-- Rollback (restores the previous behaviour, including its defect):
--   DROP TRIGGER amc_audit_events_append_only_rows ON public.amc_audit_events;
--   DROP TRIGGER amc_audit_events_append_only_truncate ON public.amc_audit_events;
--   DROP FUNCTION public.amc_audit_events_append_only();
--   ALTER TABLE public.amc_audit_events DROP CONSTRAINT amc_audit_events_actor_id_fkey;
--   ALTER TABLE public.amc_audit_events ADD CONSTRAINT amc_audit_events_actor_id_fkey
--     FOREIGN KEY (actor_id) REFERENCES public.user_profile(id) ON DELETE SET NULL;
--   CREATE RULE amc_audit_events_no_update AS ON UPDATE TO public.amc_audit_events DO INSTEAD NOTHING;
--   CREATE RULE amc_audit_events_no_delete AS ON DELETE TO public.amc_audit_events DO INSTEAD NOTHING;
-- ---------------------------------------------------------------------
