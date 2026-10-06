# Zoho FSM in the portal: what exists today

**Date:** 6 October 2026. **Branch:** `amc-hardening` (written on the former `active-amc` branch, now consolidated).
**Method:** I read the repository and ran read-only SELECTs on the production database (`schedule_entries`, `schedule_audit_events`, `amc_submissions`, `snagging_clients`, `cron.job`). I made no Zoho API calls with the production token and changed nothing.

Everything below is either in the code or seen in the data. Where neither says, the section says **not established**.

## 1. Components

| Piece | Where | What it does |
|---|---|---|
| FSM REST client | `lib/server/zoho/fsm-client.ts` | `https://fsm.zoho.com/fsm/v1`. One shared OAuth token from `settings.oauth_access_token`, refreshed by the `zoho-token-refresh` pg_cron job every 15 min (the only cron in production). 20 s timeout, 3 attempts, backoff on 429/5xx |
| Work orders | `lib/server/zoho/work-orders.ts` | Search by number (`/Work_Orders/search`, Name), or scan the 800 most recent in memory by contact, company, address or due date. Read one work order with its `Service_Line_Items` (each with `Service {id, name}`), `Service_Tasks_Line_Items` and `Appointments_X_Services` (line ↔ appointment junction with `SLI_Status`, `is_line_item_active`) |
| Appointments: write | `lib/server/zoho/appointments.ts` | Create (`POST /Service_Appointments`) for chosen service lines of an existing work order; reschedule (`PUT …/actions/reschedule`). Re-reads before writing; refuses on a cancelled appointment |
| Appointments: import | `lib/server/zoho/import-appointments.ts` | When a scheduler opens a day: searches `Scheduled_Start_Date_Time` in a padded window, reads each full record for the crew, and inserts board rows (`schedule_entries`, `origin 'fsm'`). Skips cancelled, no work order, no times, or no known technician |
| Reconcile | `lib/server/zoho/reconcile.ts` | When a day is opened or refreshed: re-reads each board appointment, writes back `fsm_status` + `fsm_status_checked_at`, and adopts FSM's times and crew. Stores the full FSM record in `schedule_audit_events.after_value` on a real change |
| Technicians | `lib/server/zoho/service-resources.ts` | FSM Users with a Service_Resources sub-object → `technician_reference` (`fsm_resource_id`, `display_name`). On demand, plus a stale-cache top-up |
| Status mapping | `lib/scheduling/appointment-status.ts` | Normalises FSM's status text into new / scheduled / dispatched / in_progress / completed / cannot_complete / cancelled / unknown, for board colours. Pattern-based ("complet", "closed", "finished" all read as completed) |
| Estimates | `app/api/estimates/route.ts` → Edge Function `get-estimate` | Reads an FSM estimate, its revisions and, for the dashboard, its **contact**: `payload.contact.data[0].Customer_Id__C` becomes the quotation's "Customer ID". Line items carry `Service.id` (`serviceItemId`) |
| Edge Functions (source not in this repo) | `get-estimate`, `zoho-fsm-work-orders` (bulk download), `zoho-fsm-appointments`, `zoho-fsm-appointment-create`, `zoho-fsm-appointment-update`, `zoho-fsm-estimate-transitions` | Called through portal routes with the anon key. `appointment-create/update` are legacy paths; the board uses the in-repo client |

**Work orders are not created by the portal.** They are created in FSM (directly, or by converting an approved estimate in FSM). The portal creates **appointments** for existing work orders (`schedule-sync.ts`, at approval of a day) and imports appointments FSM already has.

## 2. Data the portal keeps

`schedule_entries` (one row per appointment per schedule **version**; revisions copy rows):
- `fsm_work_order_id`, `fsm_work_order_name`, `fsm_appointment_id`, `fsm_appointment_name`, `fsm_appointment_type`, `fsm_schedule_type`
- `fsm_service_line_item_ids`: set only on the 10 portal-created rows, null on all 248 imported ones
- `fsm_status` (raw FSM text), `fsm_status_checked_at` (when the portal last read it, not when FSM changed it)
- `start_at` / `end_at` (scheduled window), `client_name` / `contact_name` / `address` (free text copied from FSM)
- technicians in `schedule_entry_assignments.technician_fsm_id`

It holds **no FSM contact id, no customer id, no service id and no actual times**. Rows exist only for days someone opened, and only for appointments with a technician the portal knows.

`schedule_audit_events`: `fsm_change_synced` / `fsm_appointment_cancelled` rows hold full FSM appointment records (28 seen). This is where the field evidence below comes from.

## 3. Customer identity

