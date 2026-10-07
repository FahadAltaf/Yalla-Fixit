-- =====================================================================
-- AMC enquiry pipeline and site visit
-- (BRD v0.3 Phase 3: DEV-347, 358, 359, 362)
--
-- NOT APPLIED. Branch amc-hardening, 7 Oct 2026.
-- SAFE BEFORE CODE DEPLOY. Checked against origin/main, 7 Oct 2026: the two
-- tables are new; amc_assessments and amc_communication_log are branch-only
-- (20261006130000 and 20261007120000) and live `main` never reads them.
-- Only nullable columns, or columns with a default, are added; no existing
-- row changes. Apply after 20261007120000.
-- Idempotent: safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enquiry numbers: ENQ-YYYY-NNNN (plan Q22), like the assessments'.
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.amc_enquiry_number_seq;
REVOKE ALL ON SEQUENCE public.amc_enquiry_number_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.amc_next_enquiry_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  digits text := nextval('public.amc_enquiry_number_seq')::text;
BEGIN
  RETURN 'ENQ-' || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY') || '-' || lpad(digits, greatest(4, length(digits)), '0');
END;
$$;
REVOKE ALL ON FUNCTION public.amc_next_enquiry_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_next_enquiry_number() TO service_role;

-- ---------------------------------------------------------------------
-- 2. Enquiries (DEV-347, BRD 5.1). Stages, sources and lost reasons are
--    configurable lists (amc_config "enquiries"), so they are checked in
--    the code, not here; only "Lost needs a reason" is fixed.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_number text NOT NULL UNIQUE DEFAULT public.amc_next_enquiry_number(),
  enquired_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (length(trim(source)) > 0),
  referrer text,
  /* The prospect: created or linked when the enquiry is logged (BRD 5.9). */
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  property_id uuid REFERENCES public.customer_properties(id) ON DELETE SET NULL,
  contact_name text NOT NULL CHECK (length(trim(contact_name)) > 0),
  contact_phone text,
  contact_email text,
  contact_whatsapp text,
  preferred_channel text CHECK (preferred_channel IS NULL OR preferred_channel IN ('whatsapp', 'email', 'call', 'sms')),
  preferred_language text,
  area text,
  property_category text CHECK (property_category IS NULL OR property_category IN ('residential', 'commercial')),
  unit_type text CHECK (unit_type IS NULL OR unit_type IN ('villa', 'apartment', 'townhouse', 'restaurant', 'clinic', 'shop', 'office', 'warehouse', 'other')),
  need text NOT NULL CHECK (length(trim(need)) > 0),
  owner_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'New Enquiry' CHECK (length(trim(stage)) > 0),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  lost_reason text,
  lost_notes text,
  next_follow_up_at timestamptz,
  /* Stamped by the follow-up sweep before it notifies; cleared when the date changes. */
  follow_up_notified_at timestamptz,
  /* Follow-ups, stage changes and site visits move this; the idle rule reads it. */
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  idle_flagged_at timestamptz,
  idle_escalated_at timestamptz,
  /* The proposal started from it (Phase 4 links every version). */
  submission_id uuid REFERENCES public.amc_submissions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_enquiries_reachable CHECK (COALESCE(contact_phone, contact_email, contact_whatsapp) IS NOT NULL),
  CONSTRAINT amc_enquiries_lost_reason CHECK (stage <> 'Lost' OR lost_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_customer ON public.amc_enquiries (customer_id);
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_property ON public.amc_enquiries (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_owner ON public.amc_enquiries (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_stage ON public.amc_enquiries (stage, enquired_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_follow_up ON public.amc_enquiries (next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_activity ON public.amc_enquiries (last_activity_at);
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_submission ON public.amc_enquiries (submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_created_by ON public.amc_enquiries (created_by) WHERE created_by IS NOT NULL;

/* Follow-up log (DEV-359, BRD 5.1): date, channel, person, outcome, next date. */
CREATE TABLE IF NOT EXISTS public.amc_enquiry_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id uuid NOT NULL REFERENCES public.amc_enquiries(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL CHECK (channel IN ('call', 'whatsapp', 'email', 'sms', 'meeting', 'site_visit', 'other')),
  outcome text NOT NULL CHECK (length(trim(outcome)) > 0),
  notes text,
  next_follow_up_at timestamptz,
  logged_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amc_enquiry_follow_ups_enquiry ON public.amc_enquiry_follow_ups (enquiry_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_enquiry_follow_ups_logged_by ON public.amc_enquiry_follow_ups (logged_by) WHERE logged_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Site visit (DEV-362, BRD 5.2): the assessment, scheduled from the
--    enquiry, with attendance, asset counts, access notes and exclusions.
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_assessments
  ADD COLUMN IF NOT EXISTS enquiry_id uuid REFERENCES public.amc_enquiries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance text CHECK (attendance IS NULL OR attendance IN ('attended', 'client_no_show', 'rescheduled', 'cancelled')),
  /* Units counted on site per recommended service: { "<service id>": <count> }. */
  ADD COLUMN IF NOT EXISTS asset_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(asset_counts) = 'object'),
  ADD COLUMN IF NOT EXISTS access_notes text,
  ADD COLUMN IF NOT EXISTS exclusions text;
CREATE INDEX IF NOT EXISTS idx_amc_assessments_enquiry ON public.amc_assessments (enquiry_id) WHERE enquiry_id IS NOT NULL;
/* "Assigned to me": the assessor sees the visits they are sent on. */
CREATE INDEX IF NOT EXISTS idx_amc_assessments_assessor ON public.amc_assessments (assessor_id) WHERE assessor_id IS NOT NULL;
/* A visit the client missed or that was cancelled is not completed as if it happened. */
ALTER TABLE public.amc_assessments DROP CONSTRAINT IF EXISTS amc_assessments_completed_attended;
ALTER TABLE public.amc_assessments
  ADD CONSTRAINT amc_assessments_completed_attended CHECK (status = 'draft' OR attendance IS NULL OR attendance = 'attended');

/* Follow-ups also appear in the client's communication log. */
ALTER TABLE public.amc_communication_log
  ADD COLUMN IF NOT EXISTS enquiry_id uuid REFERENCES public.amc_enquiries(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_amc_communication_enquiry ON public.amc_communication_log (enquiry_id) WHERE enquiry_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Server-only, like every AMC table.
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_enquiry_follow_ups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_enquiries, public.amc_enquiry_follow_ups FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Rollback (only before any enquiry is recorded):
--   ALTER TABLE public.amc_communication_log DROP COLUMN IF EXISTS enquiry_id;
--   ALTER TABLE public.amc_assessments DROP CONSTRAINT IF EXISTS amc_assessments_completed_attended;
--   ALTER TABLE public.amc_assessments DROP COLUMN IF EXISTS enquiry_id, DROP COLUMN IF EXISTS scheduled_at,
--     DROP COLUMN IF EXISTS attendance, DROP COLUMN IF EXISTS asset_counts,
--     DROP COLUMN IF EXISTS access_notes, DROP COLUMN IF EXISTS exclusions;
--   DROP INDEX IF EXISTS public.idx_amc_assessments_assessor;
--   DROP TABLE IF EXISTS public.amc_enquiry_follow_ups;
--   DROP TABLE IF EXISTS public.amc_enquiries;
--   DROP FUNCTION IF EXISTS public.amc_next_enquiry_number();
--   DROP SEQUENCE IF EXISTS public.amc_enquiry_number_seq;
-- ---------------------------------------------------------------------
