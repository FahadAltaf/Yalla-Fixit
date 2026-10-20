# Database harness (Finance & Reports)

A throwaway local PostgreSQL 15 cluster for this project's migrations. It never connects to production.

```bash
bash scripts/db-harness/run.sh
```

1. `00_shim.sql` builds the production shape of the tables these migrations touch (`roles`, `role_access`,
   `user_profile`, `technician_reference`, `leave_records`), with production's policies and grants as of
   20 Oct 2026 and Supabase's default privileges for new tables. It seeds a few rows so defaults on existing
   data are checked.
2. Every migration from `20261020000000` on (override with `FIRST_MIGRATION`) is applied **twice**, each in
   one transaction, as production applies them. The second pass proves they are idempotent.
3. `checks/*.sql` run in order. Each assertion prints `ok …`; the first failure raises `FAIL …` and stops the
   run with a non-zero exit.

Needs PostgreSQL 15 binaries (`PGBIN`, default `/c/Program Files/PostgreSQL/15/bin`). Uses port 55433
(`PORT`) and `.out/` (ignored) for the data directory and log.

**Gap (B-07)**: production's schema cannot be rebuilt from the repository, so the shim models only what the
migrations here depend on. Add a table to the shim, with production's columns, before a migration touches it.

Ported from the AMC harness on `amc-hardening` (`scripts/amc-db-harness/`), generic parts only.
