-- Rollback for 20261028100000_technician_hours_history. Drops the dated
-- history and the daily-hours column; shifts, teams and rest days are
-- untouched.
DROP TRIGGER IF EXISTS technician_attribute_history_on_update ON public.technician_reference;
DROP FUNCTION IF EXISTS public.record_technician_attribute_history();
DROP TABLE IF EXISTS public.technician_attribute_history;
ALTER TABLE public.technician_reference DROP COLUMN IF EXISTS daily_hours;
NOTIFY pgrst, 'reload schema';
