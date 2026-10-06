# AMC migration safety report

**Date:** 6 October 2026. **Branch:** `amc-hardening`. **Production project:** `sxzpigyphjotuubxpooj`.
**Nothing here has been applied to production.** `main` was inspected read-only with `git show origin/main:…` and never checked out or changed.
**Companion:** [`amc-database-architecture.md`](amc-database-architecture.md).

## Answer

> **CAN THESE MIGRATIONS BE APPLIED WHILE CURRENT MAIN IS LIVE? PARTIALLY.**

- **YES, 9 of 12:**
  - `20261005100000`, `20261005110000`, `20261005150000`;
  - all six AMC migrations, `20261006100000` to `20261006150000`.

  They were applied one by one on a copy of main's AMC schema. After each one, main's real AMC queries were replayed with the roles main uses, and **all 23 AMC checks passed every time**, as did main's two service-role scheduling and Zoho token checks (§4).
- **NO, 3 of 12, until the `amc-hardening` code is deployed first:** `20261005160000`, `20261005170000` and `20261005180000`. They remove browser-role access that **current main still uses**:

| Migration | What in live main breaks | Proven by |
|---|---|---|
| `20261005160000_settings_hide_zoho_token` | `context/AuthContext.tsx` loads `settings` (including `oauth_access_token`) through pg_graphql with the **anon** key, so the app shell's settings load fails. Appearance and Organization settings save through graphql (anon), so saving fails. `/api/estimates/revision`, `/api/zoho-file`, `/api/test` read the token with the user's session (**authenticated**) | `graphql.settings_with_token_anon`, `graphql.settings_update_anon`, `estimates.token_read_authenticated` → `permission denied for table settings` |
| `20261005170000_estimate_tables_server_only` | `/api/estimates`, `/api/estimates/revision`, `/api/estimates/service-item-images` read and write `estimate_revisions` / `estimate_service_items` with the user's session | `estimates.revisions_*_authenticated`, `estimates.service_items_rw_authenticated` → `permission denied` |
| `20261005180000_password_resets_server_only` | `requestPasswordReset` / `resetPassword` (`modules/auth/auth-actions.ts`) use the cookie client with the **anon** key | `auth.password_reset_*_anon` → `permission denied` |

The runbook already orders these three after the code deploy (D1 before D5, D6, D8). This report confirms that ordering is **required, not just cautious**. Applying any of them while today's main serves traffic breaks:
- sign-in branding/settings (D5);
- the estimates screens (D6);
- forgotten-password (D8).

## 1. Existing main schema baseline

Taken from `origin/main`'s seven AMC migrations (`20260721120000`, `20260915120000`, `20260915130000`, `20260916100000`, `20260916105000`, `20260916110000`, `20260922130000`). These are byte-identical on `amc-hardening`; production reflects all of them (`database-migration-reconciliation.md`).

| Object | Baseline |
|---|---|
| `amc_submissions` | ~45 columns. Workflow: `status` CHECK (draft, awaiting_approval, sent_back, approved, proposal_sent, proposal_rejected, proposal_approved, contract_sent, signed). Proposal fields: `proposal_number` NOT NULL with default from `amc_proposal_number_seq`, token hash/hint/expiry ×2, client decision, signature, snapshots. Money `numeric` unconstrained |
| Constraints | sent_back needs a reason; signed needs a name; rejection needs a reason; `owner_id → user_profile ON DELETE CASCADE` |
| Indexes | pkey; unique `idx_amc_submissions_proposal_number`; unique proposal/contract token hashes; `(status, submitted_at)` |
| Policies | owner read / insert / update; approver read / decide (5). Anon revoked |
| `amc_settings` | Single row (`id = 1` CHECK), `overrides` jsonb. RLS on, no policy, no browser grant |
| `amc_audit_events` | bigserial. `entity_type` CHECK (`submission`, `settings`); `origin` CHECK. Rules `no_update` / `no_delete` (`DO INSTEAD NOTHING`). Indexes on entity and created_at |
| Sequences | `amc_proposal_number_seq`, `amc_audit_events_id_seq` |

