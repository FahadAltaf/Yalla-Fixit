# Production migration log (AMC, and what shares its database)

DEV-506 (22 Nov 2026). Every migration in `supabase/migrations` from 5 Oct 2026, and whether it is on the
production database. Migrations are applied by the user, one file at a time, in the Supabase SQL editor.
**Never `supabase db push`.** Finance and Reports keep their own detailed log in
[docs/finance-reporting/migration-log.md](../finance-reporting/migration-log.md).

**How the Status column was filled:** a read-only probe on 22 Nov 2026 (service key, REST API, `limit=0`)
asked whether each file's first new table, or first added column, exists. **Present** means that object is
there; it is good evidence the file was applied, not a full check of everything in it. Files that only change
policies, grants, functions, triggers, views or indexes have no table or column to probe: their status comes
from the notes named in the last column, or is **Not probed**. When you apply one, write the date and your
initials in **Applied**.

| Version | File | Probe object | Status | Applied | Notes |
|---|---|---|---|---|---|
| 20261005100000 | amc_close_direct_writes | — | Not probed | | Policies |
| 20261005110000 | amc_proposal_number_beyond_9999 | — | Not probed | | Function |
| 20261005150000 | restrict_shared_allow_all_policies | — | In production (6 Oct log) | | Finance log: ported, already live |
| 20261005160000 | settings_hide_zoho_token | — | Not probed | | Grants |
| 20261005170000 | estimate_tables_server_only | — | Not probed | | Grants |
| 20261005180000 | password_resets_server_only | — | Superseded | | Table part re-applied by 20261105100000 |
| 20261006100000 | active_amc_contracts | amc_contracts | Present | | |
| 20261006110000 | active_amc_operations | amc_renewal_reminders | Present | | |
| 20261006120000 | amc_fsm_integration | amc_fsm_service_mappings | Present | | |
| 20261006130000 | amc_business_operations | customers | Present | | |
| 20261006140000 | amc_atomic_activation_and_dashboard | — | Not probed | | Function `amc_activate_contract` (contracts are created on prod, so it is there) |
| 20261006150000 | amc_business_completion | amc_notifications | Present | | |
| 20261006160000 | role_tables_server_only | — | Superseded | | Do not apply: included in 20261105100000 |
| 20261006161000 | todos_and_uploads_tightened | — | Partly | | Finance log: todos part not in effect; re-applied by 20261105100000 |
| 20261006162000 | amc_history_survives_user_deletion | — | Not probed | | FK changes |
| 20261006163000 | shared_tables_server_only | — | Partly | | Finance log: re-applied by 20261105100000 |
| 20261007100000 | amc_audit_events_guard | — | Not probed | | Trigger |
| 20261007110000 | amc_platform_foundation | amc_config | Present | | |
| 20261007120000 | amc_client_property_assets | amc_customer_contacts | Present | | |
| 20261007130000 | amc_enquiries_and_site_visits | amc_enquiries | Present | | |
| 20261007140000 | amc_rate_card_and_proposal_versions | amc_rate_card_versions | Present | | |
| 20261007150000 | amc_approval_ladder_and_send_log | amc_approval_steps | Present | | |
| 20261007160000 | amc_contract_lifecycle | amc_contract_signatories | Present | | |
| 20261007170000 | amc_shared_clients | amc_client_profiles | Present | | |
| 20261008100000 | per_page_permissions | — | Not probed | | Permission rows |
| 20261008100100 | amc_payments | amc_instalments | Present | | |
| 20261008110000 | amc_ppm_schedule | amc_visits | Present | | |
| 20261008120000 | amc_visit_assignment_and_confirmation | amc_technician_profiles | Present | | |
| 20261009100000 | push_tokens | snagging_push_tokens | Present | | |
| 20261012100000 | amc_per_page_permissions | — | Not probed | | Permission rows |
| 20261012110000 | amc_visit_job_sheets | amc_visit_job_sheets | Present | | |
| 20261012120000 | amc_call_outs_additional_work_allowances | amc_call_outs | Present | | |
| 20261012130000 | amc_client_report | — | Not probed | | |
| 20261012140000 | amc_renewal_outcomes_and_amendments | amc_contract_amendments | Present | | |
| 20261013100000 | amc_status_history_triggers | — | Not probed | | Triggers |
| 20261013150000 | snagging_quotation_office_notes | snagging_quotations.notes | Present | | |
| 20261014100000 | snagging_fsm_quotation_sync | snagging_fsm_sync_log | Present | | |
| 20261015100000 | snagging_fsm_clients | snagging_clients.fsm_contact_id | Present | | |
| 20261015110000 | snagging_fsm_jobs | snagging_jobs.fsm_work_order_id | Present | | |
| 20261015120000 | snagging_client_maher_id | snagging_clients.maher_id | Present | | |
| 20261019100000 | amc_version_lock_approved | — | Not probed | | Trigger |
| 20261020100000 | reporting_platform | reporting_settings | Present | 20 Oct (finance log) | |
| 20261020100000 | snagging_quotation_void | snagging_quotations.voided_at | Present | | Same version number as the row above |
| 20261020110000 | people_reporting_fields | org_public_holidays | Present | 20 Oct (finance log) | |
| 20261020130000 | fsm_read_model | fsm.sync_state | Present | 20 Oct (finance log) | |
| 20261021100000 | finance_core | finance.queue_items | Present | 21 Oct (finance log) | |
| 20261021110000 | finance_queue_list | — | Applied | 21 Oct (finance log) | View |
| 20261021120000 | finance_hold_query_fix | — | Applied | 21 Oct (finance log) | Function |
| 20261021130000 | finance_stuck_query_recovery | — | Applied | 21 Oct (finance log) | Function |
| 20261022100000 | reports_foundation | reports.saved_filters | Present | 22 Oct (finance log) | |
| 20261022110000 | finance_evidence_bucket | — | Applied | 22 Oct (finance log) | Storage bucket |
| 20261023100000 | hr_compliance | hr.waiver_batches | Present | 22 Oct (finance log) | |
| 20261024100000 | finance_line_ledger | finance.line_states | Present | 22 Oct (finance log) | |
| 20261025100000 | finance_work_order_snapshot | finance.work_order_states.client_name | Present | | |
| 20261026100000 | finance_progress | finance.progress_entries | Present | | |
| 20261026120000 | compliance_core | compliance_certificate_types | Present | | |
| 20261028100000 | technician_hours_history | technician_attribute_history | Present | by 29 Oct (finance log) | |
| 20261029100000 | hr_disputes | hr.disputes | Present | 29 Oct (finance log) | |
| 20261029120000 | compliance_documents | compliance_documents | Present | | |
| 20261029130000 | compliance_site_sync_and_jobs | compliance_job_runs | Present | | |
| 20261031120000 | workforce_employee_leave | employee_leave_records | Present | | |
| 20261102100000 | technician_weekly_hours | technician_reference.weekly_hours | Present | 2 Nov (finance log) | |
| 20261103100000 | finance_query_threads | finance.query_threads | Present | 2 Nov (finance log) | |
| 20261103110000 | finance_fsm_completion_log | — | Applied | 2 Nov (finance log) | Function |
| 20261104100000 | finance_not_invoiceable_both_sides | finance.wo_exclusions.marked_by_side | Present | 2 Nov (finance log) | |
| 20261104110000 | finance_refusals_no_retry | — | Applied | | Applied per the 2 Nov notes; functions |
| 20261105100000 | close_anon_table_access | — | Applied | 3 Nov (finance log) | Grants |
| 20261110100000 | amc_performance_indexes | — | Not probed | | Indexes |
| 20261111100000 | amc_field_visits_view | — | Not probed | | View `amc_field_visits` (the Visits list works on prod, so it is there) |
| 20261112100000 | amc_additional_work_slot | amc_additional_works.scheduled_start | Present | | |
| 20261113100000 | amc_assessment_photo_category | amc_visit_photos.category | Present | | |
| 20261116100000 | amc_work_photo_category | amc_work_photos.category | Present | | |
| 20261116110000 | amc_site_visit_approval | amc_site_visit_changes | Present | | |
| 20261117100000 | amc_visit_checklist_category | amc_visit_checklist_items.category | Present | | |
| 20261117120000 | amc_pass_access_type | amc_documents.access_rule_id | Present | | |
| 20261117130000 | amc_call_out_work_start | amc_call_outs.access_status | Present | | |
| 20261118100000 | amc_field_job_sheets | amc_visit_job_sheets.call_out_id | Present | | |
| 20261118110000 | amc_field_visits_started | — | Not probed | | View |
| 20261118120000 | amc_visits_started | amc_visits.started_at | Present | | |
| 20261118130000 | amc_visit_charges | amc_visit_charges | Present | | |
| 20261118140000 | amc_call_out_review_stage | — | Not probed | | CHECK change |
| 20261118150000 | finance_invoice_guards | finance.line_invoices.maher_total | Present | | |
| 20261118160000 | finance_line_billable | finance.line_states.billable | Present | | |
| 20261119100000 | amc_field_visits_all_additional_work | — | Not probed | | View |
| 20261120100000 | amc_technician_day_reminder | snagging_notifications.amc_kind | Present | 22 Nov 2026 (user) | DEV-398: the crew's reminder on the day; live-safe |
| 20261122100000 | amc_client_links | amc_client_links | Present | 22 Nov 2026 (user) | DEV-507 / DEV-494: client links without a login; live-safe, new table only |
| **20261123100000** | **amc_daily_jobs_cron** | cron.job amc-daily-jobs | **Not applied** | | DEV-485: the daily job at 06:00 Dubai. Only after the live portal runs the DEV-485 code; needs CRON_SECRET on the host and two Vault secrets (see the file) |
| 20261123110000 | notifications_realtime | pg_publication_tables portal_notifications | Present | 23 Nov 2026 (user) | Live notifications in the portal: users read their own in-app notifications; both notification tables join the Realtime feed. Live-safe, any time; the anon key stays shut out |
| **20261124100000** | **amc_amendments_allow_self_decision** | constraint amc_amendments_not_self_decided gone | **Not applied** | | 24 Nov 2026 (Sami): an approver may decide their own amendment. Drops the two-person check on amc_contract_amendments. Live-safe, any time |
| **20261124110000** | **amc_fsm_quotation_number** | columns amc_call_outs.fsm_quotation_no, amc_additional_works.fsm_quotation_no | **Not applied** | | DEV-508 (24 Nov 2026): the FSM quotation number, required before a chargeable call out is closed or additional work completed. Six nullable columns. Live-safe, any time |
| **20261124120000** | **amc_handyman_hours** | columns amc_call_outs.handyman_teams, hours_used, hours_chargeable | **Not applied** | | DEV-495 (24 Nov 2026): a call out booked as a handyman job against the free hours, with its teams; team-hours recorded at closing. Three nullable columns. Live-safe, any time |

## To apply next

1. `20261124100000_amc_amendments_allow_self_decision.sql`, any time (live-safe). Until it is applied, approving an amendment you asked for is refused with a message saying so; another approver can still decide it.
2. `20261124110000_amc_fsm_quotation_number.sql`, any time (live-safe). Until it is applied the close dialog neither shows nor requires the FSM quotation number.
3. `20261124120000_amc_handyman_hours.sql`, any time (live-safe). Until it is applied a call out cannot be booked as a handyman job; everything else is as before.
4. `20261123100000_amc_daily_jobs_cron.sql`, **only after the live portal runs the DEV-485 code** (older code runs every AMC job, client emails included). Before it: CRON_SECRET set on the live host, and the two Vault secrets the file names.
