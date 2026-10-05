# AMC hardening: production deployment runbook

**Prepared:** 5 October 2026, branch `amc-hardening`
**Production project:** `sxzpigyphjotuubxpooj`
**Status:** prepared only. Nothing in this runbook has been run against production.

**Step labels**

| Label | Meaning |
|---|---|
| **SAFE AUTOMATED STEP** | Read-only, or local. Can be scripted. |
| **MANUAL DEVOPS STEP** | A person with production access does it, and records the output. |
| **PRODUCTION CHANGE** | Changes production schema, history or code. Needs an approved window and a backup taken first. |
| **CREDENTIAL ROTATION** | Changes a secret, in Zoho or Supabase. |

**Rules**
- Run the steps in order. If a step's check fails, stop and go to §12.
- Never run `supabase db push --include-all`.
- Never replay historical migrations (§5).

**What is being deployed**

| # | Item | Kind | Depends on |
|---|---|---|---|
| D1 | Branch `amc-hardening` (the AMC hardening code; the Zoho token kept server-side; auth on the estimate and Zoho routes; the appearance route) | Code | — |
| D2 | `20261005100000_amc_close_direct_writes.sql` | Migration | D1 deployed |
| D3 | `20261005110000_amc_proposal_number_beyond_9999.sql` | Migration | — |
| D4 | `20261005150000_restrict_shared_allow_all_policies.sql` (schedule_audit_events) | Migration | — |
| D5 | `20261005160000_settings_hide_zoho_token.sql` | Migration | **D1 deployed first** |
| D6 | `20261005170000_estimate_tables_server_only.sql` | Migration | **D1 deployed first** |
| D8 | `20261005180000_password_resets_server_only.sql` | Migration | **D1 deployed first** |
| D7 | Zoho credential rotation | Rotation | D1 and D5 live |

**Why the code goes first:** the previous build's settings query asks for `oauth_access_token`, and the previous estimate routes use the caller's own role. After D5/D6 those would fail. The new code works whether or not the migrations are applied.

**The urgent part:** D1 + D5 + D7 close the Zoho token exposure; D1 + D8 close password-reset account takeover. If the full migration-history reconciliation (§3) cannot be scheduled soon, see §3a for a narrower emergency path.

---

## 1. Backup and checkpoint

| Step | Label | Action | Check |
|---|---|---|---|
| 1.1 | MANUAL DEVOPS STEP | Confirm point-in-time recovery is enabled on the project, or take an on-demand backup in the Supabase dashboard. Write down the restore point. | The backup exists, with a timestamp |
| 1.2 | SAFE AUTOMATED STEP | `supabase db dump --linked --schema-only -f prod_schema_<date>.sql` | File written |
| 1.3 | SAFE AUTOMATED STEP | `supabase db dump --linked --data-only --schema supabase_migrations -f prod_history_<date>.sql` | File written |
| 1.4 | SAFE AUTOMATED STEP | Save the current policies and grants: run the queries in §6 now and keep the output as "before" | Output saved |
| 1.5 | MANUAL DEVOPS STEP | Export the Vercel environment variables (names only) and note the current production deployment ID, for rollback of D1 | Recorded |

## 2. Schema verification (read-only)

| Step | Label | Action | Check |
|---|---|---|---|
| 2.1 | SAFE AUTOMATED STEP | `select version, name from supabase_migrations.schema_migrations order by version;` | Exactly 6 rows: `20260720102128`, `20260924080610`, `20260924082758`, `20260924125718`, `20260924132733`, `20260930112449` (as on 5 Oct 2026) |
| 2.2 | SAFE AUTOMATED STEP | The AMC policies: `select policyname from pg_policies where tablename='amc_submissions';` | The 5 names in `docs/database-migration-reconciliation.md` §4 |
| 2.3 | SAFE AUTOMATED STEP | The shared policies on `settings`, `estimate_revisions`, `estimate_service_items` and `schedule_audit_events` | "Allow All on Settings", "Allow All on estimate_revisions", "Allow All on quotation_service_item_images", "Allow All on schedule_audit_events" |
| 2.4 | SAFE AUTOMATED STEP | `select last_value from amc_proposal_number_seq;` | Below 9999 (6894 on 5 Oct 2026) |
| 2.5 | SAFE AUTOMATED STEP | Restore `prod_schema_<date>.sql` into a disposable local Postgres 15. Apply D2–D6 there twice, then run `scratchpad/pgtest` checks (or the verification blocks at the end of each file) | All pass. This was done locally on 5 Oct 2026 against a reconstructed schema; see the hardening report §16 |

