-- Migration: Manpower Compliance core tables
-- Description: FRD "Manpower Compliance module" v0.9.3 (26 Oct 2026), FR-1,
--              FR-2, FR-9, FR-10, FR-13, FR-14 and decisions D3, D4, D5, D6,
--              D11, D15. Employee master, identity documents (the only table
--              holding Emirates ID and passport numbers), certificate types,
--              employee certificates, module settings and the append-only
--              audit log. Additive, no data change, no seeding: certificate
--              types and lists are entered through the UI.
--
-- Access model: every table has RLS enabled with NO policies and all grants
-- revoked from anon and authenticated, as amc_settings and todo_attachments
-- do. Data reaches the browser only through authenticated route handlers that
-- use the service-role client and check the compliance permission; identity
-- numbers are masked there.

-- ---------------------------------------------------------------------
-- Certificate types (D5, D6): a managed list with an "expires" flag.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_certificate_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  -- D6: some trainings never expire. A held non-expiring type is Valid
  -- with no date.
  expires BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  -- Retired, never deleted: employee rows keep pointing at it.
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compliance_certificate_types_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS compliance_certificate_types_name_key
  ON public.compliance_certificate_types (LOWER(name));

COMMENT ON TABLE public.compliance_certificate_types IS
  'Training certificate types (FRD FR-1, D5). Seven entered via the UI at go-live; retired, never deleted.';

-- ---------------------------------------------------------------------
-- Employees (FR-1): one row per Maher ID. Identity numbers are NOT here.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- D3: the company staff number. Text so leading zeros survive. Unique
  -- across archived rows too, so a rehire reactivates the same record.
  maher_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  designation_id UUID REFERENCES public.lookup_options(id) ON DELETE RESTRICT,
  nationality_id UUID REFERENCES public.lookup_options(id) ON DELETE RESTRICT,
  date_of_joining DATE,
  -- Fixed set, not a lookup: the D11 rules depend on the values.
  employment_status TEXT NOT NULL DEFAULT 'active',
  -- D4: current site = FSM client plus optional project location, through
  -- the rows the snagging module already keeps for FSM clients/addresses.
  -- The foreign keys are added below, guarded, because no migration in
  -- this repo creates snagging_clients.
  site_client_id UUID,
  site_property_id UUID,
  site_assigned_at TIMESTAMPTZ,
  site_assigned_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  -- D11: optional link to the FSM technician. RESTRICT on purpose: the FSM
  -- sync deletes technicians who stop qualifying unless a foreign key
  -- blocks it, in which case it keeps the row as inactive with
  -- deactivated_at stamped, which is exactly the signal D11 needs.
  fsm_resource_id TEXT REFERENCES public.technician_reference(fsm_resource_id) ON DELETE RESTRICT,
  remarks TEXT,
  -- FR-10 / D15: source ownership of the employment group (name,
  -- designation, nationality, joining date, status). Portal now; HR later.
  employment_source TEXT NOT NULL DEFAULT 'portal',
  employment_source_ref TEXT,
  employment_synced_at TIMESTAMPTZ,
  -- FR-14: archive, never delete.
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  archive_reason TEXT,
  -- FR-12: set by the one-time import; the batch table arrives in phase 3.
  import_batch_id UUID,
  import_row INTEGER,
  created_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compliance_employees_maher_id_not_empty CHECK (LENGTH(TRIM(maher_id)) > 0),
  CONSTRAINT compliance_employees_full_name_not_empty CHECK (LENGTH(TRIM(full_name)) > 0),
  CONSTRAINT compliance_employees_status_check CHECK (
    employment_status IN ('active', 'on_leave', 'inactive', 'resigned', 'terminated')
  ),
  CONSTRAINT compliance_employees_joining_range CHECK (
    date_of_joining IS NULL OR date_of_joining BETWEEN DATE '1950-01-01' AND DATE '2100-12-31'
  ),
  CONSTRAINT compliance_employees_remarks_length CHECK (remarks IS NULL OR LENGTH(remarks) <= 10000),
  CONSTRAINT compliance_employees_source_check CHECK (employment_source IN ('portal', 'hr_erp'))
);

CREATE UNIQUE INDEX IF NOT EXISTS compliance_employees_maher_id_key
  ON public.compliance_employees (maher_id);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_employees_fsm_resource_key
  ON public.compliance_employees (fsm_resource_id) WHERE fsm_resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_employees_status_idx
  ON public.compliance_employees (employment_status) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS compliance_employees_site_idx
  ON public.compliance_employees (site_client_id);
