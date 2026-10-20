# Database design and migration plan

Part of the [Finance & Reports plan](README.md). Column lists are the design; FSM-mirror columns are
confirmed where discovery reached them and marked *provisional* where B-01 blocks it.

## Rules for every migration on this branch

Development runs against the **production database** (decision of 20 Oct), so:

1. **Additive and harmless to live `main`.** New tables, nullable or defaulted new columns, new indexes
   built `CONCURRENTLY` where the table is live. No renames, no drops, no type changes, no constraint that
   live data could violate.
2. **Applied by the user**, one file at a time (SQL editor or `psql -1`), with the pre-check and post-check
   SQL shipped beside each file, logged in `docs/production-migration-log.md`. **Never `supabase db push`.**
3. **Idempotent**: `create … if not exists`, `on conflict do nothing`, guarded `do $$` blocks, so a re-run is
   harmless.
4. **New tables are server-only**: RLS enabled, no grants to `anon` or `authenticated`, reached only through
   service-role routes that check permissions first (the direction of `20261006163000`).
5. **Money is `numeric(14,2)`**, timestamps are `timestamptz`, FSM ids are `text` with explicit names
   (`fsm_*_id`).
6. **Rollback** is a reviewed `drop … if exists` script per migration, kept beside it and never run
   automatically. New tables hold no live-relied-upon data until go-live, so dropping them is safe up to then.
7. **Append-only tables use a trigger that raises, never `DO INSTEAD NOTHING` rules.** A rule on a table with
   a foreign key to `user_profile` (`ON DELETE SET NULL`) makes **every** user deletion fail with an internal
   referential-integrity error, even when the table is empty (reproduced on Postgres 15 in P1). Actors in
   audit tables are therefore plain `uuid` columns with an `actor_label`, not foreign keys.
8. **Rows addressed to a user go with the user** (`ON DELETE CASCADE`) when a check requires a recipient;
   `SET NULL` there would violate the check and block the deletion just the same.

## Existing tables used or extended

| Table | Use | Change (additive) |
|---|---|---|
| `user_profile` | People, roles | `hidden_from_lists boolean not null default false` |
| `technician_reference` | FSM technicians | `user_profile_id uuid null references user_profile(id) on delete set null` (unique where not null), `email text null`, `employment_status text not null default 'active' check (in ('active','resigned'))`, `leaving_date date null`, `hidden_from_lists boolean not null default false`, `rest_weekdays smallint[] null` |
| `leave_records` | Leave | `leave_category text null check (in ('annual','sick','public_holiday','offset'))`; free-text `leave_type` kept for live `main` |
| `roles`, `role_access` | Access | Seed rows only (new roles, new resources) |
| `settings` | Org shift times, time zone | Read only |

## New tables

