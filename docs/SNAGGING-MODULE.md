# Property Care / Snagging module

Implements the Snagging Tool BRD (v1 Draft, 17 May 2026) across two
repositories that share one Supabase project:

- **Yalla Fixit portal** (this repo) — schema, API, and the manager
  dashboard.
- **YFI-MobileApp** — the offline inspector app, which authenticates
  against the same project and syncs through this repo's API.

## Applying the database changes

Two migrations, in order:

```bash
supabase/migrations/20260817090000_create_snagging_module.sql
supabase/migrations/20260817091000_seed_snagging_catalogue.sql
```

Locally: `npm run supabase:reset`. Against the hosted project: run both
files in the SQL editor, or `supabase db push` if the CLI is linked.

The seed is idempotent (`ON CONFLICT DO NOTHING`), so re-running it is
safe.

## Schema

Everything is prefixed `snagging_`. The module is self-contained: no
existing table is altered, and the only outward references are to
`user_profile` and `auth.users`.

| Table | Purpose |
|---|---|
| `snagging_catalogue_entries` | Element → defect → advisory severity (BRD §9) |
| `snagging_catalogue_areas` | Level 1 of the taxonomy |
| `snagging_catalogue_area_elements` | Which elements exist in which area |
| `snagging_area_templates` / `_items` | Preset room lists by property type (FR-1.03) |
| `snagging_projects` / `snagging_properties` | Engagements and the CRM-linked property (BR-1) |
| `snagging_tasks` / `snagging_task_assignees` | The inspection visit and who is on it |
| `snagging_areas` | Rooms, with the positive coverage record (FR-2.07) |
| `snagging_floor_plans` | Plans for pin placement (§12) |
| `snagging_snags` / `_photos` / `_verifications` | The persistent defect, its evidence, its status history (§5.2) |
| `snagging_submissions` / `snagging_approvals` | Sign-off and the approval chain (§6.4) |
| `snagging_audit_events` | Append-only, enforced by rule (BR-7) |
| `snagging_reports` / `_tokens` / `_token_events` | Tokenised delivery and engagement tracking (§6.5) |
| `snagging_sync_mutations` / `snagging_devices` | The mobile sync ledger (§6.3) |

Two design decisions worth knowing about, both documented inline in the
migration:

1. **The catalogue is split across two tables.** The BRD's example code
   (`LR-WL-CRK`) reads as one row per area/element/defect triple, but
   that contradicts its own 200-400 entry estimate — twenty areas times
   ~85 element/defect pairs is over a thousand rows. Levels 2-4 are ~90
   entries (`WL-CRK`); level 1 is the areas table; the pairing is an
   applicability matrix. A captured snag still stores the full
   `LIV-WL-CRK` composite for reporting.

2. **RLS is restrictive, not permissive.** The portal's older tables use
   `Allow All to public`. That is unsafe here because the mobile app
   ships the anon key, so the same policy would make every snag, photo
   path, and client name world-readable. Server code uses the service
   role and bypasses RLS; `authenticated` gets policies scoped to the
   tasks a user is assigned to; `anon` gets nothing.

## Permissions

Two new resources in `ResourceType`:

- `snagging` — inspections, approvals, analytics. The `approve` action
  is what gates the manager decision (BR-4).
- `snagging_catalogue` — master-data administration, held by Ops.

Grant these in **Roles → Permissions** as usual. Admins bypass the
check. The mobile app needs `snagging` view + edit for an inspector.

## API

All routes live under `/api/snagging` and accept **either** a portal
session cookie **or** an `Authorization: Bearer <supabase access token>`
from the app — see [lib/server/request-user-access.ts](../lib/server/request-user-access.ts).

| Route | Method | Use |
|---|---|---|
| `/overview` | GET | Dashboard counts, review queue, severity totals, sync health |
| `/clients` | GET | Distinct clients from existing properties, for the new-job picker |
| `/floor-plans` | POST | Multipart floor-plan upload to the private bucket (FR-1.02) |
| `/tasks` | GET, POST | List (view-backed, enriched with inspector + M/L split) and create |
| `/tasks/[id]` | GET, PATCH | Detail with evidence; schedule/assignment edits |
| `/tasks/[id]/approve` | POST | Manager approval, queues the report |
| `/tasks/[id]/reject` | POST | Three-tier rejection (§5.3) |
| `/tasks/[id]/rounds` | POST | Open a de-snagging round (FR-6.01) |
| `/catalogue` | GET, POST, PATCH | Master data; retire, never delete |
| `/analytics` | GET | §6.7 dashboards and §2.3 KPIs |
| `/sync/pull` | GET | Reference pack + assigned work, cursor-based |
| `/sync/push` | POST | Drains the device outbox, idempotent |
| `/media/sign` | POST | One-shot signed upload URL |

### Sync contract

The device holds an outbox; each row carries a client-generated UUID.
`/sync/push` applies a given `mutation_id` at most once and reports a
result per mutation, so a retry after a dropped response cannot
duplicate a snag and one bad payload does not strand the batch.

