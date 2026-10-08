\set ON_ERROR_STOP on
-- Phase 7 (20261008100000): payment schedule, cheques, receipts, the gate.

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  s uuid;
  c uuid;
  i1 uuid;
  i2 uuid;
  ch uuid;
  p uuid;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_instalments', 'amc_cheques', 'amc_payments'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '% is granted to a browser role', t;
    END IF;
  END LOOP;

  -- A contract to pay for.
  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES (owner_id, 'proposal_approved', '{"propertyAddress":"Villa 9","unitType":"villa"}', '{"customerName":"PAYMENTS"}',
    '{}', '[]', 0, 0, 10000, '{}', now()) RETURNING id INTO s;
  c := public.amc_activate_contract(
    jsonb_build_object(
      'submission_id', s, 'proposal_number', 'AMC-TEST-PAY', 'status', 'draft',
      'customer', '{"customerName":"PAYMENTS"}'::jsonb, 'property', '{"propertyAddress":"Villa 9"}'::jsonb,
      'start_date', current_date, 'end_date', current_date + 364,
      'subtotal', 10000, 'final_price', 10000, 'vat_amount', 500, 'grand_total', 10500, 'template', 'residential'),
    '[{"service_id":"ac-ppm","service_label":"AC PPM","entitlement_type":"visits","units":1,"frequency":2,"included_quantity":2}]'::jsonb);

  -- The gate override says who, when and why, or nothing at all.
  BEGIN
    UPDATE public.amc_contracts SET gate_override_at = now() WHERE id = c;
    RAISE EXCEPTION 'a gate override without a reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_contracts SET payment_plan = 'fifty_fifty' WHERE id = c;

  -- The schedule: amount + VAT = total, numbered once per contract.
  INSERT INTO public.amc_instalments (contract_id, instalment_no, label, due_date, amount, vat_amount, total, status)
  VALUES (c, 1, 'Half 1 of 2', current_date, 5000, 250, 5250, 'due') RETURNING id INTO i1;
  INSERT INTO public.amc_instalments (contract_id, instalment_no, label, due_date, amount, vat_amount, total)
  VALUES (c, 2, 'Half 2 of 2', current_date + 180, 5000, 250, 5250) RETURNING id INTO i2;
  BEGIN
    INSERT INTO public.amc_instalments (contract_id, instalment_no, label, due_date, amount, vat_amount, total)
    VALUES (c, 2, 'Again', current_date, 1, 0, 1);
    RAISE EXCEPTION 'two instalments with one number';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_instalments (contract_id, instalment_no, label, due_date, amount, vat_amount, total)
    VALUES (c, 3, 'Off', current_date, 100, 5, 106);
    RAISE EXCEPTION 'VAT that does not add up was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_instalments SET received_amount = 6000 WHERE id = i1;
    RAISE EXCEPTION 'more received than is owed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_instalments SET status = 'received' WHERE id = i1;
    RAISE EXCEPTION 'received without the money';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_instalments SET status = 'written_off' WHERE id = i2;
    RAISE EXCEPTION 'written off without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_instalments SET status = 'paid' WHERE id = i2;
    RAISE EXCEPTION 'an unknown status was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Cheques: one piece of paper once; a bounce says why and when.
  INSERT INTO public.amc_cheques (contract_id, instalment_id, cheque_no, bank, cheque_date, amount)
  VALUES (c, i1, '000123', 'Emirates NBD', current_date + 3, 5250) RETURNING id INTO ch;
  BEGIN
    INSERT INTO public.amc_cheques (contract_id, instalment_id, cheque_no, bank, cheque_date, amount)
    VALUES (c, i1, ' 000123', 'emirates nbd ', current_date, 1);
    RAISE EXCEPTION 'the same cheque twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_cheques SET status = 'bounced', bounced_on = current_date WHERE id = ch;
    RAISE EXCEPTION 'a bounce without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_cheques SET status = 'cleared' WHERE id = ch;
    RAISE EXCEPTION 'cleared without being deposited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_cheques SET status = 'deposited', deposited_on = current_date WHERE id = ch;
  UPDATE public.amc_cheques SET status = 'cleared', cleared_on = current_date WHERE id = ch;

  -- Receipts: a cheque receipt names its cheque, a transfer its reference, a void its reason.
  BEGIN
    INSERT INTO public.amc_payments (contract_id, instalment_id, mode, amount, received_on) VALUES (c, i1, 'cheque', 5250, current_date);
    RAISE EXCEPTION 'a cheque receipt without its cheque';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_payments (contract_id, instalment_id, mode, amount, received_on) VALUES (c, i2, 'transfer', 100, current_date);
    RAISE EXCEPTION 'a transfer without a reference';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.amc_payments (contract_id, instalment_id, mode, amount, received_on, cheque_id)
  VALUES (c, i1, 'cheque', 5250, current_date, ch) RETURNING id INTO p;
  BEGIN
    INSERT INTO public.amc_payments (contract_id, instalment_id, mode, amount, received_on, cheque_id)
    VALUES (c, i1, 'cheque', 5250, current_date, ch);
    RAISE EXCEPTION 'one cheque received twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE public.amc_instalments SET received_amount = 5250, status = 'received' WHERE id = i1;
  BEGIN
    UPDATE public.amc_payments SET voided_at = now() WHERE id = p;
    RAISE EXCEPTION 'a void without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Money history is kept.
  BEGIN
    DELETE FROM public.amc_payments WHERE id = p;
    RAISE EXCEPTION 'a payment was deleted';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_cheques WHERE id = ch;
    RAISE EXCEPTION 'a cheque was deleted';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_contracts WHERE id = c;
    RAISE EXCEPTION 'a contract with a schedule was deleted';
  EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN NULL;
  END;

  -- The send log takes Email 4.
  INSERT INTO public.amc_send_log (submission_id, version_no, document, channel, recipients, outcome)
  VALUES (s, 1, 'instalment_reminder', 'email', '[]', 'no_recipient');

  -- Pending Initial Payment is a contract status the gate can hold.
  UPDATE public.amc_contracts SET status = 'pending_client_signature' WHERE id = c;
  UPDATE public.amc_contracts SET status = 'pending_initial_payment', signed_at = now(), signed_by_name = 'Sara' WHERE id = c;
END $$;
\echo 97l payments: all checks pass
