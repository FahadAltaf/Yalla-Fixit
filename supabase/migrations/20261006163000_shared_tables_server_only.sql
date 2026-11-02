-- =====================================================================
-- Scheduling, FSM snapshot and Todo child tables: server-only
--
-- NOT APPLIED. Branch amc-hardening (security phase, 6 Oct 2026).
-- SAFE BEFORE CODE DEPLOY: the live main application (and this branch)
-- reach every one of these tables only through API routes with the service
-- role, except technician_reference, which one service reads with a
-- signed-in session; it keeps a read-only grant for authenticated users.
-- Checked on origin/main and amc-hardening, 6 Oct 2026.
--
-- Production (read-only, 6 Oct 2026): each table below has a policy
-- "Allow All on <table>" FOR ALL TO public USING (true), so the public anon
-- key (shipped in every page) can read and rewrite the schedule, leave
-- records, technicians, lookups and every todo comment and assignment.
-- Tables that do not exist are skipped, so the file is safe on any branch.
-- =====================================================================

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fsm_appointment_snapshots', 'leave_records', 'lookup_options',
    'schedule_entries', 'schedule_entry_assignments', 'schedule_versions',
    'technician_lookup_assignments', 'technician_reference',
    'todo_assignees', 'todo_comments', 'todo_tags', 'todo_updates'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    -- every open policy, whatever it is called
    FOR p IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t
         AND (qual = 'true' OR with_check = 'true')
         AND (roles && ARRAY['public', 'anon']::name[])
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    IF t = 'technician_reference' THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
      EXECUTE format('DROP POLICY IF EXISTS "technician_reference authenticated read" ON public.%I', t);
      EXECUTE format('CREATE POLICY "technician_reference authenticated read" ON public.%I FOR SELECT TO authenticated USING (true)', t);
    ELSE
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Rollback: per table,
--   GRANT ALL ON public.<t> TO anon, authenticated;
--   CREATE POLICY "Allow All on <t>" ON public.<t> FOR ALL TO public USING (true) WITH CHECK (true);
-- ---------------------------------------------------------------------
