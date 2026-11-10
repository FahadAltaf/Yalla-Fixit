# Reporting calculation specification

Part of the [Finance & Reports plan](README.md). Jira: DEV-434, 441, 442, 443, 444, 447, 451, 452, 453.
Every formula below is a pure function in `lib/finance/*` or `lib/reports/*`, unit-tested against the
BRD's worked examples. All worked examples were **recomputed**, not copied.

## Common rules

- **Time zone** `Asia/Dubai` (`lib/scheduling/org-time.ts`). A "day" is a calendar day in that zone.
  Ranges are inclusive of the start date and exclusive of the day after the end date. Stored timestamps
  are UTC.
- **Ratios are computed over sums, never averaged.** Utilization for a month is Σ job hours ÷ Σ available
  hours, not the mean of daily percentages. Days with zero available hours add nothing to either side.
- **Comparisons use unrounded values.** Rounding is for display only, after every decision is made.
- **Missing data is never zero.** An appointment without actual times is left out of job hours and counted
  against data completeness. It is never treated as a zero-length job.
- **Money**: `numeric(14,2)` end to end; percentages shown to one decimal place.

## Finance

**Complete and partially complete (30 Oct)**, Operations only, on Ready to invoice. Each billable line is
marked **Complete** (100 %, always to invoice) or **Partially complete** (above 0 and below 100 %, to invoice
or revenue only); a line's % is never below what is already invoiced of it. The work order is **Complete**
only when every billable line is; Operations then confirms it with **Complete work order**, which is refused
while any line is not (it names them). There is no work-order-wide partial %: it is entered line by line.
Finance invoices up to each line's "to invoice" %, as before. Stored as `finance.progress_entries` (the
latest entry for a line counts); rules in `lib/finance/progress.ts`, enforced in `recordProgress`.

**Completion % (DEV-434, E1)** = (cumulative invoiced + this item) ÷ estimate total.
Basis pending **D-05**; until then: pre-tax line amounts over the pre-tax total, labelled as such.

| Q-1042 (total 60 000) | This item | Cumulative after | Completion |
|---|---|---|---|
| Month 1, lines 1–5 | 25 000 | 25 000 | **41.7 %** |
| Month 2, lines 6–9 | 20 000 | 45 000 | **75.0 %** |
| Month 3, lines 10–12 | 15 000 | 60 000 | **100 %** |

**Remaining** = estimate total − cumulative invoiced. **Value this item** = Σ of its lines' amount
snapshots. None of these is ever typed in.

**Variance (DEV-440)** = invoiced amount − queue value snapshot. Non-zero requires a reason (DB check).

**Controls (DEV-441)**, all from `fin_queue_events`: days from ready to invoiced = invoiced event time −
`entered_at`, in days to one decimal; pending value at any instant = Σ value of items not Invoiced or
Excluded; ageing bands of pending items by days in status (default 0–7, 8–14, 15–30, 31+, configurable);
on-hold items with reasons; excluded value by reason; variance totals.

## Available hours engine (DEV-443)

For each technician `t` and day `d`:

1. **Excluded entirely** (not counted at all) when `d ≥ leaving_date` (DEV-457, TC15).
2. **Zero** when `d` is a public holiday (`org_public_holidays`) or one of `t`'s rest weekdays.
3. Otherwise `t`'s **hours a day** (Sami, 28 Oct; decided 29 Oct): their own `daily_hours` set in
   Scheduling; else **12 h when their Service Type is Data Center** (setting `dataCentreDailyHours`; on
   29 Oct that is 67 of 115 active technicians), which is their day and not overtime; else the standard day
   (8 h). The **shift window** from `settings` (`day_shift_start/end`, `night_shift_start/end`) is kept for
   check-in times only. A window whose end is not after its start crosses midnight and belongs to the day it
   starts on.
4. **Minus leave**: the union of `t`'s active leave intervals clipped to the window (part-day leave works,
   since `leave_records` holds timestamps). All four categories count (DEV-456).
5. **Minus unpaid break**, a setting (default 0 until **D-22** is answered).

Available hours = Σ over days of the window length minus leave and break, floored at zero.

**Shift length (D-22).** The BRD's example uses 8 h a day; the portal's day shift is 08:00–17:00, which is
**9 h**. Either a one-hour unpaid break is configured, or the example is wrong. Confirm before the
utilization report is trusted.

