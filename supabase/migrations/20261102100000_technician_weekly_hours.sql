-- =====================================================================
-- Finance & Reports: each technician's working hours for utilization
-- (the user's direction, 2 Nov).
--
-- technician_reference.weekly_hours
--     The most hours a week the technician's contract allows (for example
--     48 or 60). Null: no weekly limit beyond daily hours x working days.
-- technician_reference.off_days_per_week
--     How many days off a week (not fixed weekdays). Null: 1.
--
-- daily_hours (8, 9 or 12 by contract) arrived with 20261028100000.
-- Utilization expects, each week, the smaller of the weekly limit and
-- daily hours x (7 - off days), less public holidays and leave, and counts
-- every hour worked, off days and holidays included.
--
-- Both new fields are recorded in technician_attribute_history like the
-- others (trigger extended), so a past period keeps the values of its
-- time.
--
-- Live-safe: two nullable columns; the trigger function is replaced with
-- the same behaviour for two more fields; the history field check is
-- widened. Idempotent.
-- Apply with the checks in docs/finance-reporting/migrations/20261102100000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261102100000_rollback.sql.
-- =====================================================================

ALTER TABLE public.technician_reference
  ADD COLUMN IF NOT EXISTS weekly_hours numeric(5, 2)
    CHECK (weekly_hours IS NULL OR (weekly_hours > 0 AND weekly_hours <= 168)),
  ADD COLUMN IF NOT EXISTS off_days_per_week smallint
    CHECK (off_days_per_week IS NULL OR (off_days_per_week >= 0 AND off_days_per_week <= 6));

COMMENT ON COLUMN public.technician_reference.weekly_hours
  IS 'Most hours a week the contract allows (e.g. 48, 60). Null: daily hours x working days.';
COMMENT ON COLUMN public.technician_reference.off_days_per_week
  IS 'Days off a week, not fixed weekdays. Null: 1.';

ALTER TABLE public.technician_attribute_history DROP CONSTRAINT IF EXISTS technician_attribute_history_field_check;
ALTER TABLE public.technician_attribute_history ADD CONSTRAINT technician_attribute_history_field_check
  CHECK (field IN ('shift', 'team_leader_fsm_id', 'rest_weekdays', 'daily_hours', 'weekly_hours', 'off_days_per_week'));

CREATE OR REPLACE FUNCTION public.record_technician_attribute_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Asia/Dubai')::date;
  f text;
  old_value jsonb;
  new_value jsonb;
BEGIN
  FOREACH f IN ARRAY ARRAY['shift', 'team_leader_fsm_id', 'rest_weekdays', 'daily_hours', 'weekly_hours', 'off_days_per_week'] LOOP
    old_value := to_jsonb(OLD) -> f;
    new_value := to_jsonb(NEW) -> f;
    IF old_value IS DISTINCT FROM new_value THEN
      /* The value being replaced, the first time this field changes, so earlier days keep it. */
      IF NOT EXISTS (
        SELECT 1 FROM public.technician_attribute_history h
        WHERE h.fsm_resource_id = NEW.fsm_resource_id AND h.field = f
      ) THEN
        INSERT INTO public.technician_attribute_history (fsm_resource_id, field, value, effective_date, source)
        VALUES (NEW.fsm_resource_id, f, old_value, DATE '2000-01-01', 'before_first_edit');
      END IF;
      INSERT INTO public.technician_attribute_history (fsm_resource_id, field, value, effective_date, source)
      VALUES (NEW.fsm_resource_id, f, new_value, today, 'edit');
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_technician_attribute_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS technician_attribute_history_on_update ON public.technician_reference;
CREATE TRIGGER technician_attribute_history_on_update
  AFTER UPDATE OF shift, team_leader_fsm_id, rest_weekdays, daily_hours, weekly_hours, off_days_per_week ON public.technician_reference
  FOR EACH ROW EXECUTE FUNCTION public.record_technician_attribute_history();

NOTIFY pgrst, 'reload schema';
