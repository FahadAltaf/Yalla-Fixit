-- =====================================================
-- Migration: Structured technician attributes
-- Description: Adds managed Role and Service Type lists, plus a Shift and a
--              Team Leader on each technician. These sit alongside the
--              existing free-form tags (kept). They drive the schedule view's
--              grouping, ordering, shift visibility and filters.
-- =====================================================

-- Managed lookup: Role (Driver, Technician, Supervisor, ... extensible).
CREATE TABLE IF NOT EXISTS public.technician_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT technician_roles_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);
-- #16: no duplicate role names (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS idx_technician_roles_name_ci ON public.technician_roles (LOWER(name));

-- Managed lookup: Service Type (Data Center, Maintenance, ... extensible).
CREATE TABLE IF NOT EXISTS public.technician_service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  -- Drives the default schedule order (lower shows first): Data Center before
  -- Maintenance, etc. (#14).
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT technician_service_types_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_technician_service_types_name_ci
  ON public.technician_service_types (LOWER(name));

-- Seed the defaults YFI named. sort_order encodes the default view order.
INSERT INTO public.technician_roles (name, sort_order) VALUES
  ('Supervisor', 10), ('Driver', 20), ('Technician', 30)
ON CONFLICT DO NOTHING;
INSERT INTO public.technician_service_types (name, sort_order) VALUES
  ('Data Center', 10), ('Maintenance', 20)
ON CONFLICT DO NOTHING;

-- Portal-managed attributes on the FSM-synced technician rows. The FSM sync
-- upserts only display_name/is_active/last_synced_at, so these are preserved.
ALTER TABLE public.technician_reference
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES public.technician_roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_type_id UUID REFERENCES public.technician_service_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shift TEXT CHECK (shift IN ('morning', 'night')),
  -- Who supervises this technician (the "team leader" pointer). Self-reference.
  ADD COLUMN IF NOT EXISTS team_leader_fsm_id TEXT
    REFERENCES public.technician_reference(fsm_resource_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.technician_reference.shift
  IS 'morning | night. Decides which shift section the technician appears in (#10).';
COMMENT ON COLUMN public.technician_reference.team_leader_fsm_id
  IS 'The technician who leads/supervises this one; that leader is shown red and on top of the team (#11).';

CREATE INDEX IF NOT EXISTS idx_technician_reference_shift ON public.technician_reference (shift);
CREATE INDEX IF NOT EXISTS idx_technician_reference_team_leader ON public.technician_reference (team_leader_fsm_id);

ALTER TABLE public.technician_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_service_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on technician_roles" ON public.technician_roles;
CREATE POLICY "Allow All on technician_roles" ON public.technician_roles FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow All on technician_service_types" ON public.technician_service_types;
CREATE POLICY "Allow All on technician_service_types" ON public.technician_service_types FOR ALL TO public USING (true) WITH CHECK (true);
