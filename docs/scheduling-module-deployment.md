# Scheduling & Attendance Module — Deployment Notes

**Branch:** `scheduling-and-attendance-module`
**Prepared:** 11 Aug 2026
**Repo:** the `Portal` app (this git repository) → `FahadAltaf/Yalla-Fixit`

This branch adds the **Scheduling module**: a daily board that plans each technician's
work across the **Night** (12 AM–9 AM) and **Morning** (8 AM–5 PM) shifts and syncs
approved appointments to **Zoho FSM**. Nothing is written to FSM until a day is
submitted and approved. It was built and tested against the **YFI Staging** Supabase
project (`ulqitebapobdtsqvbucd`).

> Verified before commit: `tsc --noEmit`, `eslint`, and `next build` all pass. No
> secrets are committed (`.env.local` is gitignored; repo scanned for keys/JWTs).

---

## 1. What was created / changed in the codebase

### New (scheduling module)
- **App routes** — `app/(dashboard)/scheduling/`, `app/api/scheduling/**` (schedule,
  entries, submit/approve/reject/reopen/revise, retry, publish-edit, reconcile,
  history, audit, approvers, config, me, technicians, work-order search/lines),
  `app/api/service-resources/`, `app/api/appointments/`.
- **UI** — `components/dashboard/scheduling/**` (daily board, add-entry dialog,
  entry-detail dialog, submit/reject/history dialogs, technicians & leave tab).
- **Lib** — `lib/scheduling/export-pdf.ts` (generated PDF sheet),
  `lib/server/{publish-schedule,schedule-sync,schedule-approvers,attribute-list-route}.ts`.
- **Module** — `modules/scheduling/**` (services + types).
- **Scripts** — `scripts/dev.mjs` (casing-proof dev launcher, see §5),
  `scripts/deploy-scheduling-staging.ps1` (staging deploy helper, see §3).

### Modified (supporting changes)
- **Users module** — approver-email opt-in flag (`edit-user.tsx`,
  `modules/users/services/*`): only flagged users receive the approval email and
  appear in the submit dialog.
- **Permissions** — `components/dashboard/permissions/constants.ts`: `SCHEDULING`
  resource + `APPROVE` action.
- **Nav** — `components/dashboard-layout/menu-items.tsx`: Scheduling entry.
- **Types** — `types/types.ts`: `TechnicianReference`, `LeaveRecord`, tags/roles, etc.
- **`lib/rest-server.ts`** — API errors now render the specific field/message
  (Zod validation no longer surfaces as `[object Object]`).
- **`next.config.ts`** — `turbopack.root` + a `tailwindcss` resolveAlias, and the
  dev script routes through `scripts/dev.mjs` (see §5).
- **`package.json`** — `dev` runs the launcher; deps added (`jspdf`, `@dnd-kit/*`).
- **`.env.local.example`** — documents `NEXT_PUBLIC_FSM_APP_URL` (see §5).
- **`.gitignore`** — ignore non-bun lockfiles + editor/OS local files.

### Removed
- **`package-lock.json`** — bun is the standard; `bun.lock` is the single lockfile.

---

## 2. Zoho FSM

The module talks to Zoho FSM through Edge Functions (below). FSM requires a valid
**OAuth access token**, stored in the Supabase `settings` table
(`settings.oauth_access_token`). The reconcile/create/update functions read it from
there. Make sure production's `settings` row has a valid Zoho FSM token.

Optional client env var for FSM deep links in the entry-detail dialog:
`NEXT_PUBLIC_FSM_APP_URL` (see §5).

---

## 3. What was created on Supabase (staging) — and must be applied to production

### Migrations — `supabase/migrations/` (apply **all**, in order)
| File | What it does |
|------|--------------|
| `20260721090000_add_scheduling_settings_and_approver.sql` | Scheduling settings + approver plumbing |
| `20260721091000_create_leave_and_tags_module.sql` | Leave records + technician tags |
| `20260721092000_create_schedule_core_module.sql` | Daily schedules, versions, entries, assignments, audit |
| `20260721093000_schedule_technician_refresh_cron.sql` | pg_cron: refresh technicians from FSM |
| `20260721094000_schedule_fsm_reconcile_cron.sql` | pg_cron: reconcile appointments from FSM |
| `20260724090000_add_entry_display_names.sql` | WO/AP display names on entries |
| `20260725090000_add_sync_error_and_retry.sql` | Per-entry sync error + retry support |
| `20260726090000_add_appointment_creation_details.sql` | Service lines / type / time-bound-vs-all-day |
| `20260727090000_multi_appointment_per_workorder.sql` | Allow several appointments per work order |
| `20260728090000_add_needs_sync.sql` | Skip re-pushing untouched appointments |
| `20260729090000_technician_attributes.sql` | `technician_roles`, `technician_service_types`, role/service/shift/`team_leader_fsm_id` on `technician_reference` — **seeds the role catalog: Supervisor / Driver / Technician** |
| `20260730090000_add_approval_email_flag.sql` | `receives_schedule_approval_email` on user_profile |
| `20260731090000_optional_approval.sql` | Chosen-approver / publish-now flow |

