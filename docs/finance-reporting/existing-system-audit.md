# Existing system audit

Part of the [Finance & Reports plan](README.md). Audited 20 Oct 2026 against `main` at `f341a26` (read
from the code, not from names). Next.js 16.1 App Router, React 19.2, Supabase (Postgres + PostgREST),
Resend email, Zoho FSM API v1.

## Reuse / Extend / Build

| Component | Exists on `main` | Decision | Notes |
|---|---|---|---|
| Permission checks | `lib/role-permissions.ts` (`hasResourceAction`, `isAdminUser`, `NOT_INHERITED_BY_ADMIN`), `ResourceType`/`ActionType` in `types/types.ts` | **Extend** | Add resources; new roles are `roles` rows |
| Per-page permissions | `20261008100000_per_page_permissions.sql`, `components/dashboard/permissions/constants.ts`, `menu-items.tsx` | **Reuse pattern** | Backfill `role_access` with `on conflict do nothing` |
| Server access resolution | `lib/server/user-access.ts` (`getAuthenticatedUserAccess`), `lib/server/request-user-access.ts` (`getRequestUserAccess`) | **Reuse** | 30 s cache |
| Writes to `roles`/`role_access`/`user_profile` | **From the browser via pg_graphql with the anon key**; `/api/role-access` unauthenticated | **Replace (ported)** | See [security matrix](security-and-permissions-matrix.md) |
| FSM client | `lib/server/zoho/fsm-client.ts` (`fsmFetch`, `getFsmAccessToken`) | **Reuse** via `lib/server/finance/fsm-read.ts` | Timeout, retries, backoff already right |
| FSM data in Supabase | None (no mirror; read live per request) | **Build** read model | [FSM plan](zoho-fsm-integration-plan.md) |
| FSM clients/addresses | `lib/server/snagging/fsm-clients.ts`, `lib/server/zoho/fsm-contacts.ts` | **Extend** (DEV-459) | Read-through; no fallback |
| Scheduled jobs | `CRON_SECRET` POST routes run by an external scheduler (`app/api/snagging/approvals/escalations/run`, `app/api/todos/reminders/run`); no cron, queue or worker | **Reuse pattern** | Claim-first idempotency |
| Email | `lib/server/send-email.ts` (Resend), `lib/email-brand.ts` (`clientEmailHtml`) | **Reuse**, behind `lib/server/finance/delivery-policy.ts` | No test-mode guard on `main` |
| In-app notifications | `snagging_notifications` only (inspector app, 7 fixed types, job/visit FKs). No portal bell (commented out) | **Build** `portal_notifications` | `amc-hardening` has a generalised `amc_notifications` + inbox UI: same shape adopted so AMC can converge |
| To-dos | `todos` (owner required, `related_type` fixed to work_order/quotation/appointment) | **Not used** for system actions | Verification and dispute queues live in their modules |
| Settings | `amc_settings` (code defaults + one override row + Zod + audit) | **Reuse pattern** | `reporting_settings` |
| Audit | Per module: `snagging_audit_events` (append-only rules), `amc_audit_events`, `schedule_audit_events` | **Reuse pattern** | `fin_queue_events`, HR audit rows |
| Reports UI | Snagging analytics: `useSection`, `analytics-drilldown.tsx`, `lib/server/snagging/analytics.ts` (`resolveRange`, `periodSeries`), `lib/snagging/export-table.ts` + `ExportMenu` (xlsx in the browser) | **Reuse** | Analytics APIs check `SNAGGING` VIEW, not the page resource; fix the pattern in the new module |
| Tables and house UI | `components/data-table/index.tsx` (`DataTable`), kaizen (`PageHeading`, `StatCard`, `SectionCard`, `PillTabs`, `ListPager`), `kaizen-states`, `Money`, recharts via `components/ui/chart.tsx` | **Reuse** | — |
| Time zone | `lib/scheduling/org-time.ts` (`Asia/Dubai`, `zonedTimeToUtc`, `todayInZone`) | **Reuse** | One date policy for all reports |
| Pagination | `.range()` + `count: "exact"`; `lib/server/snagging/read-all.ts` (`readAllRows`) | **Reuse** | Hosted API silently caps unpaged reads at 1 000 rows |
| Saved filters | None (localStorage, cookies, URL only) | **Build** `report_saved_filters` | — |
| Tests | **None on `main`** | **Ported** `node:test` runner (`tests/setup/*`) from `amc-hardening` | Zero dependencies |

## People and time

- **`user_profile`**: `id` (= auth user), `email`, `role_id`, `full_name`, `is_active`,
  `receives_schedule_approval_email`. No employment status, leaving date, hidden flag, team, or link to FSM.
- **`technician_reference`**: FSM technician cache keyed by `fsm_resource_id`; `display_name`, `is_active`,
  `shift` (morning/night), `team_leader_fsm_id`, `role_id`, `service_type_id`. **No link to `user_profile`**
  (email is read during sync but not stored).
- **Shifts**: org-wide times on `settings` (`day_shift_start/end` 08–17, `night_shift_start/end` 00–09,
  `org_timezone`); one shift per technician. No rosters, rest days or public holidays.
- **`leave_records`**: keyed by `technician_fsm_id`; `start_at`/`end_at` timestamps (part-day works);
  `leave_type` free text; `active`/`cancelled`.
- **Attendance and check-ins**: none, anywhere.

## Commercial data

- **`snagging_quotations`**: snagging's own quotations; `lines` is a JSON array, not rows.
- **`snagging_clients.maher_id`**: the client's MAHER id. No invoice concept exists.
- **FSM** holds the quotations, work orders and line items this project invoices from; nothing is mirrored.

## Infrastructure facts

- Runs as a long-lived Node server (`portal.yallafixit.ae`); no `vercel.json`, no Edge Function source on
  `main`, no queue.
- Token refresh for Zoho is an external pg_cron job (not in the repo).
- `.env` on developer machines points at the **production** database.
- `bun.lock` is the declared lockfile but is out of sync with `package.json` on `main` (B-06).
- Tables built outside migrations: `snagging_jobs`, `snagging_clients`; migration `20260917090000` missing
  (B-07).

## What was ported into this branch (P0)

From `amc-hardening` commit `926cb24`, path-limited (not a cherry-pick; that commit also touches AMC routes
absent from `main`):

- New: `lib/server/{require-access, action-guard, graphql-allowlist, request-origin,
  password-reset-token, email-request-policy}.ts`, `lib/server/admin/users-roles.ts`,
  `lib/internal-signature.ts`, `app/api/users/route.ts`, `app/api/roles/route.ts`.
- Patched with the security diff only (3-way, no conflicts): `app/api/{graphql, role-access, send-email,
  auth/check-email}/route.ts`, `app/auth/callback/route.ts`, `middleware.ts`,
  `modules/{auth/auth-actions, auth/services/auth-service, roles/services/roles-service,
  settings/services/setting-service, users/services/users-service}.ts`,
  `lib/server/{send-email, schedule-approvers}.ts`,
  `components/auth/reset-password/reset-password-form.tsx`.
- Excluded: `components/dashboard/permissions/constants.ts` and `types/types.ts` (their only changes were
  AMC `AMC_OPERATIONS`; `main` has since changed both), every `amc-contracts`/`lib/amc` file, estimate and
  appointment route hardening, Edge Functions.
- Migrations: `20261005150000`, `20261006161000`, `20261006163000` (already applied to production per the
  6 Oct log) and **`20261006160000` (held — apply only when this code is deployed)**.
- Verified: every ported file's `@/` imports resolve on `main`; none imports AMC code; full non-incremental
  `tsc` passes.
