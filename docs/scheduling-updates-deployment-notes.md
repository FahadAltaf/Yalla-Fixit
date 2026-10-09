# Scheduling updates — deployment notes

Branch: `scheduling-updates` (cut from `main` on 16 Sep 2026) · Prepared 18 Sep 2026 by Sami · last updated 9 Oct 2026

Implements the 11 Sep scheduling FRD (FR‑1 to FR‑6) plus fixes found while testing against production. No new dependencies; `bun.lock` is deliberately not part of this branch.

## 1. Required environment variable

```
NEXT_PUBLIC_FSM_APP_URL="https://fsm.zoho.com/fsm/<orgId>#/tab/{module}/{id}"
```

- `<orgId>` is the organisation id in the Zoho FSM web app URL. The exact production value is in the shared (Word) copy of these notes and in Sami's `.env.local`; like other environment values it is kept out of git.
- It turns the Work Order / Appointment names in the entry dialog into links to the record in Zoho FSM. Without it they render as plain text.
- **Keep the double quotes.** Unquoted, the `#` is read as a comment and the value is cut short.
- It is a `NEXT_PUBLIC_` value, so it is baked in at build time: set it in the hosting environment, then rebuild.
- It was missing from the shared `.env`, which is why the links had disappeared.

## 2. Database

**Already applied to production** (by Sami, 17–18 Sep, via the SQL Editor). The migration files are intentionally **not** in this branch. Everything is additive and writes no data. For any other environment (local, staging), run this once; it is safe to re-run:

```sql
-- Already in main as 20260828090000_add_fsm_status_to_schedule_entries.sql,
-- but it had never been applied to production.
ALTER TABLE public.schedule_entries
  ADD COLUMN IF NOT EXISTS fsm_status TEXT,
  ADD COLUMN IF NOT EXISTS fsm_status_checked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_schedule_entries_operating_date_status
  ON public.schedule_entries (operating_date, fsm_status);

-- FR-2: highlight colour per role
ALTER TABLE public.lookup_options ADD COLUMN IF NOT EXISTS color TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lookup_options_color_hex') THEN
    ALTER TABLE public.lookup_options
      ADD CONSTRAINT lookup_options_color_hex
      CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

-- Team-arranged technician row order
ALTER TABLE public.technician_reference ADD COLUMN IF NOT EXISTS board_position INTEGER;
CREATE OR REPLACE FUNCTION public.set_technician_board_order(p_fsm_resource_ids TEXT[])
RETURNS INTEGER LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  WITH ordered AS (
    SELECT o.id, o.ord::INTEGER AS pos
    FROM unnest(p_fsm_resource_ids) WITH ORDINALITY AS o(id, ord)
  ),
  updated AS (
    UPDATE public.technician_reference t SET board_position = ordered.pos
    FROM ordered WHERE t.fsm_resource_id = ordered.id RETURNING 1
  )
  SELECT COUNT(*)::INTEGER FROM updated;
$$;
REVOKE ALL ON FUNCTION public.set_technician_board_order(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_technician_board_order(TEXT[]) TO service_role;

-- FR-4: when a day last pulled its appointments from FSM
ALTER TABLE public.schedule_versions ADD COLUMN IF NOT EXISTS fsm_imported_at TIMESTAMPTZ;
```

**Still to apply to production before deploying this build** (additive, no data; safe to re-run). Without the first, a dragged row order is not kept and the board says so. Without the second, **approving a day fails** (the approval reads the new columns) and copying an appointment to other days fails:

```sql
-- 20261008120000_schedule_board_orders.sql: per-day technician row order (FR-13)
CREATE TABLE IF NOT EXISTS public.schedule_board_orders (
  schedule_date DATE PRIMARY KEY,
  technician_order TEXT[] NOT NULL,
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.schedule_board_orders ENABLE ROW LEVEL SECURITY;

-- 20261009120000_schedule_entry_work_order_copy.sql: copy an appointment to
-- later days = a new work order in FSM on approval (FR-15)
ALTER TABLE public.schedule_entries
  ADD COLUMN IF NOT EXISTS fsm_create_work_order BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fsm_copy_source_work_order_id TEXT,
  ADD COLUMN IF NOT EXISTS fsm_copy_source_work_order_name TEXT,
  ADD COLUMN IF NOT EXISTS fsm_copy_source_appointment_id TEXT,
  ADD COLUMN IF NOT EXISTS fsm_copy_source_appointment_name TEXT,
  ADD COLUMN IF NOT EXISTS fsm_created_work_order_id TEXT,
  ADD COLUMN IF NOT EXISTS fsm_created_work_order_name TEXT,
  ADD COLUMN IF NOT EXISTS fsm_copy_price NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS fsm_copy_currency TEXT,
  ADD COLUMN IF NOT EXISTS fsm_copy_source_line_ids JSONB,
  ADD COLUMN IF NOT EXISTS fsm_work_order_create_started_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedule_entries_create_work_order_is_new_appointment'
  ) THEN
    ALTER TABLE public.schedule_entries
      ADD CONSTRAINT schedule_entries_create_work_order_is_new_appointment
      CHECK (NOT fsm_create_work_order OR entry_type = 'new_appointment');
  END IF;
END $$;
```

