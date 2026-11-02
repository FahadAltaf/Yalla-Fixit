-- =====================================================================
-- Users, roles and permission rows: server-only writes
--
-- NOT APPLIED. Branch amc-hardening (security phase, 6 Oct 2026).
-- REQUIRES NEW CODE FIRST: the live main application writes these tables
-- from the browser through pg_graphql with the anon key (Users, Roles and
-- Permissions screens, profile settings, the auth callback). Deploy the
-- amc-hardening code (which uses /api/users, /api/roles, /api/role-access
-- with the service role after a permission check), then apply this.
--
-- Production state read on 6 Oct 2026 (read-only):
--   roles         RLS on,  policy "Allow All on Roles"         FOR ALL TO public USING (true)
--   user_profile  RLS on,  policy "Allow All on User Profile"  FOR ALL TO public USING (true)
--   role_access   RLS OFF, full grants to anon and authenticated
-- So anyone holding the public anon key (it ships in every page) could
-- insert a role_access row, or set their own user_profile.role_id to the
-- admin role: every permission in the portal, AMC approval included,
-- rests on these three tables.
--
-- After this migration:
--   anon           nothing on the three tables
--   authenticated  SELECT only (a signed-in colleague's name and role;
--                  the AMC submission policies read them too)
--   service_role   everything (the API, after its own checks)
-- =====================================================================

-- role_access had RLS switched off.
ALTER TABLE public.role_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

-- Every open policy, by the names in production and in the base schema.
DROP POLICY IF EXISTS "Allow All on Roles" ON public.roles;
DROP POLICY IF EXISTS "Allow All on User Profile" ON public.user_profile;
DROP POLICY IF EXISTS "Allow All on Role Access" ON public.role_access;
DROP POLICY IF EXISTS "Allow All on role_access" ON public.role_access;

REVOKE ALL ON public.roles, public.role_access, public.user_profile FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.roles, public.role_access, public.user_profile FROM authenticated;
GRANT SELECT ON public.roles, public.role_access, public.user_profile TO authenticated;

DROP POLICY IF EXISTS "roles authenticated read" ON public.roles;
CREATE POLICY "roles authenticated read" ON public.roles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "role_access authenticated read" ON public.role_access;
CREATE POLICY "role_access authenticated read" ON public.role_access FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "user_profile authenticated read" ON public.user_profile;
CREATE POLICY "user_profile authenticated read" ON public.user_profile FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------
-- Verification (read-only)
-- ---------------------------------------------------------------------
--   select tablename, policyname, cmd, roles from pg_policies
--    where tablename in ('roles','role_access','user_profile');
--   -- expect only the three "authenticated read" SELECT policies
--   select table_name, grantee, string_agg(privilege_type, ',') from information_schema.role_table_grants
--    where table_name in ('roles','role_access','user_profile') and grantee in ('anon','authenticated')
--    group by 1, 2;
--   -- expect authenticated SELECT only; no anon row
--
-- ---------------------------------------------------------------------
-- Rollback (restores the previous, open access exactly)
-- ---------------------------------------------------------------------
--   DROP POLICY IF EXISTS "roles authenticated read" ON public.roles;
--   DROP POLICY IF EXISTS "role_access authenticated read" ON public.role_access;
--   DROP POLICY IF EXISTS "user_profile authenticated read" ON public.user_profile;
--   GRANT ALL ON public.roles, public.role_access, public.user_profile TO anon, authenticated;
--   CREATE POLICY "Allow All on Roles" ON public.roles FOR ALL TO public USING (true) WITH CHECK (true);
--   CREATE POLICY "Allow All on User Profile" ON public.user_profile FOR ALL TO public USING (true) WITH CHECK (true);
--   ALTER TABLE public.role_access DISABLE ROW LEVEL SECURITY;
