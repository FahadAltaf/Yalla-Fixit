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
| 8 | 20261022100000 | reports_foundation.sql (schema `reports`: saved filters, access log) | Any time; then expose `reports` | [20261022100000.md](migrations/20261022100000.md) | | | | |
| 9 | 20261022110000 | finance_evidence_bucket.sql (private Storage bucket `finance-evidence`, 10 MB, no policies) | Any time | Pre-check `select count(*) from storage.buckets where id = 'finance-evidence'` → 0; post-check in the file header (expect `f \| 10485760`) | | | | |

Ported from `amc-hardening` in P0 (already in production per the 6 Oct log, nothing to apply):
`20261005150000`, `20261006161000`, `20261006163000`.

**Held until this branch deploys (B-02):** `20261006160000_role_tables_server_only`. Applied earlier, the live
Users, Roles and Permissions screens on `main` stop saving.