**How live main uses them:**
- Every AMC route (`/api/amc-submissions/*`, `/api/amc/[token]`) and `lib/server/amc/{settings,audit}.ts` use **`createAdminServerClient` (service role)**. No main component queries an AMC table from the browser.
- Main's queries were extracted from the code and replayed (`80_main_contract.sql`):
  - create draft (proposal number from the default), list page and count, read one (`select *`);
  - owner update, submit, pending approvals, approve, send;
  - token lookup (`proposal_token_hash = h OR contract_token_hash = h`);
  - client approve, send contract, sign;
  - settings snapshot, settings upsert/read;
  - audit insert (submission, settings), history reads, audit append-only, deleting a submission.

**Live non-AMC paths on tables the hardening migrations lock:**
- `settings`: graphql anon read and write; token reads with the user session.
- `estimate_revisions` / `estimate_service_items`: user session.
- `password_resets`: anon.
- `schedule_audit_events`: service role, so it is unaffected.

**Production data (read-only, 5–6 Oct 2026):**
- 28 `amc_submissions`; three are signed: AMC-2026-6886, 6890 and 6891.
- 11 `snagging_clients`, 15 `snagging_properties`.
- None of the new AMC tables exist.
- The only cron job is `zoho-token-refresh`.
- The AMC `customerId` is free text.

A fresh read on 6 Oct failed with a connector authorisation error, so the counts are as recorded the day before.

## 2. New migrations

| # | File | Kind | Main-compatible while live |
|---|---|---|---|
| 1 | `20261005100000_amc_close_direct_writes` | Revoke browser writes on `amc_submissions`; lock `amc_settings` / `amc_audit_events` / sequences | **YES**: main writes AMC only as service role |
| 2 | `20261005110000_amc_proposal_number_beyond_9999` | New default function (no truncation past 9999) | **YES** |
| 3 | `20261005150000_restrict_shared_allow_all_policies` | `schedule_audit_events` server-only | **YES**: main writes it as service role |
| 4 | `20261005160000_settings_hide_zoho_token` | Column-level browser read on `settings`, no token, no writes | **NO**, code first |
| 5 | `20261005170000_estimate_tables_server_only` | Estimate tables server-only | **NO**, code first |
| 6 | `20261005180000_password_resets_server_only` | `password_resets` server-only | **NO**, code first |
| 7 | `20261006100000_active_amc_contracts` | Contracts, entitlements, usage ledger, renewal link | **YES** (additive) |
| 8 | `20261006110000_active_amc_operations` | Corrections, manager names, Todo type, reminders | **YES** (additive; widens a CHECK) |
| 9 | `20261006120000_amc_fsm_integration` | FSM links, mappings, sync log | **YES** (additive) |
| 10 | `20261006130000_amc_business_operations` | Customers, properties, assessments, discount, quotes | **YES** (additive; widens a CHECK) |
| 11 | `20261006140000_amc_atomic_activation_and_dashboard` | **New in this review.** Two functions | **YES** (functions only) |
| 12 | `20261006150000_amc_business_completion` | Notifications and their settings, signed-contract archive, assessment photos, and a private storage bucket `amc-documents` with no storage policy | **YES** (additive; one new bucket row) |

**Changes made to the unapplied files in this review** (allowed because none is applied anywhere):
- **`20261006100000`:**
  - creates the **unique** one-renewal index directly, instead of a non-unique duplicate;
  - adds two ledger indexes;
  - the append-only ledger now **raises** instead of silently ignoring;
  - the trigger reads the contract `FOR SHARE`.
- **`20261006110000`:** drops the old duplicate index name if present; same `FOR SHARE`.
- **`20261006120000`:** adds the live-links-by-work-order index.
- **`20261006130000`:** fixes assessment and quote numbers truncating past 9999.

**Not consolidated into one file.** All five AMC files are unapplied, so they could be merged. They were kept as five because:
- each is a coherent, separately verified unit;
- the runbook, reports and checks name them;
- merging would only cut the file count.

The schema they produce was improved in place, and they always apply together (§9).

## 3. Object-by-object compatibility

