-- AMC quotations (27 Nov 2026): a chargeable call out's or an additional
-- work's quotation, generated in the portal the way Snagging's are: one
-- document with its number and lines, a client link to approve or reject
-- it, and the Zoho FSM estimate it is sent as (its number becomes the
-- record's FSM quotation number, DEV-508). The manual FSM quotation number
-- stays as the other way.
--
-- Live-safe: one new table, a sequence and a numbering function. Nothing
-- existing is changed. The portal works without it (Generate quotation
-- says the update is needed).

CREATE SEQUENCE IF NOT EXISTS public.amc_quotation_number_seq;
REVOKE ALL ON SEQUENCE public.amc_quotation_number_seq FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.amc_next_quotation_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  digits text := nextval('public.amc_quotation_number_seq')::text;
BEGIN
  RETURN 'AMQ-' || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY') || '-' || lpad(digits, greatest(4, length(digits)), '0');
END;
$fn$;
REVOKE ALL ON FUNCTION public.amc_next_quotation_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_next_quotation_number() TO service_role;

CREATE TABLE IF NOT EXISTS public.amc_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The portal's number; replaced by the FSM estimate number once FSM has it.
  quote_number text NOT NULL UNIQUE DEFAULT public.amc_next_quotation_number(),
  entity_type text NOT NULL CHECK (entity_type IN ('call_out', 'additional_work')),
  entity_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'void')),
  currency text NOT NULL DEFAULT 'AED',
  -- { description, qty, unit, unit_price, amount }[], as Snagging's quotation lines.
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 5,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  scope_of_work text,
  terms text,
  -- Who and where it is for, frozen when generated (the document shows this).
  client_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The client link: only the hash is kept.
  approval_token_hash text UNIQUE,
  approval_token_hint text,
  approval_token_expires_at timestamptz,
  sent_at timestamptz,
  sent_channel text,
  sent_by uuid,
  approved_at timestamptz,
  approved_by_name text,
  rejected_reason text,
  decided_at timestamptz,
  -- 'client' (on the link) or 'staff'.
  decided_origin text,
  fsm_estimate_id text,
  fsm_estimate_number text,
  fsm_status text,
  fsm_service_id text,
  fsm_synced_at timestamptz,
  fsm_error text,
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS amc_quotations_entity_idx ON public.amc_quotations (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS amc_quotations_contract_idx ON public.amc_quotations (contract_id);
-- One live quotation (draft or sent) per call out or additional work.
CREATE UNIQUE INDEX IF NOT EXISTS amc_quotations_one_live ON public.amc_quotations (entity_type, entity_id) WHERE status IN ('draft', 'sent');

ALTER TABLE public.amc_quotations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_quotations FROM anon, authenticated;
