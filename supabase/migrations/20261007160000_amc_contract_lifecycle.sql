-- =====================================================================
-- AMC contract lifecycle and signatures
-- (BRD v0.3 Phase 6: DEV-351, 372, 373, 374, 375 part 1, 376, 378 part 1,
--  420 Email 2, 423 to-do #2)
--
-- NOT APPLIED. Branch amc-hardening, 7 Oct 2026.
-- SAFE BEFORE CODE DEPLOY. Checked against origin/main, 7 Oct 2026: live
-- `main` does not use amc_contracts, its entitlements or the dashboard
-- function (all branch-only, Group A files 4-9). Existing contracts are
-- active or cancelled and keep that status; each gets a contract number.
-- Apply after 20261007150000. Idempotent: safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Contract numbers: AMC-C-YYYY-NNNN (plan Q22).
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.amc_contract_number_seq;
REVOKE ALL ON SEQUENCE public.amc_contract_number_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.amc_next_contract_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  digits text := nextval('public.amc_contract_number_seq')::text;
BEGIN
  RETURN 'AMC-C-' || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY') || '-' || lpad(digits, greatest(4, length(digits)), '0');
END;
$$;
REVOKE ALL ON FUNCTION public.amc_next_contract_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_next_contract_number() TO service_role;

-- ---------------------------------------------------------------------
-- 2. The contract record from client approval (DEV-351, 372, 376): its own
--    number, the 11 BRD statuses, signatures not yet given, and the
--    reason behind every status after signing.
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contracts
  ADD COLUMN IF NOT EXISTS contract_number text DEFAULT public.amc_next_contract_number(),
  ADD COLUMN IF NOT EXISTS enquiry_id uuid REFERENCES public.amc_enquiries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_version_no integer CHECK (approved_version_no IS NULL OR approved_version_no >= 1),
  ADD COLUMN IF NOT EXISTS client_approved_at timestamptz,
  /* Residential or commercial template, chosen by the property's category. */
  ADD COLUMN IF NOT EXISTS template text CHECK (template IS NULL OR template IN ('residential', 'commercial')),
  ADD COLUMN IF NOT EXISTS signature_route text CHECK (signature_route IS NULL OR signature_route IN ('link', 'scan', 'zoho_sign')),
  ADD COLUMN IF NOT EXISTS signed_scan_document_id uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signed_scan_date date,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_contracts_number ON public.amc_contracts (contract_number) WHERE contract_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_contracts_enquiry ON public.amc_contracts (enquiry_id) WHERE enquiry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_contracts_scan ON public.amc_contracts (signed_scan_document_id) WHERE signed_scan_document_id IS NOT NULL;
UPDATE public.amc_contracts SET contract_number = public.amc_next_contract_number() WHERE contract_number IS NULL;
ALTER TABLE public.amc_contracts ALTER COLUMN contract_number SET NOT NULL;

/* Not signed yet: a contract now exists from client approval. */
ALTER TABLE public.amc_contracts ALTER COLUMN signed_at DROP NOT NULL;
ALTER TABLE public.amc_contracts ALTER COLUMN signed_by_name DROP NOT NULL;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.amc_contracts'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%' AND pg_get_constraintdef(oid) ILIKE '%''active''%'
       AND conname NOT IN ('amc_contracts_cancel_needs_reason')
  LOOP
    EXECUTE format('ALTER TABLE public.amc_contracts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.amc_contracts
  ADD CONSTRAINT amc_contracts_status_check CHECK (status IN (
    'draft', 'pending_client_signature', 'pending_internal_signature', 'signed', 'pending_initial_payment',
    'active', 'on_hold', 'expired', 'renewed', 'cancelled', 'terminated'));
ALTER TABLE public.amc_contracts DROP CONSTRAINT IF EXISTS amc_contracts_signed_shape;
ALTER TABLE public.amc_contracts
  ADD CONSTRAINT amc_contracts_signed_shape CHECK (
    status NOT IN ('signed', 'pending_initial_payment', 'active', 'on_hold', 'expired', 'renewed', 'terminated')
    OR (signed_at IS NOT NULL AND length(trim(coalesce(signed_by_name, ''))) > 0));
ALTER TABLE public.amc_contracts DROP CONSTRAINT IF EXISTS amc_contracts_hold_needs_reason;
ALTER TABLE public.amc_contracts
  ADD CONSTRAINT amc_contracts_hold_needs_reason CHECK (
    status NOT IN ('on_hold', 'terminated') OR length(trim(coalesce(status_reason, ''))) > 0);

-- ---------------------------------------------------------------------
-- 3. Entitlements (DEV-373): what each service covers beyond its visits.
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contract_entitlements
  ADD COLUMN IF NOT EXISTS labour_covered boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS material_coverage text NOT NULL DEFAULT 'consumables'
    CHECK (material_coverage IN ('none', 'consumables', 'parts_within_limit', 'all')),
  ADD COLUMN IF NOT EXISTS value_limit_aed numeric(12,2) CHECK (value_limit_aed IS NULL OR value_limit_aed >= 0),
  ADD COLUMN IF NOT EXISTS exclusions text;

-- ---------------------------------------------------------------------
-- 4. Signatories (DEV-374, 375): the client and each internal signatory,
--    in a configurable order, each tracked; a signed scan or Zoho Sign
--    (Phase 15) as other routes.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_contract_signatories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  party text NOT NULL CHECK (party IN ('client', 'internal')),
  sign_order integer NOT NULL CHECK (sign_order >= 1),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  email text,
  user_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  title text,
  /* waiting: someone earlier in the order has not signed yet. */
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'signed', 'cancelled')),
  method text CHECK (method IS NULL OR method IN ('link', 'portal', 'scan', 'zoho_sign')),
  signed_at timestamptz,
  signed_name text,
  evidence_document_id uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, sign_order),
  CONSTRAINT amc_signatories_internal_user CHECK (party = 'client' OR user_id IS NOT NULL),
  CONSTRAINT amc_signatories_signed_shape CHECK (status <> 'signed' OR (signed_at IS NOT NULL AND method IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_amc_signatories_user ON public.amc_contract_signatories (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_signatories_evidence ON public.amc_contract_signatories (evidence_document_id) WHERE evidence_document_id IS NOT NULL;

ALTER TABLE public.amc_contract_signatories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_contract_signatories FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Dashboard figures with the new statuses: contracts not yet active
--    count as pending activation; on hold and terminated apart.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.amc_contracts_dashboard(
  p_owner_id uuid,
  p_today date,
  p_window_days integer,
  p_since timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH visible AS (
    SELECT c.id, c.status, c.start_date, c.end_date, c.grand_total
      FROM public.amc_contracts c
      JOIN public.amc_submissions s ON s.id = c.submission_id
     WHERE p_owner_id IS NULL OR s.owner_id = p_owner_id
  ),
  classified AS (
    SELECT v.id, v.grand_total,
           CASE
             WHEN v.status IN ('cancelled', 'terminated') THEN 'cancelled'
             WHEN v.status IN ('draft', 'pending_client_signature', 'pending_internal_signature', 'signed', 'pending_initial_payment') THEN 'pending'
             WHEN v.status = 'on_hold' THEN 'on_hold'
             WHEN v.status IN ('expired', 'renewed') OR v.end_date < p_today THEN 'expired'
             WHEN v.start_date > p_today THEN 'not_started'
             WHEN v.end_date <= p_today + p_window_days THEN 'expiring'
             ELSE 'active'
           END AS display_status
      FROM visible v
  ),
  figures AS (
    SELECT
      count(*) FILTER (WHERE display_status IN ('active', 'expiring')) AS in_force,
      count(*) FILTER (WHERE display_status = 'expiring') AS expiring_soon,
      count(*) FILTER (WHERE display_status = 'expired') AS expired,
      count(*) FILTER (WHERE display_status = 'not_started') AS not_started,
      count(*) FILTER (WHERE display_status = 'cancelled') AS cancelled,
      count(*) FILTER (WHERE display_status = 'pending') AS pending,
      count(*) FILTER (WHERE display_status = 'on_hold') AS on_hold,
      coalesce(sum(round(grand_total * 100)) FILTER (WHERE display_status IN ('active', 'expiring')), 0)::bigint AS in_force_value_fils,
      count(*) FILTER (
        WHERE display_status IN ('active', 'expiring')
          AND EXISTS (
            SELECT 1 FROM public.amc_contract_entitlements e
             WHERE e.contract_id = classified.id
               AND e.entitlement_type IN ('visits', 'hours')
               AND coalesce(e.included_quantity, 0) - e.used_quantity <= 0
          )
      ) AS with_exhausted
    FROM classified
  )
  SELECT jsonb_build_object(
    'inForce', f.in_force,
    'expiringSoon', f.expiring_soon,
    'expired', f.expired,
    'notStarted', f.not_started,
    'cancelled', f.cancelled,
    'onHold', f.on_hold,
    'inForceValueFils', f.in_force_value_fils,
    'withExhaustedEntitlements', f.with_exhausted,
    /* Contracts waiting for signatures or activation, and signed proposals made before contracts existed from approval. */
    'pendingActivation', f.pending + (
      SELECT count(*)
        FROM public.amc_submissions s
       WHERE s.status = 'signed'
         AND (p_owner_id IS NULL OR s.owner_id = p_owner_id)
         AND NOT EXISTS (SELECT 1 FROM public.amc_contracts c WHERE c.submission_id = s.id)
    ),
    'usageLast30Days', (
      SELECT count(*)
        FROM public.amc_entitlement_usage u
       WHERE u.kind = 'consumption'
         AND u.occurred_at >= p_since
         AND (p_owner_id IS NULL OR EXISTS (SELECT 1 FROM visible v WHERE v.id = u.contract_id))
    ),
    'recentUsage', (
      SELECT coalesce(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT u.id, u.contract_id AS "contractId", c.proposal_number AS "proposalNumber",
                 c.customer_name AS "customerName", e.service_label AS "serviceLabel",
                 u.kind, u.quantity, u.occurred_at AS "occurredAt", u.created_at
            FROM public.amc_entitlement_usage u
            JOIN public.amc_contracts c ON c.id = u.contract_id
            JOIN public.amc_submissions s ON s.id = c.submission_id
            JOIN public.amc_contract_entitlements e ON e.id = u.entitlement_id
           WHERE p_owner_id IS NULL OR s.owner_id = p_owner_id
           ORDER BY u.created_at DESC
           LIMIT 6
        ) r
    )
  )
  FROM figures f;
$$;
REVOKE ALL ON FUNCTION public.amc_contracts_dashboard(uuid, date, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_contracts_dashboard(uuid, date, integer, timestamptz) TO service_role;

-- ---------------------------------------------------------------------
-- Rollback (only while no contract has a new status):
--   DROP TABLE IF EXISTS public.amc_contract_signatories;
--   ALTER TABLE public.amc_contract_entitlements DROP COLUMN IF EXISTS labour_covered, DROP COLUMN IF EXISTS material_coverage,
--     DROP COLUMN IF EXISTS value_limit_aed, DROP COLUMN IF EXISTS exclusions;
--   ALTER TABLE public.amc_contracts DROP CONSTRAINT IF EXISTS amc_contracts_status_check,
--     DROP CONSTRAINT IF EXISTS amc_contracts_signed_shape, DROP CONSTRAINT IF EXISTS amc_contracts_hold_needs_reason;
--   ALTER TABLE public.amc_contracts ADD CONSTRAINT amc_contracts_status_check CHECK (status IN ('active', 'cancelled'));
--   ALTER TABLE public.amc_contracts ALTER COLUMN signed_at SET NOT NULL, ALTER COLUMN signed_by_name SET NOT NULL;
--   (then re-run 20261006140000 section 2 for the previous dashboard function)
-- ---------------------------------------------------------------------
