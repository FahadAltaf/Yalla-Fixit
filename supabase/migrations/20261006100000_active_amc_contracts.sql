-- =====================================================================
-- Active AMC: operational contracts, entitlements and usage
--
-- NOT APPLIED. Branch amc-hardening (created 6 Oct 2026). Apply only
-- after the hardening migrations (20261005100000..20261005180000) and as
-- part of the reviewed deployment (docs/active-amc-implementation-report.md
-- section 18). Nothing here converts existing signed proposals.
--
-- Model
-- -----
-- A signed AMC proposal (amc_submissions.status = 'signed') stays where
-- it is: the proposal workflow is unchanged. An explicit "Activate AMC"
-- action (POST /api/amc-contracts, service role) turns it into ONE
-- operational contract:
--
--   amc_contracts               the agreement: who, where, when, how much,
--                               snapshotted at activation so later edits to
--                               the proposal, AMC Settings or prices never
--                               change it
--   amc_contract_entitlements   one row per contracted service: what it is
--                               (visits / hours / unlimited / informational)
--                               and how much is included and used
--   amc_entitlement_usage       append-only ledger of consumption and
--                               adjustments; a trigger keeps
--                               entitlements.used_quantity in step, and a
--                               CHECK makes over-consumption impossible
--
-- Stored contract status is only active | cancelled. "Expiring" and
-- "expired" are derived from end_date at read time (they cannot go stale),
-- and "pending activation" is a signed proposal with no contract row.
--
-- Access: service role only, like amc_settings and amc_audit_events. The
-- browser reads and writes through /api/amc-contracts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Contracts
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /* The signed proposal it came from. UNIQUE: one signed proposal can
     never produce two contracts, even if two people click Activate at the
     same moment. RESTRICT: a contract keeps its source. */
  submission_id uuid NOT NULL UNIQUE
    REFERENCES public.amc_submissions(id) ON DELETE RESTRICT,
  proposal_number text NOT NULL,

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled')),

  /* Snapshots taken at activation. */
  customer jsonb NOT NULL,
  property jsonb NOT NULL,
  account_managers jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* Searchable copies of the snapshot. customer_ref is the proposal's
     Customer ID (e.g. YFI1806), the key coverage lookups use. */
  customer_name text NOT NULL DEFAULT '',
  customer_ref text,
  property_label text NOT NULL DEFAULT '',
  unit_type text,

  start_date date NOT NULL,
  end_date date NOT NULL,
  term_months integer CHECK (term_months IS NULL OR term_months > 0),
  CONSTRAINT amc_contracts_period_valid CHECK (end_date > start_date),

  /* The signed commercial values (AED, two decimals). */
  currency text NOT NULL DEFAULT 'AED',
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  final_price numeric(12,2) NOT NULL CHECK (final_price >= 0),
  vat_amount numeric(12,2) NOT NULL CHECK (vat_amount >= 0),
  grand_total numeric(12,2) NOT NULL CHECK (grand_total >= 0),

  signed_at timestamptz NOT NULL,
  signed_by_name text NOT NULL CHECK (length(trim(signed_by_name)) > 0),
  /* The contract wording the client signed (merged settings snapshot). */
  contract_settings_snapshot jsonb,

  /* Renewal chain: the contract this one renews. A contract is renewed at
     most once (partial unique index below). */
  renewed_from_contract_id uuid REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,

  activated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  cancellation_reason text,
  CONSTRAINT amc_contracts_cancel_needs_reason CHECK (
    status <> 'cancelled'
    OR (cancelled_at IS NOT NULL AND length(trim(coalesce(cancellation_reason, ''))) > 0)
  ),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amc_contracts_status_end
  ON public.amc_contracts (status, end_date);
