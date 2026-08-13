-- =====================================================
-- Migration: Scheduled FSM change-detection reconciliation cron job
-- Description: Periodically detects direct Zoho FSM changes to
--              schedule-relevant appointments (SYNC-014), calling the
--              zoho-fsm-reconcile Edge Function. Mirrors the existing
--              zoho-token-refresh / zoho-technician-refresh pg_cron jobs.
-- =====================================================

SELECT cron.schedule(
  'zoho-fsm-reconcile',
  '*/10 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://ulqitebapobdtsqvbucd.supabase.co/functions/v1/zoho-fsm-reconcile',
        headers:=jsonb_build_object(),
        timeout_milliseconds:=25000
    );
  $$
);
