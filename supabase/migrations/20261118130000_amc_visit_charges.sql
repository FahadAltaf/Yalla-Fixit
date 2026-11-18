-- =====================================================================
-- Visit charges: what a call out or additional work costs the client (18 Nov 2026)
--
-- One row per call out or additional work, on its contract:
--   lines        the services, each priced from the rate card (or the
--                additional work's quotation lines), each charged or free
--   totals       subtotal (charged lines), VAT 5 %, total, in AED
--   status       due, paid, or waived (nothing to pay: covered or free)
--   timing       chosen when the visit is started: before the visit (it
--                must be paid to start) or after it (a reason is required)
--   the payment  one payment per charge: amount, date, mode, reference
--
-- Shown on the contract's Payments tab as "Visit charges", beside the
-- instalments (which are untouched).
--
-- Live-safe: a new table, server-only (service role), nothing else changed.
-- Rollback: DROP TABLE public.amc_visit_charges;
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.amc_visit_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE CASCADE,
  call_out_id uuid UNIQUE REFERENCES public.amc_call_outs(id) ON DELETE CASCADE,
  additional_work_id uuid UNIQUE REFERENCES public.amc_additional_works(id) ON DELETE CASCADE,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  vat_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  status text NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'waived')),
  payment_timing text CHECK (payment_timing IS NULL OR payment_timing IN ('before_visit', 'after_visit')),
  payment_timing_reason text,
  timing_set_at timestamptz,
  timing_set_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  paid_amount numeric(12, 2) CHECK (paid_amount IS NULL OR paid_amount > 0),
  paid_on date,
  payment_mode text CHECK (payment_mode IS NULL OR payment_mode IN ('cash', 'transfer', 'card', 'link', 'cheque')),
  payment_reference text,
  payment_note text,
  recorded_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  recorded_at timestamptz,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_visit_charges_one_owner CHECK (num_nonnulls(call_out_id, additional_work_id) = 1),
  CONSTRAINT amc_visit_charges_after_has_reason CHECK (payment_timing IS DISTINCT FROM 'after_visit' OR length(trim(coalesce(payment_timing_reason, ''))) > 0),
  CONSTRAINT amc_visit_charges_paid_shape CHECK (status <> 'paid' OR (paid_amount IS NOT NULL AND paid_on IS NOT NULL AND payment_mode IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_amc_visit_charges_contract ON public.amc_visit_charges (contract_id, created_at DESC);

ALTER TABLE public.amc_visit_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_visit_charges FROM PUBLIC;
REVOKE ALL ON public.amc_visit_charges FROM anon, authenticated;
GRANT ALL ON public.amc_visit_charges TO service_role;

COMMENT ON TABLE public.amc_visit_charges IS
  'What a call out or additional work costs the client: services priced from the rate card, VAT, and its one payment (before or after the visit). Server only.';

NOTIFY pgrst, 'reload schema';

-- Check (read-only):
-- SELECT count(*) FROM public.amc_visit_charges;
