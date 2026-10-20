-- Rollback for 20261020110000_people_reporting_fields. Review before
-- running; never run automatically. Drops the new columns (and the values
-- entered in them) and the holiday calendar.
BEGIN;
DROP TABLE IF EXISTS public.org_public_holidays;
ALTER TABLE public.leave_records DROP COLUMN IF EXISTS leave_category;
ALTER TABLE public.user_profile DROP COLUMN IF EXISTS hidden_from_lists;
DROP INDEX IF EXISTS public.idx_technician_reference_user_profile;
ALTER TABLE public.technician_reference
  DROP CONSTRAINT IF EXISTS technician_reference_resigned_has_leaving_date,
  DROP COLUMN IF EXISTS rest_weekdays,
  DROP COLUMN IF EXISTS hidden_from_lists,
  DROP COLUMN IF EXISTS leaving_date,
  DROP COLUMN IF EXISTS employment_status,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS user_profile_id;
COMMIT;
