-- =====================================================
-- Migration: Core scheduling module
-- Description: Daily schedules, versioned drafts/approvals, schedule
--              entries (FSM-backed and free-text), technician assignments,
--              FSM sync tracking, and approval history (FRD Section 7-9, 11).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.daily_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date DATE NOT NULL UNIQUE,
  has_fsm_changes BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.schedule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_schedule_id UUID NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'rejected', 'approved_syncing',
    'published', 'sync_failed', 'partially_synced',
    'published_fsm_changed', 'draft_revision'
  )),
  -- Set when this version was created as a revision of a previously
  -- published version (Section 7.3, APR-011).
  parent_version_id UUID REFERENCES public.schedule_versions(id),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  decided_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision TEXT CHECK (decision IN ('approved', 'rejected')),
  decision_comment TEXT,
  published_at TIMESTAMPTZ,
  CONSTRAINT schedule_versions_daily_schedule_version_number_key
    UNIQUE (daily_schedule_id, version_number),
  -- APR-006: rejection requires a reason.
  CONSTRAINT schedule_versions_rejection_requires_comment
    CHECK (decision IS DISTINCT FROM 'rejected' OR decision_comment IS NOT NULL)
);

-- BR-017: only one current version per operating date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_versions_one_current_per_day
  ON public.schedule_versions (daily_schedule_id)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_schedule_versions_status
  ON public.schedule_versions (status);

ALTER TABLE public.daily_schedules
  ADD COLUMN IF NOT EXISTS current_version_id UUID REFERENCES public.schedule_versions(id);

CREATE TABLE IF NOT EXISTS public.schedule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version_id UUID NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('existing_appointment', 'new_appointment', 'free_text')),
  shift TEXT NOT NULL CHECK (shift IN ('day', 'night')),
  operating_date DATE NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  -- FSM references. fsm_work_order_id/fsm_appointment_id are Required
  -- before submission for FSM-backed entries (PLAN-010); appointment id
  -- stays NULL for 'new_appointment' until approval creates it (BR-009).
  fsm_work_order_id TEXT,
  fsm_appointment_id TEXT,
  fsm_last_modified_marker TEXT,
  title TEXT,
  client_name TEXT,
  contact_name TEXT,
  address TEXT,
  notes TEXT,
  origin TEXT NOT NULL DEFAULT 'portal' CHECK (origin IN ('portal', 'fsm', 'system')),
  sync_status TEXT NOT NULL DEFAULT 'not_ready' CHECK (sync_status IN (
    'not_ready', 'ready', 'syncing', 'synced', 'failed', 'review_required'
  )),
  changed_in_fsm_at TIMESTAMPTZ,
  changed_in_fsm_fields JSONB,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_entries_end_after_start CHECK (end_at > start_at),
  -- PLAN-015/BR-012: free-text entries never carry FSM references.
  CONSTRAINT schedule_entries_free_text_has_no_fsm_refs
    CHECK (entry_type <> 'free_text' OR (fsm_work_order_id IS NULL AND fsm_appointment_id IS NULL)),
  CONSTRAINT schedule_entries_free_text_requires_title
    CHECK (entry_type <> 'free_text' OR (title IS NOT NULL AND LENGTH(TRIM(title)) > 0)),
  -- PLAN-006/BR-005: FSM-backed entries must reference their work order.
  CONSTRAINT schedule_entries_fsm_backed_requires_work_order
    CHECK (entry_type = 'free_text' OR fsm_work_order_id IS NOT NULL),
  -- BR-008: an existing_appointment entry must already carry its appointment id.
  CONSTRAINT schedule_entries_existing_requires_appointment
    CHECK (entry_type <> 'existing_appointment' OR fsm_appointment_id IS NOT NULL)
);

-- PLAN-018: one logical FSM appointment appears at most once per version.
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_entries_unique_appointment_per_version
  ON public.schedule_entries (schedule_version_id, fsm_appointment_id)
  WHERE fsm_appointment_id IS NOT NULL;

