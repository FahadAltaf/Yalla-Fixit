# Requirements traceability

Part of the [Finance & Reports plan](README.md). Sources: BRD v1.0 (19 Oct 2026) and Jira DEV-433…463
(parent DEV-432). Status reflects the code on `main` at `f341a26`, checked in the code, not inferred from
names. Decisions (D-) and blockers (B-) are in
[business-decisions-and-blockers.md](business-decisions-and-blockers.md).

**Status key**: ✅ implemented and verified · 🟡 partial · ⬜ not implemented · ♻ needs refactoring ·
❓ business decision pending · ⛔ external dependency blocked.

**Layers**: F frontend, B backend, D database, I FSM integration.

## Finance module (Part A)

| Jira | BRD | Objective | Today | Work needed | FSM | Decision | Acceptance / tests | Phase | Status |
|---|---|---|---|---|---|---|---|---|---|
| DEV-433 | 5.1 S1, 6.5 | Item only when job completed AND flagged | Nothing | B trigger in sync; D `fin_queue_items`; I read flag + completion | `Estimates.Post_To_Maher__C`, appointment/line completion | D-01, D-02, D-03 | TC01, TC02; replayed sync creates no duplicate | P3 | ⬜ ❓ |
| DEV-434 | 5.1 S2 | Line-level items; cumulative, remaining, % derived | Lines stored as JSON on snagging quotations only; FSM line ids dropped on read | D `fin_queue_item_lines` `UNIQUE(fsm_line_id)`, progress view; B atomic creation; I keep line ids | `Work_Orders.Service_Line_Items[]` | D-03, D-04, D-05 | TC03, TC04; Q-1042 → 41.7 / 75.0 / 100 % | P3 | ⬜ ❓ |
| DEV-435 | 6.4 | Queue list with summary strip and filters | Nothing | F list page (DataTable, StatCard); B paginated list API | — | D-12 (aged) | Filters, counts, server paging | P4 | ⬜ |
| DEV-436 | 5.1 S3, 6.4, 6.8 | Item detail with evidence and actions | Nothing | F detail page; B detail API; I completion-report link | Appointments ✓; report PDF ⛔ | — | All Step 3 groups shown; actions per status | P4 | ⬜ ⛔ (report link, B-01) |
| DEV-437 | 5.1 S4, 6.2 N4 | Six statuses, transitions, reasons, N4 | Nothing | D `fin_transition` fn + `fin_queue_events`; B API; notifications | — | D-07 | Illegal transitions refused; concurrent transitions → one wins | P3 | ⬜ |
| DEV-438 | 5.1 S5, 6.2 N3, 6.8 | Exclusion with reason, evidence, Behrouz verification | Nothing | D `fin_exclusions`; B request/verify; F verify queue; N3 | AMC identification | **D-06** (before build), D-14 | TC05 | P3 | ⬜ ❓ |
| DEV-439 | 5.1 S6, 6.1 E1, 6.2 N1 N2 | Daily digest email + in-app | No portal notifications; Resend sender exists | B digest run route; `portal_notifications`; E1 template | — | D-12 | Not sent when nothing new or outstanding; once per day (dedupe) | P4 | ⬜ |
| DEV-440 | 5.1 S7 | Record MAHER invoice; variance reason; lines flagged | `snagging_clients.maher_id` only (client id) | D `fin_invoices` append-only; `fin_record_invoice` fn | — | D-21 | TC06; idempotent retry; partial failure leaves nothing | P3 | ⬜ |
| DEV-441 | 5.1 S8, 6.9 | Invoicing controls and metrics | Nothing | B metrics from `fin_queue_events`; F cards | — | — | Days-to-invoice, ageing bands, variance | P4 | ⬜ |

## Reports module (Part B)

