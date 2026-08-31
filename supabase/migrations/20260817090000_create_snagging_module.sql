-- =====================================================
-- Migration: Property Care / Snagging module
-- File: 20260817090000_create_snagging_module.sql
--
-- Implements the data model behind the Snagging Tool BRD (v1 Draft,
-- 17 May 2026). Every table is prefixed `snagging_` so the module is
-- self-contained inside the shared portal database and can be reasoned
-- about, backed up, or dropped as one unit.
--
-- Section references in comments point at the BRD.
--
-- RLS NOTE — this module deliberately departs from the older
-- "Allow All to public" pattern used by the portal's first tables. The
-- mobile inspector app authenticates against this same Supabase project,
-- so a permissive `TO public` policy would make every snag, photo path,
-- and client name readable by anyone holding the anon key. Instead:
--   * server code (Next.js API routes) uses the service role, which
--     bypasses RLS entirely — nothing about the existing web
--     architecture changes;
--   * `authenticated` gets narrowly scoped policies, mostly limited to
--     rows belonging to a task the user is assigned to;
--   * `anon` gets nothing.
-- =====================================================

-- -----------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------

-- Keeps updated_at honest without every writer having to remember it.
CREATE OR REPLACE FUNCTION public.snagging_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- (snagging_is_task_member is defined in section 18, once the tables it
-- reads exist — a SQL-language function body is parsed at creation.)

-- -----------------------------------------------------
-- 1. Master data — snag catalogue (BRD §9)
--
-- Four-level taxonomy: Area -> Element -> Defect Type -> Severity
-- guideline, stored across two tables rather than one.
--
-- The BRD's example code (LR-WL-CRK) reads as one row per
-- area/element/defect triple, but that is inconsistent with its own
-- 200-400 entry estimate: sixteen areas times ~85 element/defect pairs
-- is over a thousand rows, which no Ops lead can curate and which
-- bloats the offline reference pack on every device.
--
-- So level 2-4 live here as ~85 element/defect entries (WL-CRK), level
-- 1 lives in the areas table below, and the pairing of the two is an
-- applicability matrix. A captured snag still carries the full
-- LIV-WL-CRK composite for reporting and analytics — it is composed at
-- capture time instead of being stored a thousand times over.
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_catalogue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Element + defect, e.g. WL-CRK. Stable forever (BR-8).
  code TEXT NOT NULL UNIQUE,
  element_code TEXT NOT NULL,
  element_label TEXT NOT NULL,
  defect_code TEXT NOT NULL,
  defect_label TEXT NOT NULL,
  -- Level 4 is advisory: pre-selected in the capture sheet, inspector
  -- may override (BRD §9, FR-2.03).
  default_severity TEXT NOT NULL CHECK (default_severity IN ('low', 'medium', 'high')),
  guidance TEXT,
  catalogue_version TEXT NOT NULL DEFAULT 'v1.0',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT snagging_catalogue_entries_pair_unique UNIQUE (element_code, defect_code)
);

CREATE INDEX IF NOT EXISTS idx_snagging_catalogue_active
  ON public.snagging_catalogue_entries (active, element_code, sort_order);

CREATE INDEX IF NOT EXISTS idx_snagging_catalogue_version
  ON public.snagging_catalogue_entries (catalogue_version);

-- Level 1 of the taxonomy.
CREATE TABLE IF NOT EXISTS public.snagging_catalogue_areas (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Which elements exist in which area. This is what the capture sheet
-- filters on: standing in a Guest WC, an inspector is offered Sanitary
-- and Plumbing but not Balustrade or Appliances.
CREATE TABLE IF NOT EXISTS public.snagging_catalogue_area_elements (
  area_code TEXT NOT NULL REFERENCES public.snagging_catalogue_areas(code) ON DELETE CASCADE,
  element_code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (area_code, element_code)
);

CREATE INDEX IF NOT EXISTS idx_snagging_catalogue_area_elements_element
  ON public.snagging_catalogue_area_elements (element_code);

-- -----------------------------------------------------
-- 2. Master data — area templates (FR-1.03)
-- Preset inspection checklists by property type, editable per task.
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_area_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_type TEXT NOT NULL UNIQUE CHECK (property_type IN (
    'studio', '1br', '2br', '3br', '4br', 'villa', 'townhouse'
  )),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.snagging_area_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.snagging_area_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Which catalogue area this room draws its defect list from. Several
  -- rooms share one code: "Bedroom 2" and "Bedroom 3" are both BED.
  catalogue_area_code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT snagging_area_template_items_unique UNIQUE (template_id, name)
);