### FSM read model (P2)

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `fsm_sync_state` | `resource text pk`, `watermark timestamptz`, `last_run_at`, `last_success_at`, `last_error text`, `consecutive_failures int` | — |
| `fsm_sync_runs` | `id uuid pk`, `resource`, `started_at`, `finished_at`, `pages int`, `records int`, `calls int`, `status`, `error` | idx `(resource, started_at desc)` |
| `fsm_estimates` | `fsm_estimate_id text pk`, `number`, `status`, `post_to_maher text`, `maher_invoice_number text`, `grand_total`, `sub_total`, `tax_amount numeric(14,2)`, `owner_name`, `owner_email`, `fsm_contact_id`, `fsm_company_id`, `expiry_date date`, `created_in_fsm_at`, `approved_at`, `rejected_at`, `expired_at`, `status_changed_at`, `quotation_type`, `root_number`, `fsm_work_order_id`, `modified_time`, `synced_at` | idx `(status, status_changed_at)`, `(post_to_maher)` where not null, `(modified_time)` |
| `fsm_estimate_status_events` | `id bigserial pk`, `fsm_estimate_id`, `from_status`, `to_status`, `observed_at` | unique `(fsm_estimate_id, to_status, observed_at)`; idx `(fsm_estimate_id, observed_at)` |
| `fsm_work_orders` | `fsm_work_order_id text pk`, `number`, `status`, `type`, `work_type`, `completed_at`, `fsm_estimate_id`, `grand_total`, `sub_total`, `tax_amount`, `billing_status`, `amc_contract_ref`, `parent_fsm_work_order_id`, `modified_time`, `synced_at` | idx `(fsm_estimate_id)`, `(status, completed_at)`, `(modified_time)` |
| `fsm_line_items` | `fsm_line_id text pk`, `fsm_work_order_id`, `fsm_estimate_id`, `kind` (service/part), `name`, `description`, `quantity numeric(12,3)`, `unit_price numeric(14,2)`, `amount numeric(14,2)`, `tax_percent`, `status`, `sequence int`, `synced_at` | idx `(fsm_work_order_id)`, `(fsm_estimate_id)` |
| `fsm_appointments` | `fsm_appointment_id text pk`, `fsm_work_order_id`, `status`, `type`, `scheduled_start`, `scheduled_end`, `actual_start`, `actual_end`, `actual_duration_minutes`, `cancelled_at`, `cancellation_reason`, `modified_time`, `synced_at` | idx `(scheduled_start)`, `(fsm_work_order_id)`, `(status, actual_start)` |
| `fsm_appointment_resources` | `fsm_appointment_id`, `technician_fsm_id` | pk `(fsm_appointment_id, technician_fsm_id)`; idx `(technician_fsm_id)` |
| `fsm_trips` *provisional (B-01)* | trip id, technician, start, end, distance | — |
| `fsm_checkin_events` *provisional (B-01, D-15)* | event id, technician, kind (shift_in/out, appt_in/out), at, appointment id | unique on FSM event id |

### Finance (P3)

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `fin_queue_items` | `id uuid pk`, `fsm_estimate_id`, `fsm_work_order_id`, `client_name`, `client_ref` (snapshot), `status` (`pending`,`in_progress`,`query_raised`,`on_hold`,`excluded`,`invoiced`), `value_snapshot numeric(14,2)`, `estimate_total_snapshot`, `assignee_id`, `coordinator_id`, `entered_at`, `status_changed_at`, `hold_reason`, `trigger_key text` | **unique `(trigger_key)`** (replayed triggers are no-ops); idx `(status, status_changed_at)`, `(fsm_estimate_id)`, `(assignee_id)` where status in open set |
| `fin_queue_item_lines` | `queue_item_id fk`, `fsm_line_id`, `description`, `quantity`, `unit_price`, `amount` (snapshots), `invoice_id uuid null` | **unique `(fsm_line_id)`** — a line appears in exactly one item, ever; idx `(queue_item_id)` |
| `fin_invoices` | `id uuid pk`, `queue_item_id` **unique**, `maher_invoice_number`, `invoice_date date`, `amount numeric(14,2)`, `queue_value_snapshot`, `variance numeric generated always as (amount - queue_value_snapshot) stored`, `variance_reason`, `idempotency_key` **unique**, `recorded_by`, `recorded_at` | check: `variance = 0 or length(trim(variance_reason)) > 0`; append-only (no update/delete rules) |
| `fin_exclusions` | `id uuid pk`, `queue_item_id`, `reason_code`, `reason_note`, `evidence jsonb`, `requested_by`, `requested_at`, `decision` (`pending`,`verified`,`rejected`), `decided_by`, `decided_at`, `decision_note` | partial unique `(queue_item_id) where decision = 'pending'` |
| `fin_queue_events` | `id bigserial pk`, `queue_item_id`, `event_type`, `from_status`, `to_status`, `actor_id`, `note`, `payload jsonb`, `created_at` | append-only; idx `(queue_item_id, created_at)`, `(event_type, created_at)` |

Functions: `fin_create_queue_item`, `fin_transition`, `fin_record_invoice` (`security definer` is not
needed; they run under the service role). View: `fin_estimate_progress` (cumulative invoiced, remaining,
completion % per estimate, from `fin_queue_item_lines` joined to `fin_invoices`).

### Reports, HR and platform (P1, P5–P7)

