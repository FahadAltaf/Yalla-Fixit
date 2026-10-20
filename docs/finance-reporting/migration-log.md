# Migration log (Finance & Reports branch)

Every migration this branch adds, in apply order. Applied by the user, one file at a time, on the production
database (decision of 20 Oct), with the pre-check first and the post-check after. **Never
`supabase db push`.** Fill in the row when applied.

| # | Version | File | Apply when | Checks | Applied at (Dubai) | By | Pre-check OK | Post-check OK |
|---|---|---|---|---|---|---|---|---|
| 1 | 20261020100000 | reporting_platform.sql | Any time | [20261020100000.md](migrations/20261020100000.md) | | | | |
| 2 | 20261020110000 | people_reporting_fields.sql | **Before this branch's code runs anywhere** | [20261020110000.md](migrations/20261020110000.md) | | | | |

Ported from `amc-hardening` in P0 (already in production per the 6 Oct log, nothing to apply):
`20261005150000`, `20261006161000`, `20261006163000`.

**Held until this branch deploys (B-02):** `20261006160000_role_tables_server_only`. Applied earlier, the live
Users, Roles and Permissions screens on `main` stop saving.
