-- =====================================================================
-- AMC payments: schedule, receipts, cheques, the initial payment gate
-- (BRD v0.3 5.8; DEV-352, 382, 383, 384, 386)
-- =====================================================================
-- NOT APPLIED. Row 21 in docs/production-migration-log.md, checks §13.
--
-- What it adds
--   * amc_instalments: the payment schedule made when a contract is
--     activated -- number, due date, amount, VAT, expected mode and one of
--     the nine statuses (Not Due, Due, Partially Received, Received,
--     Overdue, Cheque Deposited, Bounced, Written Off, Waived).
--   * amc_cheques: the cheque register -- held, deposited, cleared,
--     bounced (with reason and charges), replaced, returned.
--   * amc_payments: what was received against an instalment -- cash
--     (receipt, collector, handover to Finance), transfer (reference,
--     value date, proof), payment link, or a cleared cheque. A payment is
--     voided with a reason, never deleted.
--   * amc_contracts: the plan it is paid on, when the first instalment
--     arrived, and the authorised override of the initial payment gate
--     (who, when, why), plus the stamp of the late-first-payment alert.
--   * amc_send_log accepts instalment reminders (Email 4).
--
-- Live safety
--   Every table touched here is branch-only: live main does not read or
--   write amc_contracts, amc_send_log or anything new. amc_submissions is
--   not touched. Additive and idempotent; RLS on and nothing granted to
--   the browser roles, like every AMC table.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The contract: plan, first payment, gate override
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contracts
  ADD COLUMN IF NOT EXISTS payment_plan text
    CHECK (payment_plan IS NULL OR payment_plan IN ('single', 'fifty_fifty', 'quarterly', 'monthly', 'custom')),
  ADD COLUMN IF NOT EXISTS payment_plan_custom jsonb
    CHECK (payment_plan_custom IS NULL OR jsonb_typeof(payment_plan_custom) = 'array'),
  ADD COLUMN IF NOT EXISTS initial_payment_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS gate_override_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gate_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS gate_override_reason text,
  ADD COLUMN IF NOT EXISTS initial_payment_late_notified_at timestamptz;
ALTER TABLE public.amc_contracts DROP CONSTRAINT IF EXISTS amc_contracts_gate_override_shape;
ALTER TABLE public.amc_contracts
  ADD CONSTRAINT amc_contracts_gate_override_shape CHECK (
    (gate_override_at IS NULL AND gate_override_reason IS NULL)
    OR (gate_override_at IS NOT NULL AND gate_override_reason IS NOT NULL AND length(trim(gate_override_reason)) > 0)
  );
