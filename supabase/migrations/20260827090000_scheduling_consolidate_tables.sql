-- =====================================================
-- Migration: Scheduling consolidation, phases 4-6 (13 tables -> 8)
-- Description: Structural consolidation only -- no behaviour change.
--
--   Phase 4  technician_roles + technician_service_types + technician_tags
--            -> public.lookup_options, keyed by list_key
--            technician_tag_assignments
--            -> public.technician_lookup_assignments
--
--   Phase 5  schedule_approval_actions + schedule_sync_operations
--            -> folded into public.schedule_audit_events
--
--   Phase 6  daily_schedules -> folded into public.schedule_versions
--            (schedule_date moves onto the version; is_current replaces
--            the daily_schedules.current_version_id pointer)
--
-- Note: leave_records.leave_type is deliberately left as free TEXT. Making
-- it a managed list would change the leave form from a text input to a
-- picker -- a user-facing change, not a consolidation -- and it is not
-- needed to reach 8 tables.
-- =====================================================


-- =====================================================
-- Phase 4: one table for every managed dropdown
-- =====================================================

CREATE TABLE IF NOT EXISTS public.lookup_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which list this option belongs to: 'technician_role',
  -- 'technician_service_type', 'technician_tag', ... Adding a new managed
  -- dropdown anywhere in the portal is now an INSERT, not a migration.
  list_key TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Drives display order within a list (lower shows first): Data Center
  -- before Maintenance, etc. (#14).
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lookup_options_name_not_empty CHECK (LENGTH(TRIM(name)) > 0),
  CONSTRAINT lookup_options_list_key_not_empty CHECK (LENGTH(TRIM(list_key)) > 0)
);