## 3. Migration-history reconciliation

Full procedure, options and evidence: [`database-migration-reconciliation.md`](database-migration-reconciliation.md). The recommended option is a **baseline**.

| Step | Label | Action | Check |
|---|---|---|---|
| 3.1 | MANUAL DEVOPS STEP | Approve the reconciliation and the window | Approval recorded |
| 3.2 | SAFE AUTOMATED STEP | Generate the baseline `20261001000000_production_baseline.sql` from `prod_schema_<date>.sql`. Review it. Move the 82 historical files to `supabase/migrations_archive/` in a commit | The baseline builds a fresh local database (`supabase db reset`) that matches the dump (`supabase db diff` empty) |
| 3.3 | PRODUCTION CHANGE (history only) | Remove the 6 orphan history rows, so the CLI stops refusing: `supabase migration repair --status reverted 20260720102128 20260924080610 20260924082758 20260924125718 20260924132733 20260930112449` | 2.1 now returns 0 rows. **No schema change**: `repair` only edits `supabase_migrations.schema_migrations` |
| 3.4 | PRODUCTION CHANGE (history only) | Mark the baseline applied without running it: `supabase migration repair --status applied 20261001000000` | 2.1 returns exactly `20261001000000` |
| 3.5 | SAFE AUTOMATED STEP | `supabase migration list --linked` | Local and remote agree up to the baseline. Pending: D2–D6 (and `20261002100000_inspector_role.sql` once it is merged from main) |

### 3a. Emergency path for the Zoho token only (if §3 cannot happen soon)

| Step | Label | Action |
|---|---|---|
| 3a.1 | PRODUCTION CHANGE | Deploy D1 (§9) |
| 3a.2 | PRODUCTION CHANGE | Run the SQL of `20261005160000_settings_hide_zoho_token.sql` and `20261005180000_password_resets_server_only.sql` **once each**, in the SQL editor, inside `BEGIN … COMMIT` |
| 3a.3 | MANUAL DEVOPS STEP | Record both in the reconciliation log. Later, mark `20261005160000` and `20261005180000` applied with `repair --status applied` during §3, so neither is run twice |
| 3a.4 | CREDENTIAL ROTATION | §11 |

## 4. Historical versions to mark applied

With the recommended baseline, only `20261001000000` is marked applied, standing in for all 82 historical files.

If the team instead chooses the "repair every file" option, mark applied only the files whose objects §2.5 shows are present in production. Use the full table in `database-migration-reconciliation.md` §2, one `repair --status applied <version>` per file, logged. Every AMC v2 file (`20260721120000`, `20260915120000`, `20260915130000`, `20260916100000`, `20260916105000`, `20260916110000`, `20260922130000`) is reflected in production and is marked applied, **never executed**.

## 5. Migrations that must NEVER be replayed

Full list with line numbers: `database-migration-reconciliation.md` §5. The ones that hurt most:

| File | Why |
|---|---|
| `20260721120000_create_amc_submissions.sql` | Recreates "Allow All on amc_submissions" (every signed-in user reads and writes every proposal) |
| `20260915120000_amc_harden_submissions.sql` | Recreates the owner insert/update policies that D2 removes |
| `20260916105000_amc_proposal_numbers.sql` | Rewrites `customer.proposalNumber`; `setval` can move the sequence backwards (duplicate numbers) |
| `20260821190000_snagging_properties.sql` | No ON CONFLICT: duplicates every property row |
| `20260916150000_*` | Overwrites quotation `furnished` values set by coordinators |
| `20260820090000_*`, `20260826*`, `20260827090000_scheduling_consolidate_tables.sql`, `20260916120000_retire_visit_jobs.sql` | Drop or consolidate tables |
| `20260721093000_*`, `20260721094000_*` | pg_cron jobs pointing at another project (`ulqitebapobdtsqvbucd`) |
| `20250501_create_base_schema.sql` | Base schema, including the original "Allow All" policies |

