\set ON_ERROR_STOP on
-- Active AMC tables: behaviour checks on the throwaway local cluster.
SET ROLE service_role;

-- A signed proposal to activate.
INSERT INTO public.amc_submissions (id, owner_id, status, signed_by_name, signed_at)
VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001',
        'signed', 'Client Name', now());

INSERT INTO public.amc_contracts (id, submission_id, proposal_number, customer, property,
  start_date, end_date, subtotal, final_price, vat_amount, grand_total, signed_at, signed_by_name)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
  'AMC-2026-0001', '{}', '{}', '2026-10-01', '2027-10-01', 1000, 1000, 50, 1050, now(), 'Client Name');

-- 1. A second contract for the same proposal is impossible.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_contracts (submission_id, proposal_number, customer, property,
      start_date, end_date, subtotal, final_price, vat_amount, grand_total, signed_at, signed_by_name)
    VALUES ('11111111-1111-1111-1111-111111111111', 'AMC-2026-0001', '{}', '{}',
      '2026-10-01', '2027-10-01', 1, 1, 0, 1, now(), 'x');
    RAISE EXCEPTION 'duplicate activation was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- 2. end_date must be after start_date.
  BEGIN
    INSERT INTO public.amc_contracts (submission_id, proposal_number, customer, property,
      start_date, end_date, subtotal, final_price, vat_amount, grand_total, signed_at, signed_by_name)
    VALUES (gen_random_uuid(), 'X', '{}', '{}', '2026-10-01', '2026-10-01', 1, 1, 0, 1, now(), 'x');
    RAISE EXCEPTION 'invalid period was allowed';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL;
  END;
END $$;

INSERT INTO public.amc_contract_entitlements (id, contract_id, service_id, service_label,
  entitlement_type, call_out_class, units, frequency, included_quantity, contracted_price)
VALUES
 ('33333333-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'ac-ppm', 'AC PPM', 'visits', NULL, 2, 4, 4, 800),
 ('33333333-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'handyman', 'Handyman', 'hours', NULL, 1, 6, 6, 600),
 ('33333333-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'emergency', 'Emergency', 'unlimited', 'emergency', 1, 1, NULL, 0),
 ('33333333-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'helpdesk', 'Helpdesk', 'informational', NULL, 1, 1, NULL, 0);

-- 3. Consumption updates used_quantity through the trigger.
INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at)
VALUES ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000001', 'consumption', 1, now()),
       ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000002', 'consumption', 2.5, now()),
       ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000003', 'consumption', 3, now());
DO $$
DECLARE v numeric; h numeric; u numeric;
BEGIN
  SELECT used_quantity INTO v FROM public.amc_contract_entitlements WHERE id = '33333333-0000-0000-0000-000000000001';
  SELECT used_quantity INTO h FROM public.amc_contract_entitlements WHERE id = '33333333-0000-0000-0000-000000000002';
  SELECT used_quantity INTO u FROM public.amc_contract_entitlements WHERE id = '33333333-0000-0000-0000-000000000003';
  IF v <> 1 OR h <> 2.5 OR u <> 3 THEN RAISE EXCEPTION 'used_quantity not maintained: % % %', v, h, u; END IF;
END $$;

DO $$
BEGIN
  -- 4. Over-consumption is refused and leaves no ledger row.
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at)
    VALUES ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000001', 'consumption', 4, now());
    RAISE EXCEPTION 'over-consumption was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.amc_entitlement_usage WHERE entitlement_id = '33333333-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'refused consumption left a ledger row';
  END IF;
  -- 5. Informational services cannot be consumed.
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at)
    VALUES ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000004', 'consumption', 1, now());
    RAISE EXCEPTION 'informational consumption was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- 6. An adjustment below zero is refused; an adjustment needs a reason.
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, notes)
    VALUES ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000001', 'adjustment', -5, now(), 'fix');
    RAISE EXCEPTION 'negative used_quantity was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at)
    VALUES ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000001', 'adjustment', -1, now());
    RAISE EXCEPTION 'adjustment without a reason was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- 7. The same FSM appointment cannot be consumed twice.
  INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, external_type, external_reference)
  VALUES ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000002', 'consumption', 1, now(), 'fsm_appointment', 'SA-1');
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, external_type, external_reference)
    VALUES ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000002', 'consumption', 1, now(), 'fsm_appointment', 'SA-1');
    RAISE EXCEPTION 'double consumption of one appointment was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- 8. Wrong contract for the entitlement is refused.
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at)
    VALUES (gen_random_uuid(), '33333333-0000-0000-0000-000000000001', 'consumption', 1, now());
    RAISE EXCEPTION 'cross-contract usage was allowed';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL;
  END;
END $$;

-- 9. The ledger is append-only: UPDATE, DELETE and TRUNCATE fail loudly.
DO $$
BEGIN
  BEGIN
    UPDATE public.amc_entitlement_usage SET quantity = 99;
    RAISE EXCEPTION 'ledger update was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_entitlement_usage;
    RAISE EXCEPTION 'ledger delete was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    TRUNCATE public.amc_entitlement_usage CASCADE;
    RAISE EXCEPTION 'ledger truncate was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.amc_entitlement_usage) <> 4
     OR EXISTS (SELECT 1 FROM public.amc_entitlement_usage WHERE quantity = 99) THEN
    RAISE EXCEPTION 'ledger was rewritten';
  END IF;
END $$;

-- 10. A cancelled contract needs a reason, and refuses new consumption.
DO $$
BEGIN
  BEGIN
    UPDATE public.amc_contracts SET status = 'cancelled' WHERE id = '22222222-2222-2222-2222-222222222222';
    RAISE EXCEPTION 'cancel without reason was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
UPDATE public.amc_contracts SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'test'
 WHERE id = '22222222-2222-2222-2222-222222222222';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at)
    VALUES ('22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000002', 'consumption', 1, now());
    RAISE EXCEPTION 'consumption on a cancelled contract was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- 11. Audit accepts the contract entity type.
INSERT INTO public.amc_audit_events (entity_type, entity_id, event_type, origin)
VALUES ('contract', '22222222-2222-2222-2222-222222222222', 'contract_activated', 'portal');
RESET ROLE;

-- 12. Browser roles cannot reach the new tables.
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM 1 FROM public.amc_contracts; RAISE EXCEPTION 'authenticated reads amc_contracts';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at)
        VALUES (gen_random_uuid(), gen_random_uuid(), 'consumption', 1, now());
        RAISE EXCEPTION 'authenticated writes usage';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT 'ACTIVE AMC CHECKS PASSED' AS result;
