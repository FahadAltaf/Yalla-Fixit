-- Migration: Workforce leave for employees not in FSM
-- Description: Sami, 31 Oct 2026: leave for the whole workforce. People
--              linked to an FSM technician keep using leave_records, which
--              the scheduling board reads. People not in FSM get their leave
--              here, shown on their Workforce profile only. A separate table
--              so Scheduling's leave table, its checks and the board are
--              unchanged and can never see these rows.
--              Additive, no data change. Safe to run again.

CREATE TABLE IF NOT EXISTS public.employee_leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.compliance_employees(id) ON DELETE RESTRICT,
  leave_type TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT employee_leave_records_status_check CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT employee_leave_records_period_check CHECK (end_at >= start_at),
  CONSTRAINT employee_leave_records_type_not_empty CHECK (LENGTH(TRIM(leave_type)) > 0)
);

CREATE INDEX IF NOT EXISTS employee_leave_records_employee_idx
  ON public.employee_leave_records (employee_id, start_at DESC);

-- Deny by default, like the compliance tables: read and written only by the
-- portal's server routes.
ALTER TABLE public.employee_leave_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_leave_records FROM anon, authenticated;

SELECT to_regclass('public.employee_leave_records') AS employee_leave;
