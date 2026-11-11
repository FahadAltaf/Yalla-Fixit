\set ON_ERROR_STOP on
-- 20261007170000: AMC uses Snagging's clients and addresses.

DO $$
DECLARE
  leftover text;
  t text;
BEGIN
  -- No foreign key anywhere still points at the retired AMC tables.
  SELECT string_agg(format('%s.%s', conrelid::regclass, conname), ', ') INTO leftover
    FROM pg_constraint
   WHERE contype = 'f'
     AND confrelid IN (to_regclass('public.customers'), to_regclass('public.customer_properties'))
     AND conrelid NOT IN (to_regclass('public.customers'), to_regclass('public.customer_properties'));
  IF leftover IS NOT NULL THEN RAISE EXCEPTION 'still pointing at the old AMC tables: %', leftover; END IF;

  -- Each AMC reference now lands on the Snagging record.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amc_enquiries_customer_id_fkey'
                  AND confrelid = 'public.snagging_clients'::regclass) THEN
    RAISE EXCEPTION 'enquiries do not reference snagging_clients';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amc_property_assets_property_id_fkey'
                  AND confrelid = 'public.snagging_properties'::regclass) THEN
    RAISE EXCEPTION 'assets do not reference snagging_properties';
  END IF;

  -- Snagging's own tables were not touched: no AMC constraint was added to them.
  FOREACH t IN ARRAY ARRAY['snagging_clients', 'snagging_properties'] LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname LIKE 'amc%') THEN
      RAISE EXCEPTION 'an AMC constraint was added to %', t;
    END IF;
  END LOOP;

  -- The side tables and directories are server-only.
  FOREACH t IN ARRAY ARRAY['amc_client_profiles', 'amc_property_profiles', 'amc_client_directory', 'amc_property_directory'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '% is granted to a browser role', t;
    END IF;
  END LOOP;
END $$;

-- A client in use by AMC cannot be deleted from under its profile.
DO $$
DECLARE c uuid;
BEGIN
  INSERT INTO public.snagging_clients (name) VALUES ('Shared client test') RETURNING id INTO c;
  INSERT INTO public.amc_client_profiles (client_id, lifecycle) VALUES (c, 'prospect');
  BEGIN
    DELETE FROM public.snagging_clients WHERE id = c;
    RAISE EXCEPTION 'a client with an AMC profile was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF (SELECT lifecycle FROM public.amc_client_directory WHERE id = c) <> 'prospect' THEN
    RAISE EXCEPTION 'the directory does not read the profile';
  END IF;
END $$;
\echo 97k shared clients: all checks pass
