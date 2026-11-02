# Project State: Manpower Compliance module

## Objective

Build the Manpower Compliance module per FRD v0.9.3 (FR-1 to FR-14, Sharon's decisions of 26 Oct 2026 applied): https://claude.ai/artifact/CcxSKHEdwwk3cafsuV8Cug. Word copy: `Documents/YFI_Manpower_Compliance_FRD_v0.9.3.docx`.

## Scope

### Included (phased)

- Phase 1: records, validation, status engine, nearest expiry, exact-ID search, reminder list, masking, archive, audit (FR-1, FR-2, FR-3, FR-4, FR-6, FR-7, FR-9 guards, FR-13, FR-14, D11)
- Phase 2: dashboard charts, name search, full-number reveal with per-user allowlist, export (FR-5, FR-6, FR-9)
- Phase 3: import script with dry run, rejects report, reconciliation (FR-12)
- Phase 4: automatic reminders with claim-before-send, digest, overdue repeats, settings (FR-8)
- Phase 5a: role-to-certificate requirements and the non-blocking scheduling warning (FR-11)
- Phase 5b: HR source-ownership enforcement (FR-10)

### Excluded

- S0 security changes (authenticate /api/role-access, GraphQL proxy, RLS review): after both current modules are done, before release (Danish, 26 Oct 2026)
- HR ERP sync build (API unknown), scanned document storage (D8), retention purge job (F6 open)
- Warnings for crews assigned inside FSM (import/reconcile paths)

## Environment

- Repository: C:\Users\VICTUS\Desktop\YFI Scheduling\Portal (GitHub FahadAltaf/Yalla-Fixit)
- Branch: `manpower-compliance` from origin/main 4d4e5a8 (created 26 Oct 2026). Danish works on snagging on main.
- Target: PRODUCTION Supabase project for development and verification (Sami, 27 Oct 2026). Test employees use Maher IDs prefixed TEST- and are removed before the import. Each migration is applied with approval at action time and a LIVE_CHANGE_PLAN entry.
- Migrations: additive, schema-only, no seeding; untracked in git by convention; applied by hand to production after approval.
- Gates: `bunx tsc --noEmit`, `bunx eslint <changed files>`, `bun run build`, "Test Pass" HTML docket on the local stack.

## Current phase

- Phase: 1 (records, status engine, lists, employees, overview KPIs, reminder list)
- Status: Phase 1 CODED on 27 Oct 2026: registration, pure logic, migration 20261026120000_compliance_core.sql (applied to production by Sami, 27 Oct 2026), server layer (lib/server/compliance), 12 API routes under app/api/compliance, module service, 6 pages and the components under components/dashboard/compliance. Settings page moved to /settings/compliance; import script brought forward (redacted identity by default). Waiting on: the manual Test Pass docket.
- Last verified: 27 Oct 2026. `bun scripts/check-compliance-status.ts` 23/23 pass; `bunx tsc --noEmit` exit 0; eslint on all compliance files 0 errors; `bun run build` exit 0. No database has the tables yet.

## Completed

- FRD v0.9.3 with Sharon's decisions (26 Oct 2026); F1 to F3 closed; Danish agreed build-first sequencing
- Phased plan produced (project_planner, 26 Oct 2026); recorded in docs/manpower-compliance/DECISIONS.md and TEST_MATRIX.md

## Pending

- 31 Oct 2026: Workforce (C6) W1 to W4 built, reviewed and fixed; not committed or deployed. Sami runs docket section 14 after granting Workforce settings to managers (14-0). Then two demo videos: Compliance for Riyaz, Workforce and Scheduling changes for the operations team. Migration 20261029130000 gained two columns; re-run it if the earlier copy was applied.
- Sharon action points 28 Oct: C1, C2 (certificates), C7, C9 coded 29 Oct; migration 20261029120000_compliance_documents.sql to apply; C3, C4, C5, C6, C8, C10 waiting (see DECISIONS.md 2026-10-29).
- After go-live, on Sami's instruction only: delete the TEST- employees (`delete from compliance_employees where maher_id like 'TEST-%'`) and, if the sheet is re-imported with real numbers, the synthetic-identity batch by its import_batch_id. Not before Sami says so.
- Demo to Sharon on 28 Oct 2026: walkthrough doc https://claude.ai/artifact/UPv6xvXoge8h1XZiTBd8j1
- Full-number access (D2) after S0: a `compliance_identity` resource key with View, listed in NOT_INHERITED_BY_ADMIN, granted per role; or the per-user allowlist table if the three people span roles. Decide in phase 2.
- Phase 1 verification: apply the migration (approval pending), enter the seven certificate types and lists in Settings, run the Test Pass docket, record evidence in TEST_MATRIX.md
- Phases 2 to 5

## Blockers and required decisions

- Open: F6 retention period; Head Office / Other in the site map; 34 vs 35 "Missing" target.

## Evidence

- Tests: status self-check 23/23; tsc, eslint, build green after the review fixes (27 Oct 2026)
- Review: code_reviewer 27 Oct 2026: 1 high (S0, known, deferred), 4 medium + 12 low; all mediums and 10 lows fixed, 2 lows accepted (docs/manpower-compliance/DECISIONS.md). test_verifier 27 Oct 2026: all gates and static checks passed.
- Deployment or live-system verification: none

## Next action

- Sami runs the Phase 1 docket (TEST- employees and optionally the imported sheet); fix what fails; then commit Phase 1 and start Phase 2.
