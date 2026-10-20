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
3. Otherwise the **shift window** from `settings` for `t`'s shift (`day_shift_start/end`,
   `night_shift_start/end`). A window whose end is not after its start crosses midnight and belongs to the
   day it starts on.
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
  both actuals are present. A job shared by two technicians counts in full for each, for time.
- **Overtime (D-16)**: until decided, job time is clipped to the shift window for utilization, and job time
  outside the window is reported beside it as "outside shift". That keeps utilization at or below 100 %
  and hides nothing.
- **Chargeable job hours**: job hours on appointments whose estimate total is greater than zero, or that
  are identified AMC work (**D-08**, **D-14**). A zero-total estimate counts for time only (TC09).
- **Time utilization** = actual ÷ available. **Commercial utilization** = chargeable ÷ available. Always
  shown together.
- **Travel** (blocked, B-01): Σ trip durations, shown as hours and as a share of available hours. Never
  added to job hours.
- **Scheduled vs actual variance** per appointment: actual duration − scheduled duration.
- **Data completeness** = appointments with both actuals ÷ appointments expected to have them (Completed +
  Cannot Complete). Measured on production, 20 Oct: Completed appointments carry both actuals on **402 of
  402**.

**Example (BRD B2)**: 150 actual ÷ 192 available = 78.125 % → **78 %**; 132 chargeable ÷ 192 = 68.75 % →
**69 %**; 28 travel hours = 14.6 % of available hours, shown separately.

## Capacity (DEV-452)

For each day in the horizon (default 14 days): **booked** = union of scheduled intervals per technician,
summed; **available** = the engine above; **over-booked** when booked > available; **spare** when booked <
available × (1 − spare threshold). **Unassigned** = scheduled hours on appointments with no resource,
shown separately. N14 fires once when a day first moves into over-booking.

## Attendance (DEV-451) — blocked, B-01

Per technician per day: scheduled shift and hours; shift check-in and check-out times; hours present;
**late** when check-in is after shift start + late tolerance (default 15 min); **early** when check-out is
before shift end; **absent** when no check-in and no leave; leave category; rest-day or holiday marker.

## Compliance (DEV-447) — blocked by B-01; decisions D-09, D-11

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

## Quotation pipeline (DEV-442)

Per status: count, Σ total, average age. **Days in status** = today − the time the estimate entered its
current status (from `fsm_estimate_status_events`; for records imported before the sync existed, the
matching FSM lifecycle timestamp, otherwise creation). **Ageing breach** when days in status > that
status's limit (defaults Not Sent 7, Sent 10, Approved 5). **Expiry warning** when `expiry_date` − today ≤
warning days (default 5). Status mapping pending **D-13**.

## Exceptions (DEV-453)

1. Work orders whose work is complete (per **D-01**) but whose estimate is not flagged (per **D-02**) after
   N days (default 3): days elapsed, value, coordinator, whether excluded. N13 to the coordinator.
2. Completed appointments missing an actual start or end, with completeness % per technician and team.
