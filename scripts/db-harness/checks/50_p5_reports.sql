-- 20261022100000_reports_foundation: saved filters and the access log.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Server-only.
SELECT harness.expect(
  NOT has_schema_privilege('anon', 'reports', 'USAGE') AND NOT has_schema_privilege('authenticated', 'reports', 'USAGE')
  AND has_schema_privilege('service_role', 'reports', 'USAGE'),
  'only the service role may use the reports schema');
SELECT harness.expect(
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'reports' AND grantee IN ('anon', 'authenticated')),
  'no anon/authenticated grants on reports tables');
SELECT harness.expect(
  has_table_privilege('service_role', 'reports.saved_filters', 'UPDATE')
  AND has_table_privilege('service_role', 'reports.access_log', 'INSERT')
  AND NOT has_table_privilege('service_role', 'reports.access_log', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'reports.access_log', 'DELETE'),
  'the server role edits filters and only appends to the log');

-- Saved filters.
INSERT INTO public.user_profile (id, email, role_id, full_name)
VALUES ('00000000-0000-0000-0000-000000000051', 'reports.user@test.local', '00000000-0000-0000-0000-0000000000a1', 'Reports User');
INSERT INTO reports.saved_filters (user_id, report_key, kind, filters)
VALUES ('00000000-0000-0000-0000-000000000051', 'quotations', 'last_used', '{"status":"sent"}');
SELECT harness.expect_error($q$INSERT INTO reports.saved_filters (user_id, report_key, kind, filters)
  VALUES ('00000000-0000-0000-0000-000000000051', 'quotations', 'last_used', '{}')$q$, '23505',
  'one last-used selection per person and report');
INSERT INTO reports.saved_filters (user_id, report_key, kind, filters)
VALUES ('00000000-0000-0000-0000-000000000051', 'exceptions', 'last_used', '{}');
SELECT harness.expect((SELECT count(*) = 2 FROM reports.saved_filters WHERE kind = 'last_used'),
  'a last-used selection per report');
INSERT INTO reports.saved_filters (user_id, report_key, kind, name, filters)
VALUES ('00000000-0000-0000-0000-000000000051', 'quotations', 'saved', 'Sent, over 20k', '{"status":"sent","band":"20k_50k"}');
SELECT harness.expect_error($q$INSERT INTO reports.saved_filters (user_id, report_key, kind, name, filters)
  VALUES ('00000000-0000-0000-0000-000000000051', 'quotations', 'saved', 'SENT, OVER 20K', '{}')$q$, '23505',
  'saved names are unique per report, whatever the case');
SELECT harness.expect_error($q$INSERT INTO reports.saved_filters (user_id, report_key, kind, filters)
  VALUES ('00000000-0000-0000-0000-000000000051', 'quotations', 'saved', '{}')$q$, '23514',
  'a saved selection needs a name');
SELECT harness.expect_error($q$INSERT INTO reports.saved_filters (user_id, report_key, kind, filters)
  VALUES ('00000000-0000-0000-0000-000000000051', 'quotations', 'last_used', '[]')$q$, '23514',
  'filters are an object');
SELECT harness.expect_error($q$INSERT INTO reports.saved_filters (user_id, report_key, kind, filters)
  VALUES ('00000000-0000-0000-0000-000000000051', 'Bad Key!', 'last_used', '{}')$q$, '23514',
  'report keys are plain identifiers');

-- Access log: append-only, and never blocks deleting a user.
INSERT INTO reports.access_log (report_key, action, user_id, user_label, filters, row_count)
VALUES ('quotations', 'view', '00000000-0000-0000-0000-000000000051', 'Reports User', '{}', 12);
INSERT INTO reports.access_log (report_key, action, user_id, user_label, filters, row_count, format)
VALUES ('quotations', 'export', '00000000-0000-0000-0000-000000000051', 'Reports User', '{}', 12, 'xlsx');
SELECT harness.expect_error($q$UPDATE reports.access_log SET row_count = 0$q$, 'P0001', 'the access log refuses UPDATE');
SELECT harness.expect_error($q$DELETE FROM reports.access_log$q$, 'P0001', 'the access log refuses DELETE');
SELECT harness.expect_error($q$TRUNCATE reports.access_log$q$, 'P0001', 'the access log refuses TRUNCATE');
SELECT harness.expect_error($q$INSERT INTO reports.access_log (report_key, action) VALUES ('quotations', 'print')$q$, '23514',
  'only view and export are logged');
DELETE FROM public.user_profile WHERE id = '00000000-0000-0000-0000-000000000051';
SELECT harness.expect(
  (SELECT count(*) = 0 FROM reports.saved_filters WHERE user_id = '00000000-0000-0000-0000-000000000051')
  AND (SELECT count(*) = 2 FROM reports.access_log WHERE user_label = 'Reports User'),
  'deleting a user removes their filters and keeps the log');
