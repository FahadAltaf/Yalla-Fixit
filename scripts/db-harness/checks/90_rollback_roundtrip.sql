-- The shipped rollbacks undo their migration completely, and the migration
-- applies cleanly again afterwards. Runs last: it drops what the checks used.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
SET client_min_messages = warning;

\ir ../../../docs/finance-reporting/migrations/20261021110000_rollback.sql
\ir ../../../docs/finance-reporting/migrations/20261021100000_rollback.sql
\ir ../../../docs/finance-reporting/migrations/20261020130000_rollback.sql
\ir ../../../docs/finance-reporting/migrations/20261020110000_rollback.sql
\ir ../../../docs/finance-reporting/migrations/20261020100000_rollback.sql

SET client_min_messages = notice;
SELECT harness.expect(
  to_regclass('public.reporting_settings') IS NULL AND to_regclass('public.reporting_audit_events') IS NULL
  AND to_regclass('public.portal_notifications') IS NULL AND to_regclass('public.org_public_holidays') IS NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND ((table_name = 'technician_reference' AND column_name IN
                           ('user_profile_id', 'email', 'employment_status', 'leaving_date', 'hidden_from_lists', 'rest_weekdays'))
                      OR (table_name = 'user_profile' AND column_name = 'hidden_from_lists')
                      OR (table_name = 'leave_records' AND column_name = 'leave_category')))
  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reporting_audit_events_append_only')
  AND to_regnamespace('fsm') IS NULL AND to_regnamespace('finance') IS NULL,
  'rollbacks remove every object');
SELECT harness.expect((SELECT count(*) = 3 FROM public.technician_reference), 'rollback keeps the technicians');

SET client_min_messages = warning;
\ir ../../../supabase/migrations/20261020100000_reporting_platform.sql
\ir ../../../supabase/migrations/20261020110000_people_reporting_fields.sql
\ir ../../../supabase/migrations/20261020130000_fsm_read_model.sql
\ir ../../../supabase/migrations/20261021100000_finance_core.sql
\ir ../../../supabase/migrations/20261021110000_finance_queue_list.sql
\ir ../../../supabase/migrations/20261021120000_finance_hold_query_fix.sql
SET client_min_messages = notice;
SELECT harness.expect(to_regclass('public.portal_notifications') IS NOT NULL
  AND (SELECT count(*) = 1 FROM public.reporting_settings)
  AND (SELECT count(*) = 3 FROM fsm.sync_state)
  AND to_regclass('finance.queue_items') IS NOT NULL, 'migrations re-apply after rollback');
