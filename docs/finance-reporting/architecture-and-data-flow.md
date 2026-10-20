# Architecture and data flow

Part of the [Finance & Reports plan](README.md).

## Shape

```
 Zoho FSM (production, read only)
        │  GET only, via lib/server/finance/fsm-read.ts (FINANCE_FSM_READ, budget)
        ▼
 Sync runs (CRON_SECRET POST routes)  ──►  fsm.sync_state / fsm.sync_runs  (freshness, errors)
        │  incremental by Modified_Time, idempotent upserts
        ▼
 FSM read model (Supabase)
   fsm.estimates (+ status events) · fsm.work_orders · fsm.line_items
   fsm.appointments (+ resources) · [fsm_trips · fsm_checkin_events — B-01]
        │
        ├──► Finance trigger ──► fin_queue_items + fin_queue_item_lines (UNIQUE fsm_line_id)
        │         │                   │
        │         │                   ├─ fin_transition()      status changes, row-locked
        │         │                   ├─ fin_exclusions        coordinator request → Behrouz verifies
        │         │                   └─ fin_record_invoice()  MAHER ref, one transaction, idempotent
        │         └──► fin_queue_events (append-only)  → metrics (DEV-441)
        │
        ├──► Report calculators (TypeScript, pure functions)
        │       available hours ◄── technician_reference, settings shifts, leave_records,
        │                           org_public_holidays, rest days, leaving date
        │       utilization · capacity · attendance · compliance · exceptions · quotation pipeline
        │
        └──► Alert sweeps (N5/N6/N7/N8/N13/N14) ──► hr_missed_checkins (dedupe)
                                                     │
 Notifications: portal_notifications (dedupe_key) ◄──┘──► delivery-policy (live/redirect/blocked)
                                                           └──► Resend (E1–E3)
```

## Principles

1. **FSM is read, never written.** Enforced in code and proven by tests.
2. **The database guarantees what matters.** A line is invoiced at most once (`UNIQUE(fsm_line_id)`), an
   invoice is recorded at most once per item and per idempotency key, and a status changes only from the
   status the caller saw (row lock plus expected-status check). Application code is not trusted to keep
   these on its own.
3. **Derived values are derived.** Cumulative invoiced, remaining value and completion % come from a view
   over invoiced lines. Available hours, utilization and compliance are calculated from source data.
   The two stored exceptions are deliberate snapshots: the value of a queue item when it was created, and
   a finalised month's compliance statement, which must not change once issued.
4. **History is append-only.** `fin_queue_events`, `fin_invoices`, waivers and disputes are never
   updated or deleted. A waiver marks an event as waived; the original miss remains.
5. **One date policy.** Every report uses `Asia/Dubai` (`lib/scheduling/org-time.ts`), inclusive start
   date, exclusive end date, stored timestamps in UTC.
6. **Nothing reaches a real person during development.** `lib/server/finance/delivery-policy.ts`: live
   only with `FINANCE_NOTIFY_LIVE=on`; otherwise one redirect address or nothing.

## Flows

### Queue entry (DEV-433, 434) — pending D-01, D-02, D-03

1. Sync writes estimates, work orders, line items and appointments.
2. The trigger finds estimates with `Post_To_Maher__C = "To Be Invoiced"` (D-02) whose lines are complete
   (D-01) and not on any queue item.
3. `fin_create_queue_item` inserts the item and its lines in one transaction. A line already claimed fails
   the unique constraint, so a replayed sync, or two sync runs racing, cannot create a duplicate. The item
   records its value snapshot and enters `Pending`.
4. A `queue_item_created` event is appended. The next digest picks it up.

### Working an item (DEV-437, 440)

`Pending → In Progress → (Query Raised ↔ In Progress) | On Hold ↔ In Progress → Invoiced`, and
`→ Excluded` via verified exclusion. `fin_transition` takes `item_id, to_status, expected_status, actor,
note`, locks the row (`SELECT … FOR UPDATE`), refuses illegal transitions and stale expectations, and
appends the event in the same transaction. On Hold requires a reason; Query Raised notifies the
coordinator (N4).

### Recording an invoice (DEV-440)

`fin_record_invoice(item_id, maher_number, invoice_date, amount, variance_reason, idempotency_key,
actor)` in one transaction: insert into `fin_invoices` (an existing idempotency key returns the original
row unchanged), require a reason when the amount differs from the snapshot, set the item `Invoiced`, mark
its lines invoiced, append the event. A failure anywhere rolls all of it back.

### Exclusion (DEV-438) — pending D-06

Coordinator requests with reason and evidence → `fin_exclusions` row, item stays visible, Behrouz
notified (N3) → verify: item `Excluded` (lines stay claimed, so they never re-enter) / reject: item back
to `Pending` with a note.

### Compliance month (DEV-447–450) — blocked by B-01, pending D-09, D-10, D-11

Daily: required events generated from shifts and appointments, matched with check-in data, misses
recorded (N9, alerts N5/N6). Waivers and accepted disputes mark events waived. Month close: statement
issued (E2, N11) and the dispute window opens until the cut-off (default 25th). After the cut-off: figures
finalised into `hr_compliance_statements`, with the settings in force snapshotted, and the HR report sent
(E3). A finalised month is read from the snapshot and never recalculated.

## Module layout (house pattern, snagging as reference)

| Layer | Finance | Reports / HR |
|---|---|---|
| Pages | `app/(dashboard)/finance/queue`, `…/queue/[id]` | `app/(dashboard)/reports/<report>`, `…/compliance`, `…/settings/reporting` |
| API | `app/api/finance/**/route.ts` | `app/api/reports/**`, `app/api/compliance/**` |
| Run routes | `app/api/finance/sync/run`, `…/digest/run` | `app/api/reports/alerts/run`, `app/api/compliance/month-close/run` |
| Server logic | `lib/server/finance/*` | `lib/server/reports/*`, `lib/server/compliance/*` |
| Pure calculators | `lib/finance/*` | `lib/reports/*` (available hours, utilization, compliance) |
| Client services | `modules/finance/services/*` (`executeRESTBackend`) | `modules/reports/services/*` |
| UI | `components/dashboard/finance/*` | `components/dashboard/reports/*` |
| Tests | `tests/finance/*` | `tests/reports/*` |

Every route follows the house pattern: resolve the caller (`getRequestUserAccess`), 401 without a profile,
`hasResourceAction` or 403, Zod validation, service-role query, audit.
