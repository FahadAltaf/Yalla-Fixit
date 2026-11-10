# Test strategy and acceptance matrix

Part of the [Finance & Reports plan](README.md). Jira: DEV-463. The BRD's TC01–TC15 are the starting
point; every one becomes an executable test. **No test is reported as passing unless it ran.**

## Layers

| Layer | Tool | What it proves | Data |
|---|---|---|---|
| Unit | `node:test` (`npm test`, zero dependencies, `tests/setup/ts-loader.mjs`) | Pure calculators, policies, guards | In-memory fixtures |
| Database | Throwaway Postgres 15 harness (`scripts/db-harness/run.sh`, ported in P1), migrations applied twice, shipped post-checks and rollbacks exercised | Constraints, functions, concurrency, idempotency | Synthetic, generated at test volumes |
| Integration | `node:test` against route handlers with a fake FSM fetcher | Sync, triggers, permission denials | Recorded FSM-shaped payloads (no values from production) |
| Browser UAT | Built-in browser, dev server on the feature worktree | Screens, flows, role views | Test accounts, delivery policy in redirect mode |

**Never in automated tests**: production FSM (every reader gets a fake fetcher), live customer data, real
email or notifications (the delivery policy has no live mode without `FINANCE_NOTIFY_LIVE=on`).

**Known harness gap (B-07)**: today's schema cannot be rebuilt from the repo. The harness needs a schema
baseline before database tests touch `snagging_*` tables; finance and reports tables do not depend on them.

## Already running

| Suite | Phase | Tests | Result | Mutation check |
|---|---|---|---|---|
| `tests/finance/fsm-read.test.ts` | P0 | 11 | pass | Guard disabled → 6 fail; the cast test still passes by design (two layers) |
| `tests/finance/delivery-policy.test.ts` | P0 | 10 | pass | "Blocked" falling through to "live" → 4 fail |
| `tests/reporting/settings.test.ts` | P1 | 14 | pass | — |
| `tests/notifications/notifier.test.ts` | P1 | 9 | pass | Sending without a successful claim → 4 fail |
| `tests/people/people.test.ts` | P1 | 10 | pass | — |
| `tests/permissions/finance-reports-access.test.ts` | P1 | 11 | pass | Admin exclusions removed → 1 fails |
| `tests/finance/fsm-sync.test.ts` | P2 | 21 | pass | Reconcile allowed to set the watermark → 1 fails; drift margin removed → 1 fails |
| `tests/finance/queue.test.ts` | P3 | 6 | pass | — |
| `scripts/db-harness/checks/*.sql` | P1–P3 | 127 | pass | `REVOKE` removed → grant check fails |

## BRD acceptance (TC01–TC15)

| ID | Scenario | Expected | Layer | Phase | Depends on |
|---|---|---|---|---|---|
| TC01 | Job completed, flag not set | No queue item | Integration | P3 | D-01, D-02 |
| TC02 | Job completed and flag set | Item in Pending; in next digest | Integration | P3/P4 | D-01, D-02 |
| TC03 | 12-line quotation, lines 1–5 done and flagged | Item shows 5 lines and value; % derived | DB + unit | P3 | — |
| TC04 | Lines 1–5 invoiced; 6–9 done next month | New item shows only 6–9; cumulative includes month 1 | DB | P3 | D-03 |
| TC05 | Marked not invoiceable | Behrouz notified; Excluded only after verification | Integration | P3 | D-06 |
| TC06 | Invoice lower than queue value | Reason mandatory; Invoiced; lines flagged | DB | P3 | — |
| TC07 | Quotation in Sent 11 days, limit 10 | N7 to Behrouz; row highlighted | Unit ✓ (`tests/reports/quotations`, `alerts-plan`) | P5 | D-13 |
| TC08 | 2 days annual leave | Available hours −16; no alerts; compliance unaffected | Unit ✓ (`tests/reports/available-hours`; alerts and compliance in P7) | P5 | D-22 (8 h day) |
| TC09 | Quotation total 0, 2-hour job | Time utilization only | Unit ✓ (`tests/reports/utilization`) | P6 | D-08 |
| TC10 | Shift 08:00, no check-in by 08:15 | One N5 with the day's appointments | Integration | P7 | **B-01** |
| TC11 | 200 required, 7 missed, threshold 97 % | 96.5 %; AED 350 | Unit ✓ (`tests/reports/compliance`) | P7 | D-09 |
| TC12 | 200 required, 14 missed | 700 capped to AED 500 | Unit ✓ (`tests/reports/compliance`, at 97 % and 90 %) | P7 | **D-09 — holds only at 97 %** |
| TC13 | Waive 1 of 7 | Required and performed −1; penalty recalculated (AED 300 at 96.98 %); reportable | Unit ✓ (`tests/reports/compliance`); DB with the waiver table | P7 | D-09 |
| TC14 | Dispute raised on the 26th | Rejected; window closed | Date rule unit ✓ (`complianceMonthPhase`); dispute flow waits on D-10 | P7 | D-10 |
| TC15 | Leaving date the 15th | 15th onward excluded everywhere; earlier days counted | Unit ✓ (`tests/reports/available-hours`) | P5 | — |

