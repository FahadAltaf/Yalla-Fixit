-- The post-check queries shipped in docs/finance-reporting/migrations/*.md,
-- run here before any check data is written, so the values the user is
-- told to expect are the values a correct apply produces.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- 20261020100000: expect 1, t, 0, 2, 5
SELECT harness.expect(row(settings_rows, rls_on, api_grants, audit_triggers, notification_indexes)
                      = row(1::bigint, true, 0::bigint, 2::bigint, 5::bigint),
                      '20261020100000 post-check returns 1, t, 0, 2, 5')
FROM (
select
  (select count(*) from public.reporting_settings)                                   as settings_rows,
  (select bool_and(relrowsecurity) from pg_class
     where oid in ('public.reporting_settings'::regclass,
                   'public.reporting_audit_events'::regclass,
                   'public.portal_notifications'::regclass))                          as rls_on,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated')
       and table_name in ('reporting_settings', 'reporting_audit_events',
                          'portal_notifications'))                                   as api_grants,
  (select count(*) from pg_trigger
     where tgrelid = 'public.reporting_audit_events'::regclass and not tgisinternal) as audit_triggers,
  (select count(*) from pg_indexes
     where schemaname = 'public' and tablename = 'portal_notifications'
       and indexname like 'idx_portal_notifications_%')                              as notification_indexes
) post;

-- 20261020110000: expect 6, 1, 1, t, 0, 0, 0
SELECT harness.expect(row(technician_cols, user_cols, leave_cols, holidays_exists, changed_technicians, hidden_users, holiday_api_grants)
                      = row(6::bigint, 1::bigint, 1::bigint, true, 0::bigint, 0::bigint, 0::bigint),
                      '20261020110000 post-check returns 6, 1, 1, t, 0, 0, 0')
FROM (
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'technician_reference'
       and column_name in ('user_profile_id', 'email', 'employment_status', 'leaving_date',
                           'hidden_from_lists', 'rest_weekdays'))                   as technician_cols,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'user_profile'
       and column_name = 'hidden_from_lists')                                       as user_cols,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'leave_records'
       and column_name = 'leave_category')                                          as leave_cols,
  to_regclass('public.org_public_holidays') is not null                             as holidays_exists,
  (select count(*) from public.technician_reference
     where employment_status <> 'active' or hidden_from_lists)                      as changed_technicians,
  (select count(*) from public.user_profile where hidden_from_lists)                as hidden_users,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'org_public_holidays'
       and grantee in ('anon', 'authenticated'))                                    as holiday_api_grants
) post;

-- 20261020130000: expect 9, 3, 7, 0, 0, f, t
SELECT harness.expect(row(fsm_tables, sync_resources, fsm_functions, api_table_grants, api_executable,
                          api_schema_usage, server_schema_usage)
                      = row(9::bigint, 3::bigint, 7::bigint, 0::bigint, 0::bigint, false, true),
                      '20261020130000 post-check returns 9, 3, 7, 0, 0, f, t')
FROM (
select
  (select count(*) from pg_class
     where relnamespace = 'fsm'::regnamespace and relkind = 'r')                       as fsm_tables,
  (select count(*) from fsm.sync_state)                                             as sync_resources,
  (select count(*) from pg_proc where pronamespace = 'fsm'::regnamespace)           as fsm_functions,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'fsm' and grantee in ('anon', 'authenticated'))           as api_table_grants,
  (select count(*) from pg_proc p
     where p.pronamespace = 'fsm'::regnamespace
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE')))          as api_executable,
  has_schema_privilege('anon', 'fsm', 'USAGE')
    or has_schema_privilege('authenticated', 'fsm', 'USAGE')                        as api_schema_usage,
  has_schema_privilege('service_role', 'fsm', 'USAGE')                              as server_schema_usage
) post;

-- 20261021100000 (+ 20261021110000's view): expect 5, 2, 6, 0, f, t, f
SELECT harness.expect(row(tables, views, functions, api_table_grants, api_schema_usage, server_schema_usage, server_can_write_directly)
                      = row(5::bigint, 2::bigint, 6::bigint, 0::bigint, false, true, false),
                      '20261021100000 post-check returns 5, 2, 6, 0, f, t, f once the list view exists')
FROM (
select
  (select count(*) from pg_class where relnamespace = 'finance'::regnamespace and relkind = 'r')   as tables,
  (select count(*) from pg_class where relnamespace = 'finance'::regnamespace and relkind = 'v')   as views,
  (select count(*) from pg_proc where pronamespace = 'finance'::regnamespace)                      as functions,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'finance' and grantee in ('anon', 'authenticated'))                     as api_table_grants,
  has_schema_privilege('anon', 'finance', 'USAGE')
    or has_schema_privilege('authenticated', 'finance', 'USAGE')                                  as api_schema_usage,
  has_schema_privilege('service_role', 'finance', 'USAGE')                                        as server_schema_usage,
  has_table_privilege('service_role', 'finance.invoices', 'INSERT')                               as server_can_write_directly
) post;
