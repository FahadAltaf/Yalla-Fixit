-- =====================================================
-- Migration: Retire the scheduling pg_cron jobs and drop dead objects
-- Description: Scheduling consolidation, phases 2 and 3.
--
--   * Removes the zoho-technician-refresh (*/30) and zoho-fsm-reconcile
--     (*/10) pg_cron jobs. Both called Edge Functions that now live in the
--     Next.js backend (lib/server/zoho/*), and both are replaced by
--     on-demand work:
--       - technicians: refreshTechniciansIfStale() tops the roster up when
--         the scheduling screen is opened and the cache is older than 6h.
--         The roster changes a handful of times a month; polling it 48x a
--         day was ~1,400 wasted Zoho calls monthly.
--       - reconcile: POST /api/scheduling/reconcile runs when a scheduler
--         opens or refreshes a day, scoped to that day's entries. Per its
--         own logic reconcile no longer raises a review flag -- it just
--         adopts FSM's times -- so running it while nobody is looking at
--         the board bought nothing.
--     Both jobs also hard-coded a project URL that no longer matches the
--     app's SUPABASE_URL, so they were very likely already no-ops.
--
--   * Drops public.fsm_appointment_snapshots. It was written on every sync
--     and every reconcile pass but never read by anything: the reconcile
--     baseline is schedule_entries.fsm_last_modified_marker, compared
--     directly against the entry.
--
--   * Drops daily_schedules.has_fsm_changes, which is only ever set to
--     FALSE and never TRUE (the "changed in FSM" flow was removed when
--     reconcile switched to adopting FSM values silently).
-- =====================================================

-- Guarded so the migration is safe on a database where the jobs were never
-- installed (e.g. a fresh local stack, or the project the URLs pointed at).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'zoho-technician-refresh') THEN
      PERFORM cron.unschedule('zoho-technician-refresh');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'zoho-fsm-reconcile') THEN
      PERFORM cron.unschedule('zoho-fsm-reconcile');
    END IF;
  END IF;
END
$$;

DROP TABLE IF EXISTS public.fsm_appointment_snapshots;

ALTER TABLE public.daily_schedules
  DROP COLUMN IF EXISTS has_fsm_changes;