CREATE INDEX IF NOT EXISTS idx_snagging_area_template_items_template
  ON public.snagging_area_template_items (template_id, sort_order);

-- -----------------------------------------------------
-- 3. Engagements and properties
--
-- A project exists only for full-building B2B engagements (BRD §3.1);
-- single-unit consumer jobs leave project_id NULL. BR-1 forbids
-- free-form properties, so every task points at a property row that
-- carries its CRM identifiers.
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  developer_name TEXT,
  building_name TEXT,
  community TEXT,
  city TEXT DEFAULT 'Dubai',
  -- Read-only mirror of the CRM record (BRD §3.1).
  crm_account_id TEXT,
  unit_count INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled')),
  starts_on DATE,
  ends_on DATE,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.snagging_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.snagging_projects(id) ON DELETE SET NULL,
  -- CRM linkage (BR-1). Kept as text because Zoho ids are opaque.
  crm_contact_id TEXT,
  crm_property_id TEXT,
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_phone TEXT,
  unit_label TEXT NOT NULL,
  building_name TEXT,
  community TEXT,
  city TEXT DEFAULT 'Dubai',
  property_type TEXT NOT NULL CHECK (property_type IN (
    'studio', '1br', '2br', '3br', '4br', 'villa', 'townhouse'
  )),
  developer_name TEXT,
  handover_date DATE,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snagging_properties_project
  ON public.snagging_properties (project_id);

CREATE INDEX IF NOT EXISTS idx_snagging_properties_developer
  ON public.snagging_properties (developer_name);

-- -----------------------------------------------------
-- 4. Inspection tasks (FR-1.01 to FR-1.06)
--
-- One row per visit. A de-snagging round is a new task with
-- round_number > 1 pointing back at its parent (FR-6.01), which keeps
-- the snag entity single while letting each visit carry its own
-- schedule, assignees, approval, and report.
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  project_id UUID REFERENCES public.snagging_projects(id) ON DELETE SET NULL,
  property_id UUID NOT NULL REFERENCES public.snagging_properties(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL DEFAULT 'single_unit' CHECK (task_type IN ('single_unit', 'full_building')),
  service_tier TEXT CHECK (service_tier IN ('essential', 'comfort', 'full', 'b2b_building')),
  package_name TEXT,

  -- Re-inspection chain (§5.2, FR-6.01).
  round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number >= 1),
  parent_task_id UUID REFERENCES public.snagging_tasks(id) ON DELETE SET NULL,

  -- FR-1.06 lifecycle. `rejected` is not in the BRD's happy path list
  -- but is required as a resting state between a manager's rejection
  -- and the inspector picking the task back up (§5.3).
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN (
    'draft', 'assigned', 'in_progress', 'submitted', 'in_review',
    'rejected', 'approved', 'delivered', 'cancelled'
  )),

  scheduled_date DATE,
  scheduled_start_at TIMESTAMPTZ,
  scheduled_end_at TIMESTAMPTZ,

  supervisor_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  approval_manager_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,

  notes TEXT,
  -- Version of the catalogue handed to the device, so a report can be
  -- reproduced exactly even after the catalogue moves on (BRD §9).
  catalogue_version TEXT NOT NULL DEFAULT 'v1.0',

  -- FR-2.09: submitted inspections are locked; edits only come back
  -- through a rejection.
  locked BOOLEAN NOT NULL DEFAULT FALSE,

  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  supervisor_reviewed_at TIMESTAMPTZ,
  supervisor_reviewed_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  delivered_at TIMESTAMPTZ,

  -- §5.3 rejection branching. The category drives the remediation path
  -- and the SLA clock.
  rejection_category TEXT CHECK (rejection_category IN ('minor', 'data_correction', 'critical')),
  rejection_reason TEXT,
  rejection_count INTEGER NOT NULL DEFAULT 0,
  -- FR-4.06: pending-approval queue is ordered by this, and anything
  -- older than 48h escalates.
  approval_due_at TIMESTAMPTZ,
  remediation_due_at TIMESTAMPTZ,

  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- BR-5: a rejection always carries its written justification.
  CONSTRAINT snagging_tasks_rejection_requires_reason
    CHECK (rejection_category IS NULL OR rejection_reason IS NOT NULL),
  -- A round beyond the first is by definition a re-inspection of an
  -- existing task.
  CONSTRAINT snagging_tasks_rounds_have_parent
    CHECK (round_number = 1 OR parent_task_id IS NOT NULL),
  CONSTRAINT snagging_tasks_schedule_order
    CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at > scheduled_start_at)
);

