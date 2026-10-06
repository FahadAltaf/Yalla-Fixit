-- =====================================================================
-- AMC: atomic contract activation and database-side dashboard figures
--
-- NOT APPLIED. Branch amc-hardening (schema review, 6 Oct 2026). Apply
-- after 20261006130000_amc_business_operations.sql. See
-- docs/amc-database-architecture.md and docs/amc-migration-safety-report.md.
--
-- 1. amc_activate_contract(contract, entitlements): inserts the contract
--    and all its entitlements in ONE transaction. Over the REST API they
--    were two inserts with a compensating delete, so a crash or timeout
--    between them could leave a contract without services that blocked
--    re-activation (submission_id is UNIQUE).
-- 2. amc_contracts_dashboard(owner, today, window, since): the contracts
--    page figures, counted in the database. The page used to load up to
--    5000 contracts with their entitlements into the server and count
--    there; above the row limit (5000, or the project's PostgREST max-rows
--    if lower) the figures were silently wrong.
--
-- Both are SECURITY INVOKER and executable by service_role only: the API
-- (service role) is their only caller, as for every other AMC object.
-- Additive only: nothing the live app uses is changed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Activation
-- ---------------------------------------------------------------------
/* p_contract: one amc_contracts row as JSON (column -> value); columns it
   leaves out take their defaults. p_entitlements: a non-empty array of
   amc_contract_entitlements rows without contract_id. Column names are
   taken from the JSON keys and quoted; an unknown key is an error. */
CREATE OR REPLACE FUNCTION public.amc_activate_contract(p_contract jsonb, p_entitlements jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  contract_cols text;
  entitlement_cols text;
  new_id uuid;
BEGIN
  IF p_contract IS NULL OR jsonb_typeof(p_contract) <> 'object' THEN
    RAISE EXCEPTION 'The contract must be a JSON object' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_entitlements IS NULL OR jsonb_typeof(p_entitlements) <> 'array' OR jsonb_array_length(p_entitlements) = 0 THEN
    RAISE EXCEPTION 'A contract needs at least one service' USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(quote_ident(k), ', ' ORDER BY k) INTO contract_cols
    FROM jsonb_object_keys(p_contract) AS k;
  EXECUTE format(
    'INSERT INTO public.amc_contracts (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::public.amc_contracts, $1) RETURNING id',
    contract_cols
  ) INTO new_id USING p_contract;

  SELECT string_agg(quote_ident(k), ', ' ORDER BY k) INTO entitlement_cols
    FROM (
      SELECT DISTINCT jsonb_object_keys(e) AS k
        FROM jsonb_array_elements(p_entitlements) AS e
    ) keys
   WHERE k NOT IN ('contract_id', 'id');
  EXECUTE format(
    'INSERT INTO public.amc_contract_entitlements (contract_id, %1$s) SELECT $2, %1$s FROM jsonb_populate_recordset(NULL::public.amc_contract_entitlements, $1)',
    entitlement_cols
  ) USING p_entitlements, new_id;

  RETURN new_id;
END;
$$;
COMMENT ON FUNCTION public.amc_activate_contract(jsonb, jsonb) IS
  'Creates an AMC contract and its entitlements in one transaction; see 20261006140000.';
REVOKE ALL ON FUNCTION public.amc_activate_contract(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_activate_contract(jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- 2. Dashboard figures
-- ---------------------------------------------------------------------
/* The same rules as lib/amc/contracts.ts contractDisplayStatus (cancelled,
   expired, not started, expiring within p_window_days, active) and
   isExhausted (a visits/hours allowance with nothing left). p_owner_id
   null = every contract (AMC approvers); otherwise only contracts whose
   proposal that person owns. Money is returned in fils (integer). */
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
             WHEN v.status = 'cancelled' THEN 'cancelled'
             WHEN v.end_date < p_today THEN 'expired'
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
    'inForceValueFils', f.in_force_value_fils,
    'withExhaustedEntitlements', f.with_exhausted,
    'pendingActivation', (
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
COMMENT ON FUNCTION public.amc_contracts_dashboard(uuid, date, integer, timestamptz) IS
  'AMC contracts page figures, counted in the database; see 20261006140000.';
REVOKE ALL ON FUNCTION public.amc_contracts_dashboard(uuid, date, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_contracts_dashboard(uuid, date, integer, timestamptz) TO service_role;

-- ---------------------------------------------------------------------
-- Rollback (always safe: nothing stores data through these functions)
-- ---------------------------------------------------------------------
--   DROP FUNCTION IF EXISTS public.amc_contracts_dashboard(uuid, date, integer, timestamptz);
--   DROP FUNCTION IF EXISTS public.amc_activate_contract(jsonb, jsonb);