Worth a look: production's schema was behind `main`'s migrations folder (the `fsm_status` migration above). Reconcile's status write and the Display board both depend on it. `select version, name from supabase_migrations.schema_migrations order by version desc;` will show whether any others are missing.

No role or colour data is seeded. Roles already exist in production; colours are set in the UI (Technicians & Leave → Manage lists → Roles).

## 3. What changed

| Area | Change | Main files |
|---|---|---|
| Board layout | Night and Morning shifts stacked again (tabs removed) | `daily-schedule/index.tsx` |
| FR‑1 | Change a technician's role from the board | `daily-schedule/index.tsx` |
| FR‑2 | Highlight colour per role; preset + custom picker with OK | `scheduling/index.tsx`, `attribute-list-route.ts` |
| FR‑3 | Bars coloured by status on the daily board too. **The mapping now mirrors FSM's own statuses** (New, Scheduled, Dispatched, In Progress, Completed, Cannot Complete, Cancelled); the clock‑derived "Delayed" is gone. Product decision, 18 Sep; it also changes the Display board | `lib/scheduling/appointment-status.ts` |
| FR‑4 | Appointments booked directly in FSM are imported onto the day as normal, editable entries (`origin = 'fsm'`, `needs_sync = false`, so approval skips them unless edited). Runs on first open of a draft day and on Refresh | `lib/server/zoho/import-appointments.ts`, `schedule/route.ts`, `reconcile/route.ts` |
| FR‑5 | Drag rewritten: move time, reassign technician, resize from the right edge; optimistic save with Undo; rows memoised so a drag no longer re-renders the board | `daily-schedule/index.tsx` |
| Row order | Technician rows can be dragged into a shared "Custom" order | `technicians/order/route.ts`, `technician-order.ts` |
| FR‑6 | Sort by Site (appointment address) | `technician-order.ts` |
| Supervisor | The technician link (`technician_reference.team_leader_fsm_id`) is the technician's **supervisor**, not their driver (product decision, 25 Sep). Dropdowns list technicians whose role is Supervisor; the board's default grouping is by supervisor. No schema change — the column is unchanged | `scheduling/index.tsx`, `technician-order.ts` |
| Crews (fix, 28 Sep) | Imported appointments carried only their **lead** technician: FSM's search result has no crew (`Service_Resources` is empty, `$Service_Resources` absent), only `Lead`. The import now reads each new appointment's full record, and reconcile adopts FSM's crew for entries the portal has not edited | `zoho/import-appointments.ts`, `zoho/reconcile.ts` |
| Staying in step (fix, 28 Sep) | A day is re-read from FSM whenever it is loaded and its last pull is over 5 minutes old (claimed atomically on `schedule_versions.fsm_imported_at`, so concurrent loads and the Display poll run it once). Replaces "pull once, then on Refresh", which left days opened early empty and statuses stale | `schedule/route.ts` |
| Pending edits | Reconcile no longer adopts FSM's window or crew over an entry with `needs_sync = true`; only its status. A Refresh used to revert un-approved edits | `zoho/reconcile.ts` |
| Lead on reschedule | The reschedule call sent `Lead = serviceResourceIds[0]`, and assignments have no guaranteed order. It now keeps FSM's current lead when that technician is still on the job | `zoho/appointments.ts` |
| Collapsible shifts | Night and Morning sections fold to their header; remembered per shift in localStorage | `daily-schedule/index.tsx` |
| PDF export | Redrawn to mirror the board (rows tinted by role, hour columns, status-coloured bars, lanes, legend) instead of a table | `lib/scheduling/export-pdf.ts` |
| Board placement (fix, 29 Sep) | A job was filed under one shift by its start time, drawn only in that grid, and a technician had a row only in the grid of their own shift. A 05:00 to 17:00 job (AP‑3869) was filed under Night, where none of its morning-shift crew had a row: in the database, invisible on screen. It hid 336 of 852 live appointments in Aug to Sep. Now (rules revised 2 Oct after team feedback): a technician's row is in the grid of **their own shift** (`technician_reference.shift`; unset = both grids, each drawing the jobs whose times belong to it); a row draws every job of that technician that day; each grid's hours stretch in whole hours to fit the jobs on its rows; only midnight clips a bar. `schedule_entries.shift` is now a label, not a visibility rule. One module, shared by the board, the PDF and the Display | `lib/scheduling/board-layout.ts` (new), `daily-schedule/index.tsx`, `display/index.tsx`, `export-pdf.ts` |
| Site order (FR-12, 8 Oct) | The board opens grouped by site (address of the first appointment that day; a technician with none takes their supervisor's site), supervisor first within a site, no-site technicians last under their supervisor | `daily-schedule/technician-order.ts` |
| Per-day row order (FR-13, 8 Oct) | Dragging rows now saves the order for **that day only**, in the new table `schedule_board_orders` (migration `20261008120000_schedule_board_orders.sql`, additive, run by hand). Rows can be ticked (click, Ctrl-click, Shift-click range) and dragged as a block. `PUT /api/scheduling/technicians/order` takes an optional `date`; `GET /api/scheduling/schedule` returns `boardOrder`. `technician_reference.board_position` is no longer read | `technicians/order/route.ts`, `schedule/route.ts`, `daily-schedule/index.tsx` |
| Ctrl-drag (FR-14, 8 Oct) | Holding Ctrl while dragging a bar copies: a note is copied to where it lands (a new free_text entry); an appointment gains the technician it lands on, time unchanged. A note's text and notes are editable in its dialog on a draft day (`PUT` entries already accepted them) | `daily-schedule/index.tsx`, `entry-detail-dialog.tsx` |
| Copy a note to other days (FR-15 notes, 8 Oct) | New `POST /api/scheduling/schedule/entries/copy` `{entryId, dates[], confirmDuplicates?}` (CREATE permission): per date it skips past days, the same day, days beyond 14 ahead and non-draft days; opens a never-opened day as a draft; leaves off technicians on leave; asks before a second copy on the same day; writes `entry_added` with `copied_from`. Shared helpers in `lib/server/schedule-entries.ts` | `entries/copy/route.ts`, `entry-detail-dialog.tsx` |
| Copy an appointment to other days (FR-15 appointments, 9 Oct) | The team copies appointments by duplicating the work order in FSM, so the portal does the same. The same copy call takes `quoteOnly` (answers with the lines, parts and price read from FSM; nothing is copied), then `priceConfirmed: true` with `mode: "new_work_order"` (default) or `"same_work_order"` (one day, only when FSM reads the source lines as free). Each copied day gets a **pending new appointment** that points at the source work order and lines, with `fsm_create_work_order = true` and the confirmed price. **On approval** `syncEntryToFsm` first creates the new work order (`POST /Work_Orders`, sent once, no retry: a timed-out create could already exist), saves its id and name and the new line ids on the entry, then creates the appointment on it. A retry after an appointment failure reuses the saved work order. The portal never dispatches. What FSM needs that its docs do not say (found by the authorised test on WO2361, WO1928, WO758, all records cancelled afterwards): each line and part must carry its `Tax` map, and `Phone` is mandatory on the work order; `List_Price` is accepted, so the copy repeats the source price. Needs migration `20261009120000_schedule_entry_work_order_copy.sql` (additive, run by hand) **before** this build is deployed, because approval selects the new columns | `lib/server/zoho/work-order-copy.ts` (new), `lib/server/schedule-sync.ts`, `entries/copy/route.ts`, `entry-detail-dialog.tsx` |
| Shift hours on the board (2 Oct) | The team sets each grid's usual hours from the board (the hours at the right of each shift heading). New `PUT /api/scheduling/config` writes `settings.night_shift_start/end` and `day_shift_start/end`, for users with SCHEDULING/EDIT, with an audit event `shift_hours_changed`. No schema change | `app/api/scheduling/config/route.ts`, `daily-schedule/index.tsx` |
| Import window (fix, 29 Sep) | **FSM reads the timestamps of a date search in its own timezone (US Pacific), not as instants.** Measured: asking for 00:00 to 23:59 Gulf on the 29th returned 13:00 on the 28th to 12:59 on the 29th. `Z` and `+04:00` spellings behave the same. Every appointment starting at 13:00 or later was imported onto the next day and missing from its own. The import now searches the day ±36 h and keeps what starts on the day by each record's own `Scheduled_Start_Date_Time`. The offset moves with US daylight saving, so it is not hardcoded | `zoho/import-appointments.ts` |
| Entries on the wrong day | On each import of an editable day, entries with `origin = 'fsm'` and `needs_sync = false` whose time does not touch the day are **deleted** from that day's version (audit event `fsm_entries_moved_to_their_own_day`, with the rows in `before_value`). This repairs what the old window misfiled, and follows an appointment FSM moves to another date. Portal-created entries and entries with a pending edit are never removed; the board lists them instead | `zoho/import-appointments.ts` |
| Jobs over midnight | The day route also returns `carriedOver`: entries of current versions from the previous 7 days whose `end_at` is after this day's start, marked `carried_over`. They are drawn, not edited, on the later day. The entry dialog now keeps a job's own dates when saving; it used to rebuild both times on `operating_date` | `schedule/route.ts`, `entry-detail-dialog.tsx` |
| Appointments with no row | An appointment with no technician, or none in `technician_reference`, used to be skipped silently. The import returns them as `unplaced` and keeps the latest list as an audit event (`fsm_appointments_not_placed`, written only when it changes); the day route returns it on every load and the board lists them with links | `zoho/import-appointments.ts`, `schedule/route.ts` |
| Service lines | A cancelled or cannot‑complete appointment no longer counts as covering its lines, in the dialog **and** in `scheduledLineIdsOf` on publish. The publish guard now checks `Status`, not only `Cancellation_Reason` | `zoho/appointments.ts`, `zoho/work-orders.ts` |
| Entries API | `PUT` accepts `serviceLineItemIds` for an appointment not yet created in FSM. `DELETE` lets an approver remove a sync‑failed entry from an approved day and recomputes the version status | `schedule/entries/route.ts` |
| Timezone | Every wall‑clock ⇄ instant conversion now uses `settings.org_timezone` instead of the machine's clock, in the browser and on the server. The server's "today" was UTC, which would refuse to open today's draft before 04:00 Gulf time on a UTC host | `lib/scheduling/org-time.ts` |

## 4. Things to know

- The first open of a day reads that day's appointments from FSM (`/Service_Appointments/search`, `between` on `Scheduled_Start_Date_Time`), so it can take a few seconds. `schedule/route.ts` sets `maxDuration = 60`.
- Cancelled appointments, and appointments whose technician is not in `technician_reference`, are not imported.
- Removing an imported appointment from a draft does not stick: the next re-read brings it back while FSM still has it booked.
- FSM is re-read for a day at most every 5 minutes, when the day is loaded (the daily board reloads quietly every 5 minutes; the Display screen already polls). Each round is one search call plus one read per appointment on that day.
- **Two migrations this round**, both in section 2: `schedule_board_orders` (new table) and the `fsm_create_work_order` columns on `schedule_entries`. Run the second **before** deploying: approval selects those columns. Everything else needs no schema change.
- Copying an appointment to other days creates real work orders and appointments in FSM on approval, one work order per copied day, with the price repeated. The person sees the amount and confirms every time. The team should expect the new work orders in FSM's list (same contact, company, address, lines and price; Due Date = the copied day; status New, then Scheduled Appointment once approved). Nothing is dispatched by the portal.
- The day route makes three more small queries per load (org timezone, carried-over entries, latest unplaced list).
- The import now **deletes** rows, within the limits in the table above. It is the only place that does so without a user action.
- **All 104 technicians have `shift = 'morning'`.** Under the rules above the Night grid therefore has no rows, and the Morning grid widens to midnight on days with night jobs (28 of the 61 days checked). The team has to set the night technicians' shift in Technicians & Leave; FSM data points to three (over half their jobs start before 05:00). The team also asked for Morning 06:00 to 19:00 and Night 00:00 to 08:00, which they can now set from the board.
- `scripts/fsm-schedule-audit.cjs` is the read-only check used for this: FSM appointments for a date range against the portal and the board's rules. Run with bun; about 900 FSM calls for two months.
- New appointments are only added while the day is a draft or draft revision. On an approved day, statuses, times and crews still refresh, but new FSM bookings wait for a revision.

## 5. Quick check after deploying

1. Open today on the daily board: FSM appointments appear, coloured by status, with a legend. Appointments from 13:00 onward are there, and none from yesterday.
1. Open 28 Sep: AP‑3869 runs 05:00 to 17:00 on each of its 31 technicians, in the Morning grid.
1. Click the hours at the right of a shift heading: they can be changed and are saved for everyone.
2. Open an entry: Work Order and Appointment are links that open FSM.
3. Compare three appointment times with FSM: they match to the minute, whatever the viewer's timezone.
4. Drag a bar to another technician, approve the day, confirm the change in FSM.
5. Open an appointment on a test work order, copy it to tomorrow: the price box shows the lines and the amount; after confirming, tomorrow holds "Copy of WOxxxx · Pending appointment"; approve tomorrow and find the new work order and its Scheduled appointment in FSM (then cancel them in FSM).
