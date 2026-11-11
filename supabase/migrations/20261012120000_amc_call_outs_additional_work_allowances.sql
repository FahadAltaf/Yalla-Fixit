-- =====================================================================
-- AMC call outs, additional works and allowance reservations
-- (BRD v0.3 5.13, 5.14; DEV-355, 405, 406, 407, 408, 409, 423 #8)
-- =====================================================================
-- NOT APPLIED. Row 26 in docs/production-migration-log.md, checks §18.
--
-- What it adds
--   * amc_call_outs: a reactive request against a contract -- channel,
--     issue, on-site contact, priority (emergency / non emergency) -- with
--     the coverage answer given before it is confirmed (covered or
--     chargeable, and why; booking a chargeable call out as free needs an
--     authorised override with a reason), its SLA deadlines from
--     configuration, the slot and crew, attendance, diagnosis,
--     resolution, pending works, and the SLA-miss and misuse flags.
--     Statuses: logged, scheduled, attended, resolved, pending_works,
--     quoted, closed (and cancelled, with a reason).
--   * amc_additional_works: work found on a PPM visit or a call out. The
--     technical finding (what, risk, photos) is kept apart from the
--     commercial part (quotation with the material handling fee,
--     approval with evidence, invoice, payment). Five parties: requester,
--     approver, payer, invoice recipient, report recipient. Statuses:
--     identified, quotation_prepared, shared, approved, rejected,
--     scheduled, completed, invoiced, paid.
--   * amc_work_photos: photos of a call out or an additional work (files
--     in the private amc-documents bucket).
--   * Allowance reservations on the existing usage ledger: kinds
--     'reserve' and 'release', reservation_id on the settling row, and
--     amc_contract_entitlements.reserved_quantity kept by the existing
--     trigger (replaced, same name). Booking reserves a unit; completion
--     consumes it (the consumption names the reservation, which frees
--     it); a cancelled or failed booking releases it. used + reserved can
--     never pass what is included.
--   * amc_send_log accepts the call-out acknowledgement and the
--     additional-work quotation.
--
-- Live safety
--   * amc_submissions, the live scheduling tables and the Snagging tables
--     are not touched. Every table here is AMC-only and empty in
--     production; live main reads none of them.
--   * amc_apply_entitlement_usage() is replaced with a version that
--     behaves exactly as before for consumption, adjustment and
--     correction rows.
--   * role_access (live) gets INSERTS only, for the two new AMC page
--     permissions (amc_call_outs, amc_additional_works), the same way the
--     AMC per-page backfill (20261012100000) did. Nothing is updated or
--     deleted; live main does not read these resources.
--
-- Pre-check / post-check: docs/production-migration-checks.md §18.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Allowance reservations (DEV-409)
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contract_entitlements
  ADD COLUMN IF NOT EXISTS reserved_quantity numeric(10,2) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0);
ALTER TABLE public.amc_contract_entitlements DROP CONSTRAINT IF EXISTS amc_entitlements_not_overreserved;
ALTER TABLE public.amc_contract_entitlements
  ADD CONSTRAINT amc_entitlements_not_overreserved CHECK (
    included_quantity IS NULL OR used_quantity + reserved_quantity <= included_quantity
  );

ALTER TABLE public.amc_entitlement_usage
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES public.amc_entitlement_usage(id) ON DELETE RESTRICT;
ALTER TABLE public.amc_entitlement_usage DROP CONSTRAINT IF EXISTS amc_entitlement_usage_kind_check;
ALTER TABLE public.amc_entitlement_usage
  ADD CONSTRAINT amc_entitlement_usage_kind_check
  CHECK (kind IN ('consumption', 'adjustment', 'correction', 'reserve', 'release'));
ALTER TABLE public.amc_entitlement_usage DROP CONSTRAINT IF EXISTS amc_usage_reservation_shape;
ALTER TABLE public.amc_entitlement_usage
  ADD CONSTRAINT amc_usage_reservation_shape CHECK (
    (kind = 'reserve' AND quantity > 0 AND reservation_id IS NULL)
    OR (kind = 'release' AND quantity > 0 AND reservation_id IS NOT NULL)
    OR (kind = 'consumption')
    OR (kind IN ('adjustment', 'correction') AND reservation_id IS NULL)
  );
/* A reservation is settled once: consumed or released, never both. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_usage_reservation_settled
  ON public.amc_entitlement_usage (reservation_id)
  WHERE reservation_id IS NOT NULL;

/* Same name as before (20261006110000); consumption, adjustment and
   correction behave as they did, the correction guard included. 'reserve' adds to reserved_quantity (the contract must be
   active); 'release' gives the reservation back; a consumption that names
   its reservation frees it in the same update. */
