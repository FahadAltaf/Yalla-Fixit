# Manual test guide — Finance & Reports (P0–P5)

How to check by hand what is built so far on `feature/yfi-finance-reporting`. Each step says what to do and
what you should see. Automated tests are at the end.

## Before you start: what is safe

The branch runs against the **production database**, so be careful what you save.

| Area | Safe to test? | Why |
|---|---|---|
| Finance queue (FQ-1001 … 1006) | **Yes** | Marked test items; every one shows a *Test item* badge and is removed before go-live |
| Reporting Settings | Yes, **change a value back afterwards** | Only this branch reads them; History keeps every change |
| Zoho FSM | Yes | The branch can only read FSM (GET only); nothing is written there |
| Email | Yes | Blocked by the safety rail on this branch: no email leaves |
| In-app notifications | Yes | Delivered only to the allowlisted user in the worktree `.env` (`NOTIFY_INAPP_ALLOWLIST`); everyone else is skipped |
| Leave, employment status, leaving date, rest days on a **real technician** | **No: look, don't save** | Live scheduling reads the same leave records |
| Hide from lists | Only on a **test account**, and switch it off afterwards | — |

## 0. Setup (once)

1. Open the branch folder `C:\Users\Technisia\Documents\Prohelp-Work\_wt\finance-reporting` in a terminal.
2. Start the dev server on its own port (the main checkout uses 3032):

   ```bash
   npm run dev -- -p 3034
   ```

3. Open <http://localhost:3034> and sign in with your normal account.
4. **Give your role the Finance permissions.** Admins do not get the two approval acts automatically.
   Go to **Permissions**, pick your role, and tick:
   - *Ready-to-invoice queue*: View, Edit, **Approve** (Approve = record invoice)
   - *Not-invoiceable requests*: Create, **Approve** (Approve = verify)
   - *Reporting settings*: View, Edit
   - *Quotation summary* and *Exception reports*: View, Export (administrators already have these)

   Save, then reload the page. **Finance** and **Reports** groups appear in the menu.

## 1. Security (P0)

| # | Do | Expect |
|---|---|---|
| 1.1 | In a private window (signed out), open `http://localhost:3034/api/role-access` | `401` / Unauthorized, no data |
| 1.2 | Sign in as a non-admin user without the Roles permission and open `/roles` and `/permissions` | Not shown in the menu; the page refuses |

## 2. Platform (P1)

### Reporting Settings (DEV-461)

| # | Do | Expect |
|---|---|---|
| 2.1 | **Settings → Reporting** | Tabs: Invoicing, Quotations, Check-in alerts, Compliance, Capacity and exceptions, Change history, FSM data |
| 2.2 | Invoicing tab: change *Item aged after* (days in Pending) by one, e.g. 7 → 8 and save | Saved; the tab shows a change count |
| 2.3 | **Change history** tab | One row: who, when, the setting, old → new value |
| 2.4 | Enter an invalid value (e.g. a negative number) and save | Refused with a message; nothing saved |
| 2.5 | Set it back and save | History shows the second change |

### Notifications

| # | Do | Expect |
|---|---|---|
| 2.6 | Open **Notifications** in the menu | The inbox; finance notices from the queue tests appear here (allowlisted user only) |
| 2.7 | Open the **Home** page | The notifications panel shows the same open items |

### People (DEV-456, 457, 458)

