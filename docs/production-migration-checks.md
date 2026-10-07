# Production migration checks: Group A (live-safe)

For `docs/amc-brd-v0.3-implementation-plan.md` §3. All queries in sections 1 and 3 are **read-only**. Run them in the Supabase SQL editor of the **production** project (the one in the app's `.env`, `sxzp…`).
**Save the output of section 1 before applying anything:** it is also the record used for any rollback.

> The Supabase project this development environment can reach ("TPH Portal Staging", `sancq…`) is a different application, with no portal or AMC tables. It is **not** the target. Apply only to the project in the app's `.env`.

## 1. Pre-check (before file 1)

```sql
-- 1.1 Which AMC objects exist today
select
  to_regclass('public.amc_submissions')    is not null as has_amc_submissions,
  to_regclass('public.amc_settings')       is not null as has_amc_settings,
  to_regclass('public.amc_audit_events')   is not null as has_amc_audit_events,
  to_regclass('public.amc_proposal_number_seq') is not null as has_number_seq,
  to_regclass('public.amc_contracts')      is not null as has_amc_contracts,
  to_regclass('public.customers')          is not null as has_customers,
  to_regclass('public.customer_properties') is not null as has_customer_properties,
  to_regclass('public.amc_notifications')  is not null as has_amc_notifications;
```
Expected: the first four `true`, the last four `false`. **If `customers` or `customer_properties` already exist, stop and send me the output** (name clash).

```sql
-- 1.2 Columns the migrations will add to amc_submissions must not exist yet
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'amc_submissions'
   and column_name in ('renewal_of_contract_id','customer_id','property_id','assessment_id');
```
Expected: **no rows**.

```sql
-- 1.3 Constraints the migrations replace
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conname in ('amc_audit_events_entity_type_check', 'amc_submissions_owner_id_fkey')
    or (conrelid = 'public.todos'::regclass and contype = 'c');
```
Expected:
- `amc_audit_events_entity_type_check` allows `'submission', 'settings'`;
- `amc_submissions_owner_id_fkey` is `... ON DELETE CASCADE`;
- one CHECK on `todos` allowing `'work_order', 'quotation', 'appointment'`.

```sql
-- 1.4 Storage: buckets and the policies on storage.objects
select id, public from storage.buckets where id in ('uploads', 'amc-documents');
select policyname, cmd, roles, qual, with_check
  from pg_policies where schemaname = 'storage' and tablename = 'objects'
 order by policyname;
```
Expected:
- `uploads` exists with `public = true`; `amc-documents` does **not** exist.
- Among the policies: `Allow authenticated users to upload files` (INSERT) and `Allow users to update their own uploads` (UPDATE).

**If the uploads INSERT/UPDATE policies have other names, stop and send me the list**, so file 10 replaces the right ones.

```sql
-- 1.5 Policies and browser grants on the tables files 1, 3, 10 and 12 tighten
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename in ('amc_submissions','amc_settings','amc_audit_events','schedule_audit_events','todos',
                     'fsm_appointment_snapshots','leave_records','lookup_options','schedule_entries',
                     'schedule_entry_assignments','schedule_versions','technician_lookup_assignments',
                     'technician_reference','todo_assignees','todo_comments','todo_tags','todo_updates')
 order by tablename, policyname;

select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated')
   and table_name in ('amc_submissions','amc_settings','amc_audit_events','schedule_audit_events','todos',
                      'technician_reference','schedule_entries','lookup_options')
 group by table_name, grantee order by table_name, grantee;
```
Expected: "Allow All on …" policies on most of these tables, and full grants to `anon`/`authenticated`. These are exactly what Group A closes. Save the output.

```sql
-- 1.6 Data that the owner-FK change (file 11) relies on
select count(*) as proposals,
       count(*) filter (where owner_id is null) as without_owner
  from public.amc_submissions;
```
Any result is fine. This is for the record.

## 2. Apply Group A

One file at a time, in this order. Stop at the first error and send it to me.

| # | File | After it |
|---|---|---|
| 1 | `20261005100000_amc_close_direct_writes.sql` | — |
| 2 | `20261005110000_amc_proposal_number_beyond_9999.sql` | — |
| 3 | `20261005150000_restrict_shared_allow_all_policies.sql` | — |
| 4 | `20261006100000_active_amc_contracts.sql` | — |
| 5 | `20261006110000_active_amc_operations.sql` | — |
| 6 | `20261006120000_amc_fsm_integration.sql` | — |
| 7 | `20261006130000_amc_business_operations.sql` | — |
| 8 | `20261006140000_amc_atomic_activation_and_dashboard.sql` | — |
| 9 | `20261006150000_amc_business_completion.sql` | — |
| 10 | `20261006161000_todos_and_uploads_tightened.sql` | **Live check A** (below) |
| 11 | `20261006162000_amc_history_survives_user_deletion.sql` | — |
| 12 | `20261006163000_shared_tables_server_only.sql` | **Live check B** (below) |

Command (or paste the whole file into the SQL editor and run it):
```bash
psql "<PRODUCTION_DB_URL>" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/<file>
```

**Do not apply** `20261005160000`, `20261005170000`, `20261005180000` or `20261006160000` (Group B, held until release).
**Never run** `supabase db push` against production.

### Live check A (after file 10), in the live portal (`main`), signed in as a normal user
1. Profile settings → change the profile photo → it saves and shows.
2. Open Todos → the list loads; create a to-do and tick it done.
3. An admin changes the organisation logo → it saves and shows.

If any fails, run **Rollback A** at once and send me the error.

### Live check B (after file 12), in the live portal (`main`)
1. Scheduling → open today's board → entries and technicians show; drag one entry and undo.
2. Scheduling → technicians list and leave records load.
3. Open a to-do with comments and assignees.

If any fails, run **Rollback B** at once and send me the error.

## 3. Post-check (after file 12)

```sql
-- 3.1 The 18 new AMC tables exist, all with RLS on
select c.relname, c.relrowsecurity as rls_on
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and c.relname in ('amc_contracts','amc_contract_entitlements','amc_entitlement_usage','amc_renewal_reminders',
                     'amc_fsm_service_mappings','amc_fsm_links','amc_fsm_sync_events','customers','customer_properties',
                     'amc_assessment_checklist','amc_assessments','amc_assessment_items','amc_additional_service_discount',
                     'amc_additional_quotes','amc_notifications','amc_notification_settings','amc_signed_documents',
                     'amc_assessment_photos')
 order by c.relname;
```
Expected: **18 rows, every `rls_on = true`**.

```sql
-- 3.2 Nothing granted to the browser roles on AMC tables or the tightened shared tables
select table_name, grantee, string_agg(privilege_type, ',') as privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated')
   and (table_name like 'amc\_%' or table_name in ('customers','customer_properties','todos','schedule_audit_events',
        'fsm_appointment_snapshots','leave_records','lookup_options','schedule_entries','schedule_entry_assignments',
        'schedule_versions','technician_lookup_assignments','technician_reference','todo_assignees','todo_comments',
        'todo_tags','todo_updates'))
 group by table_name, grantee order by table_name, grantee;
```
Expected: one of two shapes.
- **Exactly one row:** `technician_reference | authenticated | SELECT`.
- **Also a row for `amc_submissions | authenticated | SELECT`,** if production granted it before. Live `main` reads proposals through the server, so either is fine.

```sql
-- 3.3 Open policies gone; technician read policy present
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and (policyname ilike 'Allow All%' or tablename = 'technician_reference')
   and tablename in ('amc_submissions','amc_settings','amc_audit_events','schedule_audit_events','todos',
                     'fsm_appointment_snapshots','leave_records','lookup_options','schedule_entries',
                     'schedule_entry_assignments','schedule_versions','technician_lookup_assignments',
                     'technician_reference','todo_assignees','todo_comments','todo_tags','todo_updates');
```
Expected: only `technician_reference | technician_reference authenticated read | SELECT | {authenticated}`.

```sql
-- 3.4 Constraints, storage, functions
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname in ('amc_audit_events_entity_type_check','amc_submissions_owner_id_fkey','todos_related_type_check');
select id, public from storage.buckets where id in ('uploads','amc-documents');
select policyname, cmd, roles from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname in ('Allow authenticated users to upload files','Allow users to update their own uploads');
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_run
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('amc_activate_contract','amc_contracts_dashboard','amc_next_proposal_number',
       'amc_next_assessment_number','amc_next_additional_quote_number','amc_apply_entitlement_usage');
```
Expected:
- **Constraints:**
  - owner FK `ON DELETE RESTRICT`;
  - the audit types now include `contract`;
  - the to-do types include `amc_contract`.
- **Buckets:** `uploads` public = true; `amc-documents` public = **false**.
- **Upload policies:** both present, roles `{authenticated}`.
- **Functions:** all six listed, with both `…_can_run` columns `false`.

Send me the outputs of 3.1–3.4. I compare them and confirm.

## 4. Rollback (only if a live check fails)

**Rollback A** (file 10). It restores the previous open rules. Use the exact definitions you saved in 1.4/1.5 if they differ from these:
```sql
begin;
drop policy if exists "Allow authenticated users to upload files" on storage.objects;
create policy "Allow authenticated users to upload files" on storage.objects for insert to public with check (bucket_id = 'uploads');
drop policy if exists "Allow users to update their own uploads" on storage.objects;
create policy "Allow users to update their own uploads" on storage.objects for update to public using (bucket_id = 'uploads');
grant all on public.todos to anon, authenticated;
create policy "Allow All on todos" on public.todos for all to public using (true) with check (true);
commit;
```

**Rollback B** (file 12). Run per table that broke, or for all twelve:
```sql
begin;
do $$
declare t text;
begin
  foreach t in array array['fsm_appointment_snapshots','leave_records','lookup_options','schedule_entries',
    'schedule_entry_assignments','schedule_versions','technician_lookup_assignments','technician_reference',
    'todo_assignees','todo_comments','todo_tags','todo_updates'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('grant all on public.%I to anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'Allow All on ' || t, t);
    execute format('create policy %I on public.%I for all to public using (true) with check (true)', 'Allow All on ' || t, t);
  end loop;
end $$;
commit;
```

Files 1–9 and 11 need no live check. They only add objects or close permissions that live `main` does not use. Their own rollback notes are at the end of each file.

## 5. Phase 0 migration: `20261007100000_amc_audit_events_guard.sql`

Apply after Group A, the same way (one file, `psql -1` or SQL editor). It is **live-safe**: live `main` only inserts into `amc_audit_events`. It fixes the live error where deleting a user who ever acted on a proposal fails with an internal error.

**Pre-check** (read-only):
```sql
select rulename from pg_rules where tablename = 'amc_audit_events';
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.amc_audit_events'::regclass and contype = 'f';
```
Expected:
- two rules, `amc_audit_events_no_update` and `amc_audit_events_no_delete`;
- one foreign key named `amc_audit_events_actor_id_fkey`, `... ON DELETE SET NULL`.

**If the foreign key has a different name, stop and send me the output.**

**Post-check** (read-only):
```sql
select rulename from pg_rules where tablename = 'amc_audit_events';
select tgname from pg_trigger where tgrelid = 'public.amc_audit_events'::regclass and not tgisinternal order by tgname;
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.amc_audit_events'::regclass and contype = 'f';
```
Expected:
- no rules;
- triggers `amc_audit_events_append_only_rows` and `amc_audit_events_append_only_truncate`;
- the foreign key without `ON DELETE SET NULL` (it shows no ON DELETE clause, meaning NO ACTION).

No live check needed. Rollback SQL is at the end of the file.

## 6. Phase 1 migration: `20261007110000_amc_platform_foundation.sql`

Apply after section 5, the same way. It is **live-safe**:
- three new tables (configuration, AMC to-do links, job runs) that live `main` never reads;
- the audit-type check becomes a name pattern, which still accepts what `main` writes;
- the AMC notification event check becomes a name pattern;
- the to-do link-type check also allows `amc_…` types, which live `main` shows as plain text.

**Pre-check** (read-only):
```sql
select to_regclass('public.amc_config') as amc_config, to_regclass('public.amc_todos') as amc_todos,
       to_regclass('public.amc_job_runs') as amc_job_runs, to_regclass('public.amc_notifications') as amc_notifications;
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid in ('public.amc_audit_events'::regclass, 'public.todos'::regclass) and contype = 'c';
```
Expected:
- the first three are `null` (not there yet);
- `amc_notifications` is present (from Group A, file 9);
- the audit CHECK lists entity types;
- the todos CHECK lists `'work_order', 'quotation', 'appointment', 'amc_contract'`.

**Post-check** (read-only):
```sql
select c.relname, c.relrowsecurity as rls_on from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('amc_config', 'amc_todos', 'amc_job_runs');
select table_name, grantee from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('amc_config', 'amc_todos', 'amc_job_runs')
   and grantee in ('anon', 'authenticated');
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname in ('amc_audit_events_entity_type_check', 'amc_notifications_event_name', 'todos_related_type_check');
```
Expected:
- three tables, `rls_on = true`;
- the grants query returns **no rows**;
- the audit and notification checks use `~` (a name pattern);
- the todos check still lists the four live values and adds `~ '^amc_…'`.

**Live check:** open Todos in the live portal; existing to-dos show as before.

## 7. Phase 2 migration: `20261007120000_amc_client_property_assets.sql`

Apply after section 6, the same way. It is **live-safe**:
- `customers` and `customer_properties` come from Group A file 7 and live `main` never reads them. They only gain nullable columns, or columns with a default;
- existing customers get `lifecycle = 'client'` from the column default, because they were all created for signed contracts;
- the property-type check on `customer_properties` and `amc_assessments` is widened (it still accepts villa, apartment and office);
- six new tables (contacts, communication log, assets, access rules, scope items, documents), all server-only;
- the private `amc-documents` bucket also accepts .docx and .xlsx, and stays private.

**Pre-check** (read-only):
```sql
select to_regclass('public.amc_customer_contacts') as contacts, to_regclass('public.amc_communication_log') as comms,
       to_regclass('public.amc_property_assets') as assets, to_regclass('public.amc_property_access_rules') as access_rules,
       to_regclass('public.amc_scope_items') as scope, to_regclass('public.amc_documents') as documents;
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'customers' and column_name in ('customer_type', 'lifecycle', 'trn', 'marketing_consent'))
     or (table_name = 'customer_properties' and column_name in ('building', 'zones', 'parent_property_id')));
select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid in ('public.customer_properties'::regclass, 'public.amc_assessments'::regclass)
   and contype = 'c' and pg_get_constraintdef(oid) ilike '%unit_type%';
select id, public, allowed_mime_types from storage.buckets where id = 'amc-documents';
```
Expected:
- all six tables are `null`;
- the columns query returns **no rows**;
- one unit-type check per table, each listing `villa`, `apartment`, `office`;
- the bucket row shows `public = false`.

**If the columns query returns any row, stop and send me the output.** It would mean a column with that name already exists, maybe with a different type.

**Post-check** (read-only):
```sql
select c.relname, c.relrowsecurity as rls_on from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('amc_customer_contacts', 'amc_communication_log', 'amc_property_assets',
       'amc_property_access_rules', 'amc_scope_items', 'amc_documents');
select table_name, grantee from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
   and table_name in ('amc_customer_contacts', 'amc_communication_log', 'amc_property_assets',
       'amc_property_access_rules', 'amc_scope_items', 'amc_documents');
select lifecycle, count(*) from public.customers group by lifecycle;
select conrelid::regclass, pg_get_constraintdef(oid) from pg_constraint
 where conname in ('customer_properties_unit_type_check', 'amc_assessments_unit_type_check');
select public, allowed_mime_types from storage.buckets where id = 'amc-documents';
```
Expected:
- six tables, `rls_on = true`;
- the grants query returns **no rows**;
- every existing customer is `client`;
- both checks list the nine types, from `villa` to `other`;
- the bucket is still `public = false` and now lists the .docx and .xlsx types.

**Live check:** open AMC Proposals in the live portal. The list and one proposal open as before.

## 8. Phase 3 migration: `20261007130000_amc_enquiries_and_site_visits.sql`

Apply after section 7, the same way. It is **live-safe**:
- two new tables (enquiries and their follow-ups), server-only, plus the enquiry-number sequence and function;
- `amc_assessments` (Group A file 7) and `amc_communication_log` (section 7) gain nullable columns, or columns with a default; live `main` reads neither;
- one new check on `amc_assessments`: a completed assessment's attendance is empty or "attended". Every existing row passes, because attendance is new and empty.

**Pre-check** (read-only):
```sql
select to_regclass('public.amc_enquiries') as enquiries, to_regclass('public.amc_enquiry_follow_ups') as follow_ups,
       to_regclass('public.amc_communication_log') as comms;
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'amc_assessments'
   and column_name in ('enquiry_id', 'scheduled_at', 'attendance', 'asset_counts', 'access_notes', 'exclusions');
```
Expected:
- `enquiries` and `follow_ups` are `null`;
- `comms` is present. If it is `null`, apply section 7 first;
- the columns query returns **no rows**.

**Post-check** (read-only):
```sql
select c.relname, c.relrowsecurity as rls_on from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('amc_enquiries', 'amc_enquiry_follow_ups');
select table_name, grantee from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('amc_enquiries', 'amc_enquiry_follow_ups')
   and grantee in ('anon', 'authenticated');
select has_function_privilege('anon', 'public.amc_next_enquiry_number()', 'EXECUTE') as anon_can_number;
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname in ('amc_enquiries_lost_reason', 'amc_enquiries_reachable', 'amc_assessments_completed_attended');
```
Expected:
- two tables, `rls_on = true`;
- the grants query returns **no rows**;
- `anon_can_number = false`;
- three checks: Lost needs a reason, the contact has a phone, email or WhatsApp, and a completed assessment was attended (or has no attendance).

**Live check:** open AMC Proposals in the live portal. The list and one proposal open as before.

## 9. Phase 4 migration: `20261007140000_amc_rate_card_and_proposal_versions.sql`

Apply after section 8, the same way. **It touches a live table**, so read this first:
- `amc_submissions` (live `main` reads and writes it) only gains columns: nullable ones, or ones with a constant default (`current_version` = 1, `below_floor` = false). On Postgres 11+ adding these is a quick catalogue change, with no table rewrite;
- three foreign keys and three partial indexes are added on it. The table is small, but **apply it outside working hours** so the short lock goes unnoticed;
- live `main` is unaffected: it selects `*` and keeps only the fields it knows, inserts without the new columns (so the defaults apply), and updates only its own fields. The main-compatibility check (`compat.sh`) is unchanged at 28/11 with this file applied;
- two new server-only tables (rate card versions, locked proposal versions), both append-only, plus the function that locks a version.

**Pre-check** (read-only):
```sql
select to_regclass('public.amc_rate_card_versions') as rate_card, to_regclass('public.amc_submission_versions') as versions,
       to_regclass('public.amc_enquiries') as enquiries;
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'amc_submissions'
   and column_name in ('enquiry_id', 'property_type', 'payment_plan', 'payment_plan_custom', 'valid_until', 'current_version',
                       'version_reason', 'version_summary', 'version_started_at', 'version_started_by', 'rate_card_version_id', 'below_floor');
select count(*) as proposals from public.amc_submissions;
```
Expected:
- `rate_card` and `versions` are `null`;
- `enquiries` is present. If it is `null`, apply section 8 first;
- the columns query returns **no rows**;
- note the proposal count, to compare after.

**If the columns query returns any row, stop and send me the output.**

**Post-check** (read-only):
```sql
select count(*) as proposals, count(*) filter (where current_version = 1) as at_v1, count(*) filter (where below_floor) as below_floor
  from public.amc_submissions;
select c.relname, c.relrowsecurity as rls_on from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('amc_rate_card_versions', 'amc_submission_versions');
select table_name, grantee from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('amc_rate_card_versions', 'amc_submission_versions')
   and grantee in ('anon', 'authenticated');
select has_function_privilege('anon', 'public.amc_lock_proposal_version(uuid, integer, text, text, uuid, jsonb, text, text, text, integer, text)', 'EXECUTE') as anon_can_lock;
select tgname from pg_trigger where not tgisinternal and tgname in ('amc_rate_card_versions_locked', 'amc_submission_versions_locked');
```
Expected:
- the same proposal count as before, all `at_v1`, `below_floor = 0`;
- two tables, `rls_on = true`;
- the grants query returns **no rows**;
- `anon_can_lock = false`;
- both triggers listed.

**Live check:** in the live portal, open AMC Proposals, open one proposal, and (as its owner) save one draft. All three work as before.
