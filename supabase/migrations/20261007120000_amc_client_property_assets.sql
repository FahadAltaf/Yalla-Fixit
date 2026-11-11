-- =====================================================================
-- AMC client profile, properties, assets, access rules, scope, documents
-- (BRD v0.3 Phase 2: DEV-348, 353, 360, 361, 379, 380, 381)
--
-- NOT APPLIED. Branch amc-hardening, 7 Oct 2026.
-- SAFE BEFORE CODE DEPLOY. Checked against origin/main, 7 Oct 2026: every
-- table here is new or one that live `main` never uses (customers and
-- customer_properties come from 20261006130000, also branch-only). Only
-- nullable columns or columns with defaults are added; no existing row is
-- changed except that existing customers are marked lifecycle 'client'
-- (they were all created for signed contracts).
-- Idempotent: safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Client profile (DEV-353): identity, lifecycle, consent
-- ---------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_type text CHECK (customer_type IS NULL OR customer_type IN ('individual', 'company')),
  /* BRD 5.9: the prospect becomes the client on signing and first payment. */
  ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'client' CHECK (lifecycle IN ('prospect', 'client', 'former')),
  ADD COLUMN IF NOT EXISTS became_client_at timestamptz,
  ADD COLUMN IF NOT EXISTS trade_license_no text,
  ADD COLUMN IF NOT EXISTS trade_license_expiry date,
  ADD COLUMN IF NOT EXISTS trn text,
  ADD COLUMN IF NOT EXISTS preferred_channel text CHECK (preferred_channel IS NULL OR preferred_channel IN ('whatsapp', 'email', 'call', 'sms')),
  ADD COLUMN IF NOT EXISTS preferred_language text,
  /* Marketing consent is kept apart from the contact details (BRD 5.9). */
  ADD COLUMN IF NOT EXISTS marketing_consent boolean,
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_consent_source text,
  ADD COLUMN IF NOT EXISTS marketing_consent_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_lifecycle ON public.customers (lifecycle);
CREATE INDEX IF NOT EXISTS idx_customers_consent_by ON public.customers (marketing_consent_by) WHERE marketing_consent_by IS NOT NULL;

/* Contacts: as many as needed, each with a role (BRD 5.9). */
CREATE TABLE IF NOT EXISTS public.amc_customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('primary', 'alternate', 'accounts', 'tenant', 'owner', 'signatory', 'site', 'other')),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  position text,
  phone text,
  whatsapp text,
  email text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amc_customer_contacts_customer ON public.amc_customer_contacts (customer_id);
