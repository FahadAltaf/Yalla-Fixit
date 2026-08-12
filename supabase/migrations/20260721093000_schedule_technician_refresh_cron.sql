-- =====================================================
-- Migration: Scheduled technician refresh cron job
-- Description: Periodically refreshes public.technician_reference from
--              Zoho FSM (FRD Section 12.6, "scheduled refresh of the
--              technician list"). Mirrors the existing zoho-token-refresh
--              pg_cron job that already calls the token-refresher Edge
--              Function via pg_net.
-- =====================================================

SELECT cron.schedule(
  'zoho-technician-refresh',
  '*/30 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://ulqitebapobdtsqvbucd.supabase.co/functions/v1/zoho-fsm-service-resources',
        headers:=jsonb_build_object(),
        timeout_milliseconds:=15000
    );
  $$
);
