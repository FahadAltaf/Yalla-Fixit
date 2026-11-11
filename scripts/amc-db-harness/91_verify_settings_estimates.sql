\set ON_ERROR_STOP on
-- settings: branding readable by browser roles, token never, no writes.
SET ROLE anon;
DO $$
DECLARE n text;
BEGIN
  SELECT site_name INTO n FROM public.settings WHERE type = 'admin';
  IF n IS DISTINCT FROM 'Yalla Fix It' THEN RAISE EXCEPTION 'anon cannot read branding'; END IF;
  BEGIN
    PERFORM oauth_access_token FROM public.settings;
    RAISE EXCEPTION 'anon can read the Zoho token';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM org_timezone FROM public.settings;
    RAISE EXCEPTION 'anon can read org_timezone';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.settings;
    RAISE EXCEPTION 'anon can SELECT * (includes the token)';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.settings SET primary_color = '#000';
    RAISE EXCEPTION 'anon can update settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM oauth_access_token FROM public.settings;
    RAISE EXCEPTION 'authenticated can read the Zoho token';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.settings SET appearance_theme = 'dark';
    RAISE EXCEPTION 'authenticated can update settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- The service role (edge functions, refresher, API) keeps full use.
SET ROLE service_role;
DO $$
DECLARE t text;
BEGIN
  SELECT oauth_access_token INTO t FROM public.settings WHERE id = 1;
  IF t IS DISTINCT FROM 'SECRET-ZOHO-TOKEN' THEN RAISE EXCEPTION 'service role lost the token'; END IF;
  UPDATE public.settings SET oauth_access_token = 'REFRESHED', oauth_token_refreshed_at = now() WHERE id = 1;
  UPDATE public.settings SET appearance_theme = 'dark' WHERE type = 'admin';
END $$;
RESET ROLE;

-- estimate tables: browser roles locked out, service role works.
SET ROLE anon;
DO $$
BEGIN
  BEGIN PERFORM 1 FROM public.estimate_revisions; RAISE EXCEPTION 'anon reads estimate_revisions';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.estimate_service_items (quotation_id) VALUES ('x'); RAISE EXCEPTION 'anon writes estimate_service_items';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN DELETE FROM public.estimate_revisions; RAISE EXCEPTION 'authenticated deletes estimate_revisions';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
INSERT INTO public.estimate_revisions (root_quotation_number) VALUES ('r1');
INSERT INTO public.estimate_service_items (quotation_id) VALUES ('q1');
RESET ROLE;

SELECT 'SETTINGS AND ESTIMATE CHECKS PASSED' AS result;
