-- =====================================================================
-- Finance & Reports: working hours and dated technician history
-- (Sami's answers, 28 Oct: an 8-hour day, 12 hours for some data centre
-- staff; past reports keep the shift and team a technician had then).
--
-- technician_reference.daily_hours
--     Hours a working day, net of breaks. Null = the standard day
--     (Settings -> Reporting, 8 h). Set to 12 for data centre staff.
--
-- public.technician_attribute_history
--     One row per change of a technician's shift, team leader, rest days
--     or daily hours, with the day it takes effect (Asia/Dubai). The
--     reports read the value in force on each day, so a change today does
--     not rewrite last month.
--       - Recorded by a trigger on technician_reference, so every way the
--         columns change is caught: this branch's Scheduling page and live
--         main's alike. The first change of a field also records the value
--         it replaced, effective from 2000-01-01, so history is exact from
--         the day this migration is applied.
--       - Seeded from the Scheduling audit log (technician_attributes_
--         updated, since 7 Sep), which holds each change but not the value
--         before it: before a field's first logged change, the reports use
--         that first value.
--
-- Live-safe: one nullable column, one new table, one trigger that only
-- inserts into the new table. The trigger function is SECURITY DEFINER so
-- a technician edit made with any role still records its history (the
-- table has no policies and no grants for anon or authenticated). No FK to
-- technician_reference: the FSM technician sync deletes technicians who
-- left FSM and relies on FK violations to decide delete-or-deactivate; a
-- new FK would change what it does. Idempotent: safe to run twice.
--
-- Apply with the checks in docs/finance-reporting/migrations/20261028100000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261028100000_rollback.sql.
-- =====================================================================

ALTER TABLE public.technician_reference
  ADD COLUMN IF NOT EXISTS daily_hours numeric(4, 2)
    CHECK (daily_hours IS NULL OR (daily_hours > 0 AND daily_hours <= 24));

COMMENT ON COLUMN public.technician_reference.daily_hours
  IS 'Hours a working day, net of breaks. Null = the standard day in Reporting settings (8 h).';

CREATE TABLE IF NOT EXISTS public.technician_attribute_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fsm_resource_id text NOT NULL,
  field text NOT NULL CHECK (field IN ('shift', 'team_leader_fsm_id', 'rest_weekdays', 'daily_hours')),
  value jsonb,
  effective_date date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('edit', 'before_first_edit', 'audit_seed'))
);

CREATE INDEX IF NOT EXISTS idx_technician_attribute_history_tech
  ON public.technician_attribute_history (fsm_resource_id, field, effective_date, recorded_at);

ALTER TABLE public.technician_attribute_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.technician_attribute_history FROM anon, authenticated;

COMMENT ON TABLE public.technician_attribute_history
  IS 'Dated changes of a technician''s shift, team leader, rest days and daily hours, for reports of past periods.';

-- ---------------------------------------------------------------------
-- The trigger: one row per changed field
-- ---------------------------------------------------------------------
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
  FOREACH f IN ARRAY ARRAY['shift', 'team_leader_fsm_id', 'rest_weekdays', 'daily_hours'] LOOP
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
  AFTER UPDATE OF shift, team_leader_fsm_id, rest_weekdays, daily_hours ON public.technician_reference
  FOR EACH ROW EXECUTE FUNCTION public.record_technician_attribute_history();

-- ---------------------------------------------------------------------
-- Seed from the Scheduling audit log (once: skipped when already seeded)
-- ---------------------------------------------------------------------
INSERT INTO public.technician_attribute_history (fsm_resource_id, field, value, effective_date, recorded_at, source)
SELECT ids.fsm_resource_id,
       p.key,
       p.value,
       (e.created_at AT TIME ZONE 'Asia/Dubai')::date,
       e.created_at,
       'audit_seed'
FROM public.schedule_audit_events e
CROSS JOIN LATERAL jsonb_array_elements_text(e.after_value -> 'fsmResourceIds') AS ids(fsm_resource_id)
CROSS JOIN LATERAL jsonb_each(e.after_value -> 'patch') AS p(key, value)
WHERE e.event_type = 'technician_attributes_updated'
  AND p.key IN ('shift', 'team_leader_fsm_id', 'rest_weekdays', 'daily_hours')
  AND NOT EXISTS (SELECT 1 FROM public.technician_attribute_history WHERE source = 'audit_seed');

NOTIFY pgrst, 'reload schema';
