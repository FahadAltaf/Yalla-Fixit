# Migration log (Finance & Reports branch)

Every migration this branch adds, in apply order. Applied by the user, one file at a time, on the production
database (decision of 20 Oct), with the pre-check first and the post-check after. **Never
`supabase db push`.** Fill in the row when applied.

| # | Version | File | Apply when | Checks | Applied at (Dubai) | By | Pre-check OK | Post-check OK |
|---|---|---|---|---|---|---|---|---|
| 1 | 20261020100000 | reporting_platform.sql | Any time | [20261020100000.md](migrations/20261020100000.md) | 20 Oct 2026 | User | ✓ | ✓ (tables confirmed live) |
| 2 | 20261020110000 | people_reporting_fields.sql | **Before this branch's code runs anywhere** | [20261020110000.md](migrations/20261020110000.md) | 20 Oct 2026 | User | ✓ | ✓ (6, 1, 1, t, 0, 0, 0; 118/17/5) |
| 3 | 20261020130000 | fsm_read_model.sql (schema `fsm`; then expose `fsm` in API settings) | Any time; before the first sync run | [20261020130000.md](migrations/20261020130000.md) | 20 Oct 2026 | User | ✓ | ✓ (9, 3, 7, 0, 0, f, t); schema exposed |
| 4 | 20261021100000 | finance_core.sql (schema `finance`; then expose `finance` in API settings) | After row 3 | [20261021100000.md](migrations/20261021100000.md) | 21 Oct 2026 | User | ✓ | ✓ (5, 1, 6, 0, f, t, f); schema exposed; anon key refused (42501) |
| 5 | 20261021110000 | finance_queue_list.sql (one read-only view) | After row 4 | [20261021110000.md](migrations/20261021110000.md) | 21 Oct 2026 | User | ✓ | ✓ (t, t, f) |
| 6 | 20261021120000 | finance_hold_query_fix.sql (replaces `finance.apply_action`) | Any time after row 4 | Post-check in the file header (expect `t`) | 21 Oct 2026 | User | ✓ | ✓ |
| 7 | 20261021130000 | finance_stuck_query_recovery.sql (replaces `finance.apply_action` again) | After row 6 | Post-check in the file header (expect `t`) | 21 Oct 2026 | User | ✓ | ✓ |
| 8 | 20261022100000 | reports_foundation.sql (schema `reports`: saved filters, access log) | Any time; then expose `reports` | [20261022100000.md](migrations/20261022100000.md) | 22 Oct 2026 | User | ✓ | ✓ (saved filters and access log read through the API; `reports` exposed) |
| 9 | 20261022110000 | finance_evidence_bucket.sql (private Storage bucket `finance-evidence`, 10 MB, no policies) | Any time | Pre-check `select count(*) from storage.buckets where id = 'finance-evidence'` → 0; post-check in the file header (expect `f \| 10485760`) | 22 Oct 2026 | User | ✓ | ✓ (bucket private, 10 MB) |
| 10 | 20261023100000 | hr_compliance.sql (schema `hr`: waivers, outage batches, finalised months and statements; then expose `hr`) | Any time | Pre-check `select to_regnamespace('hr')` → null; post-check in the file header (expect `4 \| 2 \| f \| f`) | 22 Oct 2026 | User | ✓ | ✓ (4 tables read through the API; `hr` exposed; `record_waivers` answers) |
| 11 | 20261024100000 | finance_line_ledger.sql (Ready to invoice on live FSM work orders: Ready marks, partial invoicing, workflow and exclusions per work order: `finance.line_states`, `line_invoices`, `line_invoice_allocations`, `work_order_states`, `wo_exclusions`, `line_events`; 5 functions) | Any time | Pre-check `select to_regclass('finance.line_states')` → null; post-check in the file header (expect `6 \| 5`) | 22 Oct 2026 | User | ✓ | ✓ (ledger tables read through the API, empty) |
| 12 | 20261025100000 | finance_work_order_snapshot.sql (8 nullable columns on `finance.work_order_states` and `finance.snapshot_work_order`: what a work order looked like in FSM when the portal last acted on it, for the metrics, the digest and waiting work outside the list's dates) | After row 11 | Pre-check `select to_regprocedure('finance.snapshot_work_order(text, jsonb, jsonb)')` → null; post-check in the file header (expect `8 \| 1`) | | | | |

Ported from `amc-hardening` in P0 (already in production per the 6 Oct log, nothing to apply):
`20261005150000`, `20261006161000`, `20261006163000`.

**Held until this branch deploys (B-02):** `20261006160000_role_tables_server_only`. Applied earlier, the live
Users, Roles and Permissions screens on `main` stop saving.
