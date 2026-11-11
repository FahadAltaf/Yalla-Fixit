\set ON_ERROR_STOP on
SET ROLE service_role;
-- Fresh active contract for these checks (93 cancelled its own).
INSERT INTO public.amc_submissions (id, owner_id, status, signed_by_name, signed_at)
VALUES ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'signed', 'Client', now());
INSERT INTO public.amc_contracts (id, submission_id, proposal_number, customer, property, account_managers,
  start_date, end_date, subtotal, final_price, vat_amount, grand_total, signed_at, signed_by_name)
VALUES ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 'AMC-2026-0002',
  '{}', '{}', '[{"name":"Sam Ali","phone":"050"}]', '2026-10-01', '2027-10-01', 100, 100, 5, 105, now(), 'Client');
INSERT INTO public.amc_contract_entitlements (id, contract_id, service_id, service_label, entitlement_type, units, frequency, included_quantity)
VALUES ('66666666-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'ac-ppm', 'AC PPM', 'visits', 1, 4, 4),
       ('66666666-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555', 'handyman', 'Handyman', 'hours', 1, 6, 6);
INSERT INTO public.amc_entitlement_usage (id, contract_id, entitlement_id, kind, quantity, occurred_at)
VALUES ('77777777-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'consumption', 2, now());

-- A correction takes back part of the original, with a reason.
INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, notes, corrects_usage_id)
VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'correction', -1, now(), 'Entered twice', '77777777-0000-0000-0000-000000000001');
DO $$
BEGIN
  IF (SELECT used_quantity FROM public.amc_contract_entitlements WHERE id = '66666666-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'correction did not reduce used_quantity';
  END IF;
  -- Cannot take back more than the original recorded (2 - 1 already = 1 left).
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, notes, corrects_usage_id)
    VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'correction', -2, now(), 'x', '77777777-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'over-correction was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A correction needs a reason and an original.
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, corrects_usage_id)
    VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'correction', -1, now(), '77777777-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'correction without reason was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, notes)
    VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'correction', -1, now(), 'x');
    RAISE EXCEPTION 'correction without original was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A correction must target the same service.
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, notes, corrects_usage_id)
    VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000002', 'correction', -1, now(), 'x', '77777777-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'cross-service correction was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A positive "correction" is not a correction.
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, notes, corrects_usage_id)
    VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'correction', 1, now(), 'x', '77777777-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'positive correction was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Account-manager names column exists and can be set.
UPDATE public.amc_contracts SET account_manager_names = 'Sam Ali' WHERE id = '55555555-5555-5555-5555-555555555555';

-- Todos may reference an AMC contract; renewal reminders are unique per threshold.
INSERT INTO public.todos (id, owner_id, description, related_type, related_id, deadline_at)
VALUES ('88888888-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Renew AMC', 'amc_contract', '55555555-5555-5555-5555-555555555555', now());
INSERT INTO public.amc_renewal_reminders (contract_id, threshold_days, remind_on, todo_id)
VALUES ('55555555-5555-5555-5555-555555555555', 30, '2027-09-01', '88888888-0000-0000-0000-000000000001');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_renewal_reminders (contract_id, threshold_days, remind_on)
    VALUES ('55555555-5555-5555-5555-555555555555', 30, '2027-09-01');
    RAISE EXCEPTION 'duplicate reminder was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.todos (owner_id, description, related_type, deadline_at)
    VALUES ('00000000-0000-0000-0000-000000000001', 'x', 'nonsense', now());
    RAISE EXCEPTION 'unknown related_type was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
-- One renewal proposal per contract.
INSERT INTO public.amc_submissions (id, owner_id, status, renewal_of_contract_id)
VALUES ('99999999-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'draft', '55555555-5555-5555-5555-555555555555');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_submissions (owner_id, status, renewal_of_contract_id)
    VALUES ('00000000-0000-0000-0000-000000000001', 'draft', '55555555-5555-5555-5555-555555555555');
    RAISE EXCEPTION 'second renewal proposal was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM 1 FROM public.amc_renewal_reminders; RAISE EXCEPTION 'authenticated reads reminders';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'OPERATIONS CHECKS PASSED' AS result;