CREATE OR REPLACE FUNCTION public.amc_apply_entitlement_usage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  ent public.amc_contract_entitlements%ROWTYPE;
  contract_status text;
  held numeric(10,2) := 0;
  res public.amc_entitlement_usage%ROWTYPE;
  original public.amc_entitlement_usage%ROWTYPE;
  already_corrected numeric;
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
  SELECT status INTO contract_status FROM public.amc_contracts WHERE id = NEW.contract_id FOR SHARE;
  IF contract_status <> 'active' AND NEW.kind IN ('consumption', 'reserve') THEN
    RAISE EXCEPTION 'Contract is not active' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.kind = 'correction' THEN
    SELECT * INTO original FROM public.amc_entitlement_usage WHERE id = NEW.corrects_usage_id;
    IF NOT FOUND OR original.entitlement_id <> NEW.entitlement_id OR original.kind <> 'consumption' THEN
      RAISE EXCEPTION 'A correction must reference a usage entry of the same service' USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum(quantity), 0) INTO already_corrected
      FROM public.amc_entitlement_usage
     WHERE corrects_usage_id = NEW.corrects_usage_id AND kind = 'correction';
    IF original.quantity + already_corrected + NEW.quantity < 0 THEN
      RAISE EXCEPTION 'A correction cannot take back more than the entry recorded' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.reservation_id IS NOT NULL THEN
    SELECT * INTO res FROM public.amc_entitlement_usage WHERE id = NEW.reservation_id;
    IF NOT FOUND OR res.kind <> 'reserve' OR res.entitlement_id <> NEW.entitlement_id THEN
      RAISE EXCEPTION 'That is not a reservation of this service' USING ERRCODE = 'check_violation';
    END IF;
    held := res.quantity;
    /* A release gives back exactly what was held. */
    IF NEW.kind = 'release' THEN
      NEW.quantity := held;
    END IF;
  END IF;

  IF NEW.kind = 'reserve' THEN
    UPDATE public.amc_contract_entitlements
       SET reserved_quantity = reserved_quantity + NEW.quantity
     WHERE id = NEW.entitlement_id;
  ELSIF NEW.kind = 'release' THEN
    UPDATE public.amc_contract_entitlements
       SET reserved_quantity = reserved_quantity - held
     WHERE id = NEW.entitlement_id;
  ELSE
    UPDATE public.amc_contract_entitlements
       SET used_quantity = used_quantity + NEW.quantity,
           reserved_quantity = reserved_quantity - held
     WHERE id = NEW.entitlement_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.amc_apply_entitlement_usage() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Call outs (DEV-405, 406)
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.amc_call_out_number_seq;
REVOKE ALL ON SEQUENCE public.amc_call_out_number_seq FROM anon, authenticated;
/* CO-<Dubai year>-<at least 4 digits>, as the AQ numbers (20261006130000). */
CREATE OR REPLACE FUNCTION public.amc_next_call_out_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  digits text := nextval('public.amc_call_out_number_seq')::text;
BEGIN
  RETURN 'CO-' || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY') || '-' || lpad(digits, greatest(4, length(digits)), '0');
END;
$fn$;
REVOKE ALL ON FUNCTION public.amc_next_call_out_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_next_call_out_number() TO service_role;

