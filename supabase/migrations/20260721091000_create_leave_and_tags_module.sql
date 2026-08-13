-- =====================================================
-- Migration: Leave and Technician Tags module
-- Description: Supervisor-managed technician leave records and editable
--              tags used to sort/filter the scheduling dashboard
--              (FRD Section 9.6, 11.3). Portal-only; never written to FSM
--              (LEAVE-012, BR-023).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_fsm_id TEXT NOT NULL REFERENCES public.technician_reference(fsm_resource_id),
  leave_type TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT leave_records_end_not_before_start CHECK (end_at >= start_at)
);

CREATE INDEX IF NOT EXISTS idx_leave_records_technician_period
  ON public.leave_records (technician_fsm_id, start_at, end_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_leave_records_status
  ON public.leave_records (status);

CREATE TABLE IF NOT EXISTS public.technician_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT technician_tags_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

-- TAG-002: unique tag name, case-insensitive to avoid "Driver" / "driver" duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_technician_tags_name_ci
  ON public.technician_tags (LOWER(name));

CREATE TABLE IF NOT EXISTS public.technician_tag_assignments (
  technician_fsm_id TEXT NOT NULL REFERENCES public.technician_reference(fsm_resource_id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.technician_tags(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (technician_fsm_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_technician_tag_assignments_tag
  ON public.technician_tag_assignments (tag_id);

ALTER TABLE public.leave_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_tag_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on leave_records" ON public.leave_records;
CREATE POLICY "Allow All on leave_records"
ON public.leave_records
FOR ALL
TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on technician_tags" ON public.technician_tags;
CREATE POLICY "Allow All on technician_tags"
ON public.technician_tags
FOR ALL
TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on technician_tag_assignments" ON public.technician_tag_assignments;
CREATE POLICY "Allow All on technician_tag_assignments"
ON public.technician_tag_assignments
FOR ALL
TO public
USING (true)
WITH CHECK (true);
