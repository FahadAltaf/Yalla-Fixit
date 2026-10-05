-- =====================================================================
-- settings: the Zoho FSM OAuth token is server-only
--
-- NOT APPLIED. Created on branch amc-hardening (5 Oct 2026). URGENT, but
-- apply only AFTER the code from the same branch is deployed (see "Order"
-- below), as part of docs/amc-hardening-production-runbook.md.
--
-- Why
-- ---
-- public.settings holds oauth_access_token, the Zoho FSM OAuth token the
-- portal and its edge functions use to call FSM as the company. The table
-- had one policy, "Allow All on Settings" (FOR ALL TO public USING true),
-- and anon/authenticated held SELECT, INSERT, UPDATE and DELETE. The anon
-- key is public (it ships in the inspector app), so anyone could read the
-- live token -- and the portal itself fetched it into every visitor's
-- browser through /api/graphql and cached it in localStorage. Anyone could
-- also rewrite the branding, timezone and shift times.
--
-- Who still needs what (checked 5 Oct 2026):
--   * Browsers, before and after sign-in (theme, colours, logo, site name):
--     SELECT on the branding columns, through /api/graphql as anon.
--   * Writes from the browser: none. Appearance is saved through
--     /api/settings/appearance (service role, signed-in users).
--   * The token: read only by server code with the service role
--     (lib/server/zoho/fsm-client.ts and the routes that use it) and by the
--     edge functions get-estimate, zoho-fsm-estimate-transitions,
--     zoho-fsm-work-orders, zoho-fsm-appointments, token-refresher and
--     refresh-token -- all of which create their client with
--     SUPABASE_SERVICE_ROLE_KEY (read from production, 5 Oct 2026).
--   * Timezone and shift times: service role only (scheduling routes).
--   The service role bypasses RLS and keeps its grants: nothing it does
--   changes here, including the 15-minute zoho-token-refresh cron.
--
-- What this does
-- --------------
--   * Drops "Allow All on Settings".
--   * Revokes everything on settings from anon and authenticated.
--   * Grants SELECT on the branding columns only, to anon and
--     authenticated, with a read-only policy. oauth_access_token,
--     oauth_token_refreshed_at, org_timezone and the shift columns are not
--     readable by either.
--
-- Order (important)
-- -----------------
-- Deploy the code first. The previous portal build's GraphQL query asks for
-- oauth_access_token; once this column is not granted, pg_graphql rejects
-- that whole query and the old build falls back to default branding. The
-- new build does not ask for it. Rotate the Zoho credentials after this is
-- applied (the token has been readable; see the runbook).
--
-- Rollback (restores the previous, open access exactly)
-- ------------------------------------------------------
--   DROP POLICY IF EXISTS "settings public read" ON public.settings;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO anon, authenticated;
--   CREATE POLICY "Allow All on Settings" ON public.settings
--     FOR ALL TO public USING (true) WITH CHECK (true);
-- =====================================================================

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on Settings" ON public.settings;

REVOKE ALL ON public.settings FROM anon, authenticated;

GRANT SELECT (
  id,
  type,
  site_name,
  site_image,
  site_description,
  meta_keywords,
  contact_email,
  social_links,
  appearance_theme,
  primary_color,
  secondary_color,
  logo_url,
  logo_horizontal_url,
  logo_setting,
  favicon_url,
  created_at,
  updated_at
) ON public.settings TO anon, authenticated;

DROP POLICY IF EXISTS "settings public read" ON public.settings;
CREATE POLICY "settings public read" ON public.settings
  FOR SELECT TO anon, authenticated
  USING (true);

-- ---------------------------------------------------------------------
-- Verification (read-only; run by hand after applying)
-- ---------------------------------------------------------------------
-- SELECT grantee, privilege_type, column_name
--   FROM information_schema.column_privileges
--  WHERE table_schema = 'public' AND table_name = 'settings'
--    AND grantee IN ('anon', 'authenticated')
--  ORDER BY grantee, column_name;
--   -- expect SELECT only, and no oauth_access_token / oauth_token_refreshed_at
--   -- / org_timezone / *_shift_* rows
--
-- From outside (must fail or omit the field):
--   curl "https://<ref>.supabase.co/rest/v1/settings?select=oauth_access_token" \
--     -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"