CREATE TABLE IF NOT EXISTS public.amc_call_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_out_no text NOT NULL UNIQUE DEFAULT public.amc_next_call_out_number(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  /* The contract's call-out service it is counted against, if it has one. */
  entitlement_id uuid REFERENCES public.amc_contract_entitlements(id) ON DELETE RESTRICT,
  priority text NOT NULL CHECK (priority IN ('emergency', 'non_emergency')),
  channel text NOT NULL CHECK (channel IN ('call', 'whatsapp', 'email', 'portal')),
  reported_at timestamptz NOT NULL,
  issue text NOT NULL CHECK (length(trim(issue)) > 0),
  trade text CHECK (trade IS NULL OR trade IN ('ac', 'plumbing', 'electrical', 'handyman', 'civil', 'other')),
  on_site_contact_name text,
  on_site_contact_phone text,

  /* The coverage answer given before the call out was confirmed (DEV-408). */
  coverage text NOT NULL CHECK (coverage IN ('covered', 'chargeable')),
  coverage_reasons text[] NOT NULL DEFAULT '{}',
  /* Booked as covered although the check said chargeable: who and why. */
  coverage_override_reason text,
  coverage_override_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES public.amc_entitlement_usage(id) ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'logged' CHECK (status IN (
    'logged', 'scheduled', 'attended', 'resolved', 'pending_works', 'quoted', 'closed', 'cancelled'
  )),
  status_reason text,

  /* SLA deadlines from configuration at the time it was logged. */
  sla_attend_due_at timestamptz,
  sla_schedule_due_at timestamptz,
  sla_met boolean,
  sla_at_risk_notified_at timestamptz,

  scheduled_start timestamptz,
  scheduled_end timestamptz,
  technician_ids text[] NOT NULL DEFAULT '{}',
  lead_technician_id text,
  assignment_override_reason text,

  attended_at timestamptz,
  diagnosis text,
  resolution text,
  parts_needed text,
  pending_works jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pending_works) = 'array'),
  resolved_at timestamptz,
  closed_at timestamptz,
  closed_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,

  misuse_flag boolean NOT NULL DEFAULT false,
  misuse_note text,
  acknowledged_at timestamptz,

  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT amc_call_outs_override_explained CHECK (
    coverage_override_reason IS NULL OR length(trim(coverage_override_reason)) > 0
  ),
  CONSTRAINT amc_call_outs_slot_pair CHECK ((scheduled_start IS NULL) = (scheduled_end IS NULL)),
  CONSTRAINT amc_call_outs_slot_order CHECK (scheduled_end IS NULL OR scheduled_end > scheduled_start),
  CONSTRAINT amc_call_outs_cancel_explained CHECK (
    status <> 'cancelled' OR (status_reason IS NOT NULL AND length(trim(status_reason)) > 0)
  ),
  CONSTRAINT amc_call_outs_attended_shape CHECK (
    status NOT IN ('attended', 'resolved', 'pending_works', 'quoted') OR attended_at IS NOT NULL
  ),
  CONSTRAINT amc_call_outs_attended_after_report CHECK (attended_at IS NULL OR attended_at >= reported_at),
  CONSTRAINT amc_call_outs_misuse_explained CHECK (
    NOT misuse_flag OR (misuse_note IS NOT NULL AND length(trim(misuse_note)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_contract ON public.amc_call_outs (contract_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_open ON public.amc_call_outs (priority, reported_at)
  WHERE status NOT IN ('closed', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_slot ON public.amc_call_outs (scheduled_start) WHERE scheduled_start IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_entitlement ON public.amc_call_outs (entitlement_id) WHERE entitlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_reservation ON public.amc_call_outs (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_override_by ON public.amc_call_outs (coverage_override_by) WHERE coverage_override_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_closed_by ON public.amc_call_outs (closed_by) WHERE closed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_created_by ON public.amc_call_outs (created_by) WHERE created_by IS NOT NULL;

ALTER TABLE public.amc_entitlement_usage
  ADD COLUMN IF NOT EXISTS call_out_id uuid REFERENCES public.amc_call_outs(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_amc_usage_call_out ON public.amc_entitlement_usage (call_out_id) WHERE call_out_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Additional works (DEV-407)
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.amc_additional_work_number_seq;
REVOKE ALL ON SEQUENCE public.amc_additional_work_number_seq FROM anon, authenticated;
/* AW-<Dubai year>-<at least 4 digits>, as the AQ numbers (20261006130000). */
CREATE OR REPLACE FUNCTION public.amc_next_additional_work_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  digits text := nextval('public.amc_additional_work_number_seq')::text;
BEGIN
  RETURN 'AW-' || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY') || '-' || lpad(digits, greatest(4, length(digits)), '0');
END;
$fn$;
REVOKE ALL ON FUNCTION public.amc_next_additional_work_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_next_additional_work_number() TO service_role;

CREATE TABLE IF NOT EXISTS public.amc_additional_works (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_no text NOT NULL UNIQUE DEFAULT public.amc_next_additional_work_number(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('visit', 'call_out', 'manual')),
  visit_id uuid REFERENCES public.amc_visits(id) ON DELETE RESTRICT,
  call_out_id uuid REFERENCES public.amc_call_outs(id) ON DELETE RESTRICT,
  technician_id text,

  /* The technical finding, kept apart from the commercial part. */
  trade text CHECK (trade IS NULL OR trade IN ('ac', 'plumbing', 'electrical', 'handyman', 'civil', 'other')),
  finding text NOT NULL CHECK (length(trim(finding)) > 0),
  risk text NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high', 'safety')),

  /* The five parties: { name, role, email, phone } each. */
  requester jsonb,
  approver jsonb,
  payer jsonb,
  invoice_recipient jsonb,
  report_recipient jsonb,

  status text NOT NULL DEFAULT 'identified' CHECK (status IN (
    'identified', 'quotation_prepared', 'shared', 'approved', 'rejected', 'scheduled', 'completed', 'invoiced', 'paid'
  )),
  quotation_lines jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(quotation_lines) = 'array'),
  material_fee_percent numeric(5,2) NOT NULL DEFAULT 20 CHECK (material_fee_percent BETWEEN 0 AND 100),
  labour_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (labour_total >= 0),
  material_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (material_total >= 0),
  material_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (material_fee >= 0),
  subtotal numeric(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  vat_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total numeric(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  quoted_at timestamptz,
  shared_at timestamptz,
  approved_at timestamptz,
  approval_evidence text,
  approval_document_id uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejection_reason text,
  scheduled_for date,
  completed_at timestamptz,
  invoice_number text,
  invoiced_at timestamptz,
  paid_at timestamptz,
  payment_reference text,

  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT amc_additional_works_source_link CHECK (
    (source = 'visit' AND visit_id IS NOT NULL AND call_out_id IS NULL)
    OR (source = 'call_out' AND call_out_id IS NOT NULL AND visit_id IS NULL)
    OR (source = 'manual' AND visit_id IS NULL AND call_out_id IS NULL)
  ),
  CONSTRAINT amc_additional_works_approval_evidence CHECK (
    status NOT IN ('approved', 'scheduled', 'completed', 'invoiced', 'paid')
    OR (approved_at IS NOT NULL AND approval_evidence IS NOT NULL AND length(trim(approval_evidence)) > 0)
  ),
  CONSTRAINT amc_additional_works_rejection_reason CHECK (
    status <> 'rejected' OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0)
  ),
  CONSTRAINT amc_additional_works_invoiced CHECK (
    status NOT IN ('invoiced', 'paid') OR (invoice_number IS NOT NULL AND invoiced_at IS NOT NULL)
  ),
  CONSTRAINT amc_additional_works_paid CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CONSTRAINT amc_additional_works_quoted CHECK (
    status IN ('identified', 'rejected') OR jsonb_array_length(quotation_lines) > 0
  )
);
CREATE INDEX IF NOT EXISTS idx_amc_additional_works_contract ON public.amc_additional_works (contract_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_additional_works_open ON public.amc_additional_works (status) WHERE status NOT IN ('paid', 'rejected');
CREATE INDEX IF NOT EXISTS idx_amc_additional_works_visit ON public.amc_additional_works (visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_additional_works_call_out ON public.amc_additional_works (call_out_id) WHERE call_out_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_additional_works_document ON public.amc_additional_works (approval_document_id) WHERE approval_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_additional_works_created_by ON public.amc_additional_works (created_by) WHERE created_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Photos of a call out or an additional work
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_work_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_out_id uuid REFERENCES public.amc_call_outs(id) ON DELETE RESTRICT,
  additional_work_id uuid REFERENCES public.amc_additional_works(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('reported', 'before', 'after', 'finding', 'other')),
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  caption text,
  uploaded_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_work_photos_one_owner CHECK ((call_out_id IS NULL) <> (additional_work_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_amc_work_photos_call_out ON public.amc_work_photos (call_out_id) WHERE call_out_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_work_photos_additional ON public.amc_work_photos (additional_work_id) WHERE additional_work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_work_photos_uploaded_by ON public.amc_work_photos (uploaded_by) WHERE uploaded_by IS NOT NULL;

-- Server-only, like every AMC table.
ALTER TABLE public.amc_call_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_additional_works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_work_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_call_outs FROM anon, authenticated;
REVOKE ALL ON public.amc_additional_works FROM anon, authenticated;
REVOKE ALL ON public.amc_work_photos FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. The send log takes the call-out acknowledgement and the quotation
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
  ADD CONSTRAINT amc_send_log_document_check
  CHECK (document IN ('proposal', 'contract', 'instalment_reminder', 'visit_confirmation', 'visit_reminder', 'service_report',
                      'call_out_acknowledgement', 'additional_work_quotation'));

-- ---------------------------------------------------------------------
-- 6. The two new AMC pages get their own permission (as 20261012100000)
-- ---------------------------------------------------------------------
-- Additive only, keyed on role_access's unique (role_id, resource, action),
-- safe to run twice. A role that can use AMC today gets View on both pages;
-- a role with AMC Visits Create or Edit gets the same on both, since call
-- outs and additional works are field work like visits.
insert into public.role_access (role_id, resource, action, enabled)
select distinct ra.role_id, page.resource, 'view', true
from public.role_access ra
cross join (values ('amc_call_outs'), ('amc_additional_works')) as page(resource)
where ra.enabled is distinct from false
  and (
    (ra.resource = 'amc' and ra.action in ('view', 'approve'))
    or (ra.resource = 'amc_operations' and ra.action in ('view', 'edit'))
    or (ra.resource in ('amc_enquiries', 'amc_rate_card', 'amc_config', 'amc_payments', 'amc_visits', 'amc_allowances') and ra.action = 'view')
  )
on conflict (role_id, resource, action) do nothing;

insert into public.role_access (role_id, resource, action, enabled)
select distinct ra.role_id, page.resource, ra.action, true
from public.role_access ra
cross join (values ('amc_call_outs'), ('amc_additional_works')) as page(resource)
where ra.enabled is distinct from false
  and ra.resource = 'amc_visits' and ra.action in ('create', 'edit')
on conflict (role_id, resource, action) do nothing;
