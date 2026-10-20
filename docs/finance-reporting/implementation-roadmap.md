# Implementation roadmap

Part of the [Finance & Reports plan](README.md). Phases follow dependencies, not Jira order. Complexity is
relative (S, M, L, XL); no dates are given because three external answers gate the critical path.

## Critical path

```
P0 ─┬─► P1 ─┬────────────────────► P3 ─► P4 ─────────────┐
    │       │      (D-01..03 gate the trigger only)       │
    └─► P2 ─┴─► P5 ─► P6                                  ├─► P9
                 └─► P7  (B-01 + D-09/10/11/15)            │
            P2 ─► P8  (B-01 for ratings; D-14, D-17)       ┘
```

**In parallel**: P1's five items are independent of each other; P3→P4 and P5→P6 run side by side once P2
lands; P8 can start any time after P2. **Strictly sequential**: P0 before anything; P2 before any report or
queue; P3 before P4; P5's available-hours engine before P6 and P7.

## Definition of done (every phase)

Migrations as files, each with pre-check SQL, post-check SQL and a rollback script, applied by the user and
logged; unit and database tests written alongside the code and passing; full non-incremental `tsc` clean;
`eslint` clean on changed files; `next build --webpack` passing; regression of shared modules; the
[traceability matrix](requirements-traceability.md) updated for all 31 issues; one commit on
`feature/yfi-finance-reporting`; a phase report (Jira done / partial / remaining, DB changes, tables
affected, FSM status, tests run, performance, security, regressions, blockers, commit hash, push status,
next phase).

---

## P0 — Foundation and FSM discovery · M · **done on the branch, 20 Oct**

- **Objective**: safe ground to build on, and evidence before design.
- **Delivered**: worktree `_wt/finance-reporting` on `feature/yfi-finance-reporting` from `origin/main`
  `f341a26`; security port from `926cb24` (10 new files, 14 patched, 4 migrations); `node:test` runner;
  read-only FSM client (`lib/server/finance/fsm-read.ts`) and delivery policy
  (`lib/server/finance/delivery-policy.ts`), 21 tests, both mutation-tested; three read-only FSM discovery
  passes (34 GET calls); these documents.
- **Findings that changed the plan**: OAuth scope blocks trips, check-ins, ratings and metadata (B-01);
  the invoice flag is `Estimates.Post_To_Maher__C` (D-02); work orders are almost never completed in FSM
  (D-01); actual times are complete on completed appointments; 115 active technicians vs 17 portal users
  (D-19); 5 leave records in total (D-16).
- **Jira**: DEV-462 (security precondition), DEV-463 (matrix started).

## P1 — Platform prerequisites · L · **built on the branch, 20 Oct; migrations not yet applied**

- **Delivered**: migrations `20261020100000_reporting_platform` and `20261020110000_people_reporting_fields`
  (files, checks and rollbacks in [migrations/](migrations/)); the throwaway-Postgres harness
  (`scripts/db-harness/`, 47 checks, migrations applied twice, rollback round trip); 13 resources and four
  admin exclusions; Reporting Settings (API, page, History); notifier, inbox API, inbox page, home panel;
  technician ↔ account link in the FSM sync, and leavers kept rather than deleted; hide-from-lists in every
  people picker; leave categories; employment status, leaving date and rest days on the technician dialog.
- **Changed from the plan**: no role rows (D-18); the audit table uses an append-only trigger, not rules
  (rules plus a user foreign key block every user deletion, found by the harness); the compliance threshold
  has no default (D-09).
- **Jira**: DEV-462, 461, 456, 457, 458. **BRD**: 5.3, 6.6, 6.7.
- **Depends on**: P0. D-18 for role names (roles can be created and renamed later).
- **Migrations**: roles and resources seed; `reporting_settings`; `portal_notifications`;
  `technician_reference` columns (`user_profile_id`, `email`, `employment_status`, `leaving_date`,
  `hidden_from_lists`, `rest_weekdays`); `user_profile.hidden_from_lists`; `leave_records.leave_category`;
  `org_public_holidays`.
- **Backend**: new resources in `ResourceType`, `permissions/constants.ts`, `menu-items.tsx`;
  `NOT_INHERITED_BY_ADMIN` entries; settings read/write with key-path audit (AMC pattern); notification
  writer behind the delivery policy with dedupe; technician ↔ user link by email during the existing FSM
  technician sync; hide-from-lists in all five picker paths.
