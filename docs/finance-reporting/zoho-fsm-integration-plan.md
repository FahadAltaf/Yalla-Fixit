# Zoho FSM integration plan

Part of the [Finance & Reports plan](README.md). Jira: DEV-433, 436, 442, 444–447, 451, 453, 454, 459.

## Principles

- **Read only.** BRD §3: "Zoho FSM (read only, no change to FSM)". This project makes no FSM writes.
  All finance FSM traffic goes through `lib/server/finance/fsm-read.ts` (`createFsmReader`), which can
  only send a GET, refuses `/actions/` paths and full URLs, needs `FINANCE_FSM_READ=on`, and stops at a
  per-run call budget. Proven by `tests/finance/fsm-read.test.ts`, which was also shown to fail when the
  guard is disabled.
- **No sandbox.** Every FSM call reaches the production tenant (`https://fsm.zoho.com/fsm/v1`, US data
  centre, hard-coded in `lib/server/zoho/fsm-client.ts`).
- **A local read model, not live calls per page.** Reports and the queue read Supabase mirror tables kept
  fresh by an incremental sync. This also serves the BRD's direction of travel ("keep as much as possible
  inside the portal … part of the plan to move off Zoho").
- **Reuse `fsmFetch`** for timeout (20 s), retries (3 attempts on 429/408/5xx, exponential backoff capped at
  8 s, `Retry-After` honoured up to 30 s).

## Discovery results — 20 Oct 2026

Three read-only passes (`scripts/finance/fsm-discovery*.ts`), **34 GET calls in total**. They record field
names, types, picklist values and counts only — never record values. Samples are the **600 most recently
modified** records per module, so they describe current practice, not all history.

### The OAuth token's scope is the first blocker

The token in `settings.oauth_access_token` (refreshed by an external pg_cron job, not in the repo) can read
records of `Work_Orders`, `Service_Appointments` and `Estimates`. Everything else tried returns
**`401 OAUTH_SCOPE_MISMATCH`**:

| Path | Result |
|---|---|
| `/settings/modules`, `/settings/fields?module=…` | 401 scope mismatch — no field metadata, no module list |
| `/Trips`, `/Trip` | 401 scope mismatch |
| `/Time_Sheets`, `/Timesheets`, `/Time_Sheet` | 401 scope mismatch |
| `/Service_Reports`, `/Job_Sheets`, `/Invoices` | 401 scope mismatch |
| `/Feedbacks`, `/Ratings` | 401 scope mismatch |
| `/Check_Ins`, `/Attendance`, `/User_Availability`, `/Shifts` | 401 scope mismatch |

A 401 here says the token may not ask, not that the module is absent. **Whether FSM exposes trips,
shift check-ins, ratings and completion reports through the API cannot be determined until the token is
re-issued with wider read scopes.** That is a Zoho admin action (re-authorise the OAuth client with the
extra read scopes, then refresh the stored token) and is recorded in
[business-decisions-and-blockers.md](business-decisions-and-blockers.md) as **B-01**.

### What the records show

**"Ready to be Invoiced" lives on the quotation.** `Estimates.Post_To_Maher__C` is a picklist whose value
**"To Be Invoiced"** was seen on 2 of 600 quotations (one New, one Approved). It sits beside
`Invoice_Number_from_Maher__C`, recorded on 0 of 600. By contrast `Billing_Status` is
`Not yet Invoiced` on **600/600** work orders and **600/600** appointments, so the flag is not a value of
that field. Other values of `Post_To_Maher__C` are unknown (metadata closed). *Conclusion, to be confirmed
by Sharon/coordinators (D-02): `Post_To_Maher__C = "To Be Invoiced"` is the BRD's flag.*

**Work orders are rarely completed in FSM.** Work order `Status`: In Progress 409, Scheduled Appointment
121, New 61, Cancelled 5, **Completed 3**, Cannot Complete 1; `Completed_Time` set on 3/600.
Appointments, however, complete normally: **Completed 402/600**. A queue trigger on "work order completed"
would fire on about 0.5 % of jobs. This is evidence for decision D-01 (what "job completed" means).