| Change to an object main uses | Class | Why |
|---|---|---|
| `amc_submissions` + nullable `renewal_of_contract_id`, `customer_id`, `property_id`, `assessment_id` (FKs) | **BACKWARD COMPATIBLE** | Nullable, no default, no backfill. Main's `select *` reads simply return four more null fields. Main's inserts name their columns |
| `amc_submissions` + unique partial index on `renewal_of_contract_id` | **SAFE** | Only non-null values, which main never writes |
| `amc_submissions` policies dropped / browser writes revoked (#1) | **BACKWARD COMPATIBLE** | Main's AMC writes are service role (bypasses RLS and grants). Proven |
| `amc_submissions.proposal_number` default replaced (#2) | **SAFE** | Same format up to 9999, then 5+ digits instead of a duplicate |
| `amc_audit_events` CHECK `entity_type` widened (#7, #10) | **SAFE** | A superset; main writes `submission` / `settings` only |
| `amc_settings`, sequences: browser grants revoked (#1) | **SAFE** | Main reads and writes them as service role |
| `todos` CHECK `related_type` widened (#8) | **SAFE** | A superset |
| `schedule_audit_events` server-only (#3) | **SAFE** | Main's scheduling uses service role |
| `settings` column-level grant, no token, no browser writes (#4) | **REQUIRES COORDINATED DEPLOYMENT** | Main's graphql (anon) and session reads use it |
| Estimate tables server-only (#5) | **REQUIRES COORDINATED DEPLOYMENT** | Main's estimate routes use the session |
| `password_resets` server-only (#6) | **REQUIRES COORDINATED DEPLOYMENT** | Main's reset actions use the anon key |
| New tables, functions, sequences (#7–#12) | **SAFE** | Main does not know them; RLS on, no browser grants |
| New storage bucket `amc-documents` (#12) | **SAFE** | Private, no policy on `storage.objects`, so it adds no access for anyone; the existing `uploads` and `snagging` buckets are untouched |
| DROP / RENAME / ALTER TYPE / SET NOT NULL on anything main uses | **None** | Checked by test `nothing in the new AMC migrations drops, renames or narrows what main uses` |

Nothing is **UNSAFE** in the sense of losing or corrupting data. The three coordinated ones fail closed: they deny access and never destroy anything.

## 4. Main application compatibility

**Harness:** `compat.sh`, on local PostgreSQL 15.
1. It builds main's AMC schema from `origin/main`'s own files and seeds 28 proposals shaped like production's.
2. It replays 34 checks in a rolled-back transaction: main's 23 AMC queries (§1), 2 service-role non-AMC reads and writes, and 9 browser-role paths. It runs them: at baseline, after each new migration, and after re-applying all of them.

Pass counts by step:

| Step | Pass | Fail | New failures |
|---|---|---|---|
| main baseline | 34 | 0 | — |
| +`20261005100000` | 34 | 0 | none |
| +`20261005110000` | 34 | 0 | none |
| +`20261005150000` | 34 | 0 | none |
| +`20261005160000` | 31 | 3 | settings token (session), settings via graphql (anon) read and write |
| +`20261005170000` | 28 | 6 | estimate tables (session) |
| +`20261005180000` | 26 | 8 | password resets (anon) |
| +`20261006100000` … `150000` | 26 | 8 | **none** |
| all re-applied | 26 | 8 | **none** |

**All 23 AMC checks and both service-role checks pass at every step.** The 8 failures are exactly the three coordinated migrations' intended effect on non-AMC paths. **Old main works after all the new AMC migrations**, provided `160000`–`180000` wait for the code.

## 5. Existing data compatibility

- **28 proposals:**
  - every new column is nullable;
  - the FKs are added on all-null columns, so validation is trivial;
  - the widened CHECKs accept every existing value;
  - the unique renewal index sees no non-null value.
- **The three signed proposals are not converted.** They appear as "pending activation" until someone activates them, after the business review (master report §7 C5).
- **`todos`:** the new CHECK is a superset of the old one. The pre-check below confirms that no row holds a value outside it.
- **`settings`:** the row is unchanged; only who may read which column changes.
- **No data is rewritten.** `20261006110000`'s `UPDATE amc_contracts …` runs on an empty table.

## 6. Destructive-operation review

| Operation | Where | Data lost? |
|---|---|---|
| `DROP POLICY` / `REVOKE` | #1, #3–#6 | No. Access only; each file has an exact rollback block |
| `DROP CONSTRAINT` then wider `ADD CONSTRAINT` | `amc_audit_events` (#7, #10), `todos` (#8), `amc_entitlement_usage` kind (#8) | No |
| `DROP RULE` / `DROP TRIGGER IF EXISTS` / `DROP INDEX IF EXISTS` | Own new objects only (#7, #8) | No |
| `DROP TABLE`, `DROP COLUMN`, `RENAME`, `ALTER TYPE`, `SET NOT NULL` | **None** | — |

**Pre-existing, worth knowing:**
- Main's `amc_submissions.owner_id → user_profile ON DELETE CASCADE` deletes a user's proposals when the user is deleted. Main's user deletion goes through graphql `deleteFromuser_profileCollection`.
- Once contracts exist, that cascade is **stopped** for any proposal with a contract: `amc_contracts.submission_id` is `ON DELETE RESTRICT`. Deleting such a user then fails rather than silently deleting signed history. That is the intended protection, but the user-deletion screen will show an error for account managers who own contracted proposals.
- **Recommendation:** deactivate those users instead of deleting them, and/or change the owner FK to `SET NULL` in the security phase.

## 7. Locking risks

Every statement takes its lock for milliseconds at today's sizes (28 proposals, a few hundred audit rows, a small `todos` table). Nothing rewrites a table, and there is no `CREATE INDEX` on a large table.

| Statement | Lock | On | Notes |
|---|---|---|---|
| `DROP POLICY`, `REVOKE`, `ALTER … SET DEFAULT` | ACCESS EXCLUSIVE, metadata only | `amc_submissions`, `settings`, estimate tables, `password_resets`, `schedule_audit_events` | Instant, but **queues behind any long transaction** on that table |
| `ADD COLUMN` (nullable FK, no default) | ACCESS EXCLUSIVE, metadata + FK check on nulls | `amc_submissions` | Instant |
| `CREATE UNIQUE INDEX` (not concurrent) | SHARE (blocks writes during the build) | `amc_submissions` | 28 rows, so about 1 ms |
| `ADD CONSTRAINT CHECK` | ACCESS EXCLUSIVE + scan | `amc_audit_events`, `todos` | Small tables. Past ~1M rows, use `NOT VALID` then `VALIDATE` |

**Rule for the window:** run each file with `SET lock_timeout = '5s';` so a migration never waits behind a long transaction while main's requests pile up behind it. If one times out, re-run it; every file is idempotent. None of the files uses `CONCURRENTLY`, so each can run inside one transaction.

**Transactions:** run every file inside `BEGIN … COMMIT`. The CLI does this per file, and the runbook's SQL-editor path wraps it explicitly. A failure then leaves nothing half-applied.

**Idempotency:** every file uses `IF NOT EXISTS`, `OR REPLACE`, `DROP … IF EXISTS` and `ON CONFLICT DO NOTHING`. The harness applies each file twice; the second pass changes nothing and all checks still pass.

## 8. Backfill requirements

**None required.** Optional, business-led:
1. activating the three early signed proposals after review;
2. creating `customers` / `customer_properties` from existing proposals (free-text Customer IDs; manual, not by name matching);
3. FSM service mappings and contract FSM links, entered by approvers.

## 9. Deployment ordering

1. **Reconcile migration history first** (still required): production's `supabase_migrations.schema_migrations` holds 6 orphan versions, and the CLI refuses to push. See `amc-hardening-production-runbook.md` §3 and `database-migration-reconciliation.md`.
2. **Now, while current main is live (optional, safe):**
   - `20261005110000`;
   - `20261005100000`;
   - `20261005150000`.

   These three close the proposal-tampering and audit-log holes without any code change. The runbook lists `100000` after D1. The harness shows current main does not need it to wait, so it may go earlier; following the runbook order is also fine.
3. **Deploy the `amc-hardening` code (D1).** It works with or without every migration below: the AMC pages answer "not set up yet" (503) until the tables exist.
4. **Straight after D1:** `20261005160000`, `20261005170000`, `20261005180000`. Then rotate the Zoho credential (runbook §11).
5. **The AMC set, together and in order:** `20261006100000` → `110000` → `120000` → `130000` → `140000` → `150000`.
   - These can technically go before D1 (they are additive), but nothing uses them until D1.
   - Apply all six in one window: the D1 code expects all six. Without `150000` the code keeps working; notifications, the signed archive and photos are simply not recorded (they degrade silently). Without `140000` the dashboard falls back to slower counting.

## 10. Rollback and recovery strategy

- **Before the window:** a point-in-time restore point or an on-demand backup (runbook §1).
- **Hardening migrations (#1–#6):** each file ends with an exact rollback block restoring the previous grants and policies. These are safe at any time and lose no data. Rolling #4–#6 back re-opens the exposure, so prefer rolling the code forward.
- **AMC migrations (#7–#11):**
  - **While no contract, link, customer, assessment, quote, notification, archive or photo has been created:** run each file's rollback block in reverse order (`150000` → `100000`). They drop only the new objects and the new nullable columns. The `amc-documents` bucket is removed only when it is empty.
  - **Once data exists:** do not drop it. Roll the code back (D1's previous deployment). The schema can stay, because it is additive and main ignores it. Fix forward.
- `20261006140000` can be dropped at any time. The code then counts the dashboard in the server (slower, still correct) and **activation fails with "not set up"**, so drop it only together with a code rollback.

## 11. Pre-deployment checks (read-only)

```sql
-- History: exactly the 6 known orphan rows before reconciliation (runbook 2.1)
select version from supabase_migrations.schema_migrations order by version;
-- None of the new objects exist yet
select to_regclass('public.amc_contracts'), to_regclass('public.customers'),
       to_regprocedure('public.amc_activate_contract(jsonb,jsonb)');
-- Widened CHECKs will accept every existing row (expect 0 and 0)
select count(*) from public.todos where related_type is not null
   and related_type not in ('work_order','quotation','appointment','amc_contract');
select count(*) from public.amc_audit_events where entity_type not in ('submission','settings');
-- Nothing holding locks for long on the tables touched (expect no rows)
select pid, now() - xact_start as age, left(query, 80) from pg_stat_activity
 where xact_start < now() - interval '30 seconds' and state <> 'idle';
-- The live code version: D1 must be serving before #4-#6 (check the deployment ID in Vercel)
```

**Local, before the window:** re-run the harness from the deployment commit:
- `run.sh`: every migration twice, plus checks 90–97;
- `compat.sh`: the main compatibility matrix;
- `scale.sh`: about 10k contracts, EXPLAIN plans and the 7 race tests.

They are in `scripts/amc-db-harness/` (see its README) and use only a throwaway local cluster.

## 12. Post-deployment checks (read-only)

```sql
-- Every AMC/customer table: RLS on, no browser grants (expect no rows)
select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
   and (c.relname like 'amc\_%' or c.relname in ('customers','customer_properties'))
   and (not c.relrowsecurity or exists (select 1 from information_schema.role_table_grants g
        where g.table_name = c.relname and g.grantee in ('anon','authenticated')
          and not (c.relname = 'amc_submissions' and g.grantee = 'authenticated' and g.privilege_type = 'SELECT')));
-- New functions callable by the API only (expect false, false, true)
select has_function_privilege('anon', 'public.amc_activate_contract(jsonb,jsonb)', 'execute'),
       has_function_privilege('authenticated', 'public.amc_contracts_dashboard(uuid,date,integer,timestamptz)', 'execute'),
       has_function_privilege('service_role', 'public.amc_contracts_dashboard(uuid,date,integer,timestamptz)', 'execute');
-- Redundant index gone, unique one present
select indexname from pg_indexes where indexname in ('idx_amc_submissions_renewal_of','idx_amc_submissions_one_renewal');
-- Ledger and cache agree (expect no rows, ever)
select e.id from amc_contract_entitlements e left join amc_entitlement_usage u on u.entitlement_id = e.id
 group by e.id having e.used_quantity <> coalesce(sum(u.quantity), 0);
```

Then run the runbook's §8 verification and §10 smoke tests:
- sign-in page branding;
- create a draft proposal and check its number;
- open AMC contracts: summary loads, pending activation shows the signed proposals;
- open Assessments: the list pages.
