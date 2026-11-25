-- =====================================================================
-- Live notifications in the portal (23 Nov 2026)
--
-- A new notification shows straight away as a message in the corner that
-- stays until it is closed, and the bell count updates, through Supabase
-- Realtime (as the YFI app's alerts, snagging_notifications).
--
-- Realtime only delivers a row the signed-in person may read, so:
--   1. signed-in users may read THEIR OWN in-app, delivered notifications
--      (recipient_user_id = auth.uid()); nobody else's, and nothing else;
--   2. both notification tables are added to the Realtime feed.
-- The public (anon) key stays shut out: only `authenticated` gets SELECT,
-- and only through the policy. Writes stay with the server (service role).
--
-- Live-safe: no data changes; the portal keeps working without it (no
-- live messages until it is applied). Rollback at the end.
-- =====================================================================

GRANT SELECT ON public.portal_notifications TO authenticated;
GRANT SELECT ON public.amc_notifications TO authenticated;

DROP POLICY IF EXISTS portal_notifications_select_own ON public.portal_notifications;
CREATE POLICY portal_notifications_select_own
  ON public.portal_notifications FOR SELECT
  TO authenticated
  USING (recipient_user_id = auth.uid() AND channel = 'in_app' AND status = 'delivered');

DROP POLICY IF EXISTS amc_notifications_select_own ON public.amc_notifications;
CREATE POLICY amc_notifications_select_own
  ON public.amc_notifications FOR SELECT
  TO authenticated
  USING (recipient_user_id = auth.uid() AND channel = 'in_app' AND status = 'delivered');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'portal_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.portal_notifications;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'amc_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.amc_notifications;
  END IF;
END $$;

-- Check (read-only):
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('portal_notifications', 'amc_notifications');  -- 2 rows
--   select policyname from pg_policies where tablename in ('portal_notifications', 'amc_notifications');                                          -- the two *_select_own
--   The public key still reads nothing: select has_table_privilege('anon', 'public.amc_notifications', 'select');                                  -- f

-- Rollback:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.portal_notifications;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.amc_notifications;
--   DROP POLICY IF EXISTS portal_notifications_select_own ON public.portal_notifications;
--   DROP POLICY IF EXISTS amc_notifications_select_own ON public.amc_notifications;
--   REVOKE SELECT ON public.portal_notifications, public.amc_notifications FROM authenticated;