| Identifier | Where | Evidence |
|---|---|---|
| AMC proposal "Customer ID" (`customer.customerId`, contract `customer_ref`) | Typed by hand in the AMC wizard (placeholder "YFI1806"); no lookup, no validation | Production: 28 proposals. 2 look like codes (`YF#####`, `YFI###`); the rest are free text (names and sentences, mostly test data) |
| FSM `Contacts.Customer_Id__C` | A custom field on FSM Contacts | Read by `get-estimate` and printed on quotations. Its values were not read here |
| FSM contact id | `Contact {id, name}` on appointments, work orders and estimates | Present on every appointment record seen |
| `snagging_clients.crm_contact_id` | Snagging clients | Null on all 9 rows |
| `schedule_entries.client_name` / `contact_name` | Free text | Not an identifier |

**Classification: NOT MAPPED.** Nothing ties an AMC contract to an FSM customer. The AMC "Customer ID" is unvalidated text; it may be meant to hold `Customer_Id__C` (same "YFI…" format in the placeholder), but no code or data confirms it. Name matching would be unsafe.

**Built (see report):** an explicit link, `amc_contracts.fsm_contact_id`, set by a person from a real work order's FSM contact, with that contact's `Customer_Id__C` kept beside it.

## 4. Services

| Catalogue | Identifier |
|---|---|
| AMC | Settings catalogue ids (`ac-ppm`, `handyman`, `emergency`, `non-emergency`, …) |
| FSM work orders and estimates | `Service_Line_Items[].Service {id, name}` (FSM Services/Products records) |
| Scheduling | Line item ids only (`fsm_service_line_item_ids`); service names shown, ids not kept |
| Quotation templates | `serviceItemId` from the estimate (FSM Service id) |

**No shared identifier.** The portal never lists FSM's Services catalogue. FSM service ids are visible only on work order and estimate lines.

**Built:** `amc_fsm_service_mappings` (AMC service id → FSM service id), kept by AMC approvers, found from real work order lines.

## 5. Work order and appointment relationship

Work order → service lines → appointments, through `Appointments_X_Services` (a line is "scheduled" while a live association exists; a cancelled appointment frees it). An appointment belongs to one work order. `schedule_entries` stores both ids, but only for board days and per schedule version, so its row ids are not stable references. **FSM ids are.**

## 6. Completion signal

| Question | Finding |
|---|---|
| Statuses in production (`schedule_entries.fsm_status`, 258 rows) | Completed 125, Dispatched 63, In Progress 30, Cannot Complete 14, Scheduled 8, none 18 |
| Statuses documented in code | New → Scheduled → Dispatched → In Progress → Completed, plus Cannot Complete and Cancelled (comment citing Zoho help); the picklist is editable per org |
| Completion timestamp | `Actual_End_Date_Time` (with `Actual_Start_Date_Time` and `Actual_Duration {unit: seconds, hours: "HH:MM:SS"}`). In the 28 stored records, all 8 "Completed" had all three; no other status had any |
| Cancellation timestamp | `Cancelled_Or_Terminated_Time` field exists; empty in the stored records |
| Observed transitions (stored snapshots) | first → Dispatched (11), Dispatched → Dispatched (8), first → Completed (4), Dispatched → Completed (3), Completed → Completed (1), first → Scheduled (1). **No transition out of Completed was seen**; the sample is small |
| Reversibility | **Not established.** The code assumes a status can move anywhere (it mirrors FSM). Nothing documents whether Completed can be reopened in this org |
| How the portal learns of it | Only when someone opens or refreshes the day containing the appointment (`/api/scheduling/schedule`, `/api/scheduling/reconcile`). No webhook, no background poll (the 10-minute reconcile cron was dropped in `20260820090000`) |

**Classification: observed, not confirmed.** "Completed" plus an actual end time is a consistent signal in the data, but the business has not confirmed that it means "the AMC service was delivered" (rather than, say, a visit closed without work), nor whether it can be reopened.

## 7. SLA timestamps

| SLA needs | FSM has | Verdict |
|---|---|---|
| requested_at (customer asked) | No request field. `Created_Time` is when the appointment record was made, not when the customer asked | **Not available** from FSM. Built: staff enter it on the AMC link |
| arrived_at (emergency attendance) | `Actual_Start_Date_Time`: when work was started in FSM | **Not confirmed** as arrival; not mapped by default |
| scheduled_at (non-emergency: when booked) | No field for when the visit was booked; `Scheduled_Start_Date_Time` is when it is planned to happen | **Not available** |

## 8. Hours

`Actual_Duration` is the appointment's elapsed time (start to end), for the whole crew, unapproved. It is not the handyman's approved labour hours. **No trustworthy hours source.**

## 9. Retry and queue infrastructure

None to reuse beyond pg_cron (one job). Scheduling sync failures are kept per row (`sync_status`, `last_sync_error`) and retried by a person. The AMC sync follows the same pattern: a per-appointment log row (`amc_fsm_sync_events`) with status, reason and attempts, retried by running the check again.
