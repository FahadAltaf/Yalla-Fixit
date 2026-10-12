-- =====================================================================
-- AMC visit execution and closure: job sheet, supervisor review,
-- non-completion reasons, the remaining trade, the service report
-- (BRD v0.3 5.12; DEV-402, 403, 404, 423 #5)
-- =====================================================================
-- NOT APPLIED. Row 25 in docs/production-migration-log.md, checks §17.
--
-- What it adds
--   * amc_visit_job_sheets: one per visit -- arrival and completion,
--     crew, faults, consumables, additional work found, pending works
--     with reasons, quality concern, the client's signature name -- with
--     its review (submitted is not completed: a supervisor closes it, or
--     returns it with a comment). Filled in the portal now; the FSM job
--     sheet fills the same record in Phase 15 (source = 'fsm').
--   * amc_visit_checklist_items: the checklist per asset / per trade.
--   * amc_visit_photos: before / after / fault photos, in the private
--     amc-documents bucket (server only, signed links).
--   * amc_visit_lines: each trade's outcome group and reason (five
--     groups, BRD 5.11), and retry_of_line_id -- the remaining trade of a
--     partly done clubbed visit is planned again as a new line on a new
--     visit, so the done work is never reopened.
--   * amc_visits: the report (document, sent, due within 48 hours, the
--     at-risk stamp), who closed it and when, the "job sheet not
--     submitted" stamp, and remainder_of_visit_id.
--   * amc_send_log accepts the service report.
--
-- Live safety
--   Branch-only tables (live main reads none of them); amc_submissions is
--   not touched. Additive and idempotent; RLS on, nothing granted to the
--   browser roles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The job sheet and its review
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_visit_job_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL UNIQUE REFERENCES public.amc_visits(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'returned', 'closed')),
  arrived_at timestamptz,
  completed_at timestamptz,
  technician_ids text[] NOT NULL DEFAULT '{}',
  faults text,
  /* [{ "item": "...", "quantity": 1, "unit": "pcs" }] -- the Inventory link comes with FSM. */
  consumables jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(consumables) = 'array'),
  /* Work found outside the scope: [{ "description": "...", "trade": "ac" }] -- quoted in Phase 11. */
  additional_work jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(additional_work) = 'array'),
  /* [{ "description": "...", "reason": "..." }] -- pending works always say why. */
  pending_works jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pending_works) = 'array'),
  quality_concern boolean NOT NULL DEFAULT false,
  quality_note text,
  client_signature_name text,
  client_signed_at timestamptz,
  notes text,
  /* BRD 5.12: review is mandatory with pending works, a quality concern, missing evidence or incomplete scope. */
  review_required boolean NOT NULL DEFAULT false,
  review_reasons text[] NOT NULL DEFAULT '{}',
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  review_comment text,
  return_count integer NOT NULL DEFAULT 0 CHECK (return_count >= 0),
  source text NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'fsm')),
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_job_sheets_time_order CHECK (completed_at IS NULL OR arrived_at IS NULL OR completed_at >= arrived_at),
  CONSTRAINT amc_job_sheets_submitted_shape CHECK (
    status NOT IN ('submitted', 'closed') OR (submitted_at IS NOT NULL AND arrived_at IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT amc_job_sheets_return_explained CHECK (
    status <> 'returned' OR (review_comment IS NOT NULL AND length(trim(review_comment)) > 0)
  ),
  CONSTRAINT amc_job_sheets_closed_reviewed CHECK (status <> 'closed' OR reviewed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_amc_job_sheets_contract ON public.amc_visit_job_sheets (contract_id);
CREATE INDEX IF NOT EXISTS idx_amc_job_sheets_review ON public.amc_visit_job_sheets (submitted_at) WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS idx_amc_job_sheets_submitted_by ON public.amc_visit_job_sheets (submitted_by) WHERE submitted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_job_sheets_reviewed_by ON public.amc_visit_job_sheets (reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_job_sheets_created_by ON public.amc_visit_job_sheets (created_by) WHERE created_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Checklist per asset / trade, and photos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_visit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_sheet_id uuid NOT NULL REFERENCES public.amc_visit_job_sheets(id) ON DELETE RESTRICT,
  visit_line_id uuid REFERENCES public.amc_visit_lines(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES public.amc_property_assets(id) ON DELETE SET NULL,
  label text NOT NULL CHECK (length(trim(label)) > 0),
  result text NOT NULL CHECK (result IN ('ok', 'attention', 'fault', 'not_applicable')),
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amc_visit_checklist_sheet ON public.amc_visit_checklist_items (job_sheet_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_amc_visit_checklist_line ON public.amc_visit_checklist_items (visit_line_id) WHERE visit_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visit_checklist_asset ON public.amc_visit_checklist_items (asset_id) WHERE asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.amc_visit_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_sheet_id uuid NOT NULL REFERENCES public.amc_visit_job_sheets(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL REFERENCES public.amc_visits(id) ON DELETE RESTRICT,
  visit_line_id uuid REFERENCES public.amc_visit_lines(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES public.amc_property_assets(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('before', 'after', 'fault', 'other')),
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  file_sha256 text NOT NULL,
  caption text,
  uploaded_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amc_visit_photos_sheet ON public.amc_visit_photos (job_sheet_id);
CREATE INDEX IF NOT EXISTS idx_amc_visit_photos_visit ON public.amc_visit_photos (visit_id);
CREATE INDEX IF NOT EXISTS idx_amc_visit_photos_line ON public.amc_visit_photos (visit_line_id) WHERE visit_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visit_photos_asset ON public.amc_visit_photos (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visit_photos_uploaded_by ON public.amc_visit_photos (uploaded_by) WHERE uploaded_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Each trade's outcome; the remaining trade planned again
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_visit_lines
  ADD COLUMN IF NOT EXISTS outcome_group text
    CHECK (outcome_group IS NULL OR outcome_group IN ('client', 'internal', 'material', 'access', 'partial')),
  ADD COLUMN IF NOT EXISTS outcome_reason text,
  ADD COLUMN IF NOT EXISTS retry_of_line_id uuid REFERENCES public.amc_visit_lines(id) ON DELETE RESTRICT;
ALTER TABLE public.amc_visit_lines DROP CONSTRAINT IF EXISTS amc_visit_lines_not_done_explained;
ALTER TABLE public.amc_visit_lines
  ADD CONSTRAINT amc_visit_lines_not_done_explained CHECK (
    status NOT IN ('not_completed', 'partially_completed') OR outcome_group IS NOT NULL
  );
/* An occurrence is planned once; a retry of it is a new line pointing back. */
ALTER TABLE public.amc_visit_lines DROP CONSTRAINT IF EXISTS amc_visit_lines_occurrence_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_visit_lines_occurrence
  ON public.amc_visit_lines (entitlement_id, occurrence) WHERE retry_of_line_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visit_lines_entitlement ON public.amc_visit_lines (entitlement_id);
CREATE INDEX IF NOT EXISTS idx_amc_visit_lines_retry ON public.amc_visit_lines (retry_of_line_id) WHERE retry_of_line_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. The visit: closure, report, the 48-hour clock, the remainder
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_visits
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_document_id uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_sent_at timestamptz,
  /* Contract clause 1.2: the report reaches the client within 48 hours of the visit. */
  ADD COLUMN IF NOT EXISTS report_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_at_risk_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS job_sheet_overdue_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS remainder_of_visit_id uuid REFERENCES public.amc_visits(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_amc_visits_closed_by ON public.amc_visits (closed_by) WHERE closed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visits_report_document ON public.amc_visits (report_document_id) WHERE report_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visits_report_due ON public.amc_visits (report_due_at) WHERE report_sent_at IS NULL AND report_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visits_remainder ON public.amc_visits (remainder_of_visit_id) WHERE remainder_of_visit_id IS NOT NULL;
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.amc_visits'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.amc_visits DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.amc_visits
  ADD CONSTRAINT amc_visits_source_check CHECK (source IN ('generated', 'added', 'separated', 'remainder'));

-- Server-only, like every AMC table.
ALTER TABLE public.amc_visit_job_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_visit_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_visit_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_visit_job_sheets FROM anon, authenticated;
REVOKE ALL ON public.amc_visit_checklist_items FROM anon, authenticated;
REVOKE ALL ON public.amc_visit_photos FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. The send log takes the service report (Email 3)
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
  CHECK (document IN ('proposal', 'contract', 'instalment_reminder', 'visit_confirmation', 'visit_reminder', 'service_report'));
