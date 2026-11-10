-- =====================================================================
-- Close what the public anon key can still read and write (3 Nov 2026)
--
-- Sami's report (2 Nov): permissions could be read and changed without
-- signing in. The /api/role-access route checks the caller since 07a3e12,
-- and /api/graphql forwards only its allowlist since this change, but the
-- anon key itself ships in the inspector app (EXPO_PUBLIC_SUPABASE_ANON_KEY),
-- so anyone holding it can call the database directly.
--
-- Production, read-only with the anon key on 3 Nov 2026:
--   readable  roles 5, role_access 99, user_profile 19,
--             schedule_audit_events 1234, todos 4 rows
--   pg_graphql offers the anon role insert/update/delete on roles,
--             role_access, user_profile, password_resets, todos,
--             todo_attachments, todo_comment_mentions, schedule_audit_events
-- So 20261005150000 (audit log) and 20261006161000 (todos) are not in
-- effect there, and 20261006160000 (role tables) was held. This file is
-- their table parts again, plus password_resets and the todo child tables,
-- idempotent, so it is safe however much of them already ran. Storage
-- policies of 20261006161000 are left to that file.
--
-- LIVE-SAFE ONLY ONCE THE LIVE PORTAL RUNS main AT 07a3e12 OR LATER: older
-- code wrote users, roles and permissions from the browser with the anon
-- key, and those screens would stop saving. Every reader and writer in the
-- current code uses the service role (lib/server/user-access.ts,
-- app/api/users, app/api/roles, app/api/role-access, modules/auth/
-- auth-actions.ts, app/api/todos*, app/api/scheduling/audit); the service
-- role is not affected by REVOKE. The mobile app reads none of these
-- tables (it subscribes to snagging_notifications only).
--
-- After this file:
--   roles, role_access, user_profile  anon nothing; signed-in users read only
--   schedule_audit_events, todos, todo_attachments, todo_comment_mentions,
--   password_resets                    no browser role at all
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Roles, permission rows and user profiles (as 20261006160000)
-- ---------------------------------------------------------------------
ALTER TABLE public.role_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

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
-- 2. Server-only tables: no browser role at all
--    (audit log as 20261005150000, todos as 20261006161000; reset tokens
--    and the todo child tables are only ever used with the service role)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow All on schedule_audit_events" ON public.schedule_audit_events;
DROP POLICY IF EXISTS "Allow All on todos" ON public.todos;

ALTER TABLE public.schedule_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_comment_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.schedule_audit_events, public.todos, public.todo_attachments,
  public.todo_comment_mentions, public.password_resets FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Pre-check (read-only): what the browser roles hold today
-- ---------------------------------------------------------------------
--   select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee in ('anon', 'authenticated')
--      and table_name in ('roles','role_access','user_profile','schedule_audit_events','todos',
--                         'todo_attachments','todo_comment_mentions','password_resets')
--    group by 1, 2 order by 1, 2;
--   -- expect anon rows today (that is the hole)
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname = 'public'
--      and tablename in ('roles','role_access','user_profile','schedule_audit_events','todos',
--                        'todo_attachments','todo_comment_mentions','password_resets')
--    order by 1, 2;
--   -- note any open policy not dropped above; with no grant it no longer matters
--
-- ---------------------------------------------------------------------
-- Post-check (read-only)
-- ---------------------------------------------------------------------
--   the grants query above: expect exactly three rows,
--     role_access | authenticated | SELECT
--     roles       | authenticated | SELECT
--     user_profile| authenticated | SELECT
--   and no anon row.
--
-- ---------------------------------------------------------------------
-- Rollback (reopens the hole; only if a screen stops working)
-- ---------------------------------------------------------------------
--   GRANT ALL ON public.roles, public.role_access, public.user_profile TO anon, authenticated;
--   CREATE POLICY "Allow All on Roles" ON public.roles FOR ALL TO public USING (true) WITH CHECK (true);
--   CREATE POLICY "Allow All on User Profile" ON public.user_profile FOR ALL TO public USING (true) WITH CHECK (true);
--   ALTER TABLE public.role_access DISABLE ROW LEVEL SECURITY;
--   GRANT ALL ON public.schedule_audit_events, public.todos TO anon, authenticated;
--   (the reset-token and todo child tables need no browser access to roll back)
