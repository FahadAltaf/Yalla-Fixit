# Database migration reconciliation (production `sxzpigyphjotuubxpooj`)

Written 5 Oct 2026 on branch `amc-hardening` (base commit `db3dfc6`). Read-only analysis. **Nothing in this document has been executed.**

> ## STOP: production maintenance step requires human / DevOps approval
>
> The local `supabase/migrations` folder and the production migration history (`supabase_migrations.schema_migrations`) no longer describe each other. Until the procedure in section 6 has been reviewed and approved by a named owner, and a maintenance window and backup are in place:
>
> - **Do not run `supabase db push`** against production (with or without `--include-all`).
> - **Do not run `supabase migration repair`** (either `--status applied` or `--status reverted`) against production.
> - **Do not replay any migration file** against production, by CLI, SQL Editor, psql or MCP `apply_migration`.
> - **Do not run `supabase db reset --linked`** under any circumstances.
>
> This document was written without connecting to production. The production facts quoted in sections 1, 2 and 4 come from read-only queries run on 5 Oct 2026 earlier in this phase; they were not re-run while writing. Re-verify them (section 7) on the day of maintenance.

---

## Contents

1. [Remote migration versions](#1-remote-migration-versions)
2. [Local migration versions](#2-local-migration-versions)
3. [Known schema drift](#3-known-schema-drift)
4. [AMC migrations already reflected in production](#4-amc-migrations-already-reflected-in-production)
5. [Migrations that must not be replayed](#5-migrations-that-must-not-be-replayed)
6. [Proposed reconciliation procedure](#6-proposed-reconciliation-procedure)
7. [Verification SQL (read-only)](#7-verification-sql-read-only)
8. [Rollback and recovery](#8-rollback-and-recovery)
9. [Status at time of writing (5 Oct 2026)](#9-status-at-time-of-writing-5-oct-2026)

---

## 1. Remote migration versions

`supabase_migrations.schema_migrations` on production holds exactly six rows. **None of these versions exists as a file in `supabase/migrations`.** Five have a local file with the same name but a different timestamp; one (`remote_schema`) has no local file at all.

| Remote version | Remote name | Local file with same name | Notes |
|---|---|---|---|
| `20260720102128` | `remote_schema` | none | Name matches what `supabase db pull` generates. The pulled file was never committed. Its `statements` column may hold the 20 Jul schema; export it before touching this row. |
| `20260924080610` | `checklist_answered_by` | `20260924100000_checklist_answered_by.sql` | Version looks generated at apply time (MCP `apply_migration` / CLI `migration new`), not the file's version. |
| `20260924082758` | `snagging_notifications` | `20260924120000_snagging_notifications.sql` | same pattern |
| `20260924125718` | `job_signoffs` | `20260924130000_job_signoffs.sql` | same pattern |
| `20260924132733` | `notification_when_at` | `20260924140000_notification_when_at.sql` | same pattern |
| `20260930112449` | `job_gatepass` | `20260930100000_job_gatepass.sql` | Latest remote version. Every local file at `db3dfc6` is older than it. |

Observations:

- `20260924150000_visit_inspectors.sql` sits between recorded rows but is **not** recorded, so the 24 Sep work was applied partly through a history-recording path and partly by hand.
- Before any `--status reverted`, compare each row's `statements` column with the local file of the same name (query 7.1b). The SQL that actually ran may differ from the committed file.

## 2. Local migration versions

Folder contents when last read on 5 Oct 2026: **84 files**. That is the 82 files at `db3dfc6`, plus 2 files created in this phase. Other work in this phase may add more; re-list the folder before step 6(e).

**None of the 82 is recorded in remote history.** Most of their objects exist in production anyway, because they were applied by hand (SQL Editor, or MCP `apply_migration` with generated versions). `docs/scheduling-updates-deployment-notes.md:21` records one such case: production changes were applied "by Sami, 17–18 Sep, via the SQL Editor". Lines 24–25 of the same file note that `20260828090000_add_fsm_status_to_schedule_entries.sql` "had never been applied to production" until then.

Areas: base 1, estimates 3, other 1, todos 4, scheduling 17, snagging 49, amc 7.

| # | Version | Name | Purpose (from header / SQL) | Area |
|---|---|---|---|---|
| 1 | `20250501` | create_base_schema | Roles ENUM, settings/roles/user_profile/password_resets, RLS, uploads bucket, initial data | base |
| 2 | `20260413` | create_estimate_revisions | Revision-chain metadata for estimates | estimates |
| 3 | `20260414` | drop_estimate_revision_id_columns | Drops redundant estimate id columns and their indexes | estimates |
| 4 | `20260415` | create_quotation_service_item_images | `estimate_service_items`: image URLs per service item | estimates |
| 5 | `20260416` | add_settings_oauth_access_token | `settings.oauth_access_token` (Zoho OAuth) | other |
| 6 | `20260520` | create_todos_module | `todos`, `todo_assignees`, `todo_comments` | todos |
| 7 | `20260523090000` | add_todo_titles_and_keys | `title`, `todo_key`, `todos_key_seq`, backfill (no header) | todos |
| 8 | `20260523120000` | create_todo_updates | `todo_updates` activity log (no header) | todos |
| 9 | `20260523130000` | create_todo_tags | `todo_tags` plus default tags (no header) | todos |
| 10 | `20260721090000` | add_scheduling_settings_and_approver | Org timezone/shift config, schedule-approver flag | scheduling |
| 11 | `20260721091000` | create_leave_and_tags_module | Technician leave records and tags | scheduling |
| 12 | `20260721092000` | create_schedule_core_module | Daily schedules, versions, entries, assignments, sync ops, approval history | scheduling |
| 13 | `20260721093000` | schedule_technician_refresh_cron | pg_cron job: technician refresh Edge Function | scheduling |
| 14 | `20260721094000` | schedule_fsm_reconcile_cron | pg_cron job: `zoho-fsm-reconcile` Edge Function | scheduling |
| 15 | `20260721120000` | create_amc_submissions | `amc_submissions` table, with an open "Allow All" policy | amc |
| 16 | `20260724090000` | add_entry_display_names | FSM display names (WO/AP numbers) on schedule entries | scheduling |
| 17 | `20260725090000` | add_sync_error_and_retry | Per-entry sync error, retry, published-edit tracking | scheduling |
| 18 | `20260726090000` | add_appointment_creation_details | Service lines, type and schedule type for new FSM appointments | scheduling |
| 19 | `20260727090000` | multi_appointment_per_workorder | Drops the unique index that blocked several appointments per work order | scheduling |
| 20 | `20260728090000` | add_needs_sync | `needs_sync` so only changed entries re-sync | scheduling |
| 21 | `20260729090000` | technician_attributes | Role and service-type lists, shift, team leader | scheduling |
| 22 | `20260730090000` | add_approval_email_flag | Approval-email recipient flag | scheduling |
| 23 | `20260731090000` | optional_approval | Chosen approver per version, or "no approval" | scheduling |
| 24 | `20260817090000` | create_snagging_module | Full snagging model (`snagging_tasks`, areas, snags, photos, catalogue, storage, RLS) | snagging |
| 25 | `20260817091000` | seed_snagging_catalogue | Catalogue v1.0, area matrix, area templates | snagging |
| 26 | `20260818090000` | drop_unused_snagging_tables | Drops report tokens, projects, summaries view | snagging |
| 27 | `20260820090000` | scheduling_drop_crons_and_dead_objects | Unschedules 2 cron jobs; drops `fsm_appointment_snapshots` and `has_fsm_changes` | scheduling |
| 28 | `20260821090000` | snagging_property_model | Property/client/assign rework on `snagging_jobs` | snagging |
| 29 | `20260821100000` | snagging_quotation | Pricing config, scope/terms, quotations | snagging |
| 30 | `20260821110000` | snagging_checklist | 47-check library and per-job checklist | snagging |
| 31 | `20260821120000` | snagging_area_access | `not_accessible` / `limited_access` area states | snagging |
| 32 | `20260821130000` | snagging_additional_visit | `visit_type`, `visit_charge` | snagging |
| 33 | `20260821140000` | snagging_delivery | Report delivery channel/recipient | snagging |
| 34 | `20260821150000` | snagging_report_tokens | Hashed tokenised client report links | snagging |
| 35 | `20260821160000` | snagging_audit_restore | Re-establishes append-only `snagging_audit_events` | snagging |
| 36 | `20260821170000` | snagging_floor_plans | Multi-floor `snagging_floor_plans` | snagging |
| 37 | `20260821180000` | snagging_rejection_sla_columns | Restores columns the out-of-band rebuild dropped | snagging |
| 38 | `20260821190000` | snagging_properties | `snagging_properties`, backfilled from jobs | snagging |
| 39 | `20260821200000` | snagging_quotation_completion | Default pricing, scope of work, terms | snagging |
| 40 | `20260824090000` | snagging_area_pins | Area pins on floor plans | snagging |
| 41 | `20260825090000` | snagging_field_inspection | Photo defect markers and other field-inspection columns | snagging |
| 42 | `20260826090000` | scheduling_drop_drift_model_and_legacy_approver | Drops FSM-drift columns/statuses and `is_schedule_approver` | scheduling |
| 43 | `20260827090000` | scheduling_consolidate_tables | 13 tables to 8 (`lookup_options`; drops `daily_schedules` and others) | scheduling |
| 44 | `20260828090000` | add_fsm_status_to_schedule_entries | `fsm_status`, `fsm_status_checked_at` and index | scheduling |
| 45 | `20260901090000` | add_snagging_job_checklist_created_at | `created_at` on job checklist, backfilled | snagging |
| 46 | `20260903090000` | create_snagging_report_versions | Report versioning for additional visits | snagging |
| 47 | `20260904090000` | snagging_review_routing | Reviewer hop, approval escalation | snagging |
| 48 | `20260904100000` | restore_area_status_trigger | Derived area status trigger plus backfill | snagging |
| 49 | `20260905090000` | snagging_report_generation | PDF generation lifecycle, version snapshots | snagging |
| 50 | `20260905100000` | fix_report_generation_status_check | Allows `generating` status | snagging |
| 51 | `20260910090000` | snagging_catalogue_v2 | Category > sub-category > defect catalogue | snagging |
| 52 | `20260910100000` | catalogue_source_code | Library defect code alongside ours | snagging |
| 53 | `20260910110000` | checklist_audience_split | Technician vs client checklist | snagging |
| 54 | `20260910120000` | snagging_rate_card | Rate card per type/furnished state | snagging |
| 55 | `20260914100000` | quotation_before_job | Quotation can exist before the job | snagging |
| 56 | `20260914110000` | desnag_quotation | De-snag as its own job and quotation | snagging |
| 57 | `20260914120000` | visits_as_appointments | `snagging_job_visits` | snagging |
| 58 | `20260915100000` | snagging_area_zones | Zones drawn around rooms | snagging |
| 59 | `20260915120000` | amc_harden_submissions | Drops the open policy; owner RLS; revokes anon | amc |
| 60 | `20260915130000` | amc_settings_and_audit | `amc_settings`, `amc_audit_events`, snapshots | amc |
| 61 | `20260916100000` | amc_approval_flow | 9-value status, approval columns, approver policies | amc |
| 62 | `20260916105000` | amc_proposal_numbers | Server-allocated proposal numbers, sequence | amc |
| 63 | `20260916110000` | amc_client_links | Client tokens, decision, signature | amc |
| 64 | `20260916120000` | retire_visit_jobs | Deletes additional-visit `snagging_jobs` rows and children | snagging |
| 65 | `20260916140000` | quotation_rate_choice | Coordinator-chosen rate within band | snagging |
| 66 | `20260916150000` | quotation_furnished | `furnished` on quotation, backfilled | snagging |
| 67 | `20260916160000` | quotation_external_rate | External-areas rate choice | snagging |
| 68 | `20260917100000` | snag_catalogue_fk | Re-points `catalogue_entry_id` FK | snagging |
| 69 | `20260918100000` | visit_review | Visit submit/review/reissue | snagging |
| 70 | `20260918110000` | area_visit | `snagging_areas.visit_id` | snagging |
| 71 | `20260920100000` | floor_plan_updated_at | `updated_at` on floor plans for delta sync | snagging |
| 72 | `20260921100000` | snag_verdict_note | `snagging_snags.verdict_note` | snagging |
| 73 | `20260922100000` | area_inspector | `snagging_areas.inspector_id` | snagging |
| 74 | `20260922110000` | snag_review_note | Reviewer note on a snag | snagging |
| 75 | `20260922130000` | amc_contract_settings_snapshot | `contract_settings_snapshot` | amc |
| 76 | `20260923100000` | multiple_inspectors | `snagging_job_inspectors`, `snagging_area_inspectors` | snagging |
| 77 | `20260924100000` | checklist_answered_by | `answered_by`, `answered_at` on job checklist | snagging |
| 78 | `20260924120000` | snagging_notifications | `snagging_notifications`, triggers, realtime | snagging |
| 79 | `20260924130000` | job_signoffs | `snagging_job_signoffs` | snagging |
| 80 | `20260924140000` | notification_when_at | `snagging_notifications.when_at` | snagging |
| 81 | `20260924150000` | visit_inspectors | `snagging_visit_inspectors` | snagging |
| 82 | `20260930100000` | job_gatepass | `snagging_jobs.gatepass_path` | snagging |

### Pending, created in this phase (versions >= 20261005)

| Version | Name | State |
|---|---|---|
| `20261005100000` | amc_close_direct_writes | **Not applied anywhere.** Drops the three AMC write policies, revokes writes on `amc_submissions` and the AMC sequences from `anon`/`authenticated`. Rollback SQL is in its header (lines 49–59). Apply only at step 6(e). |
| `20261005110000` | amc_proposal_number_beyond_9999 | **Not applied anywhere.** Adds `public.amc_next_proposal_number()` (one `nextval`, pads to at least four digits, never truncates) and points the `proposal_number` default at it. Changes no existing row and does not touch the sequence. Rollback in its header. Apply at step 6(e), after `20261005100000`. |
| `20261005160000` | settings_hide_zoho_token | **Not applied anywhere.** Drops "Allow All on Settings", revokes browser roles, grants SELECT on the branding columns only; the Zoho token becomes service-role only. Apply after the code deploy. |
| `20261005170000` | estimate_tables_server_only | **Not applied anywhere.** Drops the open policies on `estimate_revisions` and `estimate_service_items` (both live and repo policy names) and revokes browser roles. Apply after the code deploy. |
| `20261005180000` | password_resets_server_only | **Not applied anywhere.** Drops "Allow All on Password Resets" and revokes browser roles. Apply after the code deploy. |
| `20261006100000` | active_amc_contracts (branch `active-amc`) | **Not applied anywhere.** Creates `amc_contracts`, `amc_contract_entitlements`, `amc_entitlement_usage` (append-only, trigger-maintained totals), `amc_submissions.renewal_of_contract_id`, and extends the audit entity types. Apply after the hardening migrations. |
| `20261006110000` | active_amc_operations (branch `active-amc`) | **Not applied anywhere.** Usage corrections (`corrects_usage_id`, kind `correction`, trigger replaced), `amc_contracts.account_manager_names`, `todos.related_type` allows `amc_contract`, `amc_renewal_reminders`, and one renewal proposal per contract (unique index; pre-check in the header). Apply straight after `20261006100000`. |
| `20261006120000` | amc_fsm_integration (branch `active-amc`) | **Not applied anywhere.** Explicit FSM customer link on contracts, AMC→FSM service mapping, FSM work links, FSM columns on usage, FSM sync log. Additive only. Apply straight after `20261006110000`. |
| `20261006130000` | amc_business_operations (branch `active-amc`) | **Not applied anywhere.** Shared `customers` / `customer_properties` (with optional links to Snagging records), live customer/property links on AMC proposals and contracts, AMC assessments and checklist, additional-service discount configuration (off) and quotes, audit entity types. Additive. Apply straight after `20261006120000`. |
| `20261005150000` | restrict_shared_allow_all_policies | **Not applied anywhere.** Drops "Allow All on schedule_audit_events" (created by `20260721090000:67-73`) and revokes all privileges on `schedule_audit_events` from `anon`/`authenticated` (lines 93, 102). Its header points to pre-apply checks in `docs/security-followup-shared-rls.md`. Apply only at step 6(e), as a separate push. |

### In progress on main, not on this branch

- `20261002100000_inspector_role.sql` is staged in the main checkout (`Yalla Fixit/supabase/migrations`) but is **not on this branch**. Its production state is unknown. It matters when choosing the baseline version (step 6(c)).

## 3. Known schema drift

- **`snagging_clients` has no creating migration.** It is used in production and is only referenced as an FK target: `20260821190000_snagging_properties.sql:16` and `20260914100000_quotation_before_job.sql:43`. `AUDIT_SCALABILITY.md:416-420` states it "does exist (created outside `supabase/migrations/`)" with `idx_snag_clients_name`.
- **`snagging_tasks` was renamed to `snagging_jobs` out of band.**
  - `20260817090000_create_snagging_module.sql:206` creates `snagging_tasks`, and no file creates or renames to `snagging_jobs`.
  - Evidence: `20260821160000_snagging_audit_restore.sql:9-11` ("the snagging_tasks -> snagging_jobs rename happened out of band") and `20260821180000_snagging_rejection_sla_columns.sql:3-6` ("out-of-band snagging_tasks -> snagging_jobs rebuild stripped several columns").
- **`snagging_jobs.client_id` and `idx_snag_jobs_client`** exist only out of band (`AUDIT_SCALABILITY.md:417-419`). `docs/audits/performance-audit-2026-10-01.md:79` and `:3437` (finding F-DB-1) confirm that the base `snagging_jobs` table and its `job_id`-keyed child tables are not created by any migration.
- **Consequence: the local chain cannot be replayed from scratch.** This is inferred from reading the files, not from running them.
  - `20260821090000_snagging_property_model.sql:11` runs `alter table public.snagging_jobs`, which no earlier file creates, so `supabase db reset` should fail there.
  - `20260821190000` needs `snagging_clients`.
  - So a local reset cannot be used as the reference schema for a diff, and a fresh environment cannot be built from the folder.
- **Scheduling SQL was hand-applied** on 17–18 Sep via the SQL Editor (`docs/scheduling-updates-deployment-notes.md:21-60`). This includes the `20260828090000` content and extra objects (`lookup_options.color`, `technician_reference.board_position`, `set_technician_board_order`) that are intentionally **not** in any migration file on this branch. They will appear in a production dump and not in the local folder.
- **Remote history uses generated versions** (section 1), so even the 6 recorded changes do not line up with local files.
- **pg_cron target mismatch (unverified).** `20260721093000_schedule_technician_refresh_cron.sql:15-16` posts to `https://ulqitebapobdtsqvbucd.supabase.co/...`, a project ref that is not production (`sxzpigyphjotuubxpooj`). The jobs were later unscheduled by `20260820090000`. Check `cron.job` (query 7.8) for any surviving job pointing at a foreign project.
- **Policies, grants and data in base files (unverified).** `20250501_create_base_schema.sql:90-119` creates `FOR ALL ... USING (true) WITH CHECK (true)` policies on `settings`, `roles`, `user_profile`, `password_resets`. Whether production still has them is unknown; check with query 7.5.

## 4. AMC migrations already reflected in production

All 7 AMC migrations are reflected in production. None of their versions is in `schema_migrations`. The evidence below is from the read-only production queries of 5 Oct 2026.

| Local file | Objects it creates / changes | Production evidence (5 Oct 2026) |
|---|---|---|
| `20260721120000_create_amc_submissions.sql` | `amc_submissions` table; `idx_amc_submissions_owner_updated` (:22); RLS on; "Allow All on amc_submissions" policy (:27-33) | Table and `owner_updated` index exist. **The "Allow All" policy is absent**, which is correct because `20260915120000` dropped it. |
| `20260915120000_amc_harden_submissions.sql` | Drops "Allow All" (:39); owner read/insert/update policies (:43-56); `REVOKE ALL ... FROM anon` (:71) | owner read, owner insert, owner update policies present; no "Allow All" |
| `20260915130000_amc_settings_and_audit.sql` | `amc_settings` (single row, `amc_settings_single_row`) (:39-47); `settings_snapshot`, `document_options` (:86, :94); `amc_audit_events` with append-only rules, `idx_amc_audit_entity`, `idx_amc_audit_created` (:113-137) | Both tables exist with every column; sequence `amc_audit_events_id_seq` exists |
| `20260916100000_amc_approval_flow.sql` | 9-value `amc_submissions_status_check` (:47-59); `submitted_*`, `decided_*`, `sent_back_reason` (:66-71); `amc_submissions_sent_back_needs_reason` (:84); `idx_amc_submissions_status_submitted` (:98); approver read / approver decide policies (:121, :145) | Status CHECK has the 9 values; `sent_back_needs_reason` present; `status_submitted` index present; both approver policies present |
| `20260916105000_amc_proposal_numbers.sql` | `amc_proposal_number_seq` (:23); `proposal_number` NOT NULL with default (:26, :83-107); `idx_amc_submissions_proposal_number` unique (:109) | Sequence present, `last_value` = **6894**; unique proposal-number index present |
| `20260916110000_amc_client_links.sql` | Proposal/contract token columns (:35-42); partial unique token indexes (:47, :51); `client_decision` with inline check (`amc_submissions_client_decision_check`, :65-66); `signed_needs_name` (:86); `client_rejection_needs_reason` (:105) | Token partial unique indexes present; `client_decision_check`, `signed_needs_name`, `client_rejection_needs_reason` present |
| `20260922130000_amc_contract_settings_snapshot.sql` | `contract_settings_snapshot` (:19) | Column present |

Final AMC policy set in production: exactly 5 policies (owner read, owner insert, owner update, approver read, approver decide), and **no "Allow All on amc_submissions"**. After `20261005100000` is applied, the expected set is 2 (owner read, approver read).

## 5. Migrations that must not be replayed

Source: grep of every file for `DROP TABLE|DROP COLUMN|DROP POLICY|DROP VIEW|DROP FUNCTION|DROP INDEX|DROP CONSTRAINT|TRUNCATE|DELETE FROM|UPDATE|RENAME|setval|USING (true)|cron.(un)schedule|BEGIN/COMMIT`, with comment lines excluded.

- `ALTER ... RENAME` has **no hits**. The `snagging_tasks` rename exists in no file.
- `DROP POLICY IF EXISTS` immediately followed by re-creating the same policy is listed only where the re-created policy is permissive or the policy is AMC.
- Statements inside trigger-function bodies do not run at migration time. They are noted separately below the table.
- Replay as a whole is unsafe anyway: files from `20260817090000` to `20260821110000` target `snagging_tasks` or `daily_schedules`, which no longer exist, so they error part-way. Files 28–30 and 64 contain their own `BEGIN;`/`COMMIT;`, which breaks the CLI's per-file transaction (general knowledge, not verified).

| File | Statement type | Line(s) | Effect if replayed on production |
|---|---|---|---|
| `20250501_create_base_schema.sql` | `CREATE POLICY ... FOR ALL ... USING (true) WITH CHECK (true)` | 90-119 | Re-opens settings/roles/user_profile/password_resets to everyone if since tightened |
| `20260413_create_estimate_revisions.sql` | DROP POLICY + `USING (true)` | 26-32 | Re-creates open policy |
| `20260414_drop_estimate_revision_id_columns.sql` | DROP INDEX; DROP COLUMN ×3 | 7-9; 12-14 | Data loss if columns were re-added |
| `20260415_create_quotation_service_item_images.sql` | DROP POLICY + `USING (true)` | 24-30 | Re-creates open policy |
| `20260520_create_todos_module.sql` | DROP POLICY + `USING (true)` ×3 | 61-83 | Re-creates open policies |
| `20260523090000_add_todo_titles_and_keys.sql` | UPDATE ×2; `setval` ×2 | 7, 11; 25, 27 | Rewrites titles/keys; can move `todos_key_seq` |
| `20260523120000_create_todo_updates.sql` | `CREATE POLICY ... USING (true)` | 28 | Open policy |
| `20260523130000_create_todo_tags.sql` | `CREATE POLICY ... USING (true)` | 36 | Open policy |
| `20260721090000_add_scheduling_settings_and_approver.sql` | DROP POLICY + `USING (true)` ×2 | 67-81 | Open policies |
| `20260721091000_create_leave_and_tags_module.sql` | DROP POLICY + `USING (true)` ×3 | 62-84 | Re-creates `technician_tags`/`_assignments` (dropped in 20260827) with open policies |
| `20260721092000_create_schedule_core_module.sql` | DROP POLICY + `FOR ALL TO public USING (true)` ×7 | 189-215 | Re-creates `daily_schedules`, `schedule_sync_operations`, `schedule_approval_actions`, `fsm_appointment_snapshots` (all dropped later) with open policies |
| `20260721093000_schedule_technician_refresh_cron.sql` | `cron.schedule` + `net.http_post` | 10-16 | Re-instates retired */30 job posting to foreign project `ulqitebapobdtsqvbucd` |
| `20260721094000_schedule_fsm_reconcile_cron.sql` | `cron.schedule` + `net.http_post` | 9-14 | Re-instates retired */10 job |
| `20260721120000_create_amc_submissions.sql` | DROP POLICY + `CREATE POLICY "Allow All on amc_submissions" FOR ALL TO public USING (true) WITH CHECK (true)` | 27-33 | **Re-opens all AMC customer data (names, phones, emails) to the public anon key** until `20260915120000` runs |
| `20260728090000_add_needs_sync.sql` | UPDATE `schedule_entries` | 19 | Rewrites `needs_sync` |
| `20260729090000_technician_attributes.sql` | DROP POLICY + `USING (true)` ×2 | 64-67 | Re-creates `technician_roles`/`_service_types` (dropped in 20260827) with open policies |
| `20260817090000_create_snagging_module.sql` | CREATE TABLE `snagging_tasks`; DROP TRIGGER; DROP POLICY on `storage.objects` ×3; DROP/CREATE policies | 206; 721, 766; 901-912; 974-1061 | Creates a parallel empty `snagging_tasks`; rewrites storage policies |
| `20260817091000_seed_snagging_catalogue.sql` | INSERT seed (ON CONFLICT) | 25-327 | Repopulates superseded v1 catalogue tables |
| `20260818090000_drop_unused_snagging_tables.sql` | DROP TABLE ×3; DROP VIEW; DROP COLUMN ×2 | 25, 26, 100; 36; 98-99 | Drops `snagging_report_tokens` (re-created by 20260821150000 and in use) |
| `20260820090000_scheduling_drop_crons_and_dead_objects.sql` | `cron.unschedule` ×2; DROP TABLE; DROP COLUMN | 37, 40; 46; 48-49 | Fails on missing `daily_schedules`; drops tables |
| `20260821090000_snagging_property_model.sql` | UPDATE ×2; DROP CONSTRAINT; BEGIN/COMMIT | 13, 21; 19; 7, 51 | Rewrites `property_type`; nested transaction |
| `20260821100000_snagging_quotation.sql` | BEGIN/COMMIT; `USING (true)` select | 5, 66; 64 | Nested transaction |
| `20260821110000_snagging_checklist.sql` | BEGIN/COMMIT; `USING (true)` select | 8, 107; 47 | Nested transaction |
| `20260821130000_snagging_additional_visit.sql` | UPDATE `snagging_jobs` | 27 | Reclassifies `visit_type` |
| `20260821190000_snagging_properties.sql` | INSERT ... SELECT (no ON CONFLICT); UPDATE | 50; 62 | **Duplicates every property row** |
| `20260821200000_snagging_quotation_completion.sql` | UPDATE `snagging_pricing_config` | 17 | Guarded (zero/null only), low |
| `20260826090000_scheduling_drop_drift_model_and_legacy_approver.sql` | DROP COLUMN ×3; UPDATE ×3; DROP CONSTRAINT ×2; DROP INDEX | 29-30, 69; 34, 38, 51; 43, 56; 66 | Data rewrite and column loss |
| `20260827090000_scheduling_consolidate_tables.sql` | DROP TABLE ×7; UPDATE; DROP CONSTRAINT; DROP INDEX; DROP COLUMN; `USING (true)` ×2 | 97-100, 143-144, 190; 159; 169; 178; 188; 200-206 | Drops scheduling tables |
| `20260901090000_add_snagging_job_checklist_created_at.sql` | UPDATE | 23 | Overwrites `created_at` |
| `20260904090000_snagging_review_routing.sql` | UPDATE | 55 | Guarded (nulls only), low |
| `20260904100000_restore_area_status_trigger.sql` | DROP TRIGGER ×2; UPDATE backfill | 51, 86; 93 | Recomputes every area status |
| `20260910090000_snagging_catalogue_v2.sql` | DROP POLICY ×3; TRUNCATE | 131-144; 182 | Truncates `snagging_catalogue_area_elements` |
| `20260910100000_catalogue_source_code.sql` | DROP VIEW | 36 | Drops `snagging_catalogue_v2` view |
| `20260910120000_snagging_rate_card.sql` | UPDATE `snagging_pricing_config` | 54 | Guarded ("only where still empty"), low |
| `20260914100000_quotation_before_job.sql` | ALTER COLUMN DROP NOT NULL; UPDATE ×2 | 28; 95, 104 | Rewrites quotation client/property links |
| `20260914120000_visits_as_appointments.sql` | DROP POLICY + `USING (true)` select | 154-156 | Low |
| `20260915120000_amc_harden_submissions.sql` | DROP POLICY ×4 then CREATE | 39-56 | Re-creates owner insert/update **after** `20261005100000` drops them |
| `20260916100000_amc_approval_flow.sql` | DROP CONSTRAINT; UPDATE status; DROP/CREATE approver policies | 37; 39-45; 120, 144 | ACCESS EXCLUSIVE lock; re-creates approver decide |
| `20260916105000_amc_proposal_numbers.sql` | UPDATE ×4; `setval` | 35, 56, 92, 102; 75 | Rewrites `customer.proposalNumber` JSONB on drifted rows; **`setval` resets the sequence to MAX(issued), possibly below 6894, so numbers of deleted rows can be reissued** |
| `20260916120000_retire_visit_jobs.sql` | DELETE FROM ×6; UPDATE; INSERT audit; BEGIN/COMMIT | 61-85; 81; 29; 20, 88 | **Hard-deletes jobs/snags/photos/areas/plans/checklists** for any `visit_type='additional'` row |
| `20260916150000_quotation_furnished.sql` | UPDATE `snagging_quotations` | 41 | Overwrites `furnished` set by coordinators since |
| `20260918110000_area_visit.sql` | UPDATE `snagging_areas` | 32 | Guarded (`visit_id IS NULL`), low |
| `20260924140000_notification_when_at.sql` | DROP FUNCTION | 20 | Drops and re-creates `snagging_notify` |
| `20261005100000_amc_close_direct_writes.sql` | DROP POLICY ×4; REVOKE | 65-95 | Pending. Intended; apply once (6(e)) |
| `20261005150000_restrict_shared_allow_all_policies.sql` | DROP POLICY; REVOKE | 93; 102 | Pending. Intended; apply once (6(e)) |

Inside trigger/function bodies, these are not executed at migration time: `20260817090000:754`, `20260904100000:39, 74`, `20260924130000:49, 71` (`delete from snagging_job_signoffs`).

## 6. Proposed reconciliation procedure

Every step below is a proposal for an approved maintenance window. Steps (a) and (b) are read-only against production. Steps (c) to (e) write only to `supabase_migrations.schema_migrations`, except the single pending file in (e).

**CLI behaviour assumed here is general knowledge of the Supabase CLI and has not been verified against the installed version:**

- `supabase db push` compares local files with remote `schema_migrations`.
- Remote versions missing locally cause an error that suggests `supabase migration repair`.
- Local files older than the latest remote version are refused unless `--include-all` is passed.
- Each file runs in its own transaction together with its history-row insert.
- `supabase migration repair --status applied <v>` only inserts a history row and executes no SQL; `--status reverted <v>` deletes the row.
- `supabase migration list --linked` is read-only.

Confirm all of this with `supabase --version` and `supabase <cmd> --help` before step (c).

> **Never pass `--include-all` to `db push` against production.** Every local file at `db3dfc6` is older than `20260930112449`, so `--include-all` would attempt to replay all 82, including every row of section 5.

### (0) Pre-flight

1. Named approver (DevOps / owner) signs off this document. Fix the maintenance window and tell the team. Freeze all SQL Editor / MCP DDL on production from now until (f).
2. Start a maintenance log, outside this repo or as a new dated file. Record every command with timestamp, operator, full output, and the `schema_migrations` contents before and after.
3. Confirm the CLI is linked to `sxzpigyphjotuubxpooj` and nothing else: check `supabase/.temp/project-ref`, or `supabase projects list` (the linked project is marked). The local `supabase/config.toml` is `project_id = "yfi-todos-local"`.
4. Record the CLI version and production `select version();`. Local `config.toml` has `major_version = 15`; dumps must be restored into the same major version.

### (a) Backup and schema dump (read-only)

1. Confirm PITR is enabled (Dashboard > Database > Backups) and note the current timestamp as the recovery point. Otherwise take an on-demand backup.
2. Run these read-only dumps:

   ```bash
   supabase db dump --linked --schema-only -f prod_schema_20261005.sql
   supabase db dump --linked --role-only   -f prod_roles_20261005.sql
   supabase db dump --linked --data-only --schema supabase_migrations -f prod_history_20261005.sql
   # or, with a direct connection string from the dashboard:
   pg_dump "$PROD_DB_URL" --schema-only --no-owner -f prod_schema_pgdump_20261005.sql
   ```

3. Export the 6 history rows including `statements` (query 7.1b) to a file. These are the only record of what SQL the generated versions ran.
4. Export reference data that a schema-only dump does not carry (general knowledge): `cron.job`, `storage.buckets`, `pg_publication_tables` for `supabase_realtime`, and the single rows of `amc_settings` and `snagging_pricing_config`. Also export `lookup_options` and the catalogue tables if a usable local seed is wanted.
5. Store the dumps outside git, with access restricted. They contain function bodies and policies, not customer data, but treat them as sensitive.

### (b) Prove what is reflected (schema diff)

A local `supabase db reset` from the 82 files **cannot** be the reference: the chain breaks at `20260821090000` (section 3). Use the production dump as the reference instead.

1. Restore `prod_schema_20261005.sql` into a disposable local database (local Supabase stack or plain Postgres 15). This becomes the "production shape" database.
2. For each local file, check its signature objects against that database using the section 7 queries (columns, constraints, indexes, policies, functions). Record each file as one of:
   - **reflected**: all objects present and matching,
   - **partially reflected**: list what is missing or different,
   - **superseded**: objects later dropped or renamed, e.g. `snagging_tasks`, `daily_schedules`.
3. Optionally, a structural diff against a second database built from the file chain up to the point where it still replays, using migra:

   ```bash
   migra "$LOCAL_FROM_FILES_URL" "$LOCAL_PROD_SHAPE_URL" --unsafe
   ```

   `supabase db diff --linked` diffs a shadow database built from the local files against production, so it inherits the same break at `20260821090000`. Expect it to fail or be noisy until the baseline exists.
4. For each of the 5 named orphan rows, diff its `statements` against the local file of the same name.
5. Output: a reviewed table (file, verdict, evidence) attached to the maintenance log. No production write happens in this step.

### (c) Establish a baseline in the history table

There are two options.

**Option 1: repair each local version as applied, keep the 82 files.**

```bash
# one by one, each recorded in the log, only for files verdicted "reflected" in (b)
supabase migration repair --status applied 20250501 --linked
...
# only after each orphan's statements are confirmed reflected by a local file / the schema
supabase migration repair --status reverted 20260720102128 --linked
supabase migration repair --status reverted 20260924080610 --linked
...
```

- Pros: files stay where they are; per-file history keeps meaning; easy to explain.
- Cons:
  - Up to 82 manual history writes.
  - "Superseded" and "partially reflected" files (24, 26–30 and others that target `snagging_tasks` / `daily_schedules`) would be recorded as applied although their SQL could not run today. The history would then claim things that are false.
  - The chain still cannot build a fresh database, so local dev and CI stay broken (performance-audit F-DB-1).
  - Drift needs hand-written catch-up files (step d).

**Option 2 (recommended): squash into one baseline generated from the production dump.**

1. Create `supabase/migrations/<V>_production_baseline.sql` from `prod_schema_20261005.sql`. Review it. Add the reference-data inserts from (a)4 that a fresh environment needs, using `ON CONFLICT DO NOTHING`.
2. Choose `<V>` so that it is greater than `20260930112449` and smaller than every pending file. `20261001000000` fits both this branch (`20261005100000`, `20261005150000`) and main's `20261002100000_inspector_role.sql`.
   - If inspector_role turns out to be already hand-applied in production, it is inside the dump. Remove that file or mark it applied instead.
3. Move the 82 files to `supabase/migrations_archive/`, which the CLI does not read. They stay in git history for reference.
4. Write the history rows:

   ```bash
   supabase migration repair --status applied 20261001000000 --linked   # baseline: row only, no SQL runs
   supabase migration repair --status reverted 20260720102128 20260924080610 20260924082758 20260924125718 20260924132733 20260930112449 --linked
   ```

   Revert the 6 orphans only after (a)3 has saved their `statements` and (b)4 has shown they are inside the dump. Being inside the dump is true by construction, since the dump is taken from production.

- Pros:
  - Two history writes instead of about 88.
  - The history becomes true: it records exactly the schema production has.
  - `supabase db reset` works locally from the baseline, giving a real dev/CI environment.
  - Drift (step d) is absorbed automatically.
- Cons:
  - The baseline is a large generated file.
  - Per-feature migration granularity moves to the archive.
  - Anything a schema-only dump omits (cron jobs, storage buckets/policies, publication membership, `auth`-schema triggers, extensions config) must be checked and added by hand.
  - Branches cut before the squash that add migrations must be rebased onto the new folder layout.

**Recommendation: Option 2.** Option 1 cannot be made truthful, because several of the 82 files describe tables production no longer has, and it leaves the repo unable to build a database.

### (d) Track the drift

- **Option 2**: nothing extra. `snagging_clients`, `snagging_jobs`, `idx_snag_jobs_client`, `snagging_jobs.client_id` and the 17–18 Sep scheduling objects are all in the baseline. Confirm with queries 7.6 and 7.7 against the restored dump.
- **Option 1**: add tracked files generated from the production dump:
  - `CREATE TABLE IF NOT EXISTS public.snagging_clients (...)`, matching production exactly, with `idx_snag_clients_name`.
  - A guarded rename: `DO $$ BEGIN IF to_regclass('public.snagging_tasks') IS NOT NULL AND to_regclass('public.snagging_jobs') IS NULL THEN ALTER TABLE public.snagging_tasks RENAME TO snagging_jobs; END IF; END $$;`
  - `ADD COLUMN IF NOT EXISTS client_id` plus `CREATE INDEX IF NOT EXISTS idx_snag_jobs_client`.
  - The scheduling objects from `docs/scheduling-updates-deployment-notes.md:21-60`.

  Then mark each file applied with `repair` after verifying it is a no-op on production.

### (e) Apply genuinely pending migrations, one at a time

1. Confirm the remote history now looks as expected: `supabase migration list --linked` should show local and remote matching, with only the pending file(s) unapplied.
2. Run `supabase db push --dry-run --linked`. The list it prints must be exactly the intended file(s): at the time of writing, `20261005100000`, `20261005110000`, `20261005150000`, `20261005160000`, `20261005170000` and `20261005180000` (the exact order and checks are in `amc-hardening-production-runbook.md` §7). **If it lists anything else, stop.** To push one file at a time, temporarily move the later file out of the folder, or push each from a branch that contains only that file.
3. Run `supabase db push --linked`. This executes the file and inserts its history row in one transaction.
4. Run the verification block at the end of `20261005100000` (pg_policies and grants), and queries 7.4, 7.5 and 7.9. Smoke-test the AMC flow in the portal: create, submit, approve, send, client decision.
5. Repeat for any other pending file, such as `20261002100000_inspector_role.sql` once it is merged, as a separate push.

### (f) Going forward

- Every production schema change is a committed file in `supabase/migrations` and reaches production only through `supabase db push`, so file version equals history version.
- No DDL through the SQL Editor or MCP `apply_migration`. `apply_migration` records its own generated version, which is how the orphan rows in section 1 arose (inferred from their names). If it is ever unavoidable, rename the local file to the recorded version in the same commit.
- Before merging any branch with migrations, run `supabase migration list --linked` and paste the output in the PR.
- Data fixes (UPDATE/DELETE backfills) go in their own file, separate from schema changes, and say whether they are safe to re-run.
- Remove `setval` without a `GREATEST(current, max)` guard and policies `USING (true)` for `public` from new files.

## 7. Verification SQL (read-only)

Run these against production before (a) and after (c)–(e). Run the same queries against the restored dump during (b). All statements are `SELECT`s.

```sql
-- 7.1a Migration history
SELECT version, name, coalesce(array_length(statements, 1), 0) AS n_statements
  FROM supabase_migrations.schema_migrations
 ORDER BY version;

-- 7.1b Full SQL recorded for the orphan rows (export before any repair)
SELECT version, name, statements
  FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260720102128','20260924080610','20260924082758',
                   '20260924125718','20260924132733','20260930112449')
 ORDER BY version;

-- 7.2 Key tables present / absent
SELECT n, to_regclass('public.' || n) IS NOT NULL AS present
  FROM unnest(ARRAY[
    'amc_submissions','amc_settings','amc_audit_events',
    'snagging_jobs','snagging_tasks','snagging_clients','snagging_properties',
    'snagging_job_visits','snagging_job_inspectors','snagging_visit_inspectors',
    'snagging_job_signoffs','snagging_notifications',
    'schedule_entries','schedule_versions','lookup_options',
    'daily_schedules','fsm_appointment_snapshots','technician_tags'
  ]) AS n
 ORDER BY n;
-- expect snagging_tasks, daily_schedules, fsm_appointment_snapshots, technician_tags = false

-- 7.3 Columns of the AMC tables
SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('amc_submissions','amc_settings','amc_audit_events')
 ORDER BY table_name, ordinal_position;

-- 7.4 Constraints and indexes on AMC tables
SELECT conrelid::regclass AS tbl, conname, contype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid IN ('public.amc_submissions'::regclass,
                    'public.amc_settings'::regclass,
                    'public.amc_audit_events'::regclass)
 ORDER BY 1, 2;

SELECT tablename, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename LIKE 'amc%'
 ORDER BY 1, 2;

-- 7.5 Policies: AMC, and every permissive "true" policy in public/storage
SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename LIKE 'amc%'
 ORDER BY 1, 2;
-- today: 5 rows, no "Allow All on amc_submissions"; after 20261005100000: 2 rows

SELECT schemaname, tablename, policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname IN ('public','storage')
   AND (qual = 'true' OR with_check = 'true')
 ORDER BY 1, 2, 3;

SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name LIKE 'amc%'
   AND grantee IN ('anon','authenticated')
 GROUP BY table_name, grantee
 ORDER BY 1, 2;

-- 7.6 Drift objects
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'snagging_clients'
 ORDER BY ordinal_position;

SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('idx_snag_jobs_client','idx_snag_clients_name');

SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'snagging_jobs'
   AND column_name IN ('client_id','property_id','gatepass_path','visit_type');

-- 7.7 Signature columns of recent files (one row per file; all should be true)
SELECT f, EXISTS (
         SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = t AND c.column_name = col
       ) AS present
  FROM (VALUES
    ('20260828090000', 'schedule_entries',        'fsm_status'),
    ('20260915100000', 'snagging_areas',          'zone'),
    ('20260916140000', 'snagging_quotations',     'rate_chosen_by'),
    ('20260916150000', 'snagging_quotations',     'furnished'),
    ('20260916160000', 'snagging_quotations',     'external_rate_per_sqft'),
    ('20260918100000', 'snagging_job_visits',     'reviewed_by'),
    ('20260918110000', 'snagging_areas',          'visit_id'),
    ('20260920100000', 'snagging_floor_plans',    'updated_at'),
    ('20260921100000', 'snagging_snags',          'verdict_note'),
    ('20260922100000', 'snagging_areas',          'inspector_id'),
    ('20260922110000', 'snagging_snags',          'review_note_by'),
    ('20260922130000', 'amc_submissions',         'contract_settings_snapshot'),
    ('20260923100000', 'snagging_job_inspectors', 'inspector_id'),
    ('20260924100000', 'snagging_job_checklist',  'answered_by'),
    ('20260924120000', 'snagging_notifications',  'user_id'),
    ('20260924130000', 'snagging_job_signoffs',   'job_id'),
    ('20260924140000', 'snagging_notifications',  'when_at'),
    ('20260924150000', 'snagging_visit_inspectors','inspector_id'),
    ('20260930100000', 'snagging_jobs',           'gatepass_path')
  ) AS v(f, t, col)
 ORDER BY f;

-- 7.8 Scheduled jobs, realtime publication, buckets
SELECT jobid, jobname, schedule, active, command FROM cron.job ORDER BY jobid;
SELECT schemaname, tablename FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' ORDER BY 1, 2;
SELECT id, public, file_size_limit FROM storage.buckets ORDER BY id;

-- 7.9 Sequences and AMC proposal numbering
SELECT schemaname, sequencename, last_value
  FROM pg_sequences
 WHERE schemaname = 'public' AND sequencename LIKE 'amc%';
-- expect amc_proposal_number_seq last_value = 6894 (5 Oct 2026) or higher; never lower

SELECT max((regexp_match(proposal_number, '^AMC-\d{4}-(\d+)$'))[1]::bigint) AS max_issued,
       count(*) AS rows
  FROM public.amc_submissions;

-- 7.10 Row counts (take before and after; must be identical for every
--      step except data the app itself writes during the window)
SELECT 'amc_submissions' AS t, count(*) FROM public.amc_submissions
UNION ALL SELECT 'amc_audit_events',   count(*) FROM public.amc_audit_events
UNION ALL SELECT 'snagging_jobs',      count(*) FROM public.snagging_jobs
UNION ALL SELECT 'snagging_clients',   count(*) FROM public.snagging_clients
UNION ALL SELECT 'snagging_properties',count(*) FROM public.snagging_properties
UNION ALL SELECT 'snagging_snags',     count(*) FROM public.snagging_snags
UNION ALL SELECT 'snagging_quotations',count(*) FROM public.snagging_quotations
UNION ALL SELECT 'schedule_entries',   count(*) FROM public.schedule_entries
UNION ALL SELECT 'todos',              count(*) FROM public.todos;

SELECT status, count(*) FROM public.amc_submissions GROUP BY status ORDER BY status;
```

## 8. Rollback and recovery

- **History-row changes are reversible.** `repair --status applied <v>` is undone by `repair --status reverted <v>`, and the reverse also holds. Neither executes schema SQL. The exception is a reverted row's `statements` content, which is lost once the row is deleted. That is why (a)3 exports it first, so it can be re-inserted by hand from the export if needed.
- **Never run `--status reverted` on a row without knowing what it represents.** Do it only after its `statements` are saved and shown to be reflected. Reverting a row whose objects are not in any local file makes the next `db push` blind to them.
- **Schema or data changes need backup or PITR.** This applies to anything executed in (e), or anything executed by mistake (a replay). The pending file `20261005100000` carries an exact rollback in its header (lines 49–59). For an accidental replay of any section 5 file, restore from the PITR point recorded in (a)1. Do not try to hand-reverse a `DELETE`, `TRUNCATE` or `setval`.
- **Baseline (Option 2) rollback**: revert the baseline row, re-apply the 6 orphan rows from the export with `repair --status applied`, and move the archived files back. No production schema changes in that path.
- **Keep the log.** Every command, its output, and before/after results of 7.1a, 7.5, 7.9 and 7.10. If anything deviates from the expected result, stop and do not continue to the next step.

## 9. Status at time of writing (5 Oct 2026)

- Production history has 6 rows, all with generated versions, none matching a local file. The 82 local files at `db3dfc6` are all unrecorded, though most of their objects exist in production.
- The local chain cannot rebuild a database: `snagging_jobs` and `snagging_clients` are created by no file.
- All 7 AMC migrations are reflected in production, the open "Allow All" AMC policy is gone, and `amc_proposal_number_seq` is at 6894.
- Pending in this phase, not applied anywhere: `20261005100000_amc_close_direct_writes.sql` and `20261005150000_restrict_shared_allow_all_policies.sql`. In progress on main, not on this branch: `20261002100000_inspector_role.sql`.
- Recommended path: PITR checkpoint and dumps, then verify, then one production-derived baseline (Option 2) with the 6 orphan rows reverted, then `db push --dry-run`, then push each pending file on its own.
- **Nothing in this document has been run. Production was not touched while writing it. The procedure awaits human / DevOps approval.**
