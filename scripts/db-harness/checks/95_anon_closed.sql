-- 20261105100000_close_anon_table_access: the anon key reaches none of the
-- role, audit, to-do or reset-token tables; signed-in users only read roles.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT harness.expect(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee = 'anon'
      AND table_name IN ('roles', 'role_access', 'user_profile', 'schedule_audit_events', 'todos',
                         'todo_attachments', 'todo_comment_mentions', 'password_resets')),
  'anon holds nothing on the closed tables');
SELECT harness.expect(
  (SELECT string_agg(table_name || ':' || privilege_type, ',' ORDER BY table_name)
     FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee = 'authenticated'
      AND table_name IN ('roles', 'role_access', 'user_profile', 'schedule_audit_events', 'todos',
                         'todo_attachments', 'todo_comment_mentions', 'password_resets'))
  = 'role_access:SELECT,roles:SELECT,user_profile:SELECT',
  'signed-in users only read roles, permission rows and profiles');
SELECT harness.expect(
  (SELECT bool_and(relrowsecurity) FROM pg_class
    WHERE oid IN ('public.roles'::regclass, 'public.role_access'::regclass, 'public.user_profile'::regclass,
                  'public.password_resets'::regclass, 'public.todos'::regclass)),
  'RLS on the role, reset-token and to-do tables');
SELECT harness.expect(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'Allow All on %'
                AND tablename IN ('roles', 'role_access', 'user_profile', 'schedule_audit_events', 'todos')),
  'no open "Allow All" policy left on them');

-- As the anon role: every write refused (42501, insufficient privilege).
SET ROLE anon;
SELECT harness.expect_error($q$INSERT INTO public.role_access (role_id, resource, action) VALUES ('00000000-0000-0000-0000-0000000000a1', 'users', 'view')$q$, '42501', 'anon cannot grant a permission');
SELECT harness.expect_error($q$UPDATE public.user_profile SET role_id = role_id$q$, '42501', 'anon cannot change a profile''s role');
SELECT harness.expect_error($q$INSERT INTO public.password_resets (user_id, token, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 'x', now() + interval '1 hour')$q$, '42501', 'anon cannot plant a reset token');
SELECT harness.expect_error($q$SELECT 1 FROM public.roles$q$, '42501', 'anon cannot read the roles');
RESET ROLE;
SET ROLE authenticated;
SELECT harness.expect((SELECT count(*) >= 1 FROM public.roles), 'a signed-in user still reads the roles');
SELECT harness.expect_error($q$INSERT INTO public.role_access (role_id, resource, action) VALUES ('00000000-0000-0000-0000-0000000000a1', 'users', 'view')$q$, '42501', 'a signed-in user cannot grant a permission either');
SELECT harness.expect_error($q$SELECT 1 FROM public.todos$q$, '42501', 'to-dos are server-only');
RESET ROLE;