CREATE INDEX IF NOT EXISTS idx_amc_contracts_customer_ref
  ON public.amc_contracts (customer_ref) WHERE customer_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_contracts_end_date
  ON public.amc_contracts (end_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_contracts_renewed_from
  ON public.amc_contracts (renewed_from_contract_id)
  WHERE renewed_from_contract_id IS NOT NULL;

COMMENT ON TABLE public.amc_contracts IS
  'Operational AMC contracts, one per activated signed proposal. Snapshotted; see 20261006100000.';

-- ---------------------------------------------------------------------
-- 2. Entitlements
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_contract_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,

  service_id text NOT NULL,
  service_label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  /* The service's frequency type in the signed settings (covered,
     unlimited, ppm, handyman, fixed), kept for reference. */
  frequency_type text,

  entitlement_type text NOT NULL
    CHECK (entitlement_type IN ('visits', 'hours', 'unlimited', 'informational')),
  /* Emergency vs non-emergency call-outs, from the signed contract; null
     for services that are not call-outs. Drives the SLA that applies. */
  call_out_class text CHECK (call_out_class IS NULL OR call_out_class IN ('emergency', 'non_emergency')),

  units integer NOT NULL CHECK (units >= 1),
  frequency integer NOT NULL CHECK (frequency >= 1),
  /* How much is included for the contract period: required for visits
     and hours, absent for unlimited and informational. */
  included_quantity numeric(10,2),
  used_quantity numeric(10,2) NOT NULL DEFAULT 0 CHECK (used_quantity >= 0),
  CONSTRAINT amc_entitlements_included_matches_type CHECK (
    (entitlement_type IN ('visits', 'hours') AND included_quantity IS NOT NULL AND included_quantity >= 0)
    OR (entitlement_type IN ('unlimited', 'informational') AND included_quantity IS NULL)
  ),
  /* The guard that makes over-consumption impossible, whoever writes. */
  CONSTRAINT amc_entitlements_not_overused CHECK (
    included_quantity IS NULL OR used_quantity <= included_quantity
  ),
  CONSTRAINT amc_entitlements_informational_unused CHECK (
    entitlement_type <> 'informational' OR used_quantity = 0
  ),

  base_price numeric(12,2) CHECK (base_price IS NULL OR base_price >= 0),
  contracted_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (contracted_price >= 0),

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_amc_entitlements_contract
  ON public.amc_contract_entitlements (contract_id, sort_order);

-- ---------------------------------------------------------------------
-- 3. Usage ledger
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_entitlement_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  entitlement_id uuid NOT NULL REFERENCES public.amc_contract_entitlements(id) ON DELETE RESTRICT,

  /* consumption: something used (positive). adjustment: a correction
     (either sign) that must say why. */
  kind text NOT NULL CHECK (kind IN ('consumption', 'adjustment')),
  quantity numeric(10,2) NOT NULL CHECK (quantity <> 0),
  CONSTRAINT amc_usage_consumption_positive CHECK (kind <> 'consumption' OR quantity > 0),
  CONSTRAINT amc_usage_adjustment_reason CHECK (
    kind <> 'adjustment' OR length(trim(coalesce(notes, ''))) > 0
  ),

  occurred_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'fsm', 'system')),
  /* Optional link to the work that used it. */
  external_type text CHECK (
    external_type IS NULL OR external_type IN ('fsm_work_order', 'fsm_appointment', 'schedule_entry')
  ),
  external_reference text,
  CONSTRAINT amc_usage_external_pair CHECK ((external_type IS NULL) = (external_reference IS NULL)),

  notes text,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amc_usage_entitlement
  ON public.amc_entitlement_usage (entitlement_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_usage_contract
  ON public.amc_entitlement_usage (contract_id, occurred_at DESC);
/* The same FSM appointment / work order can be consumed only once per
   entitlement, so a retried sync cannot double-count. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_usage_external_once
  ON public.amc_entitlement_usage (entitlement_id, external_type, external_reference)
  WHERE kind = 'consumption' AND external_reference IS NOT NULL;

/* Keeps used_quantity equal to the ledger, in the same transaction as the
   insert. The CHECKs on amc_contract_entitlements then refuse anything
   that would overuse, go negative, or touch an informational row; the
   insert is rolled back with them. */
CREATE OR REPLACE FUNCTION public.amc_apply_entitlement_usage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  ent public.amc_contract_entitlements%ROWTYPE;
  contract_status text;
BEGIN
  SELECT * INTO ent FROM public.amc_contract_entitlements
   WHERE id = NEW.entitlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entitlement % not found', NEW.entitlement_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF ent.contract_id <> NEW.contract_id THEN
    RAISE EXCEPTION 'Entitlement does not belong to this contract' USING ERRCODE = 'check_violation';
  END IF;
  IF ent.entitlement_type = 'informational' THEN
    RAISE EXCEPTION 'Informational services cannot be consumed' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO contract_status FROM public.amc_contracts WHERE id = NEW.contract_id;
  IF contract_status <> 'active' AND NEW.kind = 'consumption' THEN
    RAISE EXCEPTION 'Contract is not active' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.amc_contract_entitlements
     SET used_quantity = used_quantity + NEW.quantity
   WHERE id = NEW.entitlement_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_amc_apply_entitlement_usage ON public.amc_entitlement_usage;
CREATE TRIGGER trg_amc_apply_entitlement_usage
  BEFORE INSERT ON public.amc_entitlement_usage
  FOR EACH ROW EXECUTE FUNCTION public.amc_apply_entitlement_usage();

/* History is never rewritten: corrections are new adjustment rows. */
CREATE OR REPLACE RULE amc_entitlement_usage_no_update AS
  ON UPDATE TO public.amc_entitlement_usage DO INSTEAD NOTHING;
CREATE OR REPLACE RULE amc_entitlement_usage_no_delete AS
  ON DELETE TO public.amc_entitlement_usage DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------
-- 4. Renewal link on proposals
-- ---------------------------------------------------------------------
/* A renewal proposal remembers the contract it renews; when it is signed
   and activated, the new contract's renewed_from_contract_id is set from
   it. The old contract is never edited. */
ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS renewal_of_contract_id uuid
    REFERENCES public.amc_contracts(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_amc_submissions_renewal_of
  ON public.amc_submissions (renewal_of_contract_id)
  WHERE renewal_of_contract_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 5. Audit: contracts are an AMC entity too
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_audit_events
  DROP CONSTRAINT IF EXISTS amc_audit_events_entity_type_check;
ALTER TABLE public.amc_audit_events
  ADD CONSTRAINT amc_audit_events_entity_type_check
  CHECK (entity_type IN ('submission', 'settings', 'contract'));

-- ---------------------------------------------------------------------
-- 6. Access: service role only
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_contract_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_entitlement_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_contracts FROM anon, authenticated;
REVOKE ALL ON public.amc_contract_entitlements FROM anon, authenticated;
REVOKE ALL ON public.amc_entitlement_usage FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.amc_apply_entitlement_usage() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Rollback (only while no contract has been activated)
-- ---------------------------------------------------------------------
--   ALTER TABLE public.amc_audit_events DROP CONSTRAINT amc_audit_events_entity_type_check;
--   ALTER TABLE public.amc_audit_events ADD CONSTRAINT amc_audit_events_entity_type_check
--     CHECK (entity_type IN ('submission', 'settings'));
--   ALTER TABLE public.amc_submissions DROP COLUMN IF EXISTS renewal_of_contract_id;
--   DROP TABLE IF EXISTS public.amc_entitlement_usage;
--   DROP FUNCTION IF EXISTS public.amc_apply_entitlement_usage();
--   DROP TABLE IF EXISTS public.amc_contract_entitlements;
--   DROP TABLE IF EXISTS public.amc_contracts;