CREATE INDEX IF NOT EXISTS idx_snagging_tasks_status_date
  ON public.snagging_tasks (status, scheduled_date DESC);

CREATE INDEX IF NOT EXISTS idx_snagging_tasks_property
  ON public.snagging_tasks (property_id, round_number);

CREATE INDEX IF NOT EXISTS idx_snagging_tasks_parent
  ON public.snagging_tasks (parent_task_id);

CREATE INDEX IF NOT EXISTS idx_snagging_tasks_project
  ON public.snagging_tasks (project_id);

-- FR-4.06: the approval queue reads exactly this slice.
CREATE INDEX IF NOT EXISTS idx_snagging_tasks_approval_queue
  ON public.snagging_tasks (approval_due_at)
  WHERE status IN ('submitted', 'in_review');

-- One live round per parent: stops two de-snag rounds being opened
-- against the same inspection by accident.
CREATE UNIQUE INDEX IF NOT EXISTS idx_snagging_tasks_unique_round
  ON public.snagging_tasks (parent_task_id, round_number)
  WHERE parent_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.snagging_task_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.snagging_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'technician' CHECK (role IN ('technician', 'supervisor')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  CONSTRAINT snagging_task_assignees_unique UNIQUE (task_id, user_id)
);

-- The mobile "my jobs" query drives off this.
CREATE INDEX IF NOT EXISTS idx_snagging_task_assignees_user
  ON public.snagging_task_assignees (user_id, task_id);

-- -----------------------------------------------------
-- 5. Areas (FR-2.01, FR-2.07)
--
-- `status` records what was found; `confirmed_at` records that a person
-- said they had finished looking. They are separate because an area
-- flips to has_snags on the first defect, which is not the same as
-- being done with the room — progress and the submit gate count
-- confirmations.
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.snagging_tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Copied from the template item; drives which catalogue entries the
  -- capture sheet offers in this room.
  catalogue_area_code TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'clear', 'has_snags')),
  -- FR-2.07: the positive coverage record. Required before an area with
  -- no snags can be closed, otherwise "clear" carries no evidence that
  -- anyone looked.
  note TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT snagging_areas_unique_name UNIQUE (task_id, name)
);

CREATE INDEX IF NOT EXISTS idx_snagging_areas_task
  ON public.snagging_areas (task_id, sort_order);