| # | Do | Expect |
|---|---|---|
| 2.8 | **Scheduling** → open any technician | An *Employment* section (status Active/Resigned, leaving date) and rest-day buttons Mon–Sun. **Don't save on a real technician.** |
| 2.9 | Scheduling → start adding leave (don't save) | *Leave type* is a dropdown of fixed categories, not free text |
| 2.10 | **Users** → edit a **test** account → switch on *Hide from lists* → save | The account stays in the Users list but is gone from people pickers (e.g. the To-do assignee picker, scheduling technician lists) |
| 2.11 | Switch *Hide from lists* off again | It is back in the pickers |

## 3. FSM data (P2)

| # | Do | Expect |
|---|---|---|
| 3.1 | **Settings → Reporting → FSM data** | One row each for quotations, work orders, appointments (and their details): records held, last successful sync, how far behind, last error if any |
| 3.2 | Press **Refresh** | The panel reloads; nothing is fetched from FSM by this button |

The sync itself runs by hand on this branch (it is scheduled only at go-live):

```bash
node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs scripts/finance/fsm-sync-run.ts estimates incremental 5
```

Expect a JSON summary (records read, written, calls used). Run it twice: the second run finds nothing new and
uses one call. Refresh 3.1 and the last-sync time moves.

## 4. Finance queue (P3, P4)

Current test items:

| Item | Status now | Use it for |
|---|---|---|
| FQ-1001 | Invoiced | Read-only view of an invoiced item (TEST-MAH-1001, AED 280 against 285) |
| FQ-1002 | Pending | Full workflow, then invoice at the exact value |
| FQ-1003 | Pending | Exclusion: reject, then verify |
| FQ-1004 | In progress | Two-tab conflict test |
| FQ-1005 | Pending | Invoice with a difference |
| FQ-1006 | Excluded | Read-only view of an excluded item |

### Queue list (DEV-435)

| # | Do | Expect |
|---|---|---|
| 4.1 | **Finance → Ready to invoice** | Five cards (Pending, In progress, On hold, Excluded value, Average days to invoice) and the list showing *Awaiting action*: FQ-1002, 1003, 1004, 1005 |
| 4.2 | Status filter → *All statuses* | All six items |
| 4.3 | Search `17969` | Only FQ-1002 |
| 4.4 | Filter by client, then clear it | The list narrows, then returns |
| 4.5 | Click a row | The item screen opens |

### Item screen and workflow (DEV-436, 437)

Use **FQ-1002**:

| # | Do | Expect |
|---|---|---|
| 4.6 | Open it | Laid out like an inspection: a header card (item code, *Test* badge, quotation, status, client · work order · coordinator, actions on the right), then tabs. **Line items**: four figure cards (this item, completion, remaining, days in status), a *Quotation progress* bar (invoiced before / this item / remaining, with the amounts) and the lines with a total. **Commercial**: reference, value, invoice, every not-invoiceable request. **Delivery evidence**: appointments and crew. **Activity**: a timeline. |
| 4.7 | **Pick up** | Status *In progress*, "with <your name>"; Activity gets a row |
| 4.8 | **Put on hold** with a reason | Status *On hold*; the reason shows in an amber band under the header |
| 4.9 | **Raise query** with a question | Status *Query raised*; "Waiting for the coordinator" shows the question; the allowlisted user gets a notification |
| 4.10 | **Answer query** with an answer | Back to *On hold* **with the hold reason still shown** (this was the bug fixed on 21 Oct); the query notification closes |
| 4.11 | **Resume** | *In progress* |
| 4.12 | **Release** | Back to *Pending*, no one assigned. Pick it up again for 4.16. |

### Two people at once (FQ-1004)

| # | Do | Expect |
|---|---|---|
| 4.13 | Open FQ-1004 in two browser tabs | Both show *In progress* |
| 4.14 | Tab 1: **Put on hold** | Works |
| 4.15 | Tab 2 (not refreshed): **Release** | Refused: someone else changed the item; nothing changes. Refresh shows *On hold*. |

### Record invoice (DEV-440)

| # | Do | Expect |
|---|---|---|
| 4.16 | FQ-1002 → **Record invoice**: number `TEST-MAH-1002`, today, amount = the item value | Saved with no reason asked; status *Invoiced*; completion % on the quotation goes up |
| 4.17 | FQ-1005 → **Record invoice** with an amount 10 lower and **no reason** | Refused: a reason is required when the amount differs |
| 4.18 | Same, now with a reason | Saved; the invoice block shows the difference (−10) and the reason |
| 4.19 | Try to record a second invoice on FQ-1005 | No *Record invoice* button: an item is invoiced once |

Please start MAHER numbers with `TEST-` so they are easy to remove.

### Not invoiceable (DEV-438) — FQ-1003

| # | Do | Expect |
|---|---|---|
| 4.20 | **Mark not invoiceable**, reason and notes, and attach a PDF and a photo under *Evidence* (after migration `20261022110000`) | "It cannot be invoiced until this is decided"; *Record invoice* disappears; the two files show as chips under the request; a notification goes to the verifier |
| 4.20a | Click a file chip | It opens in a new tab. Copy that tab's link, wait two minutes, reload it: refused (links last one minute) |
| 4.20b | In the dialog, pick an `.exe` or a file over 10 MB | Refused with a message before anything is sent |
| 4.21 | **Reject** with a note | The request closes; item back to *Pending*; notification closes |
| 4.22 | **Mark not invoiceable** again, then **Verify exclusion** | Status *Excluded*; a *Not to be invoiced* box shows the reason, who requested and verified it, and the files; its value appears in *Excluded value* on the list |

### Metrics (DEV-441)

| # | Do | Expect |
|---|---|---|
| 4.23 | **Finance → Invoicing metrics** | Laid out like the Snagging overview: date range (7 / 30 / 90 days, 12 months) and Refresh; five cards (awaiting invoice, aged, invoiced with trend, days to invoice, excluded value); *Queue activity* (value entered vs invoiced over time); *Days to invoice, by Finance user*; then the queue as it is now: *Where the waiting value sits* (donut by status), *Ageing of waiting items* (columns), *On hold*; past the *Analytics* divider, excluded value by reason and invoice variance |
| 4.24 | Check one number by hand | e.g. *Awaiting invoice* = the sum of the values of items not invoiced or excluded = the donut's centre |
| 4.25 | Click a donut slice, a card, or a day on the activity chart | The queue opens filtered to what was counted (e.g. `/finance/queue?status=pending`) |
| 4.26 | Change the range to 7 days | Activity, *Invoiced*, *Days to invoice* and variance change; the donut, ageing and on-hold list do not (they are the queue now) |

### Daily digest (DEV-439)

1. **Settings → Reporting → Invoicing**: add yourself as a digest recipient and save.
2. Run it by hand (the time check is skipped):

   ```bash
   node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs scripts/finance/run-digest.ts --ignore-time
   ```

| # | Expect |
|---|---|
| 4.25 | Today it answers `"already sent today (2026-10-21)"`: the digest goes once per Dubai day. Run it again tomorrow to see a real send. |
| 4.26 | On a sending day: an in-app *Ready to invoice* notification for the allowlisted user; the email is counted as *suppressed* (blocked by the rail) |
| 4.27 | Remove yourself as a recipient afterwards |

## 5. Reports (P5)

**Before**: apply `20261022100000_reports_foundation.sql` and add `reports` to Exposed schemas (row 8 of the
migration log). Without it the reports still work, but saved filters and the access log do not.

### Quotation summary (DEV-442)

| # | Do | Expect |
|---|---|---|
| 5.1 | **Reports → Quotation summary** | "FSM quotations updated …" line; a card per status (Not sent, Sent, Approved, Converted to work order, Rejected, Revised, Expired) with count, value before VAT, average days and how many are over the limit; the list shows *Awaiting action* (Not sent, Sent, Approved), longest-waiting first |
| 5.2 | Click the **Approved** card | The list shows only Approved; click it again to go back |
| 5.3 | Click "… quotations expiring within 5 days" | *Any flag* becomes *Expiring soon*; each row's *Valid until* says "Expires in N days" |
| 5.4 | Filter by owner, client, value band, created dates; search a number | The cards and the list narrow together |
| 5.5 | A row past its limit | Days in red with "Over the N-day limit". A "≈" before the days means the start of the status was estimated |
| 5.6 | Settings → Reporting → Quotations: change *Sent* limit, save, reload the report | Rows flagged against the new limit. Put it back |
| 5.7 | **Export → Excel** | A file with the same rows as the filtered list |

### Exception reports (DEV-453)

| # | Do | Expect |
|---|---|---|
| 5.8 | **Reports → Exception reports**, tab *Completed, not flagged* | Work orders Completed or Closed in FSM, on a quotation with a value, not marked To Be Invoiced and not in the queue (15 on 21 Oct, 13 overdue); coordinator = the quotation's owner |
| 5.9 | Switch on **Overdue only** | Only those completed more than 3 days ago (the setting under Capacity and exceptions) |
| 5.10 | Tab *Missing actual times* | Data completeness overall, by team and by technician (last 30 days); the list of completed appointments missing a start or end. On 21 Oct every completed appointment has both, so the list is empty |
| 5.11 | Pick a technician or team | Figures and list narrow to them |

### Shared report controls (DEV-455), after the migration

| # | Do | Expect |
|---|---|---|
| 5.12 | Set some filters, leave the page, come back | The same filters are back (remembered per person) |
| 5.13 | **Saved filters → Save current filters…**, name it | It appears in the menu; choosing it later restores the filters; the bin icon deletes it |
| 5.14 | Open a report and export it, then run in Supabase: `select report_key, action, user_label, row_count, format, created_at from reports.access_log order by id desc limit 5;` | One `view` row per visit and one `export` row with the row count and format |
| 5.15 | A user without *Quotation summary* View | No Reports menu entry for it; the API answers 403 |

### Public holidays (DEV-443)

| # | Do | Expect |
|---|---|---|
| 5.16 | **Settings → Reporting → Public holidays**: add a date and name | Listed; the change appears in Change history |
| 5.17 | Remove it | Gone; the removal is in Change history too |

## 5b. Utilization and capacity (P6)

No migration. Give your role *Utilization* and *Capacity* View (and Export) under Permissions → Reports.

### Utilization (DEV-444)

| # | Do | Expect |
|---|---|---|
| 5.18 | **Reports → Utilization**, set the period to 1–30 Sep | Cards: time %, commercial %, outside shift, data completeness, travel "—" (B-01). For Sept: 17.9 % and 5.1 %, 115 technicians. Notes under the cards say what the figures rest on (no break set, leave records found, technicians with no rest days, crews not read) |
| 5.19 | The trend chart | Two lines per week; *Trend: monthly* in the filters switches to months |
| 5.20 | **By technician**: lowest time % first; click a technician | Switches to *Appointments* for that technician: each with its actual times, hours, actual vs scheduled and chargeable or not |
| 5.21 | **By team**, click a team | Back to *By technician*, filtered to that team |
| 5.22 | Pick one technician in the filter | Cards, trend and list narrow to them. (Rest days would lower available hours, but don't save them on a real technician; the unit tests cover it) |
| 5.23 | Settings → Reporting → *Unpaid break per shift* = 60, reload | Available hours fall to 8 h a working day. Put it back to 0 (D-22 is open) |
| 5.24 | *Appointments*, switch on **Missing actual times only** | Empty today (every completed appointment has both times) |
| 5.25 | **Export → Excel** on each tab | Technician rows with every figure, or the appointment rows |

### Capacity (DEV-452)

| # | Do | Expect |
|---|---|---|
| 5.26 | **Reports → Capacity** | Board from today for the horizon (14 days): each team's booked/available hours per day, *All teams* on top, *Unassigned* at the bottom; red = over-booked, amber = spare, green = in between |
| 5.27 | Switch the board to **Technicians** | One row per technician; a booking on a rest day or holiday shows red |
| 5.28 | Click a cell | The bookings below narrow to that team (or technician) and day; click it again to clear |
| 5.29 | Change *From* to a past date (e.g. 1 Sep) and *Days* to 28 | The board shows that period's bookings against availability |
| 5.30 | Settings → Reporting → *Spare day below* = 25 % | Fewer amber cells. Put it back |

### Over-booking alert (N14, optional)

Off until someone is set under Settings → Reporting → *Over-booking alert recipients*. To see what it
would send without sending anything, run the plan command below: N14 lines appear under `wouldSend`.

Available hours can also be checked from the command line:

```bash
node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs scripts/reports/run-alerts.ts --plan
```

That prints the N7 / N8 / N13 / N14 alerts that *would* go out today, and the backlog held back, without writing
anything. Running it without `--plan` sends them (in-app only, through the safety rail); N7 needs recipients
set under Settings → Reporting → Quotations.

## 6. Automated tests

Run from the branch folder:

```bash
npm test
```

Expect `# pass 163`, `# fail 0` (sync engine, queue rules, metrics, digest, safety rails, available hours,
quotation ageing, exception rules, utilization, capacity, alert planning, compliance and attendance).

```bash
bash scripts/db-harness/run.sh
```

Needs the local PostgreSQL 15 the harness uses. It builds a throwaway database, applies every migration twice,
runs 153 checks (including Q-1042 giving 41.7 / 75.0 / 100 %, double invoicing refused, append-only history)
and a rollback round trip. Expect `== all checks passed`.

## What is not built yet (don't look for it)

- The automatic trigger that puts completed work into the queue (DEV-433): waits on decisions D-01..D-03.
  Until then the queue holds only the six test items.
- The completion report link on the item screen (B-01).
- Travel time on utilization (B-01). Attendance, compliance and revenue reports: P7 onwards.
