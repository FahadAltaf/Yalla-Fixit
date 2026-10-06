\set ON_ERROR_STOP on
SET ROLE service_role;

-- Customer link columns.
UPDATE public.amc_contracts
   SET fsm_contact_id = '9001', fsm_contact_name = 'Client', fsm_customer_id = 'YFI1806', fsm_customer_linked_at = now()
 WHERE id = '55555555-5555-5555-5555-555555555555';

-- Service mapping: one active AMC service per FSM service.
INSERT INTO public.amc_fsm_service_mappings (amc_service_id, fsm_service_id, fsm_service_name)
VALUES ('ac-ppm', 'SVC-1', 'AC Maintenance');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_fsm_service_mappings (amc_service_id, fsm_service_id) VALUES ('handyman', 'SVC-1');
    RAISE EXCEPTION 'two AMC services on one FSM service were allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
INSERT INTO public.amc_fsm_service_mappings (amc_service_id, fsm_service_id, active) VALUES ('handyman', 'SVC-1', false);

-- Links.
INSERT INTO public.amc_fsm_links (id, contract_id, entitlement_id, fsm_work_order_id, fsm_appointment_id)
VALUES ('88888888-1111-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
        '66666666-0000-0000-0000-000000000001', 'WO-1', 'AP-1');
INSERT INTO public.amc_fsm_links (contract_id, entitlement_id, fsm_work_order_id)
VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000002', 'WO-2');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_fsm_links (contract_id, entitlement_id, fsm_work_order_id, fsm_appointment_id)
    VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000002', 'WO-1', 'AP-1');
    RAISE EXCEPTION 'one appointment linked twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_fsm_links (contract_id, entitlement_id, fsm_work_order_id)
    VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'WO-2');
    RAISE EXCEPTION 'one work order linked twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_fsm_links (contract_id, entitlement_id, fsm_work_order_id)
    VALUES ('55555555-5555-5555-5555-555555555555', '33333333-0000-0000-0000-000000000001', 'WO-3');
    RAISE EXCEPTION 'an entitlement of another contract was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_fsm_links SET unlinked_at = now() WHERE id = '88888888-1111-0000-0000-000000000001';
    RAISE EXCEPTION 'unlink without a reason was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
-- Unlinked, the appointment can be linked again.
UPDATE public.amc_fsm_links SET unlinked_at = now(), unlink_reason = 'Wrong contract'
 WHERE id = '88888888-1111-0000-0000-000000000001';
INSERT INTO public.amc_fsm_links (contract_id, entitlement_id, fsm_work_order_id, fsm_appointment_id)
VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'WO-1', 'AP-1');

-- FSM usage is idempotent per appointment and entitlement.
INSERT INTO public.amc_entitlement_usage (id, contract_id, entitlement_id, kind, quantity, occurred_at, source,
  external_type, external_reference, fsm_work_order_id, fsm_synced_at)
VALUES ('77777777-1111-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
  '66666666-0000-0000-0000-000000000001', 'consumption', 1, now(), 'fsm', 'fsm_appointment', 'AP-1', 'WO-1', now());
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source,
      external_type, external_reference, fsm_work_order_id, fsm_synced_at)
    VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'consumption', 1, now(),
      'fsm', 'fsm_appointment', 'AP-1', 'WO-1', now());
    RAISE EXCEPTION 'the same appointment was consumed twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
-- An FSM reversal is a correction referencing the original.
INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source, notes,
  corrects_usage_id, fsm_work_order_id, fsm_synced_at)
VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'correction', -1, now(), 'fsm',
  'FSM appointment AP-1 is no longer completed', '77777777-1111-0000-0000-000000000001', 'WO-1', now());
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source, notes,
      corrects_usage_id)
    VALUES ('55555555-5555-5555-5555-555555555555', '66666666-0000-0000-0000-000000000001', 'correction', -1, now(), 'fsm',
      'again', '77777777-1111-0000-0000-000000000001');
    RAISE EXCEPTION 'a second reversal of the same entry was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Sync log: one row per appointment and action.
INSERT INTO public.amc_fsm_sync_events (fsm_appointment_id, action, contract_id, status, attempts)
VALUES ('AP-1', 'consume', '55555555-5555-5555-5555-555555555555', 'recorded', 1);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.amc_fsm_sync_events (fsm_appointment_id, action, status) VALUES ('AP-1', 'consume', 'pending');
    RAISE EXCEPTION 'duplicate sync event was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_fsm_sync_events (fsm_appointment_id, action, status) VALUES ('AP-2', 'consume', 'done');
    RAISE EXCEPTION 'unknown sync status was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM 1 FROM public.amc_fsm_links; RAISE EXCEPTION 'authenticated reads links';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.amc_fsm_service_mappings; RAISE EXCEPTION 'authenticated reads mappings';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.amc_fsm_sync_events; RAISE EXCEPTION 'authenticated reads sync events';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'FSM INTEGRATION CHECKS PASSED' AS result;
