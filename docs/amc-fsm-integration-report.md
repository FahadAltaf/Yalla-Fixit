# Active AMC ↔ Zoho FSM: integration report

**Date:** 6 October 2026. **Branch:** `active-amc` (third commit, after `cad560e` and `2fc3159`). Not pushed or merged.
**Production:** not modified. Migration `20261006120000` is created, not applied. Read-only SELECTs only; no Zoho API calls were made with the production token.
**Evidence:** `docs/amc-fsm-integration-analysis.md`.

The target chain is: AMC contract → entitlement → FSM work order → FSM appointment → completed → AMC usage. Every link now has a place in the code. Where the business has not confirmed what FSM's data means, the link is explicit (made by a person) and the automatic step is off.

## 1. Existing FSM architecture

The portal reads FSM work orders, creates and reschedules appointments for existing work orders, imports a day's appointments onto the scheduling board, and re-reads their status when a scheduler opens or refreshes a day. It does **not** create work orders; those come from FSM (directly or from estimates). The status reaches the portal only on those reads: there is no webhook, and the only cron refreshes the OAuth token. Details are in the analysis, §1–2.

## 2. Customer identity mapping: NOT MAPPED, now explicit

- **Finding:** the AMC proposal's "Customer ID" is free text, and only 2 of 28 values in production look like codes. FSM identifies customers by Contact id, and keeps a `Customer_Id__C` number on the contact. Nothing in code or data ties them.
- **Built:** `amc_contracts.fsm_contact_id` (plus `fsm_contact_name`, `fsm_customer_id`, linked at and by). **Link FSM customer** asks for a work order number, reads that work order's FSM contact, then reads the contact's `Customer_Id__C`, and stores the id. It warns when the proposal's typed Customer ID differs from FSM's. Customers are never matched by name.
- **Use:** linked work and sync check the work's FSM contact against the contract's. A different contact is refused (`customer_mismatch`). With no link on the contract, usage is possible only when a person confirms it.

## 3. Service mapping: MISSING, now configurable

- **Finding:** AMC services use catalogue ids (`ac-ppm`…); FSM work and estimate lines use FSM Service record ids. There is no shared id, and no FSM service catalogue lookup.
- **Built:** `amc_fsm_service_mappings` (AMC service id → FSM service id and name, active flag; one active AMC service per FSM service).
- **Admin screen:** **AMC contracts → FSM service mapping** (`/extensions/amc-contracts/fsm-services`). Everyone with AMC access can see it; approvers edit. FSM service ids are picked from a real work order's lines (**Find from a work order**) or typed in; labels are never matched. The work-order lookup now returns each line's `Service.id` and the work order's contact id (additive fields in `getFsmWorkOrderLines`).
- **Production state:** no mappings exist yet; an approver has to enter them.

## 4. Work order relationship

`amc_fsm_links` ties FSM work to one contract entitlement:
- **Whole work order:** every appointment of the work order counts against that service.
- **Single appointment.**
- **Optional service line** (its FSM service id is kept for the mapping check).
- **Optional customer request time,** for the SLA.
- **The coverage answer at linking time:** verdict, included, used and remaining, plus the customer and service checks.

Each work order or appointment can be linked once while active. An entitlement from another contract is refused (trigger). Unlinking needs a reason and keeps the row.

**Linking runs the coverage check and never consumes.**

`amc_entitlement_usage` keeps its FSM reference (`external_type 'fsm_appointment'`, the appointment id). It gains `fsm_work_order_id` and `fsm_synced_at`, written when the row is created; the ledger still ignores updates.

## 5. Appointment relationship

`schedule_entries` is reused, not duplicated. The contract page joins board rows by FSM work order and appointment id, on current schedule versions only, for dates, technicians and FSM status. Board row ids are not referenced, because revisions copy rows.

For linked work, FSM's own view is kept in `amc_fsm_sync_events`, updated at each check:
- status;
- scheduled start;
- actual start, end and duration.

The page can therefore show visits without calling FSM.

## 6. Completion signal: UNCONFIRMED

"Completed" with an `Actual_End_Date_Time` is consistent in production data (all 8 stored "Completed" records had actual times; no other status did), and no reopening was observed. The business has not confirmed that it means the AMC service was delivered, nor whether a completed appointment can be reopened.

The engine therefore recognises completion as an exact match against the configured statuses (`["Completed"]`, the value seen in data) **and** an actual end time. A status alone does not count, and patterns like "Closed" or "Finished" are not assumed.

## 7. Usage sync design

