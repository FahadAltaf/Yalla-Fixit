-- =====================================================
-- Migration: Scheduling module settings and approver flag
-- Description: Adds organisation timezone/shift-boundary configuration
--              (AUD-006) and the sole schedule-approver identity flag
--              (BR-002, APR-003) used by the Scheduling and Dispatch module.
-- =====================================================

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS org_timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  ADD COLUMN IF NOT EXISTS night_shift_start TIME NOT NULL DEFAULT '00:00',
  ADD COLUMN IF NOT EXISTS night_shift_end TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS day_shift_start TIME NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS day_shift_end TIME NOT NULL DEFAULT '17:00';

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS is_schedule_approver BOOLEAN NOT NULL DEFAULT FALSE;

-- BR-002: Behrouz is the sole schedule approver. This partial unique index
-- keeps at most one user flagged as approver at any time; reassigning the
-- identity is an explicit two-step update (unset old, set new).
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_single_schedule_approver
  ON public.user_profile (is_schedule_approver)
  WHERE is_schedule_approver = TRUE;

-- Shared audit trail for the scheduling module (AUD-002, AUD-003, AUD-008).
-- schedule_version_id has no FK yet because schedule_versions is created in
-- a later migration; the reference is added there once the table exists.
CREATE TABLE IF NOT EXISTS public.schedule_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  origin TEXT NOT NULL DEFAULT 'portal' CHECK (origin IN ('portal', 'fsm', 'system')),
  schedule_date DATE,
  schedule_version_id UUID,
  affected_entity_type TEXT,
  affected_entity_id TEXT,
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_audit_events_schedule_date
  ON public.schedule_audit_events (schedule_date);

CREATE INDEX IF NOT EXISTS idx_schedule_audit_events_entity
  ON public.schedule_audit_events (affected_entity_type, affected_entity_id);

CREATE INDEX IF NOT EXISTS idx_schedule_audit_events_created_at
  ON public.schedule_audit_events (created_at);

-- FSM-sourced technician cache shared by the leave module, tag module, and
-- the scheduling dashboard (LEAVE-001/002, TAG-006, Section 12.6).
CREATE TABLE IF NOT EXISTS public.technician_reference (
  fsm_resource_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_technician_reference_active
  ON public.technician_reference (is_active);

ALTER TABLE public.schedule_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_reference ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on schedule_audit_events" ON public.schedule_audit_events;
CREATE POLICY "Allow All on schedule_audit_events"
ON public.schedule_audit_events
FOR ALL
TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on technician_reference" ON public.technician_reference;
CREATE POLICY "Allow All on technician_reference"
ON public.technician_reference
FOR ALL
TO public
USING (true)
WITH CHECK (true);