**Example (BRD B2)**: 26 shift days × 8 h = 208 h; 2 days leave = 16 h; **192 available** (TC08 reduces
available hours by 16).

## Utilization (DEV-444)

- **Actual job hours** for `t`: the union of `[actual_start, actual_end)` of `t`'s appointments, so two
  overlapping appointments are not counted twice. Included statuses: Completed, and Cannot Complete when
  both actuals are present. A job shared by two technicians counts in full for each, for time. An
  appointment belongs to the period by its actual start, or its scheduled start when it has none.
  Built in P6: `lib/reports/utilization.ts`.
- **Expected hours (2 Nov, replaces the clipping below)**: each technician's own limits, set in Scheduling →
  Technicians: hours a day (8, 9 or 12 by contract; 12 for Data Center), a weekly hour limit (e.g. 48 or 60)
  and off days a week (a number, not fixed weekdays; 1 when none is entered). The week is the measure: a week
  expects min(weekly limit, hours a day × (7 − off days)), less a working day's share for each public
  holiday and the leave taken. A week cut by the period's dates expects a working day's share for each of
  its days less the off days, or for each day worked if more, never more than the full week; so one day
  worked expects one day's share, and a month adds up as its weeks do. The daily trend expects a day's share
  only on days worked. **Every hour worked counts** (any time of day, off days and holidays included), so
  utilization can pass 100 %. Each week's hours beyond what it expected are shown beside as "Above expected"
  (already inside both percentages). `expectedHours` in `lib/reports/utilization.ts`.
- ~~**Overtime (D-16)**: until decided, job time is clipped to the shift window for utilization, and job time
  outside the window is reported beside it as "outside shift". Job time on a day with nothing available
  (holiday, rest day, full-day leave, after leaving) is outside shift too, so such a day adds nothing to
  either side of the ratio. Utilization can pass 100 % only by the unpaid break, which is a length, not a
  time of day.~~ Superseded 2 Nov.
- **Chargeable job hours**: job hours on appointments whose work order's quotation totals more than zero
  before VAT; with no quotation, whose work order itself has a value (**D-08**). A zero-total quotation
  counts for time only (TC09). Work with no value anywhere is time only too, and reported apart as
  "no value in FSM".
