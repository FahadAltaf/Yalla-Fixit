-- =====================================================================
-- Active AMC <-> Zoho FSM: explicit links, service mapping, sync log
--
-- NOT APPLIED. Branch active-amc (6 Oct 2026). Apply after
-- 20261006110000_active_amc_operations.sql. See
-- docs/amc-fsm-integration-report.md.
--
-- Nothing here is inferred. The repository and the production data show
-- no stable identifier shared by an AMC contract and an FSM customer, and
-- none shared by an AMC service and an FSM service, so both are recorded
-- explicitly by staff:
--
-- 1. amc_contracts.fsm_contact_id: the FSM Contacts record id of the
--    contract's customer, linked from a real work order's contact and
--    confirmed by a person; fsm_customer_id keeps that contact's
--    Customer_Id__C for reference. Never matched by name.
-- 2. amc_fsm_service_mappings: AMC catalogue service id -> FSM Services
--    record id, kept by AMC approvers.
-- 3. amc_fsm_links: which FSM work order (and optionally which
--    appointment and service line) belongs to which contract entitlement,
--    with the coverage answer at the time of linking. FSM ids are stable;
--    schedule_entries rows are per schedule version, so they are joined by
--    fsm_work_order_id / fsm_appointment_id, never referenced by row id.
-- 4. amc_entitlement_usage gains fsm_work_order_id and fsm_synced_at, so a
--    usage row taken from FSM records the work order and when it was read.
--    The ledger stays append-only; the existing unique index on
--    (entitlement_id, external_type, external_reference) is what makes FSM
--    usage idempotent per appointment.
-- 5. amc_fsm_sync_events: one row per appointment and action, with the
--    outcome (pending / recorded / skipped / failed), the reason and the
--    attempts, so a retry is visible and can never double-count.
--
-- Automatic consumption is switched off in code
-- (lib/amc/fsm-sync.ts, AMC_FSM_AUTOMATION) until the completion signal
-- and the mappings are confirmed. Nothing here calls FSM.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The contract's FSM customer
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contracts
  ADD COLUMN IF NOT EXISTS fsm_contact_id text,
  ADD COLUMN IF NOT EXISTS fsm_contact_name text,
  ADD COLUMN IF NOT EXISTS fsm_customer_id text,
  ADD COLUMN IF NOT EXISTS fsm_customer_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS fsm_customer_linked_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_amc_contracts_fsm_contact
  ON public.amc_contracts (fsm_contact_id) WHERE fsm_contact_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. AMC service -> FSM service
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_fsm_service_mappings (
  amc_service_id text PRIMARY KEY CHECK (length(trim(amc_service_id)) > 0),
  fsm_service_id text NOT NULL CHECK (length(trim(fsm_service_id)) > 0),
  fsm_service_name text,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
/* One active AMC service per FSM service, so an FSM line resolves to at
   most one AMC service. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_fsm_service_mappings_fsm
  ON public.amc_fsm_service_mappings (fsm_service_id) WHERE active;

-- ---------------------------------------------------------------------
-- 3. FSM work linked to a contract entitlement
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_fsm_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  entitlement_id uuid NOT NULL REFERENCES public.amc_contract_entitlements(id) ON DELETE RESTRICT,
  fsm_work_order_id text NOT NULL CHECK (length(trim(fsm_work_order_id)) > 0),
  fsm_work_order_name text,
  /* Null: the link covers every appointment of the work order. */
  fsm_appointment_id text,
  fsm_appointment_name text,
  fsm_service_line_item_id text,
  fsm_service_id text,
  fsm_contact_id text,
  /* When the customer asked for the work, as recorded by staff. FSM has
     no request time; this is what the SLA would measure from. */
  requested_at timestamptz,
  /* The coverage answer when the work was linked (covered / chargeable /
     no AMC, with the figures), kept as it was. */
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'scheduling', 'system')),
  linked_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlinked_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  unlink_reason text,
  CONSTRAINT amc_fsm_links_unlink_reason CHECK (
    unlinked_at IS NULL OR length(trim(coalesce(unlink_reason, ''))) > 0
  )
);
/* An appointment belongs to one contract at a time. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_fsm_links_appointment
  ON public.amc_fsm_links (fsm_appointment_id)
  WHERE fsm_appointment_id IS NOT NULL AND unlinked_at IS NULL;
/* A whole work order is linked once. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_fsm_links_work_order
  ON public.amc_fsm_links (fsm_work_order_id)
  WHERE fsm_appointment_id IS NULL AND unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_amc_fsm_links_contract
  ON public.amc_fsm_links (contract_id, linked_at DESC);

/* The entitlement must belong to the contract. */
CREATE OR REPLACE FUNCTION public.amc_fsm_links_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.amc_contract_entitlements
     WHERE id = NEW.entitlement_id AND contract_id = NEW.contract_id
  ) THEN
    RAISE EXCEPTION 'Entitlement does not belong to this contract' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS amc_fsm_links_check ON public.amc_fsm_links;