> The staging helper `scripts/deploy-scheduling-staging.ps1` only re-applies the
> **incremental** migrations (`20260724…`→`20260731…`) idempotently, because the
> `20260721…` base was applied when the module was first built. **For a fresh
> production deploy, apply the whole list above in order** (e.g. `supabase db push`,
> or run each file), then deploy the functions.

### Edge Functions — `supabase/functions/` (deploy all)
`zoho-fsm-appointment-create`, `zoho-fsm-appointment-update`, `zoho-fsm-reconcile`,
`zoho-fsm-service-resources`, `zoho-fsm-work-order-lines`, `zoho-fsm-work-order-search`.

Deploy: `supabase functions deploy <name> --project-ref <PROD_REF> --no-verify-jwt`.
They rely on the standard `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
`SUPABASE_ANON_KEY` (provided by the platform) and the Zoho token in `settings`.

### pg_cron jobs (created by the two `*_cron.sql` migrations)
- **Technician refresh** — pulls active technicians from FSM (~every 30 min).
- **FSM reconcile** — pulls appointment changes from FSM so the board stays in step.

Confirm `pg_cron` is enabled on the production project and the jobs are scheduled
after the migrations run.

### Production deploy checklist
1. Apply **all** migrations in order (§3 table).
2. Deploy the **6 edge functions**.
3. Ensure `pg_cron` is enabled and both cron jobs exist.
4. Set `settings.oauth_access_token` to a valid **Zoho FSM** token.
5. Set the app env (`NEXT_PUBLIC_FSM_APP_URL` optional; `CRON_SECRET` if cron-invoked
   routes are used).
6. Turn on **"Schedule approval emails"** for the user(s) who should approve.

---

## 4. ⚠️ Do NOT copy staging DATA to production

The **migrations** create schema plus the **role/service catalog** (Supervisor /
Driver / Technician, and the service types) — that reference data is correct for
production. Everything else added on staging is **test data and must not be copied**:

- **Schedules** — daily schedules, versions, entries, assignments, audit rows.
- **Technician attributes** — the **tags, roles, service types, shifts, and
  driver assignments** applied to technicians on staging.
- **Tags** created during testing, and any **leave** records.
- Any **FSM appointment snapshots** / sync operation history.

Production starts clean: technicians sync from FSM, then the team configures their
own tags/roles/drivers there. Do **not** dump-and-restore staging rows into prod.

Note on the driver change: on staging we ran a one-off SQL to convert technicians
with role **Supervisor → Driver** (keeping their assigned technicians). That was a
data fix for existing staging rows only — **production does not need it**; new prod
setup should assign the **Driver** role directly. (The "Supervisor" role still
exists in the catalog but is inert — no special board behavior.)

---

## 5. Local dev notes

- **Run the app:** `bun run dev` (from the `Portal` folder). The `dev` script goes
  through `scripts/dev.mjs`, which resolves the real folder casing before starting
  Next — this avoids a Windows Turbopack bug where launching from `cd portal`
  (lowercase) vs the on-disk `Portal` breaks `@import "tailwindcss"`
  (`Can't resolve 'tailwindcss'`). If you ever bypass the script, launch from the
  correctly-cased `Portal`.
- **`NEXT_PUBLIC_FSM_APP_URL`** — optional; makes the WO/appointment IDs in the
  entry-detail dialog deep-link into Zoho FSM. It contains a `#`, so it **must be
  quoted** in `.env.local` (unquoted, `.env` treats everything after `#` as a
  comment). Template form, e.g.:
  `NEXT_PUBLIC_FSM_APP_URL="https://fsm.zoho.com/fsm/<orgId>#/tab/{module}/{id}"`
  (`{module}` → `Work_Orders` / `Service_Appointments`, `{id}` → record id).
  It's a `NEXT_PUBLIC_` var, so restart the dev server after changing it.
- **Stale dev servers (Windows):** Ctrl+C can leave the `next start-server` worker
  running, holding port 3032 and `.next/dev/lock`. If a start fails with a lock/port
  error, kill leftover `node`/`bun` "next dev / start-server" processes and remove
  `.next/dev/lock`, then start again.