/* One active primary contact per client. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_customer_contacts_primary
  ON public.amc_customer_contacts (customer_id) WHERE role = 'primary' AND active;

/* Communication log (BRD 5.9): manual entries and, later, every portal send. */
CREATE TABLE IF NOT EXISTS public.amc_communication_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  property_id uuid REFERENCES public.customer_properties(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES public.amc_contracts(id) ON DELETE SET NULL,
  submission_id uuid REFERENCES public.amc_submissions(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('call', 'whatsapp', 'email', 'sms', 'meeting', 'site_visit', 'portal', 'other')),
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound', 'internal')),
  subject text,
  summary text NOT NULL CHECK (length(trim(summary)) > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'system')),
  logged_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amc_communication_customer ON public.amc_communication_log (customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_communication_property ON public.amc_communication_log (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_communication_contract ON public.amc_communication_log (contract_id) WHERE contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_communication_submission ON public.amc_communication_log (submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_communication_logged_by ON public.amc_communication_log (logged_by) WHERE logged_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Properties (DEV-348): full type list, unit-level address, floors and
--    zones, occupancy, combined units, access constraints
-- ---------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.customer_properties'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%unit_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.customer_properties DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.customer_properties
  ADD CONSTRAINT customer_properties_unit_type_check CHECK (
    unit_type IS NULL OR unit_type IN ('villa', 'apartment', 'townhouse', 'restaurant', 'clinic', 'shop', 'office', 'warehouse', 'other')
  );
/* Assessments copy the property's type, so they take the same list. */
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.amc_assessments'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%unit_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.amc_assessments DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.amc_assessments
  ADD CONSTRAINT amc_assessments_unit_type_check CHECK (
    unit_type IS NULL OR unit_type IN ('villa', 'apartment', 'townhouse', 'restaurant', 'clinic', 'shop', 'office', 'warehouse', 'other')
  );
ALTER TABLE public.customer_properties
  ADD COLUMN IF NOT EXISTS building text,
  ADD COLUMN IF NOT EXISTS unit_no text,
  ADD COLUMN IF NOT EXISTS floor text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS floors_count integer CHECK (floors_count IS NULL OR floors_count BETWEEN 0 AND 300),
  ADD COLUMN IF NOT EXISTS zones text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS occupancy text CHECK (occupancy IS NULL OR occupancy IN ('owner', 'tenant', 'vacant')),
  ADD COLUMN IF NOT EXISTS access_constraints text,
  /* Combined units are linked, never merged: each keeps its owner, billing and history. */
  ADD COLUMN IF NOT EXISTS parent_property_id uuid REFERENCES public.customer_properties(id) ON DELETE RESTRICT;
ALTER TABLE public.customer_properties DROP CONSTRAINT IF EXISTS customer_properties_not_own_parent;
ALTER TABLE public.customer_properties
  ADD CONSTRAINT customer_properties_not_own_parent CHECK (parent_property_id IS NULL OR parent_property_id <> id);
CREATE INDEX IF NOT EXISTS idx_customer_properties_parent ON public.customer_properties (parent_property_id) WHERE parent_property_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Asset register (DEV-361)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_property_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.customer_properties(id) ON DELETE RESTRICT,
  asset_type text NOT NULL CHECK (length(trim(asset_type)) > 0),
  trade text NOT NULL CHECK (trade IN ('ac', 'plumbing', 'electrical', 'handyman', 'civil', 'other')),
  /* Identical units can be one row (e.g. 4 split units); a serial number means one unit. */
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  location text,
  make text,
  model text,
  serial_no text,
  capacity text,
  installed_on date,
  condition text NOT NULL DEFAULT 'unknown' CHECK (condition IN ('good', 'fair', 'poor', 'critical', 'unknown')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  retired_at timestamptz,
  retired_reason text,
  notes text,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_property_assets_serial_single CHECK (serial_no IS NULL OR quantity = 1),
  CONSTRAINT amc_property_assets_retired CHECK (status <> 'retired' OR (retired_at IS NOT NULL AND length(trim(coalesce(retired_reason, ''))) > 0))
);
CREATE INDEX IF NOT EXISTS idx_amc_property_assets_property ON public.amc_property_assets (property_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_property_assets_serial
  ON public.amc_property_assets (property_id, upper(trim(serial_no))) WHERE serial_no IS NOT NULL AND trim(serial_no) <> '';

-- ---------------------------------------------------------------------
-- 4. Access rules per property (DEV-380)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_property_access_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.customer_properties(id) ON DELETE RESTRICT,
  access_type text NOT NULL CHECK (access_type IN ('community_gate_pass', 'building_permit', 'security_clearance', 'lift_booking', 'key_collection', 'other')),
  issuer text,
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days BETWEEN 0 AND 90),
  /* 0 = Sunday … 6 = Saturday; empty = any day. */
  permitted_days integer[] NOT NULL DEFAULT '{}',
  permitted_from time,
  permitted_to time,
  parking text,
  contact_name text,
  contact_phone text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_access_rules_hours CHECK (permitted_from IS NULL OR permitted_to IS NULL OR permitted_from < permitted_to),
  CONSTRAINT amc_access_rules_days CHECK (permitted_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6])
);
CREATE INDEX IF NOT EXISTS idx_amc_access_rules_property ON public.amc_property_access_rules (property_id) WHERE active;

-- ---------------------------------------------------------------------
-- 5. Scope per property (DEV-360): captured once, reused by the proposal
--    and the schedule
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_scope_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.customer_properties(id) ON DELETE RESTRICT,
  /* The AMC service (catalogue id in AMC Settings, or the rate card later). */
  service_id text NOT NULL CHECK (length(trim(service_id)) > 0),
  trade text NOT NULL CHECK (trade IN ('ac', 'plumbing', 'electrical', 'handyman', 'civil', 'other')),
  asset_id uuid REFERENCES public.amc_property_assets(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  frequency_per_year integer CHECK (frequency_per_year IS NULL OR frequency_per_year BETWEEN 1 AND 365),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 1440),
  preferred_months integer[] NOT NULL DEFAULT '{}',
  preferred_days integer[] NOT NULL DEFAULT '{}',
  exclusions text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_scope_months CHECK (preferred_months <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  CONSTRAINT amc_scope_days CHECK (preferred_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6])
);
CREATE INDEX IF NOT EXISTS idx_amc_scope_items_property ON public.amc_scope_items (property_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_amc_scope_items_asset ON public.amc_scope_items (asset_id) WHERE asset_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 6. Document store (DEV-381): private bucket amc-documents, versioned
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* What it belongs to: BRD 5.9 levels (prospect/client, property,
     contract, visit) plus enquiry, proposal and call out for later phases. */
  level text NOT NULL CHECK (level IN ('customer', 'property', 'contract', 'proposal', 'enquiry', 'visit', 'call_out')),
  entity_id uuid NOT NULL,
  /* The client it rolls up to, for the client profile's document list. */
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (length(trim(category)) > 0),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  expires_on date,
  notes text,
  /* A newer version replaces it; the file is kept. */
  superseded_by uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_documents_version_unique UNIQUE (level, entity_id, category, title, version)
);
CREATE INDEX IF NOT EXISTS idx_amc_documents_entity ON public.amc_documents (level, entity_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_documents_customer ON public.amc_documents (customer_id, uploaded_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_documents_expiry ON public.amc_documents (expires_on) WHERE expires_on IS NOT NULL AND superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_amc_documents_superseded ON public.amc_documents (superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_documents_uploaded_by ON public.amc_documents (uploaded_by) WHERE uploaded_by IS NOT NULL;

/* The private bucket (20261006150000) also takes Word and Excel files now. */
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
     'application/pdf', 'text/html', 'image/jpeg', 'image/png', 'image/webp',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
   ],
       public = false
 WHERE id = 'amc-documents';

-- ---------------------------------------------------------------------
-- Access: service role only (the portal API)
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_communication_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_property_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_property_access_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_scope_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_customer_contacts, public.amc_communication_log, public.amc_property_assets,
  public.amc_property_access_rules, public.amc_scope_items, public.amc_documents FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Rollback:
--   DROP TABLE public.amc_documents, public.amc_scope_items, public.amc_property_access_rules,
--     public.amc_property_assets, public.amc_communication_log, public.amc_customer_contacts;
--   ALTER TABLE public.customer_properties DROP COLUMN parent_property_id, DROP COLUMN access_constraints,
--     DROP COLUMN occupancy, DROP COLUMN zones, DROP COLUMN floors_count, DROP COLUMN city, DROP COLUMN street,
--     DROP COLUMN floor, DROP COLUMN unit_no, DROP COLUMN building;
--   ALTER TABLE public.customers DROP COLUMN marketing_consent_by, DROP COLUMN marketing_consent_source,
--     DROP COLUMN marketing_consent_at, DROP COLUMN marketing_consent, DROP COLUMN preferred_language,
--     DROP COLUMN preferred_channel, DROP COLUMN trn, DROP COLUMN trade_license_expiry,
--     DROP COLUMN trade_license_no, DROP COLUMN became_client_at, DROP COLUMN lifecycle, DROP COLUMN customer_type;
--   (and restore the unit_type CHECK to villa/apartment/townhouse/office/other)
-- ---------------------------------------------------------------------