CREATE INDEX IF NOT EXISTS compliance_employees_designation_idx
  ON public.compliance_employees (designation_id);
CREATE INDEX IF NOT EXISTS compliance_employees_import_idx
  ON public.compliance_employees (import_batch_id);

COMMENT ON TABLE public.compliance_employees IS
  'Manpower Compliance employee master (FRD FR-1). Keyed by the Maher ID. Identity numbers live in compliance_identity_documents.';
COMMENT ON COLUMN public.compliance_employees.fsm_resource_id IS
  'Optional link to technician_reference. ON DELETE RESTRICT keeps linked technicians as inactive rows when the FSM sync would otherwise delete them (D11).';
COMMENT ON COLUMN public.compliance_employees.site_client_id IS
  'Current site: the FSM client (snagging_clients.id) the employee is assigned to (D4).';
COMMENT ON COLUMN public.compliance_employees.site_property_id IS
  'Current site: optional project location (snagging_properties.id) under that client (D4).';

-- Site foreign keys, only where the snagging client tables exist (they are
-- altered but never created by a migration in this repo).
DO $$
BEGIN
  IF to_regclass('public.snagging_clients') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'compliance_employees_site_client_fkey'
     ) THEN
    ALTER TABLE public.compliance_employees
      ADD CONSTRAINT compliance_employees_site_client_fkey
      FOREIGN KEY (site_client_id) REFERENCES public.snagging_clients(id) ON DELETE SET NULL;
  END IF;
  IF to_regclass('public.snagging_properties') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'compliance_employees_site_property_fkey'
     ) THEN
    ALTER TABLE public.compliance_employees
      ADD CONSTRAINT compliance_employees_site_property_fkey
      FOREIGN KEY (site_property_id) REFERENCES public.snagging_properties(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Identity documents (FR-1, FR-9, FR-10): 1:1 with the employee. The only
-- table that holds Emirates ID and passport numbers, so it can be gated and
-- later switched to the HR source as a unit (D15).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_identity_documents (
  employee_id UUID PRIMARY KEY REFERENCES public.compliance_employees(id) ON DELETE CASCADE,
  emirates_id_number TEXT,
  emirates_id_expiry DATE,
  emirates_id_source TEXT NOT NULL DEFAULT 'portal',
  emirates_id_source_ref TEXT,
  emirates_id_synced_at TIMESTAMPTZ,
  passport_number TEXT,
  passport_expiry DATE,
  passport_source TEXT NOT NULL DEFAULT 'portal',
  passport_source_ref TEXT,
  passport_synced_at TIMESTAMPTZ,
  -- FR-14: set when the numbers are purged after the retention period
  -- (period still open, follow-up F6; the purge job is not built yet).
  numbers_purged_at TIMESTAMPTZ,
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compliance_identity_eid_format CHECK (
    emirates_id_number IS NULL OR emirates_id_number ~ '^[0-9]{15}$'
  ),
  CONSTRAINT compliance_identity_passport_format CHECK (
    passport_number IS NULL OR passport_number ~ '^[A-Za-z0-9]{5,20}$'
  ),
  CONSTRAINT compliance_identity_eid_expiry_range CHECK (
    emirates_id_expiry IS NULL OR emirates_id_expiry BETWEEN DATE '1950-01-01' AND DATE '2100-12-31'
  ),
  CONSTRAINT compliance_iden
  tity_passport_expiry_range CHECK (
    passport_expiry IS NULL OR passport_expiry BETWEEN DATE '1950-01-01' AND DATE '2100-12-31'
  ),
  CONSTRAINT compliance_identity_eid_source_check CHECK (emirates_id_source IN ('portal', 'hr_erp')),
  CONSTRAINT compliance_identity_passport_source_check CHECK (passport_source IN ('portal', 'hr_erp'))
);

COMMENT ON TABLE public.compliance_identity_documents IS
  'Emirates ID and passport numbers and expiries (FRD FR-1, FR-9). Masked to the last 4 everywhere except the audited reveal route.';

-- ---------------------------------------------------------------------
-- Employee certificates (FR-1): no row means Not held.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_employee_certificates (
  employee_id UUID NOT NULL REFERENCES public.compliance_employees(id) ON DELETE CASCADE,
  certificate_type_id UUID NOT NULL REFERENCES public.compliance_certificate_types(id) ON DELETE RESTRICT,
  held BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_date DATE,
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, certificate_type_id),
  -- AC-08 at the database: Held = No never carries a date.
  CONSTRAINT compliance_employee_certificates_held_or_no_date CHECK (held OR expiry_date IS NULL),
  CONSTRAINT compliance_employee_certificates_expiry_range CHECK (
    expiry_date IS NULL OR expiry_date BETWEEN DATE '1950-01-01' AND DATE '2100-12-31'
  )
);

