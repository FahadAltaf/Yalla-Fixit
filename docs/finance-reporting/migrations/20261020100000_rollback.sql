-- Rollback for 20261020100000_reporting_platform. Review before running;
-- never run automatically. Drops the three tables and their data.
BEGIN;
DROP TABLE IF EXISTS public.portal_notifications;
DROP TABLE IF EXISTS public.reporting_audit_events;
DROP FUNCTION IF EXISTS public.reporting_audit_events_append_only();
DROP TABLE IF EXISTS public.reporting_settings;
COMMIT;