CREATE INDEX IF NOT EXISTS idx_amc_contracts_gate_override_by
  ON public.amc_contracts (gate_override_by) WHERE gate_override_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. The payment schedule
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_instalments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  instalment_no integer NOT NULL CHECK (instalment_no >= 1),
  label text NOT NULL CHECK (length(trim(label)) > 0),
  due_date date NOT NULL,
  /* Before VAT, the VAT, and what the client pays. */
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  vat_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  expected_mode text CHECK (expected_mode IS NULL OR expected_mode IN ('cash', 'transfer', 'link', 'cheque')),
  status text NOT NULL DEFAULT 'not_due' CHECK (status IN (
    'not_due', 'due', 'partially_received', 'received', 'overdue',
    'cheque_deposited', 'bounced', 'written_off', 'waived'
  )),
  received_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  received_date date,
  last_reference text,
  status_reason text,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  status_changed_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  /* Stamps the daily sweep claims before telling anyone, so each is said once. */
  due_notified_at timestamptz,
  overdue_notified_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  last_reminder_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_instalments_no_unique UNIQUE (contract_id, instalment_no),
  CONSTRAINT amc_instalments_vat_within_total CHECK (amount + vat_amount = total),
  CONSTRAINT amc_instalments_not_over_received CHECK (received_amount <= total),
  CONSTRAINT amc_instalments_received_means_paid CHECK (status <> 'received' OR received_amount = total),
  CONSTRAINT amc_instalments_writeoff_needs_reason CHECK (
    status NOT IN ('written_off', 'waived') OR (status_reason IS NOT NULL AND length(trim(status_reason)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_amc_instalments_open
  ON public.amc_instalments (status, due_date) WHERE status NOT IN ('received', 'written_off', 'waived');
CREATE INDEX IF NOT EXISTS idx_amc_instalments_changed_by
  ON public.amc_instalments (status_changed_by) WHERE status_changed_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. The cheque register
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_cheques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  instalment_id uuid NOT NULL REFERENCES public.amc_instalments(id) ON DELETE RESTRICT,
  cheque_no text NOT NULL CHECK (length(trim(cheque_no)) > 0),
  bank text NOT NULL CHECK (length(trim(bank)) > 0),
  cheque_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'deposited', 'cleared', 'bounced', 'replaced', 'returned')),
  /* Who holds it, as staff write it ("Finance safe", "with Omar"). */
  custody text,
  deposited_on date,
  cleared_on date,
  bounced_on date,
  bounce_reason text,
  bounce_charges numeric(12,2) CHECK (bounce_charges IS NULL OR bounce_charges >= 0),
  replaces_cheque_id uuid REFERENCES public.amc_cheques(id) ON DELETE RESTRICT,
  status_reason text,
  date_alert_sent_at timestamptz,
  recorded_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_cheques_deposited_dated CHECK (status NOT IN ('deposited', 'cleared') OR deposited_on IS NOT NULL),
  CONSTRAINT amc_cheques_cleared_dated CHECK (status <> 'cleared' OR cleared_on IS NOT NULL),
  CONSTRAINT amc_cheques_bounce_explained CHECK (
    status <> 'bounced' OR (bounced_on IS NOT NULL AND bounce_reason IS NOT NULL AND length(trim(bounce_reason)) > 0)
  ),
  CONSTRAINT amc_cheques_not_own_replacement CHECK (replaces_cheque_id IS NULL OR replaces_cheque_id <> id)
);
/* One cheque is one piece of paper: the same number from the same bank once. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_cheques_number
  ON public.amc_cheques (lower(trim(bank)), upper(trim(cheque_no)));
CREATE INDEX IF NOT EXISTS idx_amc_cheques_contract ON public.amc_cheques (contract_id);
CREATE INDEX IF NOT EXISTS idx_amc_cheques_instalment ON public.amc_cheques (instalment_id);
CREATE INDEX IF NOT EXISTS idx_amc_cheques_replaces
  ON public.amc_cheques (replaces_cheque_id) WHERE replaces_cheque_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_cheques_held_date
  ON public.amc_cheques (cheque_date) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS idx_amc_cheques_recorded_by
  ON public.amc_cheques (recorded_by) WHERE recorded_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Receipts
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  instalment_id uuid NOT NULL REFERENCES public.amc_instalments(id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('cash', 'transfer', 'link', 'cheque')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  received_on date NOT NULL,
  reference text,
  value_date date,
  receipt_no text,
  collector_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  handed_over_at timestamptz,
  handed_over_to text,
  proof_document_id uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL,
  cheque_id uuid REFERENCES public.amc_cheques(id) ON DELETE RESTRICT,
  notes text,
  recorded_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  void_reason text,
  CONSTRAINT amc_payments_cheque_linked CHECK (mode <> 'cheque' OR cheque_id IS NOT NULL),
  CONSTRAINT amc_payments_transfer_referenced CHECK (mode <> 'transfer' OR (reference IS NOT NULL AND length(trim(reference)) > 0)),
  CONSTRAINT amc_payments_void_explained CHECK (
    voided_at IS NULL OR (void_reason IS NOT NULL AND length(trim(void_reason)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_amc_payments_contract ON public.amc_payments (contract_id);
CREATE INDEX IF NOT EXISTS idx_amc_payments_instalment ON public.amc_payments (instalment_id);
CREATE INDEX IF NOT EXISTS idx_amc_payments_cheque ON public.amc_payments (cheque_id) WHERE cheque_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_payments_collector ON public.amc_payments (collector_id) WHERE collector_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_payments_proof ON public.amc_payments (proof_document_id) WHERE proof_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_payments_recorded_by ON public.amc_payments (recorded_by) WHERE recorded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_payments_voided_by ON public.amc_payments (voided_by) WHERE voided_by IS NOT NULL;
/* A cleared cheque is received once. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_payments_one_per_cheque
  ON public.amc_payments (cheque_id) WHERE cheque_id IS NOT NULL AND voided_at IS NULL;

-- Money history is kept: payments and cheques are voided or returned, never deleted.
CREATE OR REPLACE FUNCTION public.amc_payment_rows_kept()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% rows are kept: void or return them instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
DROP TRIGGER IF EXISTS amc_payments_kept ON public.amc_payments;
CREATE TRIGGER amc_payments_kept BEFORE DELETE ON public.amc_payments
  FOR EACH ROW EXECUTE FUNCTION public.amc_payment_rows_kept();
DROP TRIGGER IF EXISTS amc_cheques_kept ON public.amc_cheques;
CREATE TRIGGER amc_cheques_kept BEFORE DELETE ON public.amc_cheques
  FOR EACH ROW EXECUTE FUNCTION public.amc_payment_rows_kept();
REVOKE ALL ON FUNCTION public.amc_payment_rows_kept() FROM PUBLIC, anon, authenticated;

-- Server-only, like every AMC table.
ALTER TABLE public.amc_instalments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_instalments FROM anon, authenticated;
REVOKE ALL ON public.amc_cheques FROM anon, authenticated;
REVOKE ALL ON public.amc_payments FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. The send log takes instalment reminders (Email 4)
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
  ADD CONSTRAINT amc_send_log_document_check CHECK (document IN ('proposal', 'contract', 'instalment_reminder'));
