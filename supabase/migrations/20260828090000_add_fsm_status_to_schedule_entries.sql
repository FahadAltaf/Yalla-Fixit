-- =====================================================
-- Migration: Persist the Zoho FSM appointment status on schedule entries
-- Description: The schedule display screen colour-codes appointments by the
--              real job status (scheduled / in progress / completed /
--              delayed). Reconcile already reads Status off every FSM
--              appointment it checks, but discarded it -- so the portal had
--              no idea whether a job had actually started or finished.
--
--              We store FSM's raw status string rather than an enum: Zoho
--              picklists are editable per-org, and a value we don't
--              recognise should degrade to "scheduled" on the board rather
--              than break a CHECK constraint on write. The mapping from
--              this string to a display colour lives in application code
--              (lib/scheduling/appointment-status.ts).
-- =====================================================

ALTER TABLE public.schedule_entries
  ADD COLUMN IF NOT EXISTS fsm_status TEXT,
  ADD COLUMN IF NOT EXISTS fsm_status_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.schedule_entries.fsm_status
  IS 'Raw Zoho FSM Service_Appointment Status (e.g. New, Dispatched, In Progress, Completed, Cancelled). NULL until reconcile has seen the appointment. Mapped to a display colour in application code.';

COMMENT ON COLUMN public.schedule_entries.fsm_status_checked_at
  IS 'When fsm_status was last refreshed from FSM, so the display can show how fresh the board is.';

-- The display screen asks for one operating date at a time and cares only
-- about entries that are actually live in FSM.
CREATE INDEX IF NOT EXISTS idx_schedule_entries_operating_date_status
  ON public.schedule_entries (operating_date, fsm_status);