## 6. Verification after reconciliation (read-only)

| Step | Label | Query | Expect |
|---|---|---|---|
| 6.1 | SAFE AUTOMATED STEP | `select version from supabase_migrations.schema_migrations;` | `20261001000000` only |
| 6.2 | SAFE AUTOMATED STEP | Re-run the §1.4 policy and grant queries | Identical to "before" (repair changes no schema) |
| 6.3 | SAFE AUTOMATED STEP | `supabase db push --dry-run --linked` | Lists exactly D2–D6 (plus `20261002100000` if merged). **If anything else appears, stop.** |

## 7. Apply the new hardening migrations

One at a time, in this order, each as its own push or SQL-editor transaction. After each one, run the verification block at the end of its file.

| Step | Label | Migration | Verify |
|---|---|---|---|
| 7.0 | PRODUCTION CHANGE | **Deploy D1 first** (§9) and let it serve traffic for a few minutes | Login page shows the branding; Quotation Templates loads |
| 7.1 | PRODUCTION CHANGE | D3 `20261005110000` | `column_default` of `proposal_number` = `amc_next_proposal_number()` |
| 7.2 | PRODUCTION CHANGE | D2 `20261005100000` | Only the two read policies on `amc_submissions`; `authenticated` has only SELECT |
| 7.3 | PRODUCTION CHANGE | D4 `20261005150000` | No policy on `schedule_audit_events`; no anon/authenticated grants |
| 7.4 | PRODUCTION CHANGE | D5 `20261005160000` | Column privileges for anon/authenticated: SELECT on the branding columns only; never `oauth_access_token` |
| 7.5 | PRODUCTION CHANGE | D6 `20261005170000` | No policies and no anon/authenticated grants on both estimate tables |
| 7.6 | PRODUCTION CHANGE | D8 `20261005180000` | No policies and no anon/authenticated grants on `password_resets` |

## 8. Post-migration RLS verification (read-only)

```sql
-- policies
select tablename, policyname, cmd, roles from pg_policies
 where schemaname='public' and tablename in
 ('amc_submissions','amc_settings','amc_audit_events','settings',
  'estimate_revisions','estimate_service_items','schedule_audit_events','password_resets')
 order by 1,2;
-- table grants to browser roles
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','authenticated')
   and table_name in ('amc_submissions','amc_settings','amc_audit_events','settings',
     'estimate_revisions','estimate_service_items','schedule_audit_events','password_resets')
 group by 1,2 order by 1,2;
-- column grants on settings
select grantee, column_name, privilege_type from information_schema.column_privileges
 where table_schema='public' and table_name='settings' and grantee in ('anon','authenticated')
 order by 1,2;
```

**Expected:**

| Table | Policies | Browser-role grants |
|---|---|---|
| `amc_submissions` | "amc_submissions owner read", "amc_submissions approver read" | `authenticated` SELECT only |
| `amc_settings`, `amc_audit_events` | none | none |
| `settings` | "settings public read" | SELECT on the 17 branding columns only |
| `estimate_revisions`, `estimate_service_items`, `schedule_audit_events`, `password_resets` | none | none |

## 9. Application deployment

| Step | Label | Action | Check |
|---|---|---|---|
| 9.1 | MANUAL DEVOPS STEP | Merge `amc-hardening` into `main` (after review; conflicts with in-progress main work are analysed in the hardening report §16) | CI / `npm test` green |
| 9.2 | MANUAL DEVOPS STEP | Confirm in Vercel: `SUPABASE_SERVICE_ROLE_KEY` is set (it signs internal email calls and serves every server read); `NEXT_PUBLIC_APP_URL` is the real production URL of the **same** deployment (server-to-server email calls go there); `NEXT_PUBLIC_EMAIL_FROM`'s domain is the one quotation owners use (or set `EMAIL_PUBLIC_RECIPIENT_DOMAINS`) | Recorded |
| 9.3 | PRODUCTION CHANGE | Deploy | Build succeeds |
| 9.4 | SAFE AUTOMATED STEP | Load the login page logged out; sign in; open Settings → Appearance, Quotation Templates, Bulk download, AMC | All load |

