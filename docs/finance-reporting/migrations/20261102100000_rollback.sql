-- Rollback for 20261102100000_technician_weekly_hours (never automatic; run by hand only if asked).
-- Drops the weekly limit and off days columns and their history rows; the trigger goes back to its four fields.
BEGIN;
DELETE FROM public.technician_attribute_history WHERE field IN ('weekly_hours', 'off_days_per_week');
ALTER TABLE public.technician_attribute_history DROP CONSTRAINT IF EXISTS technician_attribute_history_field_check;
ALTER TABLE public.technician_attribute_history ADD CONSTRAINT technician_attribute_history_field_check
  CHECK (field IN ('shift', 'team_leader_fsm_id', 'rest_weekdays', 'daily_hours'));
DROP TRIGGER IF EXISTS technician_attribute_history_on_update ON public.technician_reference;
CREATE TRIGGER technician_attribute_history_on_update
  AFTER UPDATE OF shift, team_leader_fsm_id, rest_weekdays, daily_hours ON public.technician_reference
  FOR EACH ROW EXECUTE FUNCTION public.record_technician_attribute_history();
ALTER TABLE public.technician_reference DROP COLUMN IF EXISTS weekly_hours, DROP COLUMN IF EXISTS off_days_per_week;
NOTIFY pgrst, 'reload schema';
COMMIT;
