\set ON_ERROR_STOP on
-- Phase 2 (20261007120000): client profile, properties, assets, access rules,
-- scope and documents.

DO $$
DECLARE
  c uuid;
  p1 uuid;
  p2 uuid;
  a uuid;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_customer_contacts', 'amc_communication_log', 'amc_property_assets',
                           'amc_property_access_rules', 'amc_scope_items', 'amc_documents'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '% is granted to a browser role', t;
    END IF;
  END LOOP;

  INSERT INTO public.customers (name) VALUES ('Profile test client') RETURNING id INTO c;
  IF (SELECT lifecycle FROM public.customers WHERE id = c) <> 'client' THEN
    RAISE EXCEPTION 'a customer without a lifecycle is not a client';
  END IF;
  UPDATE public.customers SET lifecycle = 'prospect', customer_type = 'company', trn = '100123456700003' WHERE id = c;

  -- Property types and combined units.
  INSERT INTO public.customer_properties (customer_id, label, unit_type, property_category) VALUES (c, 'Restaurant A', 'restaurant', 'commercial') RETURNING id INTO p1;
  INSERT INTO public.customer_properties (customer_id, label, unit_type, parent_property_id, zones) VALUES (c, 'Kitchen unit', 'other', p1, ARRAY['Kitchen']) RETURNING id INTO p2;
  BEGIN
    UPDATE public.customer_properties SET parent_property_id = id WHERE id = p1;
    RAISE EXCEPTION 'a property became its own parent';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.customer_properties WHERE id = p1;
    RAISE EXCEPTION 'a parent with units was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Contacts: one active primary per client.
  INSERT INTO public.amc_customer_contacts (customer_id, role, name, phone) VALUES (c, 'primary', 'Sara', '0501234567');
  BEGIN
    INSERT INTO public.amc_customer_contacts (customer_id, role, name, phone) VALUES (c, 'primary', 'Omar', '0507654321');
    RAISE EXCEPTION 'two active primary contacts';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.amc_customer_contacts (customer_id, role, name, phone) VALUES (c, 'accounts', 'Omar', '0507654321');

  -- Assets: serial means one unit, unique per property; retiring needs a reason.
  INSERT INTO public.amc_property_assets (property_id, asset_type, trade, quantity) VALUES (p1, 'Split AC', 'ac', 4);
  INSERT INTO public.amc_property_assets (property_id, asset_type, trade, serial_no) VALUES (p1, 'Chiller', 'ac', 'SN-1') RETURNING id INTO a;
  BEGIN
    INSERT INTO public.amc_property_assets (property_id, asset_type, trade, serial_no) VALUES (p1, 'Chiller', 'ac', 'sn-1 ');
    RAISE EXCEPTION 'duplicate serial accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_property_assets (property_id, asset_type, trade, quantity, serial_no) VALUES (p1, 'Split AC', 'ac', 2, 'SN-2');
    RAISE EXCEPTION 'a serial on several units accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_property_assets SET status = 'retired' WHERE id = a;
    RAISE EXCEPTION 'retired without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_property_assets SET status = 'retired', retired_at = now(), retired_reason = 'Replaced' WHERE id = a;

  -- Access rules and scope bounds.
  BEGIN
    INSERT INTO public.amc_property_access_rules (property_id, access_type, permitted_from, permitted_to) VALUES (p1, 'community_gate_pass', '17:00', '08:00');
    RAISE EXCEPTION 'backwards hours accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.amc_property_access_rules (property_id, access_type, lead_time_days, permitted_days) VALUES (p1, 'building_permit', 3, ARRAY[1, 2, 3]);
  BEGIN
    INSERT INTO public.amc_scope_items (property_id, service_id, trade, preferred_months) VALUES (p1, 'ac-ppm', 'ac', ARRAY[13]);
    RAISE EXCEPTION 'month 13 accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.amc_scope_items (property_id, service_id, trade, quantity, frequency_per_year, preferred_months) VALUES (p1, 'ac-ppm', 'ac', 4, 4, ARRAY[1, 4, 7, 10]);

  -- Documents: one row per version.
  INSERT INTO public.amc_documents (level, entity_id, customer_id, category, title, version, storage_path, file_name, mime_type, size_bytes, sha256)
  VALUES ('customer', c, c, 'Trade licence', 'Licence', 1, 'documents/customer/' || c || '/d1.pdf', 'l.pdf', 'application/pdf', 10, 'x');
  BEGIN
    INSERT INTO public.amc_documents (level, entity_id, customer_id, category, title, version, storage_path, file_name, mime_type, size_bytes, sha256)
    VALUES ('customer', c, c, 'Trade licence', 'Licence', 1, 'documents/customer/' || c || '/d2.pdf', 'l.pdf', 'application/pdf', 10, 'x');
    RAISE EXCEPTION 'two documents with the same version';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Communication log rows survive with the client.
  INSERT INTO public.amc_communication_log (customer_id, channel, direction, summary) VALUES (c, 'call', 'outbound', 'Called about the renewal');
  BEGIN
    DELETE FROM public.customers WHERE id = c;
    RAISE EXCEPTION 'a client with history was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

DO $$
BEGIN
  IF (SELECT public FROM storage.buckets WHERE id = 'amc-documents') THEN
    RAISE EXCEPTION 'amc-documents became public';
  END IF;
END $$;
\echo 97f client profile: all checks pass
