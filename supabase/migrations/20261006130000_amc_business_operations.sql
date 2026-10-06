-- =====================================================================
-- Shared customers and properties; AMC assessments, additional-service
-- quotes and the additional-service discount configuration
--
-- NOT APPLIED. Branch amc-hardening (created 6 Oct 2026). Apply after
-- 20261006120000_amc_fsm_integration.sql. See
-- docs/amc-business-operations-report.md.
--
-- 1. customers / customer_properties: one record per real customer and
--    property, shared by modules (not amc_-prefixed). snagging_clients and
--    snagging_properties stay as they are: they are gated by Snagging
--    permissions and carry handover-inspection fields (developer, title
--    deed, NOC) and a different property-type list, so AMC is not forced
--    into them. Each shared record can point at its Snagging counterpart
--    (snagging_client_id / snagging_property_id): the convergence path,
--    so the same person is never kept as two unrelated customers.
-- 2. amc_contracts and amc_submissions gain optional customer_id /
--    property_id: who the customer and property are TODAY. The signed
--    snapshots (customer, property jsonb) are untouched and never follow
--    later edits.
-- 3. AMC property assessments with a configurable checklist. Item labels
--    are copied onto each assessment, so editing the checklist never
--    rewrites a past assessment.
-- 4. Additional-service quotes: the eligibility answer and the commercial
--    calculation (standard price, discount %, amount, final price) kept as
--    computed, linked to the contract and, once staff create it in Zoho
--    FSM, to the FSM estimate.
-- 5. amc_additional_service_discount: the discount configuration, OFF by
--    default with no rate (no 25% is assumed).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Shared customers and properties
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  /* The business identifier staff use (e.g. YFI1806). */
  customer_ref text,
  company text,
  email text,
  phone text,
  /* Zoho FSM Contacts record id, when known. */
  fsm_contact_id text,
  /* The same person in Snagging, when linked. */
  snagging_client_id uuid REFERENCES public.snagging_clients(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_ref
  ON public.customers (upper(trim(customer_ref))) WHERE customer_ref IS NOT NULL AND trim(customer_ref) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_fsm_contact
  ON public.customers (fsm_contact_id) WHERE fsm_contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_snagging_client
  ON public.customers (snagging_client_id) WHERE snagging_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.customers (lower(name));

CREATE TABLE IF NOT EXISTS public.customer_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  /* "Villa 12, Street 4" as staff write it. */
  label text NOT NULL CHECK (length(trim(label)) > 0),
  address text,
  community text,
  property_category text CHECK (property_category IS NULL OR property_category IN ('residential', 'commercial')),
  unit_type text CHECK (unit_type IS NULL OR unit_type IN ('villa', 'apartment', 'townhouse', 'office', 'other')),
  bedrooms integer CHECK (bedrooms IS NULL OR bedrooms >= 0),
  size_sqft numeric CHECK (size_sqft IS NULL OR size_sqft > 0),
  snagging_property_id uuid REFERENCES public.snagging_properties(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_properties_customer ON public.customer_properties (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_properties_snagging
  ON public.customer_properties (snagging_property_id) WHERE snagging_property_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Live links on proposals and contracts (snapshots unchanged)
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contracts
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.customer_properties(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_amc_contracts_customer ON public.amc_contracts (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_contracts_property ON public.amc_contracts (property_id) WHERE property_id IS NOT NULL;

ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.customer_properties(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 3. Assessments
-- ---------------------------------------------------------------------
/* The checklist, editable by AMC approvers. */
CREATE TABLE IF NOT EXISTS public.amc_assessment_checklist (
  item_key text PRIMARY KEY CHECK (item_key ~ '^[a-z0-9][a-z0-9_-]*$'),
  category_key text NOT NULL CHECK (category_key ~ '^[a-z0-9][a-z0-9_-]*$'),
  category_label text NOT NULL CHECK (length(trim(category_label)) > 0),
  label text NOT NULL CHECK (length(trim(label)) > 0),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
/* Starting checklist: short, general, meant to be edited. */
INSERT INTO public.amc_assessment_checklist (item_key, category_key, category_label, label, sort_order) VALUES
  ('ac-units-condition', 'air-conditioning', 'Air conditioning', 'Indoor and outdoor units: condition', 10),
  ('ac-cooling', 'air-conditioning', 'Air conditioning', 'Cooling performance', 20),
  ('ac-drainage', 'air-conditioning', 'Air conditioning', 'Drain lines and trays', 30),
  ('el-db', 'electrical', 'Electrical', 'Distribution board', 40),
  ('el-sockets-lights', 'electrical', 'Electrical', 'Sockets, switches and lights', 50),
  ('pl-leaks', 'plumbing', 'Plumbing', 'Visible leaks and damp', 60),
  ('pl-water-heaters', 'plumbing', 'Plumbing', 'Water heaters', 70),
  ('pl-tanks-pumps', 'plumbing', 'Plumbing', 'Water tanks and pumps', 80),
  ('gn-doors-windows', 'handyman', 'Handyman / general', 'Doors, windows and locks', 90),
  ('gn-fixtures', 'handyman', 'Handyman / general', 'Fixtures and fittings', 100),
  ('pc-walls-ceilings', 'property-condition', 'Property condition', 'Walls and ceilings', 110),
  ('pc-external', 'property-condition', 'Property condition', 'External areas', 120)
ON CONFLICT (item_key) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS public.amc_assessment_number_seq;
CREATE TABLE IF NOT EXISTS public.amc_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_number text NOT NULL UNIQUE
    DEFAULT ('ASM-' || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY') || '-' || lpad(nextval('public.amc_assessment_number_seq')::text, 4, '0')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT,
  property_id uuid REFERENCES public.customer_properties(id) ON DELETE RESTRICT,
  /* The proposal created from it, and the contract it was for (renewals). */
  submission_id uuid REFERENCES public.amc_submissions(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES public.amc_contracts(id) ON DELETE SET NULL,
  assessed_on date,
  assessor_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  assessor_name text,
  property_category text CHECK (property_category IS NULL OR property_category IN ('residential', 'commercial')),
  unit_type text CHECK (unit_type IS NULL OR unit_type IN ('villa', 'apartment', 'townhouse', 'office', 'other')),
  bedrooms integer CHECK (bedrooms IS NULL OR bedrooms >= 0),
  size_sqft numeric CHECK (size_sqft IS NULL OR size_sqft > 0),
  occupancy text CHECK (occupancy IS NULL OR occupancy IN ('occupied', 'vacant', 'unknown')),
  summary text,
  findings text,
  notes text,
  /* AMC catalogue service ids the assessor recommends. */
  recommended_service_ids text[] NOT NULL DEFAULT '{}',
  completed_at timestamptz,
  completed_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  /* Completed means dated, assessed, placed and finished. */
  CONSTRAINT amc_assessments_completed_shape CHECK (
    status = 'draft'
    OR (completed_at IS NOT NULL AND assessed_on IS NOT NULL AND property_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_amc_assessments_customer ON public.amc_assessments (customer_id, assessed_on DESC);
CREATE INDEX IF NOT EXISTS idx_amc_assessments_property ON public.amc_assessments (property_id, assessed_on DESC);

CREATE TABLE IF NOT EXISTS public.amc_assessment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.amc_assessments(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  category_key text NOT NULL,
  category_label text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  result text CHECK (result IS NULL OR result IN ('ok', 'attention', 'not_applicable')),
  notes text,
  UNIQUE (assessment_id, item_key)
);

/* A completed assessment is history: its answers no longer change. */
CREATE OR REPLACE FUNCTION public.amc_assessment_items_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM public.amc_assessments
   WHERE id = COALESCE(NEW.assessment_id, OLD.assessment_id);
  IF st = 'completed' THEN
    RAISE EXCEPTION 'A completed assessment cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS amc_assessment_items_locked ON public.amc_assessment_items;
CREATE TRIGGER amc_assessment_items_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.amc_assessment_items
  FOR EACH ROW EXECUTE FUNCTION public.amc_assessment_items_locked();
REVOKE ALL ON FUNCTION public.amc_assessment_items_locked() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.amc_assessments_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'A completed assessment cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  /* Once completed, only the link to the proposal created from it may be set. */
  IF OLD.status = 'completed' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.property_id IS DISTINCT FROM OLD.property_id
    OR NEW.assessed_on IS DISTINCT FROM OLD.assessed_on
    OR NEW.recommended_service_ids IS DISTINCT FROM OLD.recommended_service_ids
    OR NEW.summary IS DISTINCT FROM OLD.summary
    OR NEW.findings IS DISTINCT FROM OLD.findings
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
  ) THEN
    RAISE EXCEPTION 'A completed assessment cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS amc_assessments_locked ON public.amc_assessments;
CREATE TRIGGER amc_assessments_locked
  BEFORE UPDATE OR DELETE ON public.amc_assessments
  FOR EACH ROW EXECUTE FUNCTION public.amc_assessments_locked();
REVOKE ALL ON FUNCTION public.amc_assessments_locked() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS assessment_id uuid REFERENCES public.amc_assessments(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 4. Additional-service discount configuration (one row, off)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_additional_service_discount (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  discount_percent numeric(5,2) CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 100)),
  /* Only listed services/categories qualify; empty lists = none (lib/amc/additional-service-discount.ts). */
  eligible_service_keys text[] NOT NULL DEFAULT '{}',
  eligible_categories text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_discount_enabled_needs_rate CHECK (NOT enabled OR discount_percent IS NOT NULL)
);
INSERT INTO public.amc_additional_service_discount (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. Additional-service quotes
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.amc_additional_quote_number_seq;
CREATE TABLE IF NOT EXISTS public.amc_additional_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL UNIQUE
    DEFAULT ('AQ-' || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY') || '-' || lpad(nextval('public.amc_additional_quote_number_seq')::text, 4, '0')),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  property_id uuid REFERENCES public.customer_properties(id) ON DELETE SET NULL,
  service_key text NOT NULL CHECK (length(trim(service_key)) > 0),
  service_label text NOT NULL CHECK (length(trim(service_label)) > 0),
  service_category text,
  requested_for date NOT NULL,
  eligibility text NOT NULL CHECK (eligibility IN ('included_in_amc', 'amc_discount_eligible', 'standard_charge', 'not_configured')),
  standard_price numeric(12,2) CHECK (standard_price IS NULL OR standard_price >= 0),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  final_price numeric(12,2) CHECK (final_price IS NULL OR final_price >= 0),
  /* The rule, configuration and reasons as they were when computed. */
  calculation jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'estimate_linked', 'cancelled')),
  fsm_estimate_id text,
  fsm_estimate_number text,
  notes text,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_quote_figures CHECK (
    standard_price IS NULL OR final_price IS NULL OR final_price + discount_amount = standard_price
  ),
  CONSTRAINT amc_quote_estimate_linked CHECK (status <> 'estimate_linked' OR fsm_estimate_number IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_amc_additional_quotes_contract ON public.amc_additional_quotes (contract_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_additional_quotes_customer ON public.amc_additional_quotes (customer_id) WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_additional_quotes_estimate
  ON public.amc_additional_quotes (upper(fsm_estimate_number)) WHERE fsm_estimate_number IS NOT NULL AND status <> 'cancelled';

/* The commercial calculation is kept as computed: only the status, the
   FSM estimate link and notes change afterwards. */
CREATE OR REPLACE FUNCTION public.amc_additional_quotes_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.contract_id IS DISTINCT FROM OLD.contract_id
    OR NEW.service_key IS DISTINCT FROM OLD.service_key
    OR NEW.requested_for IS DISTINCT FROM OLD.requested_for
    OR NEW.eligibility IS DISTINCT FROM OLD.eligibility
    OR NEW.standard_price IS DISTINCT FROM OLD.standard_price
    OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent
    OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
    OR NEW.final_price IS DISTINCT FROM OLD.final_price
    OR NEW.calculation IS DISTINCT FROM OLD.calculation THEN
    RAISE EXCEPTION 'The quote calculation cannot be changed; cancel it and create another' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS amc_additional_quotes_frozen ON public.amc_additional_quotes;
CREATE TRIGGER amc_additional_quotes_frozen
  BEFORE UPDATE ON public.amc_additional_quotes
  FOR EACH ROW EXECUTE FUNCTION public.amc_additional_quotes_frozen();
REVOKE ALL ON FUNCTION public.amc_additional_quotes_frozen() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Audit: new entity types
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_audit_events DROP CONSTRAINT IF EXISTS amc_audit_events_entity_type_check;
ALTER TABLE public.amc_audit_events
  ADD CONSTRAINT amc_audit_events_entity_type_check
  CHECK (entity_type IN ('submission', 'settings', 'contract', 'assessment', 'customer', 'quote'));

-- ---------------------------------------------------------------------
-- Access: service role only
-- ---------------------------------------------------------------------
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_assessment_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_assessment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_additional_service_discount ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_additional_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customers, public.customer_properties, public.amc_assessment_checklist,
  public.amc_assessments, public.amc_assessment_items, public.amc_additional_service_discount,
  public.amc_additional_quotes FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.amc_assessment_number_seq, public.amc_additional_quote_number_seq FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Rollback (before any customer, assessment or quote exists)
-- ---------------------------------------------------------------------
--   ALTER TABLE public.amc_audit_events DROP CONSTRAINT amc_audit_events_entity_type_check;
--   ALTER TABLE public.amc_audit_events ADD CONSTRAINT amc_audit_events_entity_type_check
--     CHECK (entity_type IN ('submission', 'settings', 'contract'));
--   DROP TABLE IF EXISTS public.amc_additional_quotes;
--   DROP SEQUENCE IF EXISTS public.amc_additional_quote_number_seq;
--   DROP TABLE IF EXISTS public.amc_additional_service_discount;
--   ALTER TABLE public.amc_submissions DROP COLUMN IF EXISTS assessment_id;
--   DROP TABLE IF EXISTS public.amc_assessment_items;
--   DROP TABLE IF EXISTS public.amc_assessments;
--   DROP SEQUENCE IF EXISTS public.amc_assessment_number_seq;
--   DROP TABLE IF EXISTS public.amc_assessment_checklist;
--   ALTER TABLE public.amc_submissions DROP COLUMN IF EXISTS customer_id, DROP COLUMN IF EXISTS property_id;
--   ALTER TABLE public.amc_contracts DROP COLUMN IF EXISTS customer_id, DROP COLUMN IF EXISTS property_id;
--   DROP TABLE IF EXISTS public.customer_properties;
--   DROP TABLE IF EXISTS public.customers;
--   DROP FUNCTION IF EXISTS public.amc_assessment_items_locked(), public.amc_assessments_locked(),
--     public.amc_additional_quotes_frozen();