| Jira | BRD | Objective | Today | Work needed | FSM | Decision | Acceptance / tests | Phase | Status |
|---|---|---|---|---|---|---|---|---|---|
| DEV-442 | 5.2 B1, N7 N8 | Quotation pipeline, ageing, expiry | Single-record estimate reads only | I estimates mirror + status history; B summary; F report; N7/N8 | `Estimates` ✓ | D-13 | TC07 | P5 | ⬜ ❓ |
| DEV-443 | 5.2 B2 | Available hours engine | Org shift times in `settings`; `technician_reference.shift`; `leave_records` | B pure calculator; D holidays, rest days, leaving date | — | D-16 | TC08, TC15; cross-midnight; part-day leave | P5 | 🟡 |
| DEV-444 | 5.2 B2, 6.4 | Time vs commercial utilization; travel; completeness | Nothing | B calculator; F report; I appointments + trips | Actuals ✓ (100 % on completed); trips ⛔ | D-08, D-14, D-16 | TC09; 78 % / 69 % example | P6 | ⬜ ⛔ (travel, B-01) |
| DEV-445 | 5.2 B3, N5 | Shift check-in missed alert | Nothing | B 5-min sweep; dedupe; N5 | Shift check-in ⛔ | D-11 | TC10 | P7 | ⬜ ⛔ |
| DEV-446 | 5.2 B3, N6 | Appointment check-in missed alert | Nothing | B sweep; N6 | Possibly actual start | D-15 | One alert; none for cancelled/reassigned | P7 | ⬜ ❓ |
| DEV-447 | 5.2 B4 | Compliance % and penalty | Nothing | B calculator; D statements | Check-ins ⛔ | **D-09, D-11** | TC11, TC12 | P7 | ⬜ ⛔ ❓ |
| DEV-448 | 5.2 B4 | Waivers, single and bulk | Nothing | D `hr_waivers`, batches; F actions | Misses come from check-ins ⛔ | — | TC13 | P7 | ⬜ ⛔ (acts on misses, which need check-in data) |
| DEV-449 | 5.2 B4, N9–N12, 6.8 | Technician view and disputes | Nothing; no technician ↔ user link | D link + `hr_disputes`; F self-service | — | **D-10, D-19** | TC14 | P7 | ⬜ ❓ |
| DEV-450 | 5.2 B4, E2 E3 | Monthly statement and HR report | Nothing | B month-end finalisation; E2/E3 | Check-ins ⛔ | D-11 | Figures frozen after the window | P7 | ⬜ ⛔ |
| DEV-451 | 5.2 B5 | Daily attendance | Nothing | B report from shift + check-ins | Shift check-ins ⛔ | D-11 | Late / early / absent flags | P7 | ⬜ ⛔ |
| DEV-452 | 5.2 B5, N14 | Booked vs available capacity | Board shows today only | B forward calculator; F report; optional N14 | Appointments ✓ | — | Over-booked days highlighted | P6 | ⬜ |
| DEV-453 | 5.2 B5, N13 | Exceptions: no invoice flag; no actual times | Nothing | B two reports; N13 | ✓ | D-01, D-02 | Completeness % per technician | P5 | ⬜ ❓ |
| DEV-454 | 5.2 B5 | Revenue, AMC mix, ratings, FSM links | Nothing | B revenue report; F links | Ratings ⛔ | D-14, D-17 | Ranked revenue; links open FSM | P8 | ⬜ ⛔ ❓ |
| DEV-455 | 5.2 B5 | Shared filters, export, drill, access, saved filters | Analytics drill-through and xlsx export exist | F shared shell; D `report_saved_filters`, `report_access_log` | — | — | Same controls on every report | P5 | ⬜ (snagging export and drill-through are reusable, not this feature) |

## Prerequisites (§5.3)

| Jira | BRD | Objective | Today | Work needed | Decision | Phase | Status |
|---|---|---|---|---|---|---|---|
| DEV-456 | 5.3 | Leave types: Annual, Sick, Public Holiday, Offset | `leave_records.leave_type` is free text | D `leave_category` (nullable); F dropdown | — | P1 | 🟡 |
| DEV-457 | 5.3 | Employment status, leaving date, FSM deactivation | Nothing; FSM sync keeps only `client_status = Active` | D columns on `technician_reference`; F users/technician panel; process doc | Process: Sharon, Ali | P1 | ⬜ |
| DEV-458 | 5.3 | Hide test/dev accounts from lists | Nothing | D `hidden_from_lists`; B honoured in all 5 picker paths | — | P1 | ⬜ |
| DEV-459 | 5.3 | Client/address two-way sync | Read-through + portal→FSM writes exist | B FSM-down fallback; conflict and loop rules | — | P9 | 🟡 |
| DEV-460 | 5.3 | Clean test data before go-live | Nothing | Inventory, dry run, reviewed script; finance/HR reset | — | P9 | ⬜ |

## Settings, access, QA

| Jira | BRD | Objective | Today | Work needed | Decision | Phase | Status |
|---|---|---|---|---|---|---|---|
| DEV-461 | 6.6, 6.4 | Reporting Settings screen | AMC settings pattern to copy | D `reporting_settings`; F settings page with history | D-09, D-12 | P1 | ⬜ |
| DEV-462 | 6.7 | Roles and permissions | Permission model exists; **escalation hole on `main`** | Security port (P0, on the feature branch); new resources and roles; record scoping | D-18 | P0 (port) + P1 | ⬜ (no finance/HR access on `main`; port done on the branch) |
| DEV-463 | 6.11 | Full test case sheet | 15 starter cases in BRD | Expanded matrix ([test strategy](test-strategy-and-acceptance-matrix.md)) | Sheet link (DEV-463 text) | P0 → P9 | ⬜ (matrix started on the branch) |

## Coverage

**31 / 31 mapped to a phase.** On `main`: ✅ 0 · 🟡 3 (DEV-443, 456, 459) · ⬜ 28.
Blocked externally by B-01 in whole or part (**8**): DEV-436, 444, 445, 447, 448, 450, 451, 454.
Waiting on a business decision before build can finish (**9**): DEV-433, 434, 438, 442, 446, 447, 449, 453, 454.