COMMENT ON TABLE public.compliance_employee_certificates IS
  'Held / expiry per employee and certificate type (FRD FR-1). Status is computed, never stored.';

-- ---------------------------------------------------------------------
-- Module settings (FR-8, FR-10): a single row, created on first save.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  -- D13 / F4: how often an expired item is reminded again, in days.
  overdue_repeat_days INTEGER NOT NULL DEFAULT 7,
  -- FR-10: field groups the HR system owns once it is live.
  hr_owned_groups TEXT[] NOT NULL DEFAULT '{}',
  -- D11 (Sami, 27 Oct 2026): the Deactivate action on a linked technician
  -- emails these portal users to deactivate the person in FSM.
  deactivation_request_user_ids UUID[] NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compliance_settings_single_row CHECK (id = 1),
  CONSTRAINT compliance_settings_repeat_range CHECK (overdue_repeat_days BETWEEN 1 AND 90),
  CONSTRAINT compliance_settings_groups_check CHECK (
    hr_owned_groups <@ ARRAY['employment', 'emirates_id', 'passport']::TEXT[]
  )
);

-- ---------------------------------------------------------------------
-- Audit (FR-13): append-only, like amc_audit_events. Identity numbers are
-- stored masked by the application; the table never sees a full number.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_audit_events (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  employee_id UUID,
  event_type TEXT NOT NULL,
  field TEXT,
  old_value JSONB,
  new_value JSONB,
  actor_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  actor_label TEXT,
  origin TEXT NOT NULL DEFAULT 'portal',
  import_batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compliance_audit_entity_check CHECK (
    entity_type IN ('employee', 'identity', 'certificate', 'certificate_type', 'list', 'site',
                    'settings', 'role_requirement', 'identity_viewer', 'recipient', 'import',
                    'export', 'reminder_run')
  ),
  CONSTRAINT compliance_audit_event_check CHECK (
    event_type IN ('create', 'edit', 'archive', 'unarchive', 'reveal', 'export', 'import',
                   'import_rollback', 'hr_sync', 'grant', 'revoke')
  ),
  CONSTRAINT compliance_audit_origin_check CHECK (origin IN ('portal', 'system', 'import', 'hr'))
);

CREATE INDEX IF NOT EXISTS compliance_audit_employee_idx
  ON public.compliance_audit_events (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS compliance_audit_created_idx
  ON public.compliance_audit_events (created_at DESC);

CREATE OR REPLACE RULE compliance_audit_events_no_update AS
  ON UPDATE TO public.compliance_audit_events DO INSTEAD NOTHING;
CREATE OR REPLACE RULE compliance_audit_events_no_delete AS
  ON DELETE TO public.compliance_audit_events DO INSTEAD NOTHING;

COMMENT ON TABLE public.compliance_audit_events IS
  'Append-only audit of compliance actions (FRD FR-13). Old/new identity values are masked.';

-- ---------------------------------------------------------------------
-- Deny by default (FR-9, AC-36). No policies: only the service-role client
-- used by the route handlers can read or write.
-- ---------------------------------------------------------------------
ALTER TABLE public.compliance_certificate_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_identity_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_employee_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.compliance_certificate_types FROM anon, authenticated;
REVOKE ALL ON public.compliance_employees FROM anon, authenticated;
REVOKE ALL ON public.compliance_identity_documents FROM anon, authenticated;
REVOKE ALL ON public.compliance_employee_certificates FROM anon, authenticated;
REVOKE ALL ON public.compliance_settings FROM anon, authenticated;
REVOKE ALL ON public.compliance_audit_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.compliance_audit_events_id_seq FROM anon, authenticated;

-- Lookup list keys used by the module in public.lookup_options (no rows
-- inserted here): 'compliance_designation', 'compliance_nationality'.

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT
  to_regclass('public.compliance_employees') AS employees,
  to_regclass('public.compliance_identity_documents') AS identity_documents,
  to_regclass('public.compliance_certificate_types') AS certificate_types,
  to_regclass('public.compliance_employee_certificates') AS employee_certificates,
  to_regclass('public.compliance_settings') AS settings,
  to_regclass('public.compliance_audit_events') AS audit_events,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_employees_site_client_fkey') AS site_fk_present;
