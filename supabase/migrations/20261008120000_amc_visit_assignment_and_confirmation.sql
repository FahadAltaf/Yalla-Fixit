-- =====================================================================
-- AMC visits: technician skills, board placement, confirmation, access
-- (BRD v0.3 5.11; DEV-356, 392-399, 423 #3 #4)
-- =====================================================================
-- NOT APPLIED. Row 23 in docs/production-migration-log.md, checks §15.
--
-- What it adds
--   * amc_technician_profiles: what AMC needs to know about a technician
--     to suggest them -- areas, vehicle and driver, tools, access
--     permissions -- one row per technician, keyed by the FSM resource id.
--   * amc_technician_skills: the trades a technician is confirmed for,
--     with a level and a certificate expiry. Only "competent" or "expert"
--     with a valid certificate is suggested; nobody else can be assigned.
--   * amc_visits: where the visit sits on the board (day, start and end,
--     the technicians, the lead, an override reason), the client's
--     confirmation, the access status with its pass, and the stamps the
--     daily sweep claims before telling anyone.
--   * amc_visit_attempts: every attempt to reach the client (date,
--     channel, outcome), append-only -- the contract treats no-shows as a
--     consumed visit, so the team must show what it tried.
--   * amc_send_log accepts appointment reminders.
--
-- Live safety
--   Nothing is added to or changed on the live scheduling tables. The two
--   new technician tables REFERENCE technician_reference (the FSM roster);
--   the roster sync already deactivates, rather than deletes, a technician
--   other rows point at (it reads the foreign-key error), which is what
--   should happen to one with AMC skills on file. AMC visits placed on the
--   board stay on amc_visits: nothing is written to schedule_entries until
--   visits are published to FSM (Phase 15), so live coordinators never see
--   demo visits. amc_submissions is not touched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Technician profile and skills (DEV-356)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_technician_profiles (
  fsm_resource_id text PRIMARY KEY REFERENCES public.technician_reference(fsm_resource_id) ON DELETE RESTRICT,
  /* Communities / areas they cover, as staff write them. */
  areas text[] NOT NULL DEFAULT '{}',
  has_vehicle boolean NOT NULL DEFAULT false,
  is_driver boolean NOT NULL DEFAULT false,
  tools text[] NOT NULL DEFAULT '{}',
  /* Community or building permissions they hold (matched against a property's access rules). */
  access_permissions text[] NOT NULL DEFAULT '{}',
  notes text,
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amc_technician_profiles_updated_by
  ON public.amc_technician_profiles (updated_by) WHERE updated_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.amc_technician_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fsm_resource_id text NOT NULL REFERENCES public.technician_reference(fsm_resource_id) ON DELETE RESTRICT,
  trade text NOT NULL CHECK (trade IN ('ac', 'plumbing', 'electrical', 'handyman', 'civil', 'other')),
  level text NOT NULL DEFAULT 'competent' CHECK (level IN ('trainee', 'competent', 'expert')),
  certificate text,
  certificate_expires date,
  verified_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_technician_skills_one_per_trade UNIQUE (fsm_resource_id, trade)
);
CREATE INDEX IF NOT EXISTS idx_amc_technician_skills_trade ON public.amc_technician_skills (trade, level);
CREATE INDEX IF NOT EXISTS idx_amc_technician_skills_verified_by
  ON public.amc_technician_skills (verified_by) WHERE verified_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. The visit on the board, its confirmation and its access (DEV-392..399)
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_visits
  ADD COLUMN IF NOT EXISTS scheduled_start timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end timestamptz,
  ADD COLUMN IF NOT EXISTS technician_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS lead_technician_id text,
  ADD COLUMN IF NOT EXISTS headcount integer CHECK (headcount IS NULL OR headcount BETWEEN 1 AND 20),
  /* Why the coordinator chose someone the suggestion did not put first. */
  ADD COLUMN IF NOT EXISTS assignment_note text,
  ADD COLUMN IF NOT EXISTS placed_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS placed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_confirmation text
    CHECK (client_confirmation IS NULL OR client_confirmation IN ('pending', 'confirmed', 'declined', 'no_answer')),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmation_channel text
    CHECK (confirmation_channel IS NULL OR confirmation_channel IN ('whatsapp', 'call', 'sms', 'email')),
  ADD COLUMN IF NOT EXISTS confirmation_note text,
  ADD COLUMN IF NOT EXISTS access_status text
    CHECK (access_status IS NULL OR access_status IN ('not_required', 'pending', 'approved', 'rejected', 'expired')),
  ADD COLUMN IF NOT EXISTS access_document_id uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS access_valid_until date,
  ADD COLUMN IF NOT EXISTS access_note text,
  ADD COLUMN IF NOT EXISTS confirmation_due_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_answer_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_alert_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_reminder_sent_at timestamptz;
ALTER TABLE public.amc_visits DROP CONSTRAINT IF EXISTS amc_visits_slot_shape;
ALTER TABLE public.amc_visits
  ADD CONSTRAINT amc_visits_slot_shape CHECK (
    (scheduled_start IS NULL AND scheduled_end IS NULL)
    OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start)
  );
ALTER TABLE public.amc_visits DROP CONSTRAINT IF EXISTS amc_visits_confirmed_shape;
ALTER TABLE public.amc_visits
  ADD CONSTRAINT amc_visits_confirmed_shape CHECK (client_confirmation IS DISTINCT FROM 'confirmed' OR confirmed_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_amc_visits_slot ON public.amc_visits (scheduled_start) WHERE scheduled_start IS NOT NULL;
/* "Is this technician already booked then?" -- the double-booking check. */
CREATE INDEX IF NOT EXISTS idx_amc_visits_technicians ON public.amc_visits USING gin (technician_ids);
CREATE INDEX IF NOT EXISTS idx_amc_visits_placed_by ON public.amc_visits (placed_by) WHERE placed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visits_confirmed_by ON public.amc_visits (confirmed_by) WHERE confirmed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visits_access_document ON public.amc_visits (access_document_id) WHERE access_document_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Attempts to reach the client (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_visit_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.amc_visits(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no >= 1),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'call', 'sms', 'email')),
  outcome text NOT NULL CHECK (outcome IN ('message_sent', 'no_answer', 'confirmed', 'reschedule_requested', 'declined')),
  note text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  actor_label text,
  CONSTRAINT amc_visit_attempts_no_unique UNIQUE (visit_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS idx_amc_visit_attempts_actor ON public.amc_visit_attempts (actor_id) WHERE actor_id IS NOT NULL;
DROP TRIGGER IF EXISTS amc_visit_attempts_locked ON public.amc_visit_attempts;
CREATE TRIGGER amc_visit_attempts_locked
  BEFORE UPDATE OR DELETE ON public.amc_visit_attempts
  FOR EACH ROW EXECUTE FUNCTION public.amc_history_row_locked();

-- Server-only, like every AMC table.
ALTER TABLE public.amc_technician_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_technician_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_visit_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_technician_profiles FROM anon, authenticated;
REVOKE ALL ON public.amc_technician_skills FROM anon, authenticated;
REVOKE ALL ON public.amc_visit_attempts FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. The send log takes appointment reminders
-- ---------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.amc_send_log'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%document%'
  LOOP
    EXECUTE format('ALTER TABLE public.amc_send_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.amc_send_log
  ADD CONSTRAINT amc_send_log_document_check
  CHECK (document IN ('proposal', 'contract', 'instalment_reminder', 'visit_confirmation', 'visit_reminder'));
