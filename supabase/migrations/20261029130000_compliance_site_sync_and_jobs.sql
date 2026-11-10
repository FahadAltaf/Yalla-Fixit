-- Migration: Manpower Compliance current site from FSM + scheduled job log
-- Description: Sharon's action points C3 and C4 (28 Oct 2026), decided by
--              Sami on 29 Oct 2026. The current site of an employee linked to
--              an FSM technician is the client and address of the
--              appointment that technician is on RIGHT NOW (blank when none),
--              read from Zoho FSM directly (Q2, 30 Oct 2026).
--              A scheduled job recomputes it; every run is logged.
--              Additive, no data change. Safe to run again (every
--              statement is IF NOT EXISTS or replaces itself).

ALTER TABLE public.compliance_employees
  ADD COLUMN IF NOT EXISTS site_source TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS site_client_name TEXT,
  ADD COLUMN IF NOT EXISTS site_address TEXT,
  ADD COLUMN IF NOT EXISTS site_fsm_appointment_id TEXT,
  ADD COLUMN IF NOT EXISTS site_fsm_work_order_id TEXT,
  ADD COLUMN IF NOT EXISTS site_fsm_appointment_name TEXT,
  ADD COLUMN IF NOT EXISTS site_fsm_work_order_name TEXT,
  ADD COLUMN IF NOT EXISTS site_appointment_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS site_appointment_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS site_synced_at TIMESTAMPTZ;

ALTER TABLE public.compliance_employees DROP CONSTRAINT IF EXISTS compliance_employees_site_source_check;
ALTER TABLE public.compliance_employees ADD CONSTRAINT compliance_employees_site_source_check
  CHECK (site_source IN ('none', 'fsm', 'manual'));

COMMENT ON COLUMN public.compliance_employees.site_source IS
  'Where the current site came from: fsm = the technician''s appointment in progress at site_synced_at; manual = the older picker; none = blank.';

-- One row per scheduled or manual run of a compliance job (C4).
CREATE TABLE IF NOT EXISTS public.compliance_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'cron',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN,
  summary JSONB,
  error TEXT,
  CONSTRAINT compliance_job_runs_job_check CHECK (job IN ('site_sync', 'reminders')),
  CONSTRAINT compliance_job_runs_trigger_check CHECK (trigger IN ('cron', 'manual'))
);
CREATE INDEX IF NOT EXISTS compliance_job_runs_job_idx ON public.compliance_job_runs (job, started_at DESC);

ALTER TABLE public.compliance_job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.compliance_job_runs FROM anon, authenticated;

SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compliance_employees' AND column_name = 'site_source') AS site_columns,
  to_regclass('public.compliance_job_runs') AS job_runs;
