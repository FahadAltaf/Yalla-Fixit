\set ON_ERROR_STOP on
-- Runs after the hardening migrations (applied twice). Every check raises
-- on failure, so a clean exit means all passed.

-- Fixtures: one owner, one approver role.
INSERT INTO public.roles (id, name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'amc_approver') ON CONFLICT DO NOTHING;
INSERT INTO public.user_profile (id, email, role_id) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@test.local', NULL),
  ('00000000-0000-0000-0000-000000000002', 'approver@test.local', '00000000-0000-0000-0000-0000000000a1')
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_access (role_id, resource, action) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'amc', 'approve') ON CONFLICT DO NOTHING;

-- 1. Policies left on amc_submissions: the two read policies only.
DO $$
DECLARE names text;
BEGIN
  SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) INTO names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'amc_submissions';
  IF names IS DISTINCT FROM 'amc_submissions approver read:SELECT,amc_submissions owner read:SELECT' THEN
    RAISE EXCEPTION 'unexpected amc_submissions policies: %', names;
  END IF;
END $$;

-- 2. Grants: authenticated may only SELECT; anon nothing; settings/audit nothing.
DO $$
DECLARE g text;
BEGIN
  SELECT string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' ORDER BY 1)
    INTO g
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name LIKE 'amc%'
     AND grantee IN ('anon', 'authenticated');
  IF g IS DISTINCT FROM 'amc_submissions:authenticated:SELECT' THEN
    RAISE EXCEPTION 'unexpected AMC grants to browser roles: %', g;
  END IF;
END $$;

-- 3. The service role (the API) can still insert, and numbers are issued.
SET ROLE service_role;
INSERT INTO public.amc_submissions (owner_id) VALUES ('00000000-0000-0000-0000-000000000001');
RESET ROLE;

-- 4. Proposal numbers across 9999 -> 10001 (sequence moved locally only).
SELECT setval('public.amc_proposal_number_seq', 9997, true);
SET ROLE service_role;
INSERT INTO public.amc_submissions (owner_id)
SELECT '00000000-0000-0000-0000-000000000001' FROM generate_series(1, 4);
RESET ROLE;
DO $$
DECLARE got text; yr text := to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY');
BEGIN
  SELECT string_agg(proposal_number, ',' ORDER BY proposal_number) INTO got
    FROM public.amc_submissions
   WHERE proposal_number LIKE 'AMC-%-99%' OR proposal_number LIKE 'AMC-%-1000_';
  IF got IS DISTINCT FROM format('AMC-%1$s-10000,AMC-%1$s-10001,AMC-%1$s-9998,AMC-%1$s-9999', yr) THEN
    RAISE EXCEPTION 'unexpected proposal numbers: %', got;
  END IF;
END $$;

-- 5. A signed-in owner cannot write their own row directly any more.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
DO $$
BEGIN
  BEGIN
    UPDATE public.amc_submissions SET status = 'approved'
     WHERE owner_id = '00000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'owner UPDATE was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_submissions (owner_id, status)
    VALUES ('00000000-0000-0000-0000-000000000001', 'signed');
    RAISE EXCEPTION 'owner INSERT was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_submissions;
    RAISE EXCEPTION 'owner DELETE was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.amc_next_proposal_number();
    RAISE EXCEPTION 'authenticated could draw a proposal number';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM nextval('public.amc_proposal_number_seq');
    RAISE EXCEPTION 'authenticated could advance the sequence';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
-- Reads still work for the owner (RLS backstop kept).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.amc_submissions;
  IF n < 1 THEN RAISE EXCEPTION 'owner can no longer read own rows'; END IF;
END $$;
RESET ROLE;

-- 6. An approver cannot approve directly either.
UPDATE public.amc_submissions SET status = 'awaiting_approval'
 WHERE proposal_number LIKE 'AMC-%-9998';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
DO $$
BEGIN
  BEGIN
    UPDATE public.amc_submissions SET status = 'approved' WHERE status = 'awaiting_approval';
    RAISE EXCEPTION 'approver UPDATE was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 7. Settings and audit stay closed to browser roles.
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.amc_settings;
    RAISE EXCEPTION 'anon can read amc_settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 8. schedule_audit_events: browser roles locked out, service role writes.
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.schedule_audit_events (action) VALUES ('forged');
    RAISE EXCEPTION 'anon can write schedule_audit_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.schedule_audit_events;
    RAISE EXCEPTION 'authenticated can read schedule_audit_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE service_role;
INSERT INTO public.schedule_audit_events (action) VALUES ('ok');
RESET ROLE;

SELECT 'ALL HARDENING CHECKS PASSED' AS result;
