\set ON_ERROR_STOP on
SET ROLE anon;
DO $$
BEGIN
  BEGIN PERFORM token FROM public.password_resets; RAISE EXCEPTION 'anon reads reset tokens';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.password_resets (token) VALUES ('x'); RAISE EXCEPTION 'anon inserts reset tokens';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM token FROM public.password_resets; RAISE EXCEPTION 'authenticated reads reset tokens';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$
DECLARE t text;
BEGIN
  INSERT INTO public.password_resets (email, token, expires_at) VALUES ('u@test.local', 'NEW', now());
  SELECT token INTO t FROM public.password_resets WHERE token = 'NEW';
  IF t IS NULL THEN RAISE EXCEPTION 'service role cannot use password_resets'; END IF;
  UPDATE public.password_resets SET used_at = now() WHERE token = 'NEW';
END $$;
RESET ROLE;
SELECT 'PASSWORD RESET CHECKS PASSED' AS result;