**Actual times are reliable where they matter.** Appointments with both `Actual_Start_Date_Time` and
`Actual_End_Date_Time`:

| Appointment status | Both actuals present |
|---|---|
| Completed | **402 / 402 (100 %)** |
| Cannot Complete | 15 / 45 |
| In Progress | 0 / 11 (start only on all 11) |
| Dispatched, Cancelled, Scheduled, New | 0 |

**Chargeable/AMC flags exist but are unused.** On work orders `Chargeable__C` is `false` on 600/600,
`Outside_AMC_Scope__C` `false` on 600/600, `PPM_Status__C` empty on 600/600, `AMC_Contract_Ref__C` set on
3/600, `Work_Type__C = "AMC PPM"` on 5/600. Work order `Type`: Service 471, Maintenance 54, Inspection 26,
Scheduled Maintenance 26, Emergency 14, Standard 9. None of these can drive the chargeable split or AMC
identification on their own today (D-08, D-14).

**Quotation statuses seen**: New 360, Converted to Work Order 222, Approved 18. `Quotation_Type__C`:
Standard 524, Revision 76. "Sent", "Rejected", "Revised" and "Expired" did not appear in the sample;
`Rejected_Time` and `Expired_Time` fields exist. The BRD's seven-status pipeline must be mapped onto real
values (D-13).

## Per-resource plan

| Resource | Source | Fields (confirmed unless marked) | Paging | Freshness | Status |
|---|---|---|---|---|---|
| Quotations | `GET /Estimates` | `id, Name, Status, Grand_Total, Sub_Total, Tax_Amount, Owner, Contact, Company, Expiry_Date, Creation_Date__C, Approved_Time, Rejected_Time, Expired_Time, Cancelled_Time, Closed_Time, Post_To_Maher__C, Invoice_Number_from_Maher__C, Quotation_Type__C, Root_Quotation_Number__C, Work_Order, Modified_Time` | `per_page=200`, `info.more_records` | 15 min incremental | **Readable** |
| Quotation status history | Derived | Each sync compares status with the stored row and appends `fsm_estimate_status_events` | — | as sync | **Build** (no history API used) |
| Work orders | `GET /Work_Orders` | `id, Name, Status, Type, Work_Type__C, Completed_Time, Estimate, Service_Line_Items, Service_Appointments, Grand_Total, Sub_Total, Tax_Amount, Billing_Status, AMC_Contract_Ref__C, Parent_Work_Order, Modified_Time` | same | 15 min | **Readable** |
| Line items | Embedded in work order (`Service_Line_Items[]`) | From code (`work-order-copy.ts`): `id, Name, Service, Quantity, List_Price, Amount, Line_Item_Amount, Discount, Tax, Status`. **Keep the line `id`** — today's code drops it | with WO | with WO | **Readable** (row shape to confirm on a WO that has lines) |
| Appointments | `GET /Service_Appointments` | `id, Name, Status, Type, Scheduled_Start/End_Date_Time, Actual_Start/End_Date_Time, Actual_Duration, Scheduled_Duration, Work_Order, Service_Resources, Overlapping_Appointments, Cancellation_Reason, Modified_Time` | same | 15 min; 5 min for today's window (alerts) | **Readable** |
| Technician assignment | `Service_Resources` on appointment; `/users` (existing `syncFsmTechnicians`) | existing `technician_reference` | 200 | 6 h (existing) | **Readable** |
| Trips / travel | unknown module | — | — | — | **Blocked (B-01)** |
| Shift check-in/out | unknown module | — | — | — | **Blocked (B-01)** |
| Appointment check-in/out | Hypothesis: `Actual_Start_Date_Time` / `Actual_End_Date_Time` | — | — | — | **To confirm (D-15)** |
| Completion report PDF | Attachments / service report | `app/api/zoho-file` proxy reads files by id | — | on open | **Blocked (B-01)** |
| Ratings / feedback | unknown module | — | — | — | **Blocked (B-01)** |
| Customers, addresses | `/Contacts`, `/Contacts/{id}/Addresses` | existing `lib/server/zoho/fsm-contacts.ts` | 200 | read-through | **Exists (DEV-459)** |