`/sync/pull` takes the `server_time` from the previous response as its
cursor. The cursor is the server's clock, not the phone's — a handset
that has been on a site for two days is frequently the one with the
wrong time.

Photos never pass through the API. The app requests a signed upload URL,
puts the binary straight into the private `snagging` bucket, and only
then queues the metadata row — so the server never holds a photo record
pointing at an object that does not exist.

## Screens

Rebuilt to the Kaizen design system and the ops reference design:

- `/snagging` — **Today at a glance**: status stat cards, a review
  queue, open snags by severity, and the one dark band per page for the
  "media trails the record" caveat.
- `/snagging/jobs` — the **jobs table**: status-pill filters, inspector,
  round, and H/M/L snag counts (severity is always a colour paired with
  a value, never colour alone).
- `/snagging/jobs/new` — the four-step **new job** wizard (property →
  floor plans → areas → assign).
- `/snagging/review` — the **review workspace**: the SLA-ordered queue on
  the left, the selected inspection's stat cards and walk-the-snags list
  on the right. `/snagging/approvals` redirects here.
- `/snagging/[id]` — one inspection, reusing the review panel.
- `/snagging/[id]/desnag` — the **de-snag builder**: pick which
  outstanding snags carry into the next round (low severity unticked by
  default).
- `/snagging/analytics` — §6.7 dashboards and §2.3 KPIs.
- `/snagging/catalogue` — master data.

## Test data

The staging DB was seeded with demo jobs for testing (task codes
prefixed `SEED-`, plus one wizard-created `MARVISTO-*` job and a
`SEED-2412-R2` de-snag round). To clear it:

```sql
delete from public.snagging_properties where unit_label like 'SEED-%';
delete from public.snagging_tasks where code like 'MARVISTO-%';
```

Properties cascade to their tasks, areas, snags, and photos.

## Testing from a browser

Both halves can be exercised in a desktop browser, which is usually
faster than reaching for a handset.

**The dashboard** is an ordinary Next.js app: `npm run dev` here, then
`/snagging`. It hits every API route, so it is the primary way to test
the backend.

**The inspector app** runs on web too, but not with a plain
`expo start`. `expo-sqlite` uses wa-sqlite in the browser, which needs
`SharedArrayBuffer`, which browsers only grant to a cross-origin
isolated page — and isolation is decided by COOP/COEP on the top-level
HTML document. `metro.config.js` sets those headers, but Metro's
middleware never sees the HTML: Expo Router's dev middleware serves it
higher up the stack. So the repo has a small dev-only proxy that fronts
Expo and stamps the headers on everything:

```bash
node scripts/dev-web.mjs --port 8081
```

Without it the app boots to the login screen and then throws
`SQLite is not available` the moment a screen reads local data. With it,
`crossOriginIsolated` is true and the offline database, outbox, and sync
engine all run in the browser.

Two caveats. Expo classifies web SQLite as alpha, so a handset is still
the real target. And `expo-file-system` has no web implementation, so
the free-space figure behind the low-storage warning (FR-3.05) reads as
unavailable there — it is wrapped in a guard rather than crashing.

For the app to sync it needs `EXPO_PUBLIC_API_URL` pointing at this
portal (`http://localhost:3032` by default) and the migrations applied;
until then the pull returns a 500 and the job list stays empty.

## Schema trim (migration 20260818090000)

Three tables were created ahead of unbuilt features and removed to keep
the schema lean, via `20260818090000_drop_unused_snagging_tables.sql`
(apply it when convenient — the app already runs with or without it):

- `snagging_projects` — full-building B2B engagements. Single-unit and
  de-snag flows never referenced it; its `project_id` FK columns on
  tasks/properties and its join in the summary view are removed too.
- `snagging_report_tokens`, `snagging_report_token_events` — tokenised
  delivery (FR-5.04-06), not implemented.

`snagging_reports` is kept: the approval flow stages a row there and
report generation builds on it. Everything else maps to a wired flow.

## Not built yet

Phase 1 items from the BRD that this work does not cover:

- **PDF and web-view report generation** (FR-5.01 to FR-5.03).
  Approval creates a `snagging_reports` row with `status = 'queued'`;
  nothing consumes it yet.
- **Tokenised delivery** (FR-5.04 to FR-5.06). The tables, hashed
  tokens, expiry, and engagement tracking are in place; the send path
  and the public report page are not.
- **Zoho CRM/FSM read-only integration.** `snagging_properties` carries
  `crm_contact_id` / `crm_property_id`; nothing populates them yet, so
  properties are entered at intake.
- **Floor-plan upload from the portal.** The table, storage, and the
  app's pin placement are ready; there is no upload UI, which is why a
  full-building task is created as a draft (FR-1.02 makes the plan
  mandatory there).
- **Supervisor review step.** The schema and approval actions support
  it; the routing is manager-only for now.
- **Escalation after 48 hours** (FR-4.06). `approval_due_at` is set and
  surfaced as overdue in the queue and analytics; nothing sends the
  escalation.
