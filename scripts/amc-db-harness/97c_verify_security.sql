\set ON_ERROR_STOP on
-- Security phase (20261006160000..162000): role tables, todos, uploads,
-- and AMC history surviving user deletion.

-- 1. Role tables: anon has nothing; authenticated may read, never write.
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.user_profile LIMIT 1;
    RAISE EXCEPTION 'anon can read user_profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.role_access (role_id, resource, action) SELECT id, 'amc', 'approve' FROM public.roles LIMIT 1;
    RAISE EXCEPTION 'anon can write role_access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.roles (name) VALUES ('anon-made');
    RAISE EXCEPTION 'anon can create roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.user_profile SET role_id = role_id;
    RAISE EXCEPTION 'anon can update user_profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.user_profile;
  IF n = 0 THEN RAISE EXCEPTION 'authenticated cannot read user_profile'; END IF;
  PERFORM 1 FROM public.roles LIMIT 1;
  PERFORM 1 FROM public.role_access LIMIT 1;
  BEGIN
    UPDATE public.user_profile SET role_id = (SELECT id FROM public.roles LIMIT 1)
     WHERE id = '00000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'a signed-in user can change their own role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.role_access (role_id, resource, action) SELECT id, 'amc', 'approve' FROM public.roles LIMIT 1;
    RAISE EXCEPTION 'a signed-in user can grant permissions';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.roles;
    RAISE EXCEPTION 'a signed-in user can delete roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.role_access'::regclass) THEN
    RAISE EXCEPTION 'role_access RLS is off';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('roles', 'role_access', 'user_profile', 'todos')
              AND (cmd <> 'SELECT' OR 'public' = ANY (roles) OR 'anon' = ANY (roles))) THEN
    RAISE EXCEPTION 'an open policy remains on a role table or todos';
  END IF;
END $$;

-- 2. Todos: server-only.
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.todos LIMIT 1;
    RAISE EXCEPTION 'authenticated can read todos directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 3. uploads: signed-in users upload their own; anonymous uploads refused.
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('uploads', 'public/anon.html');
    RAISE EXCEPTION 'anonymous upload accepted';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('uploads', 'public/mine.png', '00000000-0000-0000-0000-000000000001');
DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('amc-documents', 'signed-contracts/x.pdf', '00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'a signed-in user can write the private AMC bucket';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

-- 4. A user who owns AMC proposals cannot be deleted (and the proposals survive).
INSERT INTO public.user_profile (id, email) VALUES ('97c00000-0000-0000-0000-000000000001', 'leaver@test.local');
INSERT INTO public.amc_submissions (owner_id) VALUES ('97c00000-0000-0000-0000-000000000001');
DO $$
BEGIN
  BEGIN
    DELETE FROM public.user_profile WHERE id = '97c00000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'deleting a proposal owner was allowed';
  /* RESTRICT (23503), or main's amc_audit_events no-update rule cancelling
     the actor SET NULL first (an internal RI error): either way the delete
     is refused and nothing is lost. */
  EXCEPTION WHEN foreign_key_violation OR internal_error THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.amc_submissions WHERE owner_id = '97c00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'the proposal was lost';
  END IF;
  IF (SELECT confdeltype FROM pg_constraint WHERE conname = 'amc_submissions_owner_id_fkey') <> 'r' THEN
    RAISE EXCEPTION 'owner FK is not RESTRICT';
  END IF;
END $$;
\echo 97c security: all checks pass