**Rules** live in `lib/amc/fsm-sync.ts`, as the pure function `planFsmUsage`. For one appointment and one linked entitlement, it decides in this order:
1. The customer: a different FSM contact is skipped; with no link on the contract, the customer is "unverified".
2. The service: a line mapped to another AMC service is skipped; an unmapped line is "unverified".
3. Completed or not.
4. Already recorded or not.
5. The quantity, by entitlement type (§9).
6. Whether the ledger would accept it: in force on the work date (Dubai) and allowance left.
7. Whether it may run without a person: automation on for that type **and** customer and service verified.

The result is one of: **consume**, **reverse**, **review** (a person must confirm) or **skip**, each with a reason code.

**Server** (`lib/server/amc/fsm-integration.ts`, `syncFsmAppointment`):
- reads the appointment fresh from FSM;
- finds its link (by appointment, or by the linked work order);
- reads the ledger and applies the plan;
- logs the outcome;
- writes usage only for "consume"/"reverse" plans that are automatic or confirmed;
- audits each step.

**Triggers:**
- **Check FSM** on the contract re-reads every linked appointment (up to 40, four at a time; work-order links expand to their live appointments).
- **Review** on a visit re-reads FSM, shows the plan, and records it on **Confirm**.

Nothing runs on a timer.

**Automatic switch:** `AMC_FSM_AUTOMATION` (all off). Turning on `autoConsume.visits` makes **Check FSM** record verified completed visits without confirmation. A scheduled run would call the same function; it is not built, because no polling job exists and none was asked for while the signal is unconfirmed.

## 8. Idempotency

- **One consumption per appointment and service:** the ledger's existing unique index `(entitlement_id, external_type, external_reference)`. A duplicate insert, from a retry, a second check, or usage already typed in by hand with the same appointment, is answered "already recorded".
- **Plan level:** an existing consumption makes the plan `already_recorded`, so a retry never re-attempts.
- **Reversals:** the database refuses a correction beyond what the entry recorded (trigger from `20261006110000`), and the plan returns `already_reversed` once the net reaches 0.
- **Sync log:** `amc_fsm_sync_events` is unique per (appointment, action). A retry updates the row (status, reason, attempts, last attempt) rather than adding one. A recorded event keeps its usage id.

## 9. Consumption quantity

| Entitlement | Rule |
|---|---|
| Visits | 1 per completed appointment (`visitsPerAppointment`, configurable) |
| Hours | **Never from FSM by default.** `Actual_Duration` is elapsed appointment time for the crew, not approved hours. The plan asks a person to enter the hours, showing FSM's duration for reference. `hoursSource: "actual_duration"` would allow it, but only if the business decides that duration is the measure |
| Unlimited | 1 per completed appointment, for reporting; never exhausts |
| Informational | Never consumed (skipped) |

## 10. Reversal handling

If an appointment recorded as used is no longer "Completed" (e.g. cancelled), the plan proposes a **reversal**:
- a `correction` entry that references the original, with a reason;
- `source 'fsm'`;
- audited as `fsm_usage_reversed`.

The original stays. Reversal is manual until FSM's reopen behaviour is confirmed (`autoReverse: false`): the visit shows "Needs review", and a person confirms it. Usage recorded by hand is corrected from the usage history, as before.

## 11. SLA mapping

- **requested_at:** FSM has none, and `Created_Time` is not used as one. Staff can enter the customer's request time when linking work.
- **Attendance (emergency):** `Actual_Start_Date_Time` exists, but it isn't confirmed as arrival, so it is **not mapped** (`AMC_SLA_FSM_FIELDS.arrivedAt = null`).
- **Booking time (non-emergency):** FSM has no field for it.

`slaForVisit` returns MET, BREACHED or PENDING only when both times exist and are mapped. Otherwise it returns UNKNOWN, with the reason. A finished visit without a measured time is UNKNOWN, never BREACHED. **SLA automation: UNAVAILABLE**, with the mapping and evaluation ready once attendance is confirmed.

## 12. UI additions

| Where | What |
|---|---|
| Contract → **Zoho FSM integration** | FSM customer (linked or missing, with Link/Change); service mappings N/M with what is unmapped; linked work count; automatic usage (disabled, per type); completion signal used; SLA tracking (unavailable or not applicable). Actions: **Check FSM**, **Link FSM work** |
| Contract → **Upcoming visits** | Linked work's future appointments from the scheduling board: date and time, service, work order, appointment, technicians, FSM status, coverage |
| Contract → **Visit history** | Linked appointments and usage typed by hand: date, service, work order, appointment, technicians, FSM status (with "as of"), usage and source, coverage, SLA (target, actual, state), **Review** where a person must confirm |
| Contract → **Linked FSM work** | Each link with service, coverage at linking, who and when, request time; **Unlink** with a reason |
| Contract → **Usage history** | Source column: Manual, FSM (confirmed), FSM (automatic), FSM correction; FSM read time and work order |
| Dialogs | Link FSM customer, Link FSM work (work order lookup, appointment or all, service line, AMC service, request time; shows the coverage verdict), Review FSM visit (re-reads FSM; hours entered by hand), Unlink |
| **FSM service mapping** page | AMC service, FSM service, status; edit (approvers) with **Find from a work order** |
| Scheduling → Add entry | Under a chosen work order: "AMC customer · AMC-…", each line's coverage, and whether it is linked. Read-only, silent without AMC access or an AMC, never blocks scheduling |