## Expanded matrix

### Integrity and concurrency (DB layer)

- Same FSM line claimed by two items → second insert fails on `UNIQUE(fsm_line_id)`.
- Two concurrent `fin_record_invoice` calls on one item → exactly one invoice; the other gets the first's
  result or a clean conflict.
- Retried submission with the same idempotency key → the original row returned, nothing duplicated.
- Failure after the invoice insert but before line flagging → whole transaction rolled back.
- `fin_transition` with a stale expected status → refused, nothing changed.
- Replayed sync page, and two sync runs racing → no duplicate queue item (`trigger_key` unique).
- Update or delete on `fin_invoices`, `fin_queue_events`, waivers, finalised statements → refused.

### Sync (integration layer, fake fetcher)

- Older page after a newer one → the stored row is not overwritten.
- Status change → one status event; no change → none.
- Budget reached mid-run → clean stop, watermark unchanged, the next run resumes.
- FSM 429 / 5xx / timeout → retried per `fsmFetch`; persistent failure recorded in `fsm.sync_state`.
- FSM unreachable → reports show the last good data with a freshness warning; nothing is blanked.

### Calculations (unit layer)

- Cross-midnight shift; part-day leave; leave spanning several days; holiday on a rest day; zero available
  hours (excluded from ratios, no division by zero); overlapping appointments (union, not sum); missing
  actuals (excluded, lowers completeness, never zero); job time outside the shift (reported separately);
  unrounded threshold comparison.

### Permissions (integration layer)

- Finance → utilization: 403. HR → queue: 403. Technician → another technician's compliance: 403, even
  with that id in the request. Admin → record invoice, verify exclusion, waive: refused unless granted
  (`NOT_INHERITED_BY_ADMIN`). Export without EXPORT: 403 from the server.
- After the security port: `anon` cannot write `roles`, `role_access`, `user_profile`;
  `/api/role-access` without a session: 401.

### Notifications

- Each N1–N14 and E1–E3 at most once per dedupe key; digest not sent on an empty day; no alert for a
  technician on leave, off shift, or for a cancelled or reassigned appointment; redirect mode never reaches
  a real address.

### Volume (DB layer, at the volumes in the [database plan](database-design-and-migration-plan.md))

- Queue list first page, item detail, progress view, utilization for a month, compliance for a month:
  `EXPLAIN (ANALYZE, BUFFERS)` recorded; no sequential scan on the large tables for the paged queries.
- Export of a large report completes without holding a request open beyond the server timeout.

### Regression (each phase)

- Snagging, scheduling and AMC screens on the feature branch; Users, Roles and Permissions screens after
  the security port (they now write through server routes).

## Browser UAT script (per phase)

Run on the feature worktree's dev server with delivery in redirect mode and only test accounts on the
in-app allowlist. Steps are written per phase in its report, with screenshots or extracted text as evidence.