- **Frontend**: Reporting Settings page with History; notification inbox and home panel (ported shape from
  `amc-hardening`); leave category dropdown; employment status and leaving date on the technician panel;
  hide-from-lists toggle on users.
- **Tests**: permission denials (Finance → utilization, HR → queue, technician → others' data); settings
  validation; notification dedupe; hidden users absent from every picker but present in the Users list.
- **Acceptance**: TC15 setup (leaving date stored); a hidden account absent from all five pickers.
- **Risks**: shared-file conflicts with `amc-hardening` (permissions constants, menu, notifications, users).
  Keep hunks small and additive.

## P2 — FSM read model and sync · L · **built; live backfill in progress (20 Oct)**

- **Delivered**: schema `fsm` (migration `20261020130000`, applied by the user, schema exposed) with nine
  tables and seven guarded writer functions; the sync engine (`lib/server/finance/fsm-sync/`: incremental,
  reconcile, resumable backfill, lease, call budget, run log); `CRON_SECRET` run route and a status route;
  the freshness panel (Settings → Reporting → FSM data); 18 engine tests, 30 database checks for the read
  model; two more read-only discovery passes (13 calls).
- **Live so far**: quotations fully loaded (1,054, 6 calls) and on incremental sync (1 call when nothing
  changed); work orders 3,400 headers and lines for 38 recent ones; appointments 128 from the last week with
  6 crews. Every run GET-only and capped.
- **Changed from the plan**: own schema (user's decision); a lease row instead of an advisory lock; line
  changes are caught through appointment changes as well, because a line can complete without its work
  order's `Modified_Time` moving.
- **Still to do**: finish the work-order and appointment backfills (call spend to agree, B-03); nightly
  reconcile and the 15-minute schedule are wired at go-live only.

- **Enables**: DEV-433, 442, 444, 446, 453, 454. **Depends on**: P0.
- **Migrations**: `fsm.sync_state`, `fsm.sync_runs`, `fsm.estimates`, `fsm.estimate_status_events`,
  `fsm.work_orders`, `fsm.line_items`, `fsm.appointments`, `fsm.appointment_resources`.
- **Backend**: `lib/server/finance/fsm-sync/*` per resource; watermark with a 10-minute overlap; idempotent
  upserts guarded on `modified_time`; advisory-lock claim per resource; run log; status-event derivation;
  nightly 7-day reconciliation; resumable backfill; run routes behind `CRON_SECRET`.
- **Frontend**: a freshness indicator component (last success, lag, last error) used by every report.
- **Tests**: replayed pages are no-ops; an older page never overwrites a newer row; two concurrent runs →
  one proceeds; a status change appends exactly one event; budget exhaustion stops cleanly and resumes.
- **Acceptance**: a backfilled count matches FSM's count for a sample period; a change in FSM appears
  within one cycle.
- **Risks**: FSM allowance unknown (B-03); volumes unknown (B-04); line-item row shape still to confirm on a
  work order that has lines.

## P3 — Finance core · L

- **Jira**: DEV-434, 437, 438, 440 now; **DEV-433 trigger only after D-01, D-02, D-03**. **BRD**: 5.1
  Steps 1–5, 7; N3, N4. **Depends on**: P1, P2.
- **Migrations**: `fin_queue_items`, `fin_queue_item_lines` (`UNIQUE(fsm_line_id)`), `fin_invoices`,
  `fin_exclusions`, `fin_queue_events`; functions `fin_create_queue_item`, `fin_transition`,
  `fin_record_invoice`; view `fin_estimate_progress`.
- **Backend**: transition and invoice APIs over the functions; exclusion request/verify (D-06 decides
  whether AMC is filtered before or excluded after); N3 and N4. The trigger is built as a function taking an
  explicit eligibility rule, so it can be wired once D-01..03 are settled without reworking the model.
- **Tests**: TC03, TC04, TC05, TC06; Q-1042 → 41.7 / 75.0 / 100 %; duplicate line rejected; two concurrent
  invoice recordings → one invoice; a retried submission with the same key returns the original; a failure
  mid-transaction leaves nothing changed; illegal transitions refused.
- **Risks**: building the trigger on an unconfirmed meaning of "completed" (mitigated by not building it
  until D-01).

## P4 — Finance UI and digest · M

- **Jira**: DEV-435, 436, 439, 441. **BRD**: 6.4, 6.1 E1, 6.2 N1 N2, 5.1 Step 8. **Depends on**: P3.
- **Backend**: paginated, filtered queue API; detail API; digest run route (once a day, not sent when
  nothing is new or outstanding, deduped per day); metrics from `fin_queue_events`.
- **Frontend**: queue list (summary strip, filters, ageing, server paging), item detail (commercial
  reference, lines, value block, evidence, activity log, actions), metrics cards.
- **Tests**: TC02 digest inclusion; digest suppressed on an empty day; digest not sent twice in one day;
  filters and paging; metric arithmetic.
- **Partial**: the completion report link waits on B-01.

## P5 — Reports foundation · M

- **Jira**: DEV-455, 443, 442, 453. **BRD**: 5.2 B1, B2 (engine), B5; N7, N8, N13. **Depends on**: P1, P2.
- **Migrations**: `report_saved_filters`, `report_access_log`.
- **Backend**: available-hours engine (pure; [spec](reporting-calculation-specification.md)); quotation
  summary with ageing and expiry; the two exception reports; server-side export with an EXPORT check.
- **Frontend**: shared report shell (date range, technician/team/client filters, saved filters, export,
  drill-through, freshness), quotation summary, exception reports.
- **Tests**: TC07, TC08, TC15; cross-midnight shift; part-day leave; zero-available day; holiday and rest
  day.
- **Waiting**: D-13 status mapping, D-22 shift length.

## P6 — Utilization and capacity · M

- **Jira**: DEV-444, 452. **BRD**: 5.2 B2, B5; N14. **Depends on**: P5.
- **Backend**: utilization (interval union, outside-shift reporting, completeness); capacity horizon;
  optional N14.
- **Tests**: TC09; 78 % / 69 % example; overlapping appointments not double-counted; missing actuals
  excluded and reflected in completeness.
- **Partial**: travel waits on B-01. **Waiting**: D-08, D-14, D-16.

## P7 — Attendance and compliance · XL · **blocked**

- **Jira**: DEV-451, 445, 446, 447, 448, 449, 450. **BRD**: 5.2 B3, B4, B5; E2, E3; N5, N6, N9–N12.
- **Depends on**: P5, **B-01** (check-in data), **D-09, D-10, D-11, D-15, D-19**.
- **Can be built ahead of the blockers**: waiver and dispute data model and flows; month-end
  finalisation; statements from test data. **Cannot**: anything that reads a real check-in.
- **Tests**: TC10–TC14; one alert per miss; no alert on leave, off-shift, cancelled or reassigned; late
  check-in counts; bulk waiver; dispute after cut-off refused; unrounded threshold comparison (TC13 at
  96.98 %); finalised month never recalculated.
- **Risks**: employee penalties; HR and legal confirmation outstanding (D-11). Penalties are calculated and
  reported only.

## P8 — FSM-custom reports · S–M

- **Jira**: DEV-454. **Depends on**: P2; **D-14, D-17**; ratings wait on B-01.
- Revenue per technician and client, AMC vs one-time mix, FSM standard report links.

## P9 — Clients sync completion and go-live · M

- **Jira**: DEV-459, 460, 463.
- FSM-down fallback in `listFsmClients`; ownership, conflict and loop rules
  ([FSM plan](zoho-fsm-integration-plan.md)); test-data inventory, dry run and reviewed cleanup script
  (never run without approval); truncate finance and HR transactional tables and re-run the backfill;
  hold-then-apply `20261006160000` with the deploy; full regression and browser UAT.

## Progress (31 issues)

| State | Issues |
|---|---|
| Built on branch (P1), awaiting migrations and browser check | DEV-456, 457 (process doc open), 458, 461, 462 (roles wait on D-18) |
| Next (P2) | FSM read model and sync |
| Buildable after P2 | DEV-434, 435, 436*, 437, 438*, 439, 440, 441, 442*, 443, 452, 453*, 455 |
| Waiting on a decision | DEV-433 (D-01–03), 434 (D-03–05), 438 (D-06), 442 (D-13), 446 (D-15), 447 (D-09, D-11), 449 (D-10, D-19), 453 (D-01, D-02), 454 (D-14, D-17) |
| Externally blocked (B-01) | DEV-436 (report link), 444 (travel), 445, 447, 448†, 450†, 451, 454 (ratings) |
| Final | DEV-459, 460, 463 |

\* partly waiting on a decision · † plumbing buildable, meaningful only with check-in data