## 10. Smoke tests

Run [`amc-hardening-production-smoke-test.md`](amc-hardening-production-smoke-test.md) in full. Every check must PASS.

## 11. Credential rotation

The Zoho FSM access token has been readable with the public key, and cached in visitors' browsers. Access tokens expire within about an hour (`token-refresher` treats 60 minutes as the lifetime), but anyone who copied one could keep fetching fresh ones until D1 + D5 are live. Rotate **after** D1 and D5 are verified.

| Step | Label | Action | Notes |
|---|---|---|---|
| 11.1 | CREDENTIAL ROTATION | In the Zoho API console, revoke the current refresh token, generate a new one (same scopes), and update the edge-function secret `zoho_oauth_refresh_token` | Secrets used by `token-refresher` and `refresh-token` |
| 11.2 | CREDENTIAL ROTATION | Regenerate the Zoho OAuth client secret; update `zoho_oauth_client_secret` | — |
| 11.3 | SAFE AUTOMATED STEP | Invoke `token-refresher` once (or wait ≤ 15 minutes for the `zoho-token-refresh` cron); confirm `oauth_token_refreshed_at` moved, and an FSM call works (smoke test M2) | Read-only check |
| 11.4 | CREDENTIAL ROTATION (recommended) | Consider rotating the Supabase anon key only if abuse is suspected. Rotating it breaks the inspector app until a new build ships | Not required by this release |
| 11.5 | MANUAL DEVOPS STEP | Ask users to sign out and in, or just reload: `localStorage.SK_PROJECT_SETTINGS` is rewritten on the next page load without the token | — |

Not affected: Resend API key and the Supabase service-role key. Neither was exposed by these findings.

## 12. Rollback

| Situation | Action | Label |
|---|---|---|
| Code (D1) misbehaves before any migration | Promote the previous Vercel deployment (§1.5) | PRODUCTION CHANGE |
| A migration (D2–D6) causes failures | Run that file's **Rollback** block (in its header) in the SQL editor, then `supabase migration repair --status reverted <version>` | PRODUCTION CHANGE |
| D5 rolled back | The token is exposed again: re-apply as soon as the cause is fixed; rotation (§11) is still required | PRODUCTION CHANGE |
| History repair (§3) went wrong | History rows only: restore `prod_history_<date>.sql`, or re-run `repair` with the opposite status. Schema is untouched by `repair` | PRODUCTION CHANGE |
| Anything worse | Restore to the §1.1 restore point (PITR) | PRODUCTION CHANGE |

Rolling back D1 after D5/D6 are applied leaves the old code reading columns it can no longer see: branding falls back to defaults, and quotation dashboards and revisions fail. Roll back the migrations first, then the code.

## 13. Not covered by this runbook (follow-ups)

- **Edge functions are public FSM proxies.** All six are deployed with `verify_jwt = false`. Anyone can:
  - fetch estimates, contacts, work orders, appointments and attachments;
  - approve, reject or cancel estimates (`zoho-fsm-estimate-transitions`).
- **Token in logs.** `zoho-fsm-estimate-transitions` logs the `settings` row, token included (`console.log(settings, "settings")`).
- **Missing functions.** The portal calls `zoho-fsm-appointment-create` and `zoho-fsm-appointment-update`, which do not exist.
- **CRITICAL: anyone can make themselves an admin.** `role_access` has RLS switched off and full anon grants; `roles` and `user_profile` have "Allow All" policies with full anon grants (checked 5 Oct 2026). With the public key alone, anyone can set their own `user_profile.role_id` to the admin role, or grant a role any permission, and read every user's email and name. The portal's user and role management writes these tables from the browser through `/api/graphql` as anon (`modules/users`, `modules/roles`, `modules/auth`), so they cannot be locked down until those writes move to authenticated server routes. This is the top security blocker after this release.
- **Unauthenticated GraphQL proxy.** `/api/graphql` forwards any query as anon, with no authentication.
- **Public storage bucket.** The `uploads` bucket is public, and allows anon inserts.

Each needs its own change, and is documented in `security-followup-shared-rls.md`.