- **AMC and in-contract work is not chargeable** (decided 29 Oct; the BRD's B2 said it was), whatever its
  value: reported apart as "AMC / contract", time only. FSM marks it on the work order (**D-14**):
  `Work_Type__C` "AMC PPM", or an `AMC_Contract_Ref__C`. On 29 Oct, 4 of October's 328 counted
  appointments are marked; `Type = "Scheduled Maintenance"` alone is not taken as AMC.
- **Time utilization** = actual ÷ expected. **Commercial utilization** = chargeable ÷ expected. Always
  shown together.
- **Travel** (blocked, B-01): Σ trip durations, shown as hours and as a share of available hours. Never
  added to job hours.
- **Scheduled vs actual variance** per appointment: actual duration − scheduled duration.
- **Data completeness** = Completed appointments with both actuals ÷ Completed appointments, the same
  figure as the exception report (DEV-453), so the two screens agree. Cannot Complete is left out: 323 of
  536 have no actual times, mostly because the work never started, which is not a data gap. Measured on
  production, 21 Oct: **2,672 of 2,672**.

**Example (BRD B2)**: 150 actual ÷ 192 available = 78.125 % → **78 %**; 132 chargeable ÷ 192 = 68.75 % →
**69 %**; 28 travel hours = 14.6 % of available hours, shown separately.

## Capacity (DEV-452)

For each day in the horizon (default 14 days): **booked** = union of the scheduled intervals of a
technician's appointments that are not cancelled, by calendar day, summed over technicians; **available**
= the engine above, each working day **in full** (hours a day less leave; decided 29 Oct: never the 6/7 that
Utilization takes while no rest day is entered, so a 12 h Data Center day booked 12 h is full, not over); **over-booked** when booked > available (a booking on a rest day, holiday or leave is
over-booking); **spare** when booked < available × spare share (`capacity.spareBelowPercent`, suggested
50 %; the BRD gives no figure). **Unassigned** = scheduled hours on appointments with no technician, summed
(separate jobs), shown apart and in no team. Team = team leader (D-20). N14 fires once per team and day when
the day first becomes over-booked, to `capacity.alertRecipientUserIds`, and closes when it no longer is.
Built in P6: `lib/reports/capacity.ts`.

The portal's night shift (00:00–09:00) lies within one day; a shift crossing midnight would split its
bookings across two dates. Bookings come from FSM appointments only: entries in the portal's own schedule
that have not reached FSM are not counted.

## Attendance (DEV-451) — `lib/reports/attendance.ts`; check-ins from FSM Attendance (29 Oct)

Check-ins are **FSM Attendance records as they are**: one per technician per day, its first check-in and
last check-out kept together (`sessionStart`), so a night's 06:00 check-out belongs to the evening it started.
A record is filed under the shift day its check-in is nearest (within 4 h of the shift), else its own date.
The same pairing is used by Compliance (shift check-outs) and Utilization (crew hours trimmed to the
technician's own check-in and check-out).

Per technician per day:

- **Expected hours**: the technician's shift (Scheduling), widened to that day's scheduled jobs, as the
  Scheduling board does (`lib/scheduling/board-layout.ts`, 2 Oct).
- **Late**: check-in after the **shift start** + tolerance (default 15 min). **Left early**: check-out before
  the **shift end**. Not measured from a job's booked start: crews booked 05:00–07:00 start work a median
  87 min after the booking (30 Sep – 29 Oct), so a booking is a planning block.
- **Outside shift**: checked in, but at no time within the expected hours (e.g. a night worker set up on the
  morning shift). Neither late nor early.
- **Absent**: a working day, not wholly on leave, with no check-in and no work of their own in FSM, once the
  expected hours are over (today is not judged early).
- **Worked, no check-in**: no check-in, but FSM shows them doing the work: the appointment's lead, or their own
  time sheet. A planned crew place alone is not proof.
- **No check-out**: a past day's record still open.
- **Rest day not set**: every day is a working day; such absences are counted apart on the page.
- Hours present: check-out − check-in of the record.

## Compliance (DEV-447) — calculation built (`lib/reports/compliance.ts`); data blocked by B-01; decisions D-09, D-11

Assumptions in the built calculation, to confirm with D-11 and D-15:

- A day wholly on leave needs nothing; **part-day leave keeps the day's events required**.
- A cancelled appointment counts as cancelled before start (the FSM copy has no cancellation time).
  "Reassigned before start" is the current crew: someone taken off an appointment no longer owes it.
- A shift check-in or check-out belongs to the shift whose window (± 4 h) holds it, so a night shift's
  check-out after midnight counts for the evening it started. The first check-in and last check-out count.
- Disputes for a month stay open until the cut-off day of the **following** month, that day included
  (25 November for October); from the next day the month is final.

**Required events** per eligible day: shift check-in + shift check-out, plus appointment check-in +
check-out for each appointment assigned to the technician and not cancelled or reassigned before its start.
A shift with three appointments requires eight. **Not eligible**: off-shift days, leave, public holidays,
rest days, days from the leaving date, and waived events (removed from both required and performed).
**Performed**: an event recorded at all; a late check-in counts as performed.

**Compliance %** = performed ÷ required. **Penalty**: if compliance (unrounded) < threshold, then misses ×
rate, capped at the monthly cap; otherwise zero. Misses = required − performed.

| Case | Required | Missed | Compliance | Penalty at 97 % | Penalty at 90 % |
|---|---|---|---|---|---|
| TC11 | 200 | 7 | 96.5 % | **AED 350** | AED 0 |
| TC12 | 200 | 14 | 93.0 % | 700 → **AED 500** (cap) | **AED 0** |
| TC13 (TC11, 1 miss waived) | 199 | 6 | **96.98 %** | **AED 300** | AED 0 |

Two consequences for the BRD's tests:

- **TC12's expected penalty assumes the 97 % threshold.** At 90 %, the same technician is compliant. Its
  expected result depends on **D-09**.
- **TC13 displays as "97.0 %" while being below 97 %.** The comparison must use the unrounded value, and
  the screen must say "below threshold" in words rather than leave a rounded number to imply otherwise.

**Waivers** never delete the miss; they add a waiver row that removes it from both counts. A finalised
month is read from `hr_compliance_statements` (figures plus the settings snapshot used) and never
recalculated.

### Disputes and the compliance messages (DEV-449, 450), 29 Oct — `lib/reports/compliance-disputes.ts`

- **Raise**: one missed check-in, with the reason, up to the cut-off day of the next month, that day
  included (TC14: the 26th is refused); during the month too. Not on a performed, waived, already disputed
  or finalised event. The technician raises their own (found from the signed-in account,
  `technician_reference.user_profile_id`); a supervisor or coordinator (Compliance Edit) raises it for them.
  One dispute per event.
- **Decide**: only the reviewers named in Settings → Reporting → Dispute reviewers (D-10). Accepted: the miss
  is waived with one of the six waiver reasons, in the same transaction (`hr.decide_dispute`). Rejected: the
  reason is required. Decided once. Allowed until the month is finalised.
- **Finalise**: after the cut-off and only when no dispute is undecided (checked in the portal and in
  `hr.finalize_month`). Sends E3.
- **N9** (technician, in-app): each miss on a settled day (before today, due time 4 h past), the last 3 days
  only, so a first run sends no backlog. "You missed the {event} on {date}. Compliance this month: {c}%",
  {c} over settled days.
- **N10** (technician, their team leader, the named supervisors): once a month, when settled compliance is
  below the threshold.
- **N11** (in-app) and **E2** (email to the address FSM holds) at month close, while disputes are open; N11
  is resolved when they close. E2: the figures, each miss with date and event, the penalty only below the
  threshold, how to dispute and the deadline.
- **E3** (HR and managers, email and in-app): from the frozen statements, one row per technician, team
  totals, the whole; when the month is finalised, and by the daily run if that failed.
- Runner: `POST /api/reports/alerts/compliance` (CRON_SECRET), once a day; all deduplicated.
- In-app messages need the technician's portal account. On 29 Oct **no technician has one** (0 of 115),
  so N9–N11 reach nobody until accounts are linked; E2 and E3 do not depend on it.

## Quotation pipeline (DEV-442)

Per status: count, Σ total, average age. **Days in status** = today − the time the estimate entered its
current status (from `fsm.estimate_status_events`; for records imported before the sync existed, the
matching FSM lifecycle timestamp, otherwise creation). **Ageing breach** when days in status > that
status's limit (defaults Not Sent 7, Sent 10, Approved 5). **Expiry warning** when `expiry_date` − today ≤
warning days (default 5). Status mapping pending **D-13**.

## Exceptions (DEV-453)

1. Work orders whose work is complete (per **D-01**) but whose estimate is not flagged (per **D-02**) after
   N days (default 3): days elapsed, value, coordinator, whether excluded. N13 to the coordinator.
2. Completed appointments missing an actual start or end, with completeness % per technician and team.

## Check-in alerts N5, N6 (BRD B3) — `lib/reports/checkin-alerts.ts`, runner `POST /api/reports/alerts/check-ins` (29 Oct)

Run every five minutes by the external scheduler (CRON_SECRET); FSM is read fresh each run (today only).
In-app, to **Check-in alert recipients** (Reporting Settings → Check-in alerts); nobody until set.

- **N5**: shift start (Scheduling) + delay (15 min) passed, no FSM Attendance check-in (one from up to 4 h before
  the start counts). Lists the technician's appointments today. Not raised on leave (any length that day), rest
  day, public holiday or after the leaving date; a technician with no rest day set only when booked today.
- **N6**: scheduled start + delay (15 min) passed, the appointment not started in FSM (no actual start; status not
  In Progress, Completed, Cannot Complete or Cancelled). One alert per appointment naming the lead and crew size;
  only crew members at work today count. Location from the Scheduling module's entry for the appointment.
- One alert per miss (dedupe key: technician + day, or appointment + scheduled start). Resolved when the check-in
  is recorded, the appointment starts, is cancelled, moved or reassigned, or the day ends; rows stay in
  `portal_notifications`, so repeat patterns are reportable.

## Common to every report (BRD B5), 29 Oct

- **Client filter** on Utilization, Capacity, Attendance and Compliance (Quotations and Exceptions had it).
  Utilization: job and chargeable hours of that client's appointments only; available hours stay whole days.
  Capacity: that client's bookings against everyone's availability. Attendance and Compliance: the technicians
  booked on that client's appointments in the dates.
- **Travel** (B2): per technician and team, hours and share of the day = travel ÷ available hours.
- **Capacity** opens on the capacity horizon setting (§6.6: 14 days), the same days N14 watches.
- **Zoho FSM reports** (Reports menu): links to the FSM standard and custom reports, set in Reporting Settings →
  FSM report links; Revenue needs the Revenue permission.
- **How this report works**: an ⓘ beside each report's controls opens its calculation in plain words
  (`components/dashboard/reports/how-it-works.tsx`); it quotes the live settings.