## Sync design (P2)

- **Incremental by `Modified_Time`.** List endpoints sorted `sort_by=Modified_Time&sort_order=desc`, read
  page by page until a record older than the stored watermark minus a 10-minute overlap; upsert, then advance
  the watermark to the newest `Modified_Time` seen. The overlap absorbs clock skew and same-second edits;
  idempotent upserts make re-reading harmless.
- **Idempotent upserts** keyed on the FSM id (`ON CONFLICT (fsm_id) DO UPDATE … WHERE excluded.modified_time
  >= current.modified_time`), so a late or repeated page never overwrites newer data.
- **Run log** `fsm_sync_runs` (started, finished, pages, records, calls, error) and per-resource
  `fsm_sync_state` (watermark, last success, last error, consecutive failures) — surfaced as a freshness
  indicator on every report.
- **Concurrency**: a run claims its resource with an advisory lock (`pg_try_advisory_lock`), so two
  triggers never sync the same resource at once.
- **Budget**: each run has a ceiling (`createFsmReader` budget) well under the org's daily allowance, which
  is shared with scheduling and snagging. The rate-limit headers could not be read (the probe got a 401
  without them); the allowance must be confirmed from the Zoho console (B-03).
- **Reconciliation**: nightly re-read of records modified in the last 7 days catches anything a watermark
  missed; a weekly count comparison flags drift.
- **Backfill**: one-off, oldest first, resumable from the stored page; run deliberately before go-live.
  Volume is unknown until counted (B-04); at 200 per call, 20 000 records is 100 calls.
- **No webhooks.** None exist in the portal, and their reliability is unverified. Polling with watermarks is
  the simpler reliable mechanism; revisit only if freshness requirements tighten.
- **Triggers**: `CRON_SECRET`-protected POST routes (house pattern, e.g.
  `app/api/snagging/approvals/escalations/run`). Nothing schedules them until go-live.

## Client and address sync (DEV-459)

Already built on `main` as read-through with lazy materialisation (`lib/server/snagging/fsm-clients.ts`,
migration `20261015100000_snagging_fsm_clients.sql`): FSM is read live; a portal row is created when a
client is used; portal-created clients are written to FSM. Remaining work (P9):

- **Fallback** when FSM is unreachable: `listFsmClients` has none today, so an FSM outage empties the
  client picker even for clients already used. Fall back to `snagging_clients` with an on-screen notice.
- **Ownership and conflicts**: FSM owns contact and address fields; the portal owns portal-only fields
  (`notes`, `maher_id`). A portal edit to an FSM-owned field is written to FSM first and copied locally only
  on success; a later FSM change always wins on read.
- **Loop prevention**: writes carry the record's last-seen `Modified_Time`; a read that returns our own
  write is recognised and not echoed back.
- **Writes stay off on this branch** (`SNAGGING_FSM_CLIENTS=off`) per the read-only decision.

## Existing integration findings worth fixing (outside this project)

- `ZOHO_FSM=read` in `.env` is **read by no code on `main`**, while `SNAGGING_FSM_SYNC=on` **enables**
  snagging's estimate and work-order writes. A developer reading the `.env` comment believes FSM is
  read-only when it is not (B-05).
- `components/dashboard/extensions/bulk-download.tsx` puts the OAuth access token in a query string.
- `app/api/zoho-file`, `app/api/estimates/*`, `app/api/test` call FSM without `fsmFetch` (no timeout, no
  429 handling) and, on `main`, without an auth check. `amc-hardening` (`926cb24`) adds checks to the
  estimate routes, but those were **not** part of this branch's security port, which is limited to closing
  the role-escalation hole. `app/api/test` should be removed.
- Seven FSM paths depend on Supabase Edge Functions whose source is not on `main`.