## 13. Tests

`npm test`: **100 passed**. That is the 87 existing tests plus 13 new ones in `tests/amc/fsm-integration.test.ts`:
- **FSM records:** duration parsing (including unexpected shapes), snapshot mapping, released lines.
- **Completion:** status and actual end both required; "Closed" not assumed; automation off by default.
- **Customer mapping:** match, mismatch, unlinked contract, no contact; a mismatch never consumes; unverified needs a person.
- **Service mapping:** mapped, unmapped, inactive, mismatch, mapping coverage.
- **Coverage through the mapping:** covered, unlimited, exhausted, expired, no AMC, unmapped.
- **Sync:**
  - review while automation is off, consume when confirmed, automatic when on and verified;
  - duplicate events, retries, and manual usage already recorded;
  - not completed, cannot complete, unlimited, informational;
  - exhausted and outside the period.
- **Hours:** missing (review, with a suggestion), entered by a person, a reliable source configured, no duration.
- **Reversal:** a compensating entry that references the original; a duplicate reversal is prevented.
- **SLA:** met (94 min), breached, pending, unknown when unmapped, without a request time, or finished without an attendance time.

**Database rules** were checked on the local Postgres 15 cluster, with the migration applied twice:
- customer columns;
- one active AMC service per FSM service;
- one active link per appointment and per work order;
- a cross-contract entitlement refused, and unlinking without a reason refused;
- relinking after unlink;
- FSM usage idempotent per appointment, a second reversal refused;
- sync log unique per appointment and action, with valid statuses only;
- browser roles locked out.

## 14. Migrations

`20261006120000_amc_fsm_integration.sql`, **NOT APPLIED**. Apply after `20261006110000`. It adds only:
- columns and three tables (`amc_fsm_service_mappings`, `amc_fsm_links`, `amc_fsm_sync_events`);
- one trigger;
- indexes.

All are idempotent (`IF NOT EXISTS`), and none rewrites existing rows. RLS is on, with no browser grants. Rollback notes are in the file.

Code before the migration degrades cleanly. The contract page shows "Needs migration 20261006120000", and the scheduling notice says nothing. The usage history falls back to its older column set.

## 15. Automatic features enabled

None. Every FSM-derived write needs a person, except the sync log and audit rows.

## 16. Automatic features intentionally disabled

| Feature | Switch | Why |
|---|---|---|
| Automatic visit usage | `AMC_FSM_AUTOMATION.autoConsume.visits` | Completion unconfirmed; customer and service mappings not populated |
| Automatic hours usage | `autoConsume.hours` + `hoursSource` | No trustworthy approved-hours source |
| Automatic unlimited usage (reporting) | `autoConsume.unlimited` | As for visits |
| Automatic reversal | `autoReverse` | Reopen behaviour not established |
| SLA attendance | `AMC_SLA_FSM_FIELDS.arrivedAt` | Actual start not confirmed as arrival |
| Scheduled sync | not built | No polling job exists; FSM status otherwise arrives only on board reads |

## 17. Business decisions and production prerequisites

**Decisions:**
1. Is FSM "Completed" (with an actual end time) the proof that an AMC visit was delivered? Are other statuses ever used for that?
2. Can a Completed appointment be reopened or cancelled in this FSM org? If so, should usage be reversed automatically?
3. Does one completed appointment equal one visit (even with several service lines or technicians)?
4. Handyman hours: what is the approved measure? (FSM's elapsed duration; time sheets; entered by hand?)
5. Attendance: does `Actual_Start_Date_Time` mean "technician arrived"? What counts as "scheduled within 6 hours" for non-emergency?
6. Is the proposal's "Customer ID" meant to be FSM's `Customer_Id__C`? If so, validate it at entry.
7. Who links FSM work and confirms FSM usage: owners and approvers (today), or operations staff too?

**Production prerequisites, in order:**
1. Apply `20261006100000`, `20261006110000` and `20261006120000` after the hardening migrations (runbook 7.7–7.9).
2. Deploy.
3. An approver maps the AMC services to FSM services.
4. For each active contract, link the FSM customer.
5. Link AMC work as it is created.
6. Only after decisions 1–3, switch on `autoConsume.visits`, and add a scheduled check if wanted.