-- One work order can only be pending creation once per version (no duplicate
-- "Pending Appointment Creation" entries for the same work order).
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_entries_unique_pending_work_order_per_version
  ON public.schedule_entries (schedule_version_id, fsm_work_order_id)
  WHERE entry_type = 'new_appointment';

CREATE INDEX IF NOT EXISTS idx_schedule_entries_version_shift
  ON public.schedule_entries (schedule_version_id, shift);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_sync_status
  ON public.schedule_entries (sync_status);

CREATE TABLE IF NOT EXISTS public.schedule_entry_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_entry_id UUID NOT NULL REFERENCES public.schedule_entries(id) ON DELETE CASCADE,
  technician_fsm_id TEXT NOT NULL REFERENCES public.technician_reference(fsm_resource_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_entry_assignments_unique UNIQUE (schedule_entry_id, technician_fsm_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_entry_assignments_technician
  ON public.schedule_entry_assignments (technician_fsm_id);

-- SYNC-008/SYNC-010: per-operation sync tracking with idempotent retry support.
CREATE TABLE IF NOT EXISTS public.schedule_sync_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version_id UUID NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  schedule_entry_id UUID REFERENCES public.schedule_entries(id) ON DELETE SET NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('create_appointment', 'update_appointment', 'reconcile')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'succeeded', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 1,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  error_category TEXT,
  error_message TEXT,
  response_summary JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_sync_operations_version_status
  ON public.schedule_sync_operations (schedule_version_id, status);

CREATE INDEX IF NOT EXISTS idx_schedule_sync_operations_entry
  ON public.schedule_sync_operations (schedule_entry_id);

-- APR-007: approval workflow history (submit/approve/reject/withdraw).
CREATE TABLE IF NOT EXISTS public.schedule_approval_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version_id UUID NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected', 'withdrawn')),
  actor_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_approval_actions_version
  ON public.schedule_approval_actions (schedule_version_id);

-- Change-detection cache for the polling reconciliation job (SYNC-014,
-- SYNC-017): last-seen state per FSM appointment, compared on each poll.
CREATE TABLE IF NOT EXISTS public.fsm_appointment_snapshots (
  fsm_appointment_id TEXT PRIMARY KEY,
  fsm_work_order_id TEXT,
  last_modified_marker TEXT,
  last_known_status TEXT,
  captured_fields JSONB,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_changed_detected_at TIMESTAMPTZ
);

-- Now that schedule_versions exists, wire up the audit table's FK
-- (table created in 20260721090000_add_scheduling_settings_and_approver.sql).
ALTER TABLE public.schedule_audit_events
  ADD CONSTRAINT schedule_audit_events_schedule_version_id_fkey
  FOREIGN KEY (schedule_version_id) REFERENCES public.schedule_versions(id) ON DELETE SET NULL;

ALTER TABLE public.daily_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_entry_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_approval_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fsm_appointment_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on daily_schedules" ON public.daily_schedules;
CREATE POLICY "Allow All on daily_schedules"
ON public.daily_schedules FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on schedule_versions" ON public.schedule_versions;
CREATE POLICY "Allow All on schedule_versions"
ON public.schedule_versions FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on schedule_entries" ON public.schedule_entries;
CREATE POLICY "Allow All on schedule_entries"
ON public.schedule_entries FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on schedule_entry_assignments" ON public.schedule_entry_assignments;
CREATE POLICY "Allow All on schedule_entry_assignments"
ON public.schedule_entry_assignments FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on schedule_sync_operations" ON public.schedule_sync_operations;
CREATE POLICY "Allow All on schedule_sync_operations"
ON public.schedule_sync_operations FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on schedule_approval_actions" ON public.schedule_approval_actions;
CREATE POLICY "Allow All on schedule_approval_actions"
ON public.schedule_approval_actions FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on fsm_appointment_snapshots" ON public.fsm_appointment_snapshots;
CREATE POLICY "Allow All on fsm_appointment_snapshots"
ON public.fsm_appointment_snapshots FOR ALL TO public USING (true) WITH CHECK (true);