| Table | Purpose | Key constraints |
|---|---|---|
| `portal_notifications` | N1–N14 in-app, E1–E3 delivery log | `dedupe_key` unique per `(recipient_key, channel)`; idx `(recipient_user_id, resolved_at, created_at)` |
| `reporting_settings` | One override row (AMC pattern) | `id smallint pk check (id = 1)` |
| `org_public_holidays` | Public holiday calendar | unique `(holiday_date)` |
| `hr_missed_checkins` | One row per miss | **unique `dedupe_key`** (technician, date, event, appointment) → one alert per miss |
| `hr_waiver_batches` | Bulk outage waivers | — |
| `hr_waivers` | Waived misses | unique `(missed_checkin_id)`; append-only |
| `hr_disputes` | Technician disputes | partial unique one open dispute per miss |
| `hr_compliance_months` | `open` → `statement_sent` → `finalized` | unique `(month)` |
| `hr_compliance_statements` | Frozen figures + settings snapshot | unique `(month, technician_fsm_id)`; append-only |
| `report_saved_filters` | Per user per report | unique `(user_id, report_key, name)` |
| `report_access_log` | Views and exports (BRD §6.9 note) | idx `(report_key, created_at)` |

## Migration order and dependencies

| Order | Migration | Depends on | Live-safe? |
|---|---|---|---|
| 0 | Ported security (`20261005150000`, `20261006161000`, `20261006163000`) | — | Already applied to production (6 Oct log) |
| 0b | `20261006160000_role_tables_server_only` | **This branch's code deployed** | **Hold** until then |
| 1 | Platform: `portal_notifications`, `reporting_settings`, roles/resources seed | 0 | Yes |
| 2 | People: `technician_reference`, `user_profile`, `leave_records` columns; `org_public_holidays` | — | Yes (nullable/defaulted) |
| 3 | FSM read model | — | Yes |
| 4 | Finance tables and functions | 3 | Yes |
| 5 | Reports: saved filters, access log | 1 | Yes |
| 6 | HR / compliance | 2, 3, B-01 | Yes |

## Impact on existing modules

- **Snagging, Scheduling, AMC on `main`**: no existing column changes meaning; new columns default to the
  current behaviour (`hidden_from_lists = false`, `employment_status = 'active'`).
- **Hide-from-lists** must be honoured in five paths (P1): `lib/server/snagging/staff.ts`
  (`listSnaggingStaff`), `usersService.getUsers` consumers (to-dos assignee picker), `getApproverRecipients`,
  `listAmcUsers`, `lib/server/scheduling-technicians.ts` (`listTechniciansForViewer`). The Users admin list
  must still show hidden users.
- **`amc-hardening`** adds ~50 `amc_*` tables and edits shared files; none of this project's tables share a
  name. Migration timestamps on this branch sort after `20261019100000` (the latest on `amc-hardening`).

## Scale test volumes

Counted on the production database, 20 Oct 2026: `technician_reference` **118** (115 active),
`user_profile` **17**, `leave_records` **5**, `schedule_entries` 476, `snagging_clients` 25. FSM record
volumes (quotations, work orders, appointments) are unknown until counted (B-04); the discovery samples
were capped at 600 per module and say nothing about totals.

Tests run against these volumes, chosen to exceed a plausible five-year horizon for one business unit:

| Entity | Test volume | Basis |
|---|---|---|
| Quotations | 50 000 | Unknown (B-04); generous ceiling |
| Work orders | 50 000 | Unknown (B-04); generous ceiling |
| Line items | 500 000 | ~10 per work order |
| Queue items / invoice lines | 100 000 / 500 000 | every line once |
| Technicians | 300 | 118 today (115 active) |
| Appointments | 600 000 | ~300 a day for 5 years (assumed; B-04) |
| Check-in events | 2 400 000 | 4 per appointment |
| Compliance statements | 18 000 | 300 technicians × 60 months |

Benchmarks (queue list, item detail, progress view, utilization month, compliance month) are run with
`EXPLAIN (ANALYZE, BUFFERS)` on the throwaway-Postgres harness and recorded. No figure is reported until it
has been measured.
