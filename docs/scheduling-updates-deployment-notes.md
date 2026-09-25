# Scheduling updates — deployment notes

Branch: `scheduling-updates` (cut from `main` on 16 Sep 2026) · Prepared 18 Sep 2026 by Sami

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
| Service lines | A cancelled or cannot‑complete appointment no longer counts as covering its lines, in the dialog **and** in `scheduledLineIdsOf` on publish. The publish guard now checks `Status`, not only `Cancellation_Reason` | `zoho/appointments.ts`, `zoho/work-orders.ts` |
| Entries API | `PUT` accepts `serviceLineItemIds` for an appointment not yet created in FSM. `DELETE` lets an approver remove a sync‑failed entry from an approved day and recomputes the version status | `schedule/entries/route.ts` |
| Timezone | Every wall‑clock ⇄ instant conversion now uses `settings.org_timezone` instead of the machine's clock, in the browser and on the server. The server's "today" was UTC, which would refuse to open today's draft before 04:00 Gulf time on a UTC host | `lib/scheduling/org-time.ts` |

## 4. Things to know

- The first open of a day reads that day's appointments from FSM (`/Service_Appointments/search`, `between` on `Scheduled_Start_Date_Time`), so it can take a few seconds. `schedule/route.ts` sets `maxDuration = 60`.
- Cancelled appointments, and appointments whose technician is not in `technician_reference`, are not imported.
- Removing an imported appointment from a draft does not stick: Refresh brings it back while FSM still has it booked.
- FSM statuses are re-read on first open and on Refresh, not on every page load.

## 5. Quick check after deploying

1. Open today on the daily board: FSM appointments appear, coloured by status, with a legend.
2. Open an entry: Work Order and Appointment are links that open FSM.
3. Compare three appointment times with FSM: they match to the minute, whatever the viewer's timezone.
4. Drag a bar to another technician, approve the day, confirm the change in FSM.