-- -----------------------------------------------------
-- 6. Floor plans (FR-1.02, §12 pin-on-floor-plan)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_floor_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.snagging_tasks(id) ON DELETE CASCADE,
  property_id UUID REFERENCES public.snagging_properties(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  -- Object key inside the `snagging` storage bucket.
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  page_number INTEGER NOT NULL DEFAULT 1,
  width INTEGER,
  height INTEGER,
  bytes BIGINT,
  uploaded_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A plan belongs to a specific visit or to the property as a whole,
  -- never to neither.
  CONSTRAINT snagging_floor_plans_has_owner
    CHECK (task_id IS NOT NULL OR property_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_snagging_floor_plans_task
  ON public.snagging_floor_plans (task_id);

CREATE INDEX IF NOT EXISTS idx_snagging_floor_plans_property
  ON public.snagging_floor_plans (property_id);

-- -----------------------------------------------------
-- 7. Snags (§5.2, BR-2, BR-3, BR-6)
--
-- The snag is a persistent entity owned by the property, not by the
-- visit that found it. Re-inspection rounds update its status; they
-- never duplicate the row. `origin_task_id` records which visit raised
-- it so a delta report can be produced (FR-5.07).
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_snags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.snagging_properties(id) ON DELETE CASCADE,
  origin_task_id UUID NOT NULL REFERENCES public.snagging_tasks(id) ON DELETE CASCADE,
  area_id UUID NOT NULL REFERENCES public.snagging_areas(id) ON DELETE CASCADE,

  -- FR-2.05, generated on device as {taskCode}-S001 and confirmed here.
  snag_code TEXT NOT NULL,

  -- BR-2: classification always comes from the catalogue. The codes and
  -- labels are denormalised so a report renders without joining, and so
  -- a later catalogue edit cannot silently rewrite an issued report.
  catalogue_entry_id UUID REFERENCES public.snagging_catalogue_entries(id) ON DELETE RESTRICT,
  -- The full four-level composite, e.g. LIV-WL-CRK.
  catalogue_code TEXT NOT NULL,
  area_code TEXT,
  element_code TEXT,
  defect_code TEXT,
  area_label TEXT,
  element_label TEXT,
  defect_label TEXT,

  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  -- Supplementary only (BR-2).
  note TEXT,

  floor_plan_id UUID REFERENCES public.snagging_floor_plans(id) ON DELETE SET NULL,
  -- Stored as a 0..1 fraction of the plan so a pin survives any zoom
  -- level or re-render at a different resolution.
  pin_x REAL CHECK (pin_x IS NULL OR (pin_x >= 0 AND pin_x <= 1)),
  pin_y REAL CHECK (pin_y IS NULL OR (pin_y >= 0 AND pin_y <= 1)),

  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'pending_verification', 'verified_closed',
    'verified_poor_quality', 'verified_not_done', 'withdrawn'
  )),
  round_created INTEGER NOT NULL DEFAULT 1,
  -- BR-6: set when the owning inspection is submitted.
  locked BOOLEAN NOT NULL DEFAULT FALSE,

  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT snagging_snags_code_unique UNIQUE (property_id, snag_code),
  -- A pin is both coordinates or neither.
  CONSTRAINT snagging_snags_pin_complete
    CHECK ((pin_x IS NULL) = (pin_y IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_snagging_snags_task
  ON public.snagging_snags (origin_task_id);

CREATE INDEX IF NOT EXISTS idx_snagging_snags_area
  ON public.snagging_snags (area_id);

-- FR-6.02: a round pre-populates from the still-outstanding snags.
CREATE INDEX IF NOT EXISTS idx_snagging_snags_open_by_property
  ON public.snagging_snags (property_id, status)
  WHERE status IN ('open', 'pending_verification', 'verified_poor_quality', 'verified_not_done');

-- FR-7.01/FR-7.04: distribution by category and severity over time.
CREATE INDEX IF NOT EXISTS idx_snagging_snags_analytics
  ON public.snagging_snags (element_code, defect_code, severity, created_at);

-- -----------------------------------------------------
-- 8. Photos (FR-2.04, FR-2.06, FR-4.05)
--
-- Metadata only. The JPEG lives in the private `snagging` bucket and
-- never touches the camera roll, which §7 (PDPL) requires. EXIF is
-- captured before compression strips it.
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_snag_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snag_id UUID NOT NULL REFERENCES public.snagging_snags(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.snagging_tasks(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video')),
  bytes BIGINT,
  width INTEGER,
  height INTEGER,
  checksum_md5 TEXT,
  -- Retained for evidentiary weight in developer disputes (R6).
  exif JSONB,
  gps_lat DOUBLE PRECISION,
  gps_lng DOUBLE PRECISION,
  taken_at TIMESTAMPTZ NOT NULL,
  -- Which visit produced this frame. A de-snag round adds evidence to
  -- an existing snag rather than replacing it.
  round_number INTEGER NOT NULL DEFAULT 1,
  uploaded_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snagging_snag_photos_snag
  ON public.snagging_snag_photos (snag_id, round_number);

CREATE INDEX IF NOT EXISTS idx_snagging_snag_photos_task
  ON public.snagging_snag_photos (task_id);

-- -----------------------------------------------------
-- 9. Verifications (§5.2, FR-6.03, FR-6.05)
-- One row per snag per de-snagging round: the full status history.
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_snag_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snag_id UUID NOT NULL REFERENCES public.snagging_snags(id) ON DELETE CASCADE,
  round_task_id UUID NOT NULL REFERENCES public.snagging_tasks(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN (
    'verified_closed', 'verified_poor_quality', 'verified_not_done', 'withdrawn'
  )),
  note TEXT,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One verdict per snag per round; a correction overwrites in place.
  CONSTRAINT snagging_snag_verifications_unique UNIQUE (snag_id, round_task_id)
);

CREATE INDEX IF NOT EXISTS idx_snagging_verifications_snag
  ON public.snagging_snag_verifications (snag_id, round_number);

-- -----------------------------------------------------
-- 10. Submission and approval (FR-2.08, §6.4)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.snagging_tasks(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL DEFAULT 1,
  signed_at TIMESTAMPTZ NOT NULL,
  signer_name TEXT NOT NULL,
  signature_path TEXT,
  gps_lat DOUBLE PRECISION,
  gps_lng DOUBLE PRECISION,
  device_id TEXT,
  app_version TEXT,
  snag_count INTEGER NOT NULL DEFAULT 0,
  area_count INTEGER NOT NULL DEFAULT 0,
  submitted_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Each resubmission after a rejection is its own attempt.
  CONSTRAINT snagging_submissions_unique_attempt UNIQUE (task_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_snagging_submissions_task
  ON public.snagging_submissions (task_id);

-- FR-4.02/FR-4.03: every transition through the approval chain, with
-- the justification that BR-5 requires on any rejection.
CREATE TABLE IF NOT EXISTS public.snagging_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.snagging_tasks(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'submitted', 'supervisor_approved', 'supervisor_rejected',
    'approved', 'rejected', 'escalated', 'reopened'
  )),
  rejection_category TEXT CHECK (rejection_category IN ('minor', 'data_correction', 'critical')),
  comment TEXT,
  actor_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT snagging_approvals_rejection_requires_comment
    CHECK (action NOT IN ('rejected', 'supervisor_rejected')
           OR (comment IS NOT NULL AND LENGTH(TRIM(comment)) > 0)),
  CONSTRAINT snagging_approvals_rejection_requires_category
    CHECK (action <> 'rejected' OR rejection_category IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_snagging_approvals_task
  ON public.snagging_approvals (task_id, created_at DESC);

-- -----------------------------------------------------
-- 11. Audit log (BR-7, FR-4.04)
--
-- Append-only, enforced in the database rather than by convention: the
-- rules below make UPDATE and DELETE no-ops for every role including
-- the service role, so no application bug or console session can
-- rewrite history.
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_audit_events (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  task_id UUID REFERENCES public.snagging_tasks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  actor_label TEXT,
  origin TEXT NOT NULL DEFAULT 'portal' CHECK (origin IN ('portal', 'mobile', 'system')),
  justification TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snagging_audit_task
  ON public.snagging_audit_events (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_snagging_audit_entity
  ON public.snagging_audit_events (entity_type, entity_id, created_at DESC);

-- DO INSTEAD NOTHING silently discards the write. A rule is used rather
-- than a trigger so it also covers writes made by the table owner.
CREATE OR REPLACE RULE snagging_audit_events_no_update AS
  ON UPDATE TO public.snagging_audit_events DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snagging_audit_events_no_delete AS
  ON DELETE TO public.snagging_audit_events DO INSTEAD NOTHING;

-- -----------------------------------------------------
-- 12. Reports and tokenised delivery (§6.5)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.snagging_tasks(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.snagging_properties(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL DEFAULT 1,
  -- FR-5.07: a re-inspection produces both a delta and a cumulative view.
  report_type TEXT NOT NULL DEFAULT 'full' CHECK (report_type IN ('full', 'delta', 'cumulative')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  pdf_path TEXT,
  bytes BIGINT,
  snag_count INTEGER NOT NULL DEFAULT 0,
  severity_counts JSONB,
  generation_error TEXT,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snagging_reports_task
  ON public.snagging_reports (task_id, report_type);

-- FR-5.04/FR-5.05: revocable, 30-day, no client account. The token is
-- stored hashed so a database read cannot be turned into report access.
CREATE TABLE IF NOT EXISTS public.snagging_report_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.snagging_reports(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  -- Last 6 characters, so support can identify a link a client quotes
  -- without the full secret being recoverable.
  token_hint TEXT,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp', 'manual')),
  recipient TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  first_opened_at TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ,
  open_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snagging_report_tokens_report
  ON public.snagging_report_tokens (report_id);

-- FR-5.05: engagement tracking (opens, IP, user agent).
CREATE TABLE IF NOT EXISTS public.snagging_report_token_events (
  id BIGSERIAL PRIMARY KEY,
  token_id UUID NOT NULL REFERENCES public.snagging_report_tokens(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'opened' CHECK (event_type IN ('opened', 'downloaded', 'denied')),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snagging_report_token_events_token
  ON public.snagging_report_token_events (token_id, created_at DESC);

-- -----------------------------------------------------
-- 13. Mobile sync ledger (§6.3)
--
-- The device appends every local write to an outbox and replays it
-- until acknowledged. This table is the server half of that contract:
-- a mutation id seen twice is applied once, so a retry after a dropped
-- response can never double-insert a snag.
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_sync_mutations (
  mutation_id UUID PRIMARY KEY,
  user_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  device_id TEXT,
  entity TEXT NOT NULL,
  entity_id UUID NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'rejected')),
  error_message TEXT,
  result JSONB,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snagging_sync_mutations_entity
  ON public.snagging_sync_mutations (entity, entity_id);

CREATE INDEX IF NOT EXISTS idx_snagging_sync_mutations_user
  ON public.snagging_sync_mutations (user_id, applied_at DESC);

-- Device registry: powers the low-storage warning (FR-3.05) and gives
-- ops a view of which handset last synced a job.
CREATE TABLE IF NOT EXISTS public.snagging_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  platform TEXT,
  os_version TEXT,
  app_version TEXT,
  free_bytes BIGINT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------
-- 14. updated_at triggers
-- -----------------------------------------------------

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'snagging_catalogue_entries',
    'snagging_area_templates',
    'snagging_projects',
    'snagging_properties',
    'snagging_tasks',
    'snagging_areas',
    'snagging_snags',
    'snagging_reports'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_touch', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.snagging_touch_updated_at()',
      t || '_touch', t
    );
  END LOOP;
END $$;

-- -----------------------------------------------------
-- 15. Derived state
-- -----------------------------------------------------

-- Keeps an area's status in step with what has been captured in it, so
-- no writer has to remember (FR-2.07). An area that has at least one
-- live snag is has_snags; one that has none falls back to clear if the
-- inspector confirmed it, pending otherwise.
CREATE OR REPLACE FUNCTION public.snagging_refresh_area_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- NEW is unassigned on DELETE, so it cannot be read unconditionally.
  v_area_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.area_id ELSE NEW.area_id END;
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.snagging_snags
  WHERE area_id = v_area_id
    AND status <> 'withdrawn';

  UPDATE public.snagging_areas
  SET status = CASE
        WHEN v_count > 0 THEN 'has_snags'
        WHEN confirmed_at IS NOT NULL THEN 'clear'
        ELSE 'pending'
      END
  WHERE id = v_area_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS snagging_snags_refresh_area ON public.snagging_snags;
CREATE TRIGGER snagging_snags_refresh_area
AFTER INSERT OR UPDATE OF status, area_id OR DELETE ON public.snagging_snags
FOR EACH ROW EXECUTE FUNCTION public.snagging_refresh_area_status();

-- Allocates the next snag code for a property: {taskCode}-S001. The
-- device generates the same shape offline; this is the server's
-- authority when two inspectors work the same unit at once.
CREATE OR REPLACE FUNCTION public.snagging_next_snag_code(p_task_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id UUID;
  v_code TEXT;
  v_next INTEGER;
BEGIN
  SELECT property_id, code INTO v_property_id, v_code
  FROM public.snagging_tasks WHERE id = p_task_id;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Unknown task %', p_task_id;
  END IF;

  -- Counts across the whole property, not the visit, so a de-snagging
  -- round never reissues a code that round 1 already used.
  SELECT COALESCE(MAX(NULLIF(regexp_replace(snag_code, '^.*-S', ''), '')::INTEGER), 0) + 1
  INTO v_next
  FROM public.snagging_snags
  WHERE property_id = v_property_id
    AND snag_code ~ '-S[0-9]+$';

  RETURN v_code || '-S' || LPAD(v_next::TEXT, 3, '0');
END;
$$;

-- -----------------------------------------------------
-- 16. Reporting views
-- -----------------------------------------------------

-- Aggregates the counters every list screen needs, so the inspections
-- table does not fan out to N queries per row.
CREATE OR REPLACE VIEW public.snagging_task_summaries AS
SELECT
  t.id,
  t.code,
  t.status,
  t.task_type,
  t.round_number,
  t.parent_task_id,
  t.scheduled_date,
  t.scheduled_start_at,
  t.scheduled_end_at,
  t.package_name,
  t.service_tier,
  t.locked,
  t.rejection_category,
  t.rejection_reason,
  t.rejection_count,
  t.approval_due_at,
  t.submitted_at,
  t.approved_at,
  t.delivered_at,
  t.created_at,
  t.updated_at,
  t.supervisor_id,
  t.approval_manager_id,
  p.id  AS property_id,
  p.unit_label,
  p.building_name,
  p.community,
  p.property_type,
  p.client_name,
  p.developer_name,
  pr.id AS project_id,
  pr.name AS project_name,
  COALESCE(a.area_count, 0)      AS area_count,
  COALESCE(a.confirmed_count, 0) AS confirmed_area_count,
  COALESCE(s.snag_count, 0)      AS snag_count,
  COALESCE(s.high_count, 0)      AS high_severity_count,
  COALESCE(s.open_count, 0)      AS open_snag_count,
  COALESCE(ph.photo_count, 0)    AS photo_count
FROM public.snagging_tasks t
JOIN public.snagging_properties p ON p.id = t.property_id
LEFT JOIN public.snagging_projects pr ON pr.id = t.project_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS area_count,
         COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) AS confirmed_count
  FROM public.snagging_areas WHERE task_id = t.id
) a ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS snag_count,
         COUNT(*) FILTER (WHERE severity = 'high') AS high_count,
         COUNT(*) FILTER (WHERE status IN ('open', 'pending_verification',
                                           'verified_poor_quality', 'verified_not_done')) AS open_count
  FROM public.snagging_snags WHERE origin_task_id = t.id
) s ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS photo_count
  FROM public.snagging_snag_photos WHERE task_id = t.id
) ph ON TRUE;

-- FR-7.04: internal developer-quality view — snag rate per unit.
CREATE OR REPLACE VIEW public.snagging_developer_quality AS
SELECT
  COALESCE(p.developer_name, 'Unknown') AS developer_name,
  p.building_name,
  COUNT(DISTINCT p.id)                                       AS unit_count,
  COUNT(sn.id)                                               AS snag_count,
  ROUND(COUNT(sn.id)::NUMERIC / NULLIF(COUNT(DISTINCT p.id), 0), 2) AS snags_per_unit,
  COUNT(sn.id) FILTER (WHERE sn.severity = 'high')           AS high_severity_count,
  COUNT(sn.id) FILTER (WHERE sn.status = 'verified_closed')  AS closed_count,
  COUNT(sn.id) FILTER (WHERE sn.status IN ('open', 'pending_verification',
                                           'verified_poor_quality', 'verified_not_done')) AS outstanding_count
FROM public.snagging_properties p
LEFT JOIN public.snagging_snags sn ON sn.property_id = p.id
GROUP BY COALESCE(p.developer_name, 'Unknown'), p.building_name;

-- Views run with the privileges of the caller, not the definer, so the
-- RLS below still applies to anyone reading them through PostgREST.
ALTER VIEW public.snagging_task_summaries SET (security_invoker = true);
ALTER VIEW public.snagging_developer_quality SET (security_invoker = true);

-- -----------------------------------------------------
-- 17. Storage
-- -----------------------------------------------------

-- Private: property photos are personal data under PDPL (§7), so no
-- object is served without a signed URL minted by the API.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('snagging', 'snagging', FALSE, 52428800)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "snagging authenticated upload" ON storage.objects;
CREATE POLICY "snagging authenticated upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'snagging');

DROP POLICY IF EXISTS "snagging authenticated read" ON storage.objects;
CREATE POLICY "snagging authenticated read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'snagging');

-- Re-uploading the same object key after a failed sync must not 409.
DROP POLICY IF EXISTS "snagging owner update" ON storage.objects;
CREATE POLICY "snagging owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'snagging' AND owner = auth.uid())
WITH CHECK (bucket_id = 'snagging' AND owner = auth.uid());

-- -----------------------------------------------------
-- 18. Row level security
--
-- Server code uses the service role and bypasses all of this. The
-- policies exist for the mobile app, which holds a user JWT.
-- -----------------------------------------------------

-- True when the current JWT belongs to somebody assigned to the task,
-- its supervisor, or its approval manager. SECURITY DEFINER so the
-- policy can read the assignment table without recursing through that
-- table's own RLS.
CREATE OR REPLACE FUNCTION public.snagging_is_task_member(p_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.snagging_task_assignees a
    WHERE a.task_id = p_task_id
      AND a.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.snagging_tasks t
    WHERE t.id = p_task_id
      AND (t.supervisor_id = auth.uid() OR t.approval_manager_id = auth.uid())
  );
$$;

ALTER TABLE public.snagging_catalogue_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_catalogue_areas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_catalogue_area_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_area_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_area_template_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_properties             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_tasks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_task_assignees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_areas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_floor_plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_snags                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_snag_photos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_snag_verifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_submissions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_approvals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_audit_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_reports                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_report_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_report_token_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_sync_mutations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_devices                ENABLE ROW LEVEL SECURITY;

-- Reference data is readable by any signed-in staff member; only the
-- server writes it.
DROP POLICY IF EXISTS "snagging catalogue readable" ON public.snagging_catalogue_entries;
CREATE POLICY "snagging catalogue readable"
ON public.snagging_catalogue_entries FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "snagging catalogue areas readable" ON public.snagging_catalogue_areas;
CREATE POLICY "snagging catalogue areas readable"
ON public.snagging_catalogue_areas FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "snagging catalogue area elements readable" ON public.snagging_catalogue_area_elements;
CREATE POLICY "snagging catalogue area elements readable"
ON public.snagging_catalogue_area_elements FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "snagging templates readable" ON public.snagging_area_templates;
CREATE POLICY "snagging templates readable"
ON public.snagging_area_templates FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "snagging template items readable" ON public.snagging_area_template_items;
CREATE POLICY "snagging template items readable"
ON public.snagging_area_template_items FOR SELECT TO authenticated USING (TRUE);

-- A signed-in inspector sees the jobs they are on, and nothing else.
DROP POLICY IF EXISTS "snagging tasks member read" ON public.snagging_tasks;
CREATE POLICY "snagging tasks member read"
ON public.snagging_tasks FOR SELECT TO authenticated
USING (public.snagging_is_task_member(id));

DROP POLICY IF EXISTS "snagging assignees self read" ON public.snagging_task_assignees;
CREATE POLICY "snagging assignees self read"
ON public.snagging_task_assignees FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.snagging_is_task_member(task_id));

DROP POLICY IF EXISTS "snagging properties member read" ON public.snagging_properties;
CREATE POLICY "snagging properties member read"
ON public.snagging_properties FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.snagging_tasks t
  WHERE t.property_id = snagging_properties.id
    AND public.snagging_is_task_member(t.id)
));

DROP POLICY IF EXISTS "snagging projects member read" ON public.snagging_projects;
CREATE POLICY "snagging projects member read"
ON public.snagging_projects FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.snagging_tasks t
  WHERE t.project_id = snagging_projects.id
    AND public.snagging_is_task_member(t.id)
));

-- Task-scoped child tables: read for members, write for members while
-- the task is still open. The lock check is what enforces BR-6 against
-- a device replaying an edit after submission.
DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('snagging_areas',              'task_id'),
      ('snagging_floor_plans',        'task_id'),
      ('snagging_snag_photos',        'task_id'),
      ('snagging_submissions',        'task_id'),
      ('snagging_approvals',          'task_id')
    ) AS v(table_name, task_column)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   spec.table_name || '_member_read', spec.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
       USING (%I IS NOT NULL AND public.snagging_is_task_member(%I))',
      spec.table_name || '_member_read', spec.table_name,
      spec.task_column, spec.task_column
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "snagging snags member read" ON public.snagging_snags;
CREATE POLICY "snagging snags member read"
ON public.snagging_snags FOR SELECT TO authenticated
USING (public.snagging_is_task_member(origin_task_id));

DROP POLICY IF EXISTS "snagging verifications member read" ON public.snagging_snag_verifications;
CREATE POLICY "snagging verifications member read"
ON public.snagging_snag_verifications FOR SELECT TO authenticated
USING (public.snagging_is_task_member(round_task_id));

-- A device may register and update only its own row.
DROP POLICY IF EXISTS "snagging devices self" ON public.snagging_devices;
CREATE POLICY "snagging devices self"
ON public.snagging_devices FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Everything else (writes to snags, approvals, audit, reports, tokens)
-- goes through the API on the service role. No policy is defined for
-- those paths, so PostgREST denies them by default.

DO $$
BEGIN
  RAISE NOTICE 'Migration 20260817090000_create_snagging_module.sql completed successfully!';
END $$;
