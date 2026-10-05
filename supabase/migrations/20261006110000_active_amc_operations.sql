-- =====================================================================
-- Active AMC operations: corrections, account-manager search, renewal
-- reminders
--
-- NOT APPLIED. Branch active-amc (6 Oct 2026). Apply after
-- 20261006100000_active_amc_contracts.sql.
--
-- 1. Usage corrections. A mistaken usage entry is never edited or deleted
--    (the ledger is append-only). It is corrected by a compensating
--    'correction' entry that points at the original, carries a reason, and
--    can never take back more than the original recorded.
-- 2. amc_contracts.account_manager_names: the snapshotted account-manager
--    names as plain text, so the list can search and filter by them.
-- 3. Todos can reference an AMC contract (related_type 'amc_contract'), and
--    amc_renewal_reminders records which reminder todo was made for which
--    contract and threshold, so the same reminder is never created twice.
--    Nothing here creates a reminder: that is an explicit action, switched
--    off in code until the schedule is approved.
-- 4. One renewal proposal per contract. The app checked this before
--    inserting, but two quick clicks could both pass the check; the unique
--    index makes the second insert fail instead. To start over, delete the
--    draft renewal first.
--
-- PRE-CHECK before applying (must return no rows):
--   SELECT renewal_of_contract_id, count(*) FROM public.amc_submissions
--    WHERE renewal_of_contract_id IS NOT NULL
--    GROUP BY 1 HAVING count(*) > 1;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Corrections
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_entitlement_usage
  ADD COLUMN IF NOT EXISTS corrects_usage_id uuid
    REFERENCES public.amc_entitlement_usage(id) ON DELETE RESTRICT;

ALTER TABLE public.amc_entitlement_usage
  DROP CONSTRAINT IF EXISTS amc_entitlement_usage_kind_check;
ALTER TABLE public.amc_entitlement_usage
  ADD CONSTRAINT amc_entitlement_usage_kind_check
  CHECK (kind IN ('consumption', 'adjustment', 'correction'));

ALTER TABLE public.amc_entitlement_usage
  DROP CONSTRAINT IF EXISTS amc_usage_correction_shape;
ALTER TABLE public.amc_entitlement_usage
  ADD CONSTRAINT amc_usage_correction_shape CHECK (
    (kind = 'correction'
      AND corrects_usage_id IS NOT NULL
      AND quantity < 0
      AND length(trim(coalesce(notes, ''))) > 0)
    OR (kind <> 'correction' AND corrects_usage_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_amc_usage_corrects
  ON public.amc_entitlement_usage (corrects_usage_id)
  WHERE corrects_usage_id IS NOT NULL;

/* The ledger trigger, now also guarding corrections: the original must be
   a consumption on the same entitlement, and all corrections of it
   together cannot exceed what it recorded. */
CREATE OR REPLACE FUNCTION public.amc_apply_entitlement_usage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  ent public.amc_contract_entitlements%ROWTYPE;
  contract_status text;
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
  SELECT status INTO contract_status FROM public.amc_contracts WHERE id = NEW.contract_id;
  IF contract_status <> 'active' AND NEW.kind = 'consumption' THEN
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

  UPDATE public.amc_contract_entitlements
     SET used_quantity = used_quantity + NEW.quantity
   WHERE id = NEW.entitlement_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.amc_apply_entitlement_usage() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Account-manager names for search and filtering
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contracts
  ADD COLUMN IF NOT EXISTS account_manager_names text NOT NULL DEFAULT '';
UPDATE public.amc_contracts c
   SET account_manager_names = coalesce((
     SELECT string_agg(trim(m->>'name'), ', ')
       FROM jsonb_array_elements(c.account_managers) AS m
      WHERE coalesce(trim(m->>'name'), '') <> ''
   ), '')
 WHERE c.account_manager_names = '';

-- ---------------------------------------------------------------------
-- 3. Todos may reference an AMC contract; renewal reminders are unique
-- ---------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  /* The original CHECK was declared inline (name todos_related_type_check);
     drop any CHECK on todos that mentions related_type, whatever its name. */
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.todos'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%related_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.todos DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.todos
  ADD CONSTRAINT todos_related_type_check CHECK (
    related_type IS NULL
    OR related_type IN ('work_order', 'quotation', 'appointment', 'amc_contract')
  );

CREATE TABLE IF NOT EXISTS public.amc_renewal_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  threshold_days integer NOT NULL CHECK (threshold_days > 0),
  remind_on date NOT NULL,
  todo_id uuid REFERENCES public.todos(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  /* One reminder per contract and threshold, however often the action
     runs. */
  UNIQUE (contract_id, threshold_days)
);
ALTER TABLE public.amc_renewal_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_renewal_reminders FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. One renewal proposal per contract
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_submissions_one_renewal
  ON public.amc_submissions (renewal_of_contract_id)
  WHERE renewal_of_contract_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Rollback (before any correction or reminder exists)
-- ---------------------------------------------------------------------
--   DROP INDEX IF EXISTS public.idx_amc_submissions_one_renewal;
--   DROP TABLE IF EXISTS public.amc_renewal_reminders;
--   ALTER TABLE public.todos DROP CONSTRAINT todos_related_type_check;
--   ALTER TABLE public.todos ADD CONSTRAINT todos_related_type_check CHECK
--     (related_type IS NULL OR related_type IN ('work_order','quotation','appointment'));
--   ALTER TABLE public.amc_contracts DROP COLUMN IF EXISTS account_manager_names;
--   ALTER TABLE public.amc_entitlement_usage DROP CONSTRAINT amc_usage_correction_shape;
--   ALTER TABLE public.amc_entitlement_usage DROP CONSTRAINT amc_entitlement_usage_kind_check;
--   ALTER TABLE public.amc_entitlement_usage ADD CONSTRAINT amc_entitlement_usage_kind_check
--     CHECK (kind IN ('consumption','adjustment'));
--   ALTER TABLE public.amc_entitlement_usage DROP COLUMN IF EXISTS corrects_usage_id;
--   (and re-create the trigger function from 20261006100000)