-- #16 / TAG-002: no duplicate names within a list, case-insensitive, so
-- "Driver" and "driver" can't both exist. Names MAY repeat across lists.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lookup_options_key_name_ci
  ON public.lookup_options (list_key, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_lookup_options_list_key
  ON public.lookup_options (list_key, sort_order);

-- Many-to-many technician attributes (currently just tags). Single-value
-- attributes -- role, service type -- stay as FK columns on
-- technician_reference; only genuinely repeating ones live here.
CREATE TABLE IF NOT EXISTS public.technician_lookup_assignments (
  technician_fsm_id TEXT NOT NULL
    REFERENCES public.technician_reference(fsm_resource_id) ON DELETE CASCADE,
  lookup_id UUID NOT NULL REFERENCES public.lookup_options(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (technician_fsm_id, lookup_id)
);

CREATE INDEX IF NOT EXISTS idx_technician_lookup_assignments_lookup
  ON public.technician_lookup_assignments (lookup_id);

-- Carry the existing rows across, KEEPING THEIR ids. That matters: it means
-- technician_reference.role_id / .service_type_id stay valid and every
-- technician keeps the role, service type and tags already assigned to them.
INSERT INTO public.lookup_options (id, list_key, name, sort_order, created_at, updated_at)
  SELECT id, 'technician_role', name, sort_order, created_at, updated_at
  FROM public.technician_roles
ON CONFLICT DO NOTHING;

INSERT INTO public.lookup_options (id, list_key, name, sort_order, created_at, updated_at)
  SELECT id, 'technician_service_type', name, sort_order, created_at, updated_at
  FROM public.technician_service_types
ON CONFLICT DO NOTHING;

INSERT INTO public.lookup_options
    (id, list_key, name, sort_order, created_by, created_at, updated_by, updated_at)
  SELECT id, 'technician_tag', name, 100, created_by, created_at, updated_by, updated_at
  FROM public.technician_tags
ON CONFLICT DO NOTHING;

INSERT INTO public.technician_lookup_assignments
    (technician_fsm_id, lookup_id, assigned_by, assigned_at)
  SELECT technician_fsm_id, tag_id, assigned_by, assigned_at
  FROM public.technician_tag_assignments
ON CONFLICT DO NOTHING;

-- CASCADE also drops the technician_reference.role_id / .service_type_id
-- foreign keys that pointed at these tables; the columns keep their values
-- and are repointed at lookup_options below.
DROP TABLE IF EXISTS public.technician_tag_assignments;
DROP TABLE IF EXISTS public.technician_tags;
DROP TABLE IF EXISTS public.technician_roles CASCADE;
DROP TABLE IF EXISTS public.technician_service_types CASCADE;

ALTER TABLE public.technician_reference
  ADD CONSTRAINT technician_reference_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES public.lookup_options(id) ON DELETE SET NULL,
  ADD CONSTRAINT technician_reference_service_type_id_fkey
    FOREIGN KEY (service_type_id) REFERENCES public.lookup_options(id) ON DELETE SET NULL;

-- Defaults YFI named, in case the source lists were empty. sort_order
-- encodes the default view order; ON CONFLICT keeps any existing row.
INSERT INTO public.lookup_options (list_key, name, sort_order) VALUES
  ('technician_role', 'Supervisor', 10),
  ('technician_role', 'Driver', 20),
  ('technician_role', 'Technician', 30),
  ('technician_service_type', 'Data Center', 10),
  ('technician_service_type', 'Maintenance', 20)
ON CONFLICT DO NOTHING;


-- =====================================================
-- Phase 5: one audit trail instead of three
-- =====================================================

-- schedule_approval_actions and schedule_sync_operations recorded events
-- that schedule_audit_events ALREADY recorded -- submit/approve/reject was
-- written to all three places (the third being the decision columns on
-- schedule_versions, which remain the authoritative current state). These
-- columns let the one surviving table carry what the other two added.
ALTER TABLE public.schedule_audit_events
  ADD COLUMN IF NOT EXISTS schedule_entry_id UUID
    REFERENCES public.schedule_entries(id) ON DELETE SET NULL,
  -- 'succeeded' | 'failed' | 'pending' for sync events; NULL otherwise.
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  -- Idempotency/correlation key for a sync attempt (SYNC-008/SYNC-010).
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

CREATE INDEX IF NOT EXISTS idx_schedule_audit_events_entry
  ON public.schedule_audit_events (schedule_entry_id);

CREATE INDEX IF NOT EXISTS idx_schedule_audit_events_version_type
  ON public.schedule_audit_events (schedule_version_id, event_type);

DROP TABLE IF EXISTS public.schedule_approval_actions;
DROP TABLE IF EXISTS public.schedule_sync_operations;


-- =====================================================
-- Phase 6: the day IS the version
-- =====================================================

-- daily_schedules carried only schedule_date plus a current_version_id
-- pointer that duplicated schedule_versions.is_current -- two sources of
-- truth that four separate routes had to keep in step by hand. Moving the
-- date onto the version removes the table, the join, and that whole class
-- of bug.
ALTER TABLE public.schedule_versions
  ADD COLUMN IF NOT EXISTS schedule_date DATE;

UPDATE public.schedule_versions v
  SET schedule_date = d.schedule_date
  FROM public.daily_schedules d
  WHERE v.daily_schedule_id = d.id AND v.schedule_date IS NULL;

ALTER TABLE public.schedule_versions
  ALTER COLUMN schedule_date SET NOT NULL;

-- Replaces UNIQUE (daily_schedule_id, version_number).
ALTER TABLE public.schedule_versions
  DROP CONSTRAINT IF EXISTS schedule_versions_daily_schedule_version_number_key;

ALTER TABLE public.schedule_versions
  ADD CONSTRAINT schedule_versions_date_version_number_key
  UNIQUE (schedule_date, version_number);

-- BR-017: exactly one current version per operating date. This partial
-- unique index is now the ONLY definition of "the current version",
-- replacing daily_schedules.current_version_id.
DROP INDEX IF EXISTS public.idx_schedule_versions_one_current_per_day;

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_versions_one_current_per_date
  ON public.schedule_versions (schedule_date)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_schedule_versions_schedule_date
  ON public.schedule_versions (schedule_date);

ALTER TABLE public.schedule_versions
  DROP COLUMN IF EXISTS daily_schedule_id;

DROP TABLE IF EXISTS public.daily_schedules;


-- =====================================================
-- RLS: match the existing scheduling convention
-- =====================================================

ALTER TABLE public.lookup_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_lookup_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on lookup_options" ON public.lookup_options;
CREATE POLICY "Allow All on lookup_options"
ON public.lookup_options FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on technician_lookup_assignments" ON public.technician_lookup_assignments;
CREATE POLICY "Allow All on technician_lookup_assignments"
ON public.technician_lookup_assignments FOR ALL TO public USING (true) WITH CHECK (true);
