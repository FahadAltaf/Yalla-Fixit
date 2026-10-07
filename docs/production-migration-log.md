# Production migration log

Every migration applied to the **production** database outside `supabase db push`, in order.

At release, each row is marked applied in Supabase's migration history (`supabase migration repair --status applied <version>`, runbook §3), so it is never run twice.

Rules: one file at a time; pre-check first; never `supabase db push` on production. Checks: `docs/production-migration-checks.md`.

| # | Version | File | Applied at (Dubai time) | Applied by | Pre-check OK | Post-check / live check OK | Notes |
|---|---|---|---|---|---|---|---|
| 1 | 20261005100000 | amc_close_direct_writes.sql | | | | | |
| 2 | 20261005110000 | amc_proposal_number_beyond_9999.sql | | | | | |
| 3 | 20261005150000 | restrict_shared_allow_all_policies.sql | | | | | |
| 4 | 20261006100000 | active_amc_contracts.sql | | | | | |
| 5 | 20261006110000 | active_amc_operations.sql | | | | | |
| 6 | 20261006120000 | amc_fsm_integration.sql | | | | | |
| 7 | 20261006130000 | amc_business_operations.sql | | | | | |
| 8 | 20261006140000 | amc_atomic_activation_and_dashboard.sql | | | | | |
| 9 | 20261006150000 | amc_business_completion.sql | | | | | |
| 10 | 20261006161000 | todos_and_uploads_tightened.sql | | | | Live check A | |
| 11 | 20261006162000 | amc_history_survives_user_deletion.sql | | | | | |
| 12 | 20261006163000 | shared_tables_server_only.sql | | | | Live check B | |
| 13 | 20261007100000 | amc_audit_events_guard.sql (Phase 0) | | | | Post-check §5 | |
| 14 | 20261007110000 | amc_platform_foundation.sql (Phase 1) | | | | Post-check §6, open Todos | |
| 15 | 20261007120000 | amc_client_property_assets.sql (Phase 2) | | | | Post-check §7, open AMC Proposals | |
| 16 | 20261007130000 | amc_enquiries_and_site_visits.sql (Phase 3) | | | | Post-check §8, open AMC Proposals | |
| 17 | 20261007140000 | amc_rate_card_and_proposal_versions.sql (Phase 4, live table: out of hours) | | | | Post-check §9, open and save a proposal | |
| 18 | 20261007150000 | amc_approval_ladder_and_send_log.sql (Phase 5, live table: out of hours) | | | | Post-check §10, open a proposal | |

**Held until release (Group B, do not apply):** 20261005160000, 20261005170000, 20261005180000, 20261006160000.
