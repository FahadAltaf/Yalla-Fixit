# Performance and scalability plan

Part of the [Finance & Reports plan](README.md). Optimisations are chosen from measured volumes and query
shapes, not added by default. Each one below says why it is needed; anything not listed is deliberately
left out until a measurement asks for it.

## Volumes

Counted on production, 20 Oct 2026: 118 technicians (115 active), 17 portal users, 476 schedule entries,
5 leave records, 25 snagging clients. FSM totals are unknown (B-04). Test volumes are in the
[database plan](database-design-and-migration-plan.md#scale-test-volumes).

## Decisions

| Concern | Decision | Why |
|---|---|---|
| Reports calling FSM on page load | **Never.** Reports read the Supabase read model | FSM latency, a shared org rate allowance, and outage behaviour |
| FSM sync cost | Incremental by `Modified_Time`, `per_page=200`, per-run call budget | Full re-reads would spend the allowance; the budget caps a runaway loop |
| N+1 FSM calls | Fields requested with `fields=` on list endpoints; no per-record follow-up GET where the list carries the data | The existing appointment import makes one GET per appointment (8 at a time); not copied |
| PostgREST 1 000-row cap | Every list paged with `.range()` + `count`; full reads via `readAllRows`, ordered by a unique key | The hosted API truncates silently (`AUDIT_SCALABILITY.md`) |
| Queue list | Server-side paging and filtering; indexes on `(status, status_changed_at)`, `(fsm_estimate_id)`, partial `(assignee_id)` for open statuses | The list is filtered by status and aged on every load |
| Completion % | A view over invoiced lines; materialise only if the measured query is slow | Correctness first; volume per estimate is small |
| Available hours | Computed in TypeScript per request from source rows; **no fact table** | 300 technicians × 31 days ≈ 9 300 day-rows a month is trivial |
| Utilization | Interval union per technician per day in TypeScript over appointments fetched for the range (indexed on `scheduled_start`) | One indexed range read; the union is linear after sorting |
| Compliance month | Calculated daily into `hr_missed_checkins`; finalised months read from `hr_compliance_statements` | Finalised figures must never change, and re-reading them is cheaper anyway |
| Report export | Server-side generation with an EXPORT check; asynchronous only if a measured export exceeds the request budget | Snagging exports run in the browser; that bypasses the server check and loads everything into memory |
| Dashboard loading | One query per card (the snagging `useSection` pattern), lazy below the fold | Avoid one slow card blocking the page |
| Write-heavy tables | Minimal indexes on `fin_queue_events`, `fsm.sync_runs`, `report_access_log` | Append-heavy; read by item or by time only |
| Audit growth | Append-only tables are never pruned automatically; archiving is a later decision | Pruning conflicts with the append-only rules |

## Not adding now, and what would change that

- **Materialised views**: only if the progress view or a monthly report measures slow at test volume.
- **Background report generation**: only if an export exceeds the server's request timeout at test volume.
- **A job queue** (`docs/JOB-QUEUE-SCOPE.md`): the `CRON_SECRET` run routes with advisory-lock claims cover
  the sync and the sweeps at this volume.
- **Webhooks from FSM**: only if 15-minute freshness proves too slow; their reliability is unverified.

## Measurement

Each phase records `EXPLAIN (ANALYZE, BUFFERS)` for its new queries at test volume on the harness, plus
wall-clock for sync runs and exports. Results go into that phase's report. **No performance figure is stated
until it has been measured.**
