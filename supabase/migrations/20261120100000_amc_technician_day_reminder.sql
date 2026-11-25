-- =====================================================================
-- The technician's reminder on the day of a PPM visit (DEV-398, 20 Nov 2026)
--
-- BRD v0.4 5.11: "The client gets a reminder the day before and the
-- technician on the day." Technicians work in the YFI mobile app, not the
-- FSM app (20 Nov 2026 review of DEV-398), so the reminder is an alert in
-- that app: a row in snagging_notifications, which the existing database
-- webhook pushes to the technician's phone (app/api/snagging/push/send).
--
--   1. snagging_notifications takes a new type, amc_visit_today, and the
--      AMC record it points to (amc_kind, amc_id), so a tap opens the AMC
--      visit. job_id and visit_id stay for Snagging alerts.
--   2. amc_visits.technician_reminded_on: the day the crew was reminded,
--      claimed before sending, so overlapping runs remind once a day.
--
-- Live-safe: a wider CHECK, two nullable columns on the alerts table and
-- one on amc_visits. No data changes. Rollback at the end.
-- =====================================================================

-- 1. The alert type and its AMC link -----------------------------------
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.snagging_notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.snagging_notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.snagging_notifications
  ADD CONSTRAINT snagging_notifications_type_check CHECK (type IN (
    'assigned', 'rejected', 'rescheduled', 'approved',
    'visit_booked', 'visit_sent_back', 'visit_rescheduled',
    'amc_visit_today'
  ));

ALTER TABLE public.snagging_notifications
  ADD COLUMN IF NOT EXISTS amc_kind text,
  ADD COLUMN IF NOT EXISTS amc_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snagging_notifications_amc_kind_check') THEN
    ALTER TABLE public.snagging_notifications ADD CONSTRAINT snagging_notifications_amc_kind_check
      CHECK (amc_kind IS NULL OR amc_kind IN ('ppm', 'call_out', 'additional_work', 'site_visit'));
  END IF;
END $$;

COMMENT ON COLUMN public.snagging_notifications.amc_kind IS
  'An AMC alert (DEV-398): the kind of AMC visit it is about, as amc_field_visits.kind. Null for Snagging alerts.';
COMMENT ON COLUMN public.snagging_notifications.amc_id IS
  'An AMC alert (DEV-398): the AMC visit, call out or work it opens in the YFI app. Null for Snagging alerts.';

-- 2. Reminded once a day ------------------------------------------------
ALTER TABLE public.amc_visits
  ADD COLUMN IF NOT EXISTS technician_reminded_on date;

COMMENT ON COLUMN public.amc_visits.technician_reminded_on IS
  'DEV-398: the day (Dubai) the crew got the on-the-day reminder in the YFI app; claimed before sending, so it goes once.';

NOTIFY pgrst, 'reload schema';

-- Check (read-only):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'snagging_notifications_type_check';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'snagging_notifications' AND column_name IN ('amc_kind', 'amc_id');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'amc_visits' AND column_name = 'technician_reminded_on';

-- Rollback (only if asked; first delete any amc_visit_today rows):
-- DELETE FROM public.snagging_notifications WHERE type = 'amc_visit_today';
-- ALTER TABLE public.snagging_notifications DROP CONSTRAINT snagging_notifications_amc_kind_check;
-- ALTER TABLE public.snagging_notifications DROP COLUMN amc_kind, DROP COLUMN amc_id;
-- ALTER TABLE public.snagging_notifications DROP CONSTRAINT snagging_notifications_type_check;
-- ALTER TABLE public.snagging_notifications ADD CONSTRAINT snagging_notifications_type_check CHECK (type IN (
--   'assigned', 'rejected', 'rescheduled', 'approved', 'visit_booked', 'visit_sent_back', 'visit_rescheduled'));
-- ALTER TABLE public.amc_visits DROP COLUMN technician_reminded_on;
