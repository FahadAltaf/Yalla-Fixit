-- =====================================================
-- Migration: Service Appointment creation details
-- Description: When the team creates a NEW appointment in FSM (not linking an
--              existing one) they must choose which service line(s) it covers,
--              the appointment Type, and the schedule type (Time-bound or All
--              Day). These are stored on the entry at draft time and sent to
--              FSM on approval. Matches the fields Zoho FSM's
--              Create Service Appointment API actually requires — the previous
--              code sent the wrong ids for $Service_Line_Items, which is why
--              creation failed.
-- =====================================================

ALTER TABLE public.schedule_entries
  -- FSM appointment Type picklist: -None-, Service, Inspection, Installation,
  -- Maintenance, Emergency, Scheduled Maintenance, Standard.
  ADD COLUMN IF NOT EXISTS fsm_appointment_type TEXT,
  -- 'Time-bound' (uses start/end) or 'All Day' (uses the operating date).
  ADD COLUMN IF NOT EXISTS fsm_schedule_type TEXT NOT NULL DEFAULT 'Time-bound'
    CHECK (fsm_schedule_type IN ('Time-bound', 'All Day')),
  -- The Service_Line_Item ids (SVC-xxxx) this appointment covers.
  ADD COLUMN IF NOT EXISTS fsm_service_line_item_ids JSONB,
  -- The Service_Tasks_Line_Item ids, only present when the work order has them.
  ADD COLUMN IF NOT EXISTS fsm_service_task_line_item_ids JSONB;

COMMENT ON COLUMN public.schedule_entries.fsm_service_line_item_ids
  IS 'Array of Zoho FSM Service_Line_Item ids ($Service_Line_Items) this new appointment covers. Required for new_appointment entries.';
COMMENT ON COLUMN public.schedule_entries.fsm_schedule_type
  IS 'Time-bound (Scheduled_Start/End) or All Day (Appointment_Date). All-Day entries render as a full-width bar on the grid.';
