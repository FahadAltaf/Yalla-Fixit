-- =====================================================
-- Migration: Human-readable FSM names on schedule entries
-- Description: The schedule grid was labelling entries with the raw Zoho
--              record ids (e.g. 33246000001629781), which are meaningless to
--              a scheduler. Store the display names FSM already returns on
--              lookup (WO2361 / AP1043) so the grid can show those instead.
--              Ids are retained -- they remain the sync key.
-- =====================================================

ALTER TABLE public.schedule_entries
  ADD COLUMN IF NOT EXISTS fsm_work_order_name TEXT,
  ADD COLUMN IF NOT EXISTS fsm_appointment_name TEXT;

COMMENT ON COLUMN public.schedule_entries.fsm_work_order_name
  IS 'Zoho FSM work order display name (e.g. WO2361). Shown on the grid; fsm_work_order_id stays the sync key.';
COMMENT ON COLUMN public.schedule_entries.fsm_appointment_name
  IS 'Zoho FSM service appointment display name (e.g. AP1043). NULL until a new_appointment entry is created in FSM on approval.';
