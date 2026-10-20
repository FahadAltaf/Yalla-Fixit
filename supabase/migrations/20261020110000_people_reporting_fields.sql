-- =====================================================================
-- Finance & Reports P1: people data the reports need (DEV-456, 457, 458).
--
-- technician_reference (the FSM technician roster):
--   user_profile_id    the portal account of this technician, so a
--                      technician's own data is resolved from the session
--                      and never from a request (unique where set).
--   email              copied from FSM by the technician sync; how the
--                      link above is found.
--   employment_status  active | resigned (DEV-457).
--   leaving_date       from this day on the technician is excluded from
--                      available hours, alerts and compliance (TC15).
--   hidden_from_lists  keeps the technician out of pickers (DEV-458).
--   rest_weekdays      ISO weekdays (1 = Monday .. 7 = Sunday) off each
--                      week; null = not recorded (D-16 decides the source).
-- user_profile.hidden_from_lists   the same switch for portal accounts.
-- leave_records.leave_category     annual | sick | public_holiday | offset
--                      (DEV-456). Nullable: the free-text leave_type that
--                      live main writes is kept and still required.
-- org_public_holidays  the public holiday calendar.
--
-- Live-safe: new nullable or defaulted columns (the defaults are today's
-- behaviour: visible, active), one new table. The FSM technician sync on
-- main writes only display_name, is_active and last_synced_at, so it never
-- touches these. The tables are small (118 technicians, 17 users, 5 leave
-- records on 20 Oct), so plain index builds take no noticeable lock.
-- Idempotent: safe to run twice.
--
-- ORDER: apply BEFORE this branch's code runs anywhere. Its technician sync
-- writes technician_reference.email and reads the columns added here.
--
-- Apply with the checks in docs/finance-reporting/migrations/20261020110000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261020110000_rollback.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- technician_reference
-- ---------------------------------------------------------------------
ALTER TABLE public.technician_reference
  ADD COLUMN IF NOT EXISTS user_profile_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS employment_status text NOT NULL DEFAULT 'active'
    CHECK (employment_status IN ('active', 'resigned')),
  ADD COLUMN IF NOT EXISTS leaving_date date,
  ADD COLUMN IF NOT EXISTS hidden_from_lists boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rest_weekdays smallint[]
    CHECK (rest_weekdays IS NULL OR rest_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]);

/* A resigned technician without a leaving date cannot be excluded from
   anything, so the pair is enforced here and not only in the form. */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'technician_reference_resigned_has_leaving_date'
      AND conrelid = 'public.technician_reference'::regclass
  ) THEN
    ALTER TABLE public.technician_reference
      ADD CONSTRAINT technician_reference_resigned_has_leaving_date
      CHECK (employment_status <> 'resigned' OR leaving_date IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_technician_reference_user_profile
  ON public.technician_reference (user_profile_id)
  WHERE user_profile_id IS NOT NULL;

COMMENT ON COLUMN public.technician_reference.leaving_date
  IS 'First day the technician no longer works. Excluded from that day on (BRD TC15).';
COMMENT ON COLUMN public.technician_reference.rest_weekdays
  IS 'ISO weekdays off each week, 1 = Monday .. 7 = Sunday. Null = not recorded.';

-- ---------------------------------------------------------------------
-- user_profile
-- ---------------------------------------------------------------------
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS hidden_from_lists boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profile.hidden_from_lists
  IS 'Kept out of every people picker (DEV-458). Still listed in Users, and can still sign in.';

-- ---------------------------------------------------------------------
-- leave_records
-- ---------------------------------------------------------------------
ALTER TABLE public.leave_records
  ADD COLUMN IF NOT EXISTS leave_category text
    CHECK (leave_category IS NULL OR leave_category IN ('annual', 'sick', 'public_holiday', 'offset'));

-- ---------------------------------------------------------------------
-- org_public_holidays
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_public_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_public_holidays FROM anon, authenticated;