CREATE TRIGGER amc_fsm_links_check
  BEFORE INSERT OR UPDATE OF contract_id, entitlement_id ON public.amc_fsm_links
  FOR EACH ROW EXECUTE FUNCTION public.amc_fsm_links_check();
REVOKE ALL ON FUNCTION public.amc_fsm_links_check() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. FSM details on usage rows
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_entitlement_usage
  ADD COLUMN IF NOT EXISTS fsm_work_order_id text,
  ADD COLUMN IF NOT EXISTS fsm_synced_at timestamptz;

-- ---------------------------------------------------------------------
-- 5. Sync log
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_fsm_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fsm_appointment_id text NOT NULL CHECK (length(trim(fsm_appointment_id)) > 0),
  action text NOT NULL CHECK (action IN ('consume', 'reverse')),
  contract_id uuid REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  link_id uuid REFERENCES public.amc_fsm_links(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pending', 'recorded', 'skipped', 'needs_review', 'failed')),
  reason text,
  fsm_status text,
  /* What FSM said at the last read, so the contract page can show the
     visit without calling FSM on every view. */
  fsm_work_order_id text,
  fsm_appointment_name text,
  fsm_scheduled_start_at timestamptz,
  fsm_actual_start_at timestamptz,
  fsm_actual_end_at timestamptz,
  fsm_actual_duration_seconds integer CHECK (fsm_actual_duration_seconds IS NULL OR fsm_actual_duration_seconds >= 0),
  usage_id uuid REFERENCES public.amc_entitlement_usage(id) ON DELETE RESTRICT,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  resolved_at timestamptz,
  /* One row per appointment and action; a retry updates it. */
  UNIQUE (fsm_appointment_id, action)
);
CREATE INDEX IF NOT EXISTS idx_amc_fsm_sync_events_contract
  ON public.amc_fsm_sync_events (contract_id, status);

-- ---------------------------------------------------------------------
-- Access: service role only, like the other AMC tables
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_fsm_service_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_fsm_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_fsm_sync_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_fsm_service_mappings FROM anon, authenticated;
REVOKE ALL ON public.amc_fsm_links FROM anon, authenticated;
REVOKE ALL ON public.amc_fsm_sync_events FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Rollback (before any link, mapping or FSM usage exists)
-- ---------------------------------------------------------------------
--   DROP TABLE IF EXISTS public.amc_fsm_sync_events;
--   DROP TABLE IF EXISTS public.amc_fsm_links;
--   DROP FUNCTION IF EXISTS public.amc_fsm_links_check();
--   DROP TABLE IF EXISTS public.amc_fsm_service_mappings;
--   ALTER TABLE public.amc_entitlement_usage
--     DROP COLUMN IF EXISTS fsm_work_order_id, DROP COLUMN IF EXISTS fsm_synced_at;
--   ALTER TABLE public.amc_contracts
--     DROP COLUMN IF EXISTS fsm_contact_id, DROP COLUMN IF EXISTS fsm_contact_name,
--     DROP COLUMN IF EXISTS fsm_customer_id, DROP COLUMN IF EXISTS fsm_customer_linked_at,
--     DROP COLUMN IF EXISTS fsm_customer_linked_by;
