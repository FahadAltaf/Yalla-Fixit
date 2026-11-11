-- =====================================================================
-- AMC renewal outcomes and contract amendments
-- (BRD v0.3 5.16; DEV-415, 416, 417, 423 #7)
-- =====================================================================
-- NOT APPLIED. Row 28 in docs/production-migration-log.md, checks §20.
--
-- What it adds
--   * On amc_contracts: the renewal's outcome (Renewed, Renewed with
--     Revised Scope, Under Negotiation, Not Renewed with a reason, Lapsed)
--     with who and when; the reminder, escalation and last-activity stamps
--     the renewals sweep keeps; and a scheduled termination (notice date,
--     effective date, refund).
--   * amc_contract_amendments: scope change, property change, hold,
--     resume, transfer, early termination and cancellation, each
--     requested with a reason, decided by an approver who is not the
--     requester, then applied. Append-only in spirit: a request is never
--     deleted, its status moves on.
--   * A page permission for AMC → Renewals (amc_renewals): every role
--     that can use AMC today gets View, as 20261012100000 did.
--
-- Live safety
--   * amc_submissions and every live table are untouched, except
--     role_access, which gets INSERTS only (no update, no delete), safe to
--     run twice.
--   * The new amc_contracts columns are nullable and unread by live main.
--
-- Pre-check / post-check: docs/production-migration-checks.md §20.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Renewal outcome and the sweep's stamps; a scheduled termination
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contracts
  ADD COLUMN IF NOT EXISTS renewal_outcome text
    CHECK (renewal_outcome IS NULL OR renewal_outcome IN ('renewed', 'renewed_revised_scope', 'under_negotiation', 'not_renewed', 'lapsed')),
  ADD COLUMN IF NOT EXISTS renewal_outcome_reason text,
  ADD COLUMN IF NOT EXISTS renewal_outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_outcome_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renewal_reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS termination_notice_on date,
  ADD COLUMN IF NOT EXISTS termination_effective_on date,
  ADD COLUMN IF NOT EXISTS termination_refund numeric(12,2) CHECK (termination_refund IS NULL OR termination_refund >= 0);
ALTER TABLE public.amc_contracts DROP CONSTRAINT IF EXISTS amc_contracts_not_renewed_reason;
ALTER TABLE public.amc_contracts
  ADD CONSTRAINT amc_contracts_not_renewed_reason CHECK (
    renewal_outcome IS DISTINCT FROM 'not_renewed' OR length(trim(coalesce(renewal_outcome_reason, ''))) > 0
  );
ALTER TABLE public.amc_contracts DROP CONSTRAINT IF EXISTS amc_contracts_termination_order;
ALTER TABLE public.amc_contracts
  ADD CONSTRAINT amc_contracts_termination_order CHECK (
    termination_effective_on IS NULL OR termination_notice_on IS NULL OR termination_effective_on >= termination_notice_on
  );
CREATE INDEX IF NOT EXISTS idx_amc_contracts_renewal_outcome_by ON public.amc_contracts (renewal_outcome_by) WHERE renewal_outcome_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_contracts_termination_due ON public.amc_contracts (termination_effective_on) WHERE termination_effective_on IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Amendments
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_contract_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('scope_change', 'property_change', 'hold', 'resume', 'transfer', 'early_termination', 'cancellation')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'applied', 'withdrawn')),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  /* What the change is: the new property, the new party, the dates, the scope mode, the refund. */
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  effective_on date,
  requested_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_comment text,
  applied_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  applied_at timestamptz,
  /* A scope change opens a new proposal; its id is kept here. */
  result_submission_id uuid REFERENCES public.amc_submissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_amendments_decided CHECK (status IN ('requested', 'withdrawn') OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  CONSTRAINT amc_amendments_not_self_decided CHECK (decided_by IS NULL OR requested_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT amc_amendments_rejection_explained CHECK (status <> 'rejected' OR length(trim(coalesce(decision_comment, ''))) > 0),
  CONSTRAINT amc_amendments_applied CHECK (status <> 'applied' OR applied_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_amc_amendments_contract ON public.amc_contract_amendments (contract_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_amendments_open ON public.amc_contract_amendments (status) WHERE status IN ('requested', 'approved');
CREATE INDEX IF NOT EXISTS idx_amc_amendments_requested_by ON public.amc_contract_amendments (requested_by) WHERE requested_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_amendments_decided_by ON public.amc_contract_amendments (decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_amendments_applied_by ON public.amc_contract_amendments (applied_by) WHERE applied_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_amendments_submission ON public.amc_contract_amendments (result_submission_id) WHERE result_submission_id IS NOT NULL;

ALTER TABLE public.amc_contract_amendments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_contract_amendments FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. AMC → Renewals has its own page permission (as 20261012100000)
-- ---------------------------------------------------------------------
insert into public.role_access (role_id, resource, action, enabled)
select distinct ra.role_id, 'amc_renewals', 'view', true
from public.role_access ra
where ra.enabled is distinct from false
  and (
    (ra.resource = 'amc' and ra.action in ('view', 'approve'))
    or (ra.resource = 'amc_operations' and ra.action in ('view', 'edit'))
    or (ra.resource in ('amc_enquiries', 'amc_rate_card', 'amc_config', 'amc_payments', 'amc_visits', 'amc_allowances') and ra.action = 'view')
  )
on conflict (role_id, resource, action) do nothing;
