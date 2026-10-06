# AMC database harness

Throwaway local PostgreSQL 15 checks for the AMC migrations. **Nothing here connects to production.** Each script starts its own cluster on a local port under `.out/`, and stops it when done.

Requirements: Git Bash and PostgreSQL 15 binaries. Set `PGBIN` if they are not in `/c/Program Files/PostgreSQL/15/bin`. `compat.sh` and `scale.sh` also read `origin/main` with `git show`, so run `git fetch origin` first.

| Script | What it proves |
|---|---|
| `bash run.sh` | Every migration from `20261005` on applies cleanly **twice**. Behavioural checks `90`–`96`, and schema invariants `97`: RLS and grants, no CASCADE into history, no duplicate indexes, FK indexes, money types, function security, numbering past 9999, atomic activation, dashboard figures |
| `bash compat.sh` | Builds main's AMC schema from `origin/main`, then replays main's database contract (`80_main_contract.sql`) at baseline and after each new migration. Prints the PASS/FAIL matrix (`docs/amc-migration-safety-report.md` §4) |
| `bash scale.sh` | About 10k synthetic contracts (`98`), `EXPLAIN ANALYZE` of the app's queries (`99`, output in `.out/explain.txt`) and the two-session race tests (`concurrency.sh`) |

`00_supabase_shim.sql` stands in for the Supabase parts the migrations touch: roles, `auth.uid()`, default privileges, and the shared tables with their live "Allow All" policies.
