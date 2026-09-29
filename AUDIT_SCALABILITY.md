# Scalability & performance audit — Yalla Fixit portal

**Date:** 29 September 2026
**Scope:** `Yalla Fixit` (Next.js portal) + the shared mobile sync contract.
The mobile app has its own report at `yfi-mobile-app/YFI-MobileApp/AUDIT_SCALABILITY.md`.
**Method:** read-only. No source file was modified by this audit.
**Premise:** what happens at 100x today's data.

---

## 0. Live now — not waiting for 100x

The brief asked what breaks at 100x. Two things are **already live**, and they
are listed first.

> **Correction, 29 Sep 2026.** An earlier revision of this report claimed a
> third live issue: that the catalogue and checklist endpoints were truncating
> today. **That was wrong.** The row counts below are correct, but they were
> mapped to the wrong endpoints. Verified against the running app:
>
> | Table | Rows | Read by | Truncating? |
> |---|---:|---|---|
> | `snagging_catalogue_defects` | 1,061 | `catalogue/v2` | No — already paged |
> | `snagging_job_checklist` | 1,749 | per-job, filtered by `job_id` | No — never that many for one job |
> | `snagging_sync_mutations` | 1,656 | by `mutation_id`, never listed | No |
> | `snagging_catalogue_entries` | **88** | `catalogue` (v1) | No |
> | `snagging_checklist_items` | **47** | `checklist` | No |
>
> `/api/snagging/catalogue` returns 88 entries and `/api/snagging/checklist`
> returns 47 — both complete. **No endpoint is truncating today.** The
> unbounded-read findings below remain valid as 100x risks and the paging has
> been applied, but they are not live bugs. The remaining two items in this
> section were verified directly and are real.

PostgREST silently caps an unbounded `select()` at **1,000 rows** without
erroring, which is what makes the findings in §3 a correctness problem rather
than a performance one as data grows.

### L-1 · Unauthenticated GraphQL proxy — CRITICAL (security + cost)

`app/api/graphql/route.ts:3-23` accepts an anonymous `POST` and forwards an
**arbitrary caller-supplied GraphQL query** to Supabase using the server's anon
key. No authentication, no depth limit, no complexity limit, no timeout.

**Verified live in production.** An anonymous request returns `HTTP 200`:

```
POST https://portal.yallafixit.ae/api/graphql   {"query":"{ __typename }"}
→ 200  {"data":{"__typename":"Query"}}
```

I used `__typename` deliberately — it returns no data. Anyone who finds this
URL can author arbitrarily expensive nested queries against the database.

### L-2 · Four unauthenticated Zoho proxies — HIGH

`app/api/work-orders/route.ts`, `app/api/appointments/route.ts`,
`app/api/appointments/create/route.ts`, `app/api/appointments/update/route.ts`
contain **zero** references to `getAuthenticatedUserAccess`,
`getRequestUserAccess` or `Unauthorized`. They inject `SUPABASE_ANON_KEY`
server-side and proxy to Zoho.

`app/api/service-resources/route.ts` has three such references — this
anti-pattern was already fixed for that one route and these four were missed.

Two of them (`create`, `update`) **write**, so I verified by reading the code
rather than probing production.

> Context: earlier in this session, 18 snagging routes were found with their
> auth guards commented out and were restored. These four are a separate set
> that never had guards at all.

---

## 1. Executive summary

### Scalability score: **4 / 10**

Not a low score for lack of care — parts of this codebase are genuinely
well-engineered (§8). It is low because the correct patterns exist and were
applied inconsistently, so the same class of bug appears fixed in one file and
live in its neighbour.

### Top 5 risks

| # | Risk | Why it's top |
|---|---|---|
| 1 | **Unbounded Chrome processes** — `lib/server/snagging/report-pdf-headless.ts:112` launches a browser per call with no pool, no semaphore, no queue | N concurrent approvals = N Chrome processes (~300 MB each) on one long-running host. This OOM-kills the server and takes every in-flight request with it. The single highest-severity item. |
| 2 | **Silent mobile data loss** — seven parent queries in `lib/server/snagging/sync-pull.ts:174-311` have no `.range()` | The phone treats a snapshot as the whole truth and **deletes rows it wasn't sent**. `lib/server/snagging/read-all.ts:1-9` documents this exact failure. The child tables were fixed; the parents were missed. |
| 3 | **No timeouts on any outbound call** — `lib/server/zoho/fsm-client.ts:68` and 11 other `fetch` sites | Node's `fetch` has no default response timeout. One slow Zoho socket and handlers accumulate until the event loop and socket pool are exhausted. Classic single-server cascade. |
| 4 | **No rate limiting anywhere** across 108 route files | Nothing sits between a caller and the unbounded endpoints below. `analytics?from=2000-01-01` is a single-request OOM (§4, A-9). |
| 5 | **Silent 1,000-row truncation as a systemic pattern** | Not yet live (see the correction in §0), but the largest table is already at 1,061 rows. At 100x it reaches the schedule board, the client report, sync and the audit trail — all failing as *wrong data*, not as errors. |

---

## 2. Architecture overview

| Layer | Technology |
|---|---|
| Framework | Next.js 16.1.0 (App Router), React 19.2 |
| Database | Supabase Postgres via `supabase-js` (PostgREST) |
| Auth | Supabase Auth; ES256 JWT verified locally; cookie (portal) + `Authorization: Bearer` (mobile) |
| Hosting | **Long-running Node server**, self-hosted at `portal.yallafixit.ae` (no `x-vercel-id`/CDN headers) — not serverless |
| Integrations | Zoho FSM (scheduling + work orders), Resend (email), Supabase Storage (private `snagging` bucket) |
| PDF | `puppeteer-core` server-side; `html2canvas` + `jsPDF` client-side |
| Queues / cache | **None.** No Redis, no job queue, no React Query/SWR |

**Modules:** snagging (inspections, quotations, reports), scheduling (technician
day board + FSM sync + wall display), AMC (maintenance proposals), todos.

Two architectural facts shape everything below:

1. **It is a long-running server, not lambdas.** This is genuinely good for the
   in-process caches (§8) and makes SSE viable. It also means one OOM takes
   down all users, and module-level state leaks for the process lifetime.
2. **There is no queue.** Every expensive operation — PDF rendering, Zoho
   imports, email, photo copying — happens inside an HTTP request.

---

## 3. Findings table

### Critical

| ID | Area | File:Line | Problem | Impact at 100x | Fix |
|---|---|---|---|---|---|
| A-1 | Infra | `lib/server/snagging/report-pdf-headless.ts:112` | `puppeteer.launch()` per call; no pool or concurrency limit | N approvals ⇒ N Chrome processes ⇒ OOM kills the server | Process-wide semaphore; reuse one browser |
| A-2 | Sync | `lib/server/snagging/sync-pull.ts:174-311` | 7 parent queries with no `.range()` | Phone deletes real work past 1,000 jobs | Add `.range()`/`readAllRows` |
| A-3 | Sync | `lib/server/snagging/sync-children.ts:121-183` | Cold pull sends unbounded full snapshot, signs every URL | Multi-hundred-MB JSON in heap; no `maxDuration` | Enforce server-side cap + cursor |
| A-4 | Integr. | `lib/server/zoho/fsm-client.ts:68-92` | No retry, backoff, 429 handling or timeout | First 429 silently degrades every import | Wrap with backoff + `AbortSignal.timeout()` |
| A-5 | Integr. | `lib/server/zoho/reconcile.ts:86-98` | No `.range()`; one FSM call **per entry** (`:111-127`) inside a 60s request | Guaranteed timeout; no checkpoint, so a failure at 900 discards 900 | Require `operatingDate`, page, move to a job |
| A-6 | API | `app/api/graphql/route.ts:3-23` | Unauthenticated arbitrary GraphQL proxy (**live**) | Unbounded cost + data exposure | Delete, or auth + allowlist |
| A-7 | API | `app/api/todos/route.ts:77,99-102,328-337` | Whole table + all comments/updates, then filter/sort/page in JS; `pageSize` unclamped | Entire todo graph per request; wrong past 1,000 | Push filter/sort/range into SQL |
| A-8 | DB | `app/api/report/[token]/route.ts:122` | Client-facing report reads snags with no `.range()` | Client's copy silently misses defects the internal PDF shows | Use `readAllRows` (as `report-data.ts:393`) |
| A-9 | API | `lib/server/snagging/analytics.ts:135-147` | `resolveRange` clamps only the upper bound — no floor, no max window | `?from=2000-01-01` reads every job + every snag into heap | Clamp window width |
| A-10 | Frontend | `components/dashboard/scheduling/display/index.tsx:599-677` | One Radix `Tooltip` root **per bar** | 8,400 contexts + eager subtrees freeze the tab | One shared tooltip driven by hover state |
| A-11 | Frontend | `modules/roles/services/roles-graphql.ts:3-17` | `GET_ALL_ROLES` has no `first`/`after`/`pageInfo` | Roles list silently truncated by pg_graphql | Copy the fix in `users-graphql.ts:130-132` |
| A-12 | Frontend | `lib/snagging/report-pdf.ts:26-32` | `html2canvas(node, {scale:2})` over the whole report | Exceeds browser canvas cap ⇒ blank PDF, no error | Render per page/section |

### High

| ID | Area | File:Line | Problem | Impact at 100x | Fix |
|---|---|---|---|---|---|
| B-1 | DB | `app/api/scheduling/schedule/route.ts:117-127` | Day entries `select("*")` + 3 joins, no limit | Board silently draws a partial day | `.range()` + column list |
| B-2 | DB | `app/api/scheduling/audit/route.ts:31-35` | Audit read with **no limit**, `select("*")` incl. two JSONB blobs | Multi-MB response; truncated trail shown as complete | Paginate |
| B-3 | DB | `app/api/snagging/overview/inspectors/route.ts:61-100` | Reads **every job ever** + every roster row to build a name map | Hundreds of round trips per dashboard open | `DISTINCT` / aggregate in SQL |
| B-4 | DB | `lib/server/snagging/analytics.ts:213-283` | Every job in range + every snag on them into Node, aggregated in JS | Worst memory path in the repo | SQL aggregates or rollup |
| B-5 | API | `app/api/snagging/tasks/[id]/report/versions/route.ts:197,253` | `generateReportPdf()` **synchronously**, no `maxDuration` | Holds a handler ~3 min + 300 MB | Move to `after()` |
| B-6 | API | `lib/server/snagging/job-list.ts:79-89` | Raw `search` into `.or()` — bypasses the repo's own `likeTerm()` (`search.ts:7-11`) | PostgREST filter injection + seq scan per keystroke | Route through `likeTerm()` |
| B-7 | API | `app/api/amc-submissions/route.ts:379-413` | **11** exact `COUNT(*)` per page load (1 + 9 statuses + null) | 11 seq scans per keystroke | One `GROUP BY status` |
| B-8 | API | `lib/server/snagging/quotation-list.ts:58-86` | Same shape — 6 exact counts with JSONB `ilike` | 6 seq scans per request | One `GROUP BY` |
| B-9 | API | `app/api/snagging/overview/categories/route.ts:82-88` | Leading-wildcard `like` + one `COUNT(*)` per category in `Promise.all` | N concurrent seq scans; saturates the pool | Single grouped query |
| B-10 | Infra | `app/api/scheduling/schedule/stream/route.ts:55,103-126` | Watcher map keyed by user-supplied date, uncapped; 2s interval each | 500 dates = 500 intervals = 500 q/s | Cap watchers; restrict date window |
| B-11 | Infra | `app/api/scheduling/schedule/stream/route.ts:80-100` | `fingerprintOf` selects all entries, builds+sorts a string every 2s | Truncates at 1,000 ⇒ board goes stale silently | `max(updated_at)` + `count(*)` |
| B-12 | Jobs | `app/api/snagging/approvals/escalations/run/route.ts:99-173` | 200 serial claim+email+audit, no `maxDuration`, no checkpoint | Never catches up; nothing reports the backlog | Batch + time budget |
| B-13 | Jobs | `app/api/todos/reminders/run/route.ts:39-140` | `.limit(50)` + N+1 (2 reads/todo) + serial email | Hard ceiling ~1,200 reminders/day | Batch + queue |
| B-14 | API | `app/api/snagging/sync/snag/route.ts:88` | `await req.formData()` buffers whole body; up to 20 files; **no byte limit** | 20 videos × 50 MB = 1 GB resident per request | `Content-Length` guard + streaming |
| B-15 | Frontend | `components/dashboard/todos/index.tsx:956-961` | Search fires a request **per keystroke**; no debounce, no abort | 8 keystrokes = 8 calls to A-7 | `useDebounce` (exists, used in 9 components) |
| B-16 | Frontend | `components/dashboard/scheduling/display/index.tsx:567-684` | All rows + bars rendered, unvirtualized | ~9,000 rows mounted | Virtualize |
| B-17 | Frontend | `components/dashboard/scheduling/display/index.tsx:575-581` | Gridlines re-rendered **inside every row** | 9,000 × 14 = 126k redundant nodes | One overlay |
| B-18 | Frontend | `components/dashboard/scheduling/display/index.tsx:200-205` | Change toasts `duration: Infinity` on an unattended 24/7 board | Toasts accumulate without bound; memory leak | Cap count / auto-expire |
| B-19 | Frontend | `components/dashboard/snagging/evidence-media.tsx:128,188` | `unoptimized` on the **grid thumbnail** (`sizes="120px"`) | Downloads N full-res originals to draw 120px tiles | Drop `unoptimized` |
| B-20 | Frontend | `components/dashboard/snagging/snag-walk-list.tsx:191-283` | Whole snag array client-side; re-walked per filter change | Full payload + O(n) per interaction | Server-side paging |
| B-21 | API | `lib/server/snagging/read-all.ts:22-33` | `readAllRows` loops with no max-rows guard or time budget | Reused primitive; any caller can pull millions | Add a ceiling + cancellation |
| B-22 | Integr. | `lib/server/zoho/import-appointments.ts:28-29,158,174` | `MAX_PAGES=5` (1,000/day); on cap it `break`s and returns partial **as complete** | Appointments silently never reach the board | Set `error` on truncation |
| B-23 | API | `app/api/report/[token]/route.ts:23-63` | Public, unthrottled, re-assembles the whole report per open, ignoring the stored PDF | Heaviest read path, no auth, no limit | Serve the stored artifact |
| B-24 | DB | `lib/server/publish-schedule.ts:57-63` | Publish = one serial FSM write per entry | 1,000 serial writes in one request | Batch + concurrency |

### Medium / Low (abridged)

| ID | Area | File:Line | Problem |
|---|---|---|---|
| C-1 | DB | `lib/server/user-access.ts:99` | Cache `clear()` cliff at 1,000 users ⇒ thundering herd |
| C-2 | DB | `lib/server/snagging/media.ts:99` | Same `clear()` cliff at 20,000 signed URLs |
| C-3 | DB | `lib/server/snagging/media.ts:169` | `chunks.map(async …)` — unbounded parallel signing |
| C-4 | API | `app/api/snagging/sync/snag/route.ts:147-152` | Server-generated `mutationId` defeats the idempotency ledger on retry |
| C-5 | Jobs | both cron routes | `CRON_SECRET` compared with `===` (non-constant-time) |
| C-6 | DB | `lib/server/snagging/report-pdf-headless.ts:156` | Whole PDF buffer → JS string + regex, for a page count |
| C-7 | Frontend | `app/quotations/review/page.tsx:23`, `app/quote/[token]/public-quotation.tsx:10` | html2canvas + jsPDF statically imported on **public** pages |
| C-8 | Frontend | `components/dashboard/permissions/index.tsx:272-281` and 2 others | `pageSize={data.length}` — pagination stubbed out |
| C-9 | Frontend | `components/dashboard/extensions/bulk-download.tsx:155-224` | Whole ZIP built in browser memory |
| C-10 | Frontend | `components/dashboard/roles/index.tsx:34-36` | Fetch failure → `console.error` only; empty table indistinguishable from "no roles" |
| C-11 | DB | all audit tables | No retention anywhere (§ below) |
| C-12 | API | `app/api/test/route.ts` | A Zoho bulk-download debug endpoint shipped to production; no auth guard found |

### Audit tables that grow forever

Nothing in the repo prunes any of them. Two **cannot** be pruned as built:
`snagging_audit_events` and `amc_audit_events` install
`RULE … ON DELETE … DO INSTEAD NOTHING`
(`supabase/migrations/20260817090000_create_snagging_module.sql:594-595`,
`20260915130000:136-137`) — `DELETE` is silently discarded. Pruning requires
dropping the rule first.

`snagging_sync_mutations` is the fastest-growing table in the system (one row
per mobile mutation, forever) and is a pure idempotency ledger — worthless
after the retry window. Already 1,656 rows.

---

## 4. Detailed findings — Critical and High

### A-1 · Chrome with no ceiling

`lib/server/snagging/report-pdf-headless.ts:104-123`

```ts
const executablePath = resolveBrowserPath();
if (!executablePath) throw new BrowserUnavailableError();
browser = await puppeteer.launch({ executablePath, /* … */ });
```

Callers: `report-generate.ts:119`, reached from `approve/route.ts:170` inside
`after()` **and** from `report/versions/route.ts:197,253` inline. `after()`
defers work; it bounds nothing.

**Fix** — one semaphore, process-wide:

```ts
const MAX_CONCURRENT_RENDERS = 2;
let active = 0;
const waiting: Array<() => void> = [];

async function withRenderSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await run();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}
```

Wrap `renderPdfFromHtml`'s body in `withRenderSlot`. Two is a starting point —
tune against host RAM (~300 MB per Chrome).

### A-2 · Sync parents unpaged — silent data loss

`lib/server/snagging/sync-pull.ts:174-178` (and `:190`, `:206`, `:224`, `:271`,
`:285`, `:306`):

```ts
const assignedQuery = admin
  .from("snagging_jobs")
  .select("id, status, parent_job_id")
  .eq("inspector_id", profile.id)
  .in("status", WORKABLE_JOB_STATUSES);   // ← no .range()
```

`lib/server/snagging/read-all.ts:1-9` states the consequence precisely: *"the
phone — which treats a snapshot as the whole truth — deleted the rows it had
not been sent."* The child tables were fixed with `readAllRows`. These seven
parents were not.

**Fix** — use the helper that already exists:

```ts
const assigned = await readAllRows<{ id: string }>(
  (from, to) =>
    admin
      .from("snagging_jobs")
      .select("id, status, parent_job_id")
      .eq("inspector_id", profile.id)
      .in("status", WORKABLE_JOB_STATUSES)
      .order("id", { ascending: true })
      .range(from, to),
  "assigned jobs",
);
```

### A-4 · No timeout, no backoff on any Zoho call

`lib/server/zoho/fsm-client.ts:68-92` is the single chokepoint for every FSM
call and has no retry, no backoff, no 429 handling and **no timeout**.

The repo already contains the pattern — `app/api/zoho-file/route.ts:35-63`
implements 3 retries with linear backoff. It was never applied to the shared
client.

**Fix**:

```ts
const res = await fetch(url, {
  ...init,
  signal: AbortSignal.timeout(20_000),
});

if (res.status === 429 || res.status >= 500) {
  const retryAfter = Number(res.headers.get("retry-after")) || 0;
  const wait = retryAfter * 1000 || Math.min(2 ** attempt * 500, 8_000);
  await new Promise((r) => setTimeout(r, wait));
  continue; // bounded attempts
}
```

### A-7 · Todos: the whole graph, per request

`app/api/todos/route.ts:77` then `:99-102`, paged at `:328-337`:

```ts
let query = admin.from("todos").select("*")        // no limit
// … then .in(ids) for assignees, comments, updates — also unbounded
const start = page * pageSize;
return sortedTodos.slice(start, start + pageSize); // paged in Node
```

`pageSize` is `Number(params.get("pageSize") ?? 100)` with **no clamp and no
finiteness check** — `?pageSize=1e9` is accepted.

**Fix** — filter, sort, count and page in Postgres, and drop the child fan-out
from the list view (fetch comments/updates on open):

```ts
const pageSize = Math.min(Math.max(Number(params.get("pageSize")) || 25, 1), 100);
const page = Math.max(0, Number(params.get("page")) || 0);

let q = admin
  .from("todos")
  .select("id,todo_key,title,status,deadline_at,owner_id", { count: "exact" })
  .order("deadline_at", { ascending: true })
  .range(page * pageSize, page * pageSize + pageSize - 1);
if (status && status !== "all") q = q.in("status", status.split(","));
```

### A-9 · A one-line OOM

`lib/server/snagging/analytics.ts:135-147` clamps only the upper bound:

```ts
if (to > latest) to = latest;   // `from` has no floor, no max width
```

Any authenticated user can request `?from=2000-01-01`, which reads every job
and every snag into one request's heap. No `maxDuration`, no rate limit.

**Fix**:

```ts
const MAX_WINDOW_DAYS = 400;
const floor = addDays(to, -MAX_WINDOW_DAYS);
if (from < floor) from = floor;
```

### A-10 / B-16 / B-17 · The wall display at 100x

`components/dashboard/scheduling/display/index.tsx:599-677` wraps **every bar**
in its own Radix `Tooltip` — an independent root with its own context and
Presence subscription — and eagerly builds each `TooltipContent` subtree
(`:658-676`, 5-7 elements each). At 84 bars this is fine; at 8,400 it is 8,400
React contexts.

`:575-581` renders the hour gridlines *inside every row*, though they are
identical in all of them.

**Fix**: one shared tooltip positioned from hover state; hoist the gridlines to
a single absolutely-positioned overlay sibling of the rows; virtualize
`laidOut` (`:567`).

### B-6 · Filter injection the repo already knows how to prevent

`lib/server/snagging/job-list.ts:79-89`:

```ts
const search = params.get("search")?.trim();
const term = `%${search}%`;
query = query.or([`code.ilike.${term}`, /* … */].join(","));
```

`lib/server/snagging/search.ts:7-11` exports `likeTerm()`, which strips
`,()"'%_*:` — and `client-list.ts:41` and `quotation-list.ts:26` both use it.
A search containing `,` or `)` terminates the `or()` early and rewrites the
predicate. Same gap at `catalogue/route.ts:50-58` and `checklist/route.ts:83-87`.

**Fix**: `const term = \`%${likeTerm(search)}%\`;`

### B-7 / B-8 · N counts per page load

`app/api/amc-submissions/route.ts:379-413` calls `countFor` **11 times**: the
page, `null`, and each of the 9 `AMC_STATUSES`. Every one carries the same
`or(...)` visibility filter **and** the JSONB `ilike` search clauses, none of
which can use an index.

**Fix** — one grouped query via RPC:

```sql
create or replace function amc_status_counts(p_search text default null)
returns table(status text, n bigint)
language sql stable as $$
  select status, count(*) from amc_submissions
  where p_search is null
     or customer->>'customerName' ilike '%'||p_search||'%'
  group by status;
$$;
```

### B-14 · Unbounded upload body

`app/api/snagging/sync/snag/route.ts:88` does `await req.formData()`, buffering
the entire multipart body before validation. Up to 20 files (`:65`), and
`content_type` may be `video/*` (`:132`). `photo.bytes` (`:49`) is a
*client-supplied hint* used only for the DB row.

**Fix**: reject on `Content-Length` before reading the body, and stream each
part straight to Storage rather than buffering.

---

## 5. Index recommendations

Checked against the live schema on 29 Sep 2026 — none of these already exist.

> **Two sweep claims were wrong and are corrected here.** `snagging_clients`
> **does** exist (created outside `supabase/migrations/`) and already has
> `idx_snag_clients_name`. `snagging_jobs.client_id` **is** already indexed as
> `idx_snag_jobs_client`. The live schema, not the migrations folder, is the
> source of truth — several columns were added out of band.

```sql
-- ── 1. The Overview page's 4-way OR ────────────────────────────────────
-- lib/server/snagging/overview-queries.ts:91-95 ORs created_by, inspector_id,
-- reviewer_id and approval_manager_id. inspector_id and reviewer_id are
-- indexed; the other two are NOT, so the planner cannot build a BitmapOr and
-- falls back to a sequential scan — on ~25 queries per Overview load.
create index concurrently if not exists idx_snag_jobs_created_by
  on public.snagging_jobs (created_by);
create index concurrently if not exists idx_snag_jobs_approval_manager
  on public.snagging_jobs (approval_manager_id);

-- ── 2. The Jobs list default sort (lib/server/snagging/job-list.ts:129-142)
create index concurrently if not exists idx_snag_jobs_created_at
  on public.snagging_jobs (created_at desc);

-- ── 3. Job-detail audit lookups ────────────────────────────────────────
-- job-detail-sections.ts:456-463 filters event_type + entity_id and never
-- entity_type, so the existing (entity_type, entity_id, created_at) index
-- has an unconstrained leading column.
create index concurrently if not exists idx_snag_audit_event_type_entity
  on public.snagging_audit_events (event_type, entity_id, created_at desc);

-- ── 4. First query of every mobile sync pull ───────────────────────────
-- sync-pull.ts:190-194 and job-roster.ts:86-90.
create index concurrently if not exists idx_snag_visits_inspector
  on public.snagging_job_visits (inspector_id);

-- ── 5. Severity roll-ups on the Jobs list ──────────────────────────────
-- job-list.ts:56-73 runs three correlated counts per row; at pageSize 200
-- that is 600 aggregates per page.
create index concurrently if not exists idx_snag_snags_job_sev_status
  on public.snagging_snags (job_id, severity, status);

-- ── 6. Text search — currently ALL sequential scans ────────────────────
-- pg_trgm is NOT installed. Every ilike '%term%' in the app is a seq scan.
create extension if not exists pg_trgm;

create index concurrently if not exists idx_snag_jobs_code_trgm
  on public.snagging_jobs using gin (code gin_trgm_ops);
create index concurrently if not exists idx_snag_jobs_unit_trgm
  on public.snagging_jobs using gin (unit_label gin_trgm_ops);
create index concurrently if not exists idx_snag_jobs_building_trgm
  on public.snagging_jobs using gin (building_name gin_trgm_ops);
```

**Verify a fix landed** (should report `Bitmap`/`Index Scan`, not `Seq Scan`):

```sql
explain analyze
select id from public.snagging_jobs
where created_by = '00000000-0000-0000-0000-000000000000'
   or inspector_id = '00000000-0000-0000-0000-000000000000';
```

---

## 6. Pagination coverage matrix

108 route files; 64 expose a `GET`. Routes whose paging lives in a lib helper
are marked accordingly.

| Endpoint | Paginated | Type | Max page size |
|---|---|---|---|
| `snagging/tasks` | **Yes** | offset (`job-list.ts:22-26`) | 200 |
| `snagging/quotations` | **Yes** | offset (`quotation-list.ts:27`) | 100 |
| `snagging/clients` | **Yes** | offset (`client-list.ts:49`) | 100 |
| `snagging/catalogue/v2` | **Yes** | `readAll` paging | n/a |
| `snagging/tasks/[id]/audit` | **Yes** | offset | 100 |
| `snagging/overview/upcoming` | **Yes** | offset | — |
| `snagging/analytics/records` | **Partial** | offset; full set materialised first | clamped |
| `amc-submissions` | **Partial** | offset + 11 counts | — |
| `snagging/sync/jobs` | **Partial** | keyset for Done tab only (`sync-pull.ts:537`) | — |
| `todos` | **No** (JS slice) | — | **unclamped** |
| `snagging/catalogue` (v1) | **No** | — | — |
| `snagging/checklist` | **No** | — | — |
| `scheduling/schedule` | **No** | — | — |
| `scheduling/audit` | **No** | — | — |
| `scheduling/history` | **No** | — | — |
| `snagging/sync/pull` | **No** | — | — |
| `snagging/tasks/[id]/snags` | **No** | — | — |
| `snagging/overview/inspectors` | **No** (reads all) | — | — |
| `snagging/overview/{kpis,pipeline,activity,categories,quotations}` | **No** | aggregates | — |
| `report/[token]`, `snagging/quotation/[token]`, `amc/[token]` | **No** | — | — |
| `snagging/floor-plans`, `properties`, `availability`, `pricing` | **No** | small tables | — |
| `scheduling/{approvers,config,leave,me,tags,tag-assignments}` | **No** | config tables | — |
| `role-access`, `todos/tags`, `amc-settings` | **No** | `amc-settings` caps at 2,000 | — |

**Summary: 6 of 64 GET routes are properly paginated with a capped page size.**

---

## 7. Prioritised action plan

### Quick wins (< 1 day)

1. **Delete or authenticate `app/api/graphql/route.ts`** — live, unauthenticated, in production.
2. **Add auth guards** to the four Zoho proxies (§0, L-2).
3. **Clamp `pageSize`** in `app/api/todos/route.ts:328`.
4. **Floor `resolveRange`** in `analytics.ts:139` — closes a one-line OOM.
5. **Route three search paths through `likeTerm()`** (`job-list.ts:81`, `catalogue/route.ts:51`, `checklist/route.ts:84`).
6. **`readAllRows` in `app/api/report/[token]/route.ts:122`** — one line; fixes a client-facing correctness bug.
7. **Apply the §5 indexes** — no code change.
8. **Debounce the todos search** (`todos/index.tsx:956`) using the existing `useDebounce`.
9. **Remove `unoptimized`** from `evidence-media.tsx:188`.
10. **Delete `app/api/test/route.ts`** if it is what it looks like.

### Medium (1-3 days)

11. **Semaphore around Chrome** (A-1) and move `report/versions` PDF into `after()`.
12. **Page the seven sync parents** (A-2).
13. **Timeouts + backoff on `fsmFetch`** (A-4); `AbortSignal.timeout()` on all 11 outbound `fetch` sites.
14. **`.range()` on the schedule board and audit reads** (B-1, B-2).
15. **Replace the N-count endpoints** with `GROUP BY` RPCs (B-7, B-8, B-9).
16. **Cap the SSE watcher map**; replace `fingerprintOf` with `max(updated_at)` + `count(*)` (B-10, B-11).
17. **Fix the two cache `clear()` cliffs** — LRU-evict one entry instead (C-1, C-2).
18. **Rate limiting** on the unauthenticated surfaces first.

### Long-term

19. **Introduce a job queue.** PDF rendering, Zoho reconcile, escalations, report generation and bulk photo copying all belong outside the request path. This is the root cause behind A-1, A-5, B-5, B-12 and B-13.
20. **Replace JS aggregation with SQL** in analytics and the overview (B-3, B-4) — materialised views or RPCs.
21. **Retention on audit tables** — and drop the `DO INSTEAD NOTHING` rules first, or they cannot be pruned at all.
22. **Server-side pagination for the remaining tables**; virtualize the wall display.
23. **Adopt a fetch cache** (React Query/SWR) — there is none today.

---

## 8. What's already done well

Worth recording, because several of these are the patterns the rest of the code
should be measured against:

- **`lib/server/snagging/read-all.ts`** — a correct paging primitive with a
  docstring explaining the exact data-loss bug it prevents. The problem is
  adoption, not design.
- **`lib/server/user-access.ts:52-112`** — genuinely well-built: JWT verified
  locally (no Auth round trip), profile + permissions in one query, 30s TTL,
  **promise-valued so concurrent misses share one query**, negative results
  deliberately not cached. Auth went from three sequential round trips (~1s) to
  effectively free. Only defect is the `clear()` cliff.
- **The mutation idempotency ledger** (`sync-push.ts:122,156-168`) — correctly
  distinguishes `applied` from `rejected`.
- **Claim-before-side-effect** in three places: `report-generate.ts:86-99`,
  `scheduling/schedule/route.ts:96-106`, `escalations/run:109-115`.
- **Push batching** (`push-plan.ts:84-101`) — dependency waves with bounded
  concurrency, mutations capped at 500.
- **`lib/server/snagging/job-list.ts:48-58`** — explicit column lists with
  in-database aggregates and a sort allowlist, with comments documenting the
  regressions that motivated them.
- **Keyset pagination done right** at `sync-pull.ts:537-543` — the pattern the
  offset endpoints should copy.
- **`components/dashboard/snagging/jobs-table.tsx:113-134`** — server paging,
  debounce, request ticket against out-of-order responses, and a real error
  state. The reference implementation for the other tables.
- **Mobile photo compression** measured against a hard 1 MB cap.

---

## 9. Coverage

**Audited:** `app/api/**` (all 108 route files), `app/(dashboard)/**`,
`app/quote/**`, `app/quotations/**`, `lib/server/**`, `lib/snagging/**`,
`lib/scheduling/**`, `lib/pdf/**`, `lib/supabase/**`, `modules/**`,
`components/dashboard/**`, `components/data-table/**`, `components/ui/**`
(spot), `supabase/migrations/*.sql`, `next.config.ts`, `package.json`, and the
**live production schema** (`pg_class`, `pg_indexes`, `information_schema`).

**Not audited:** `scripts/`, `utils/`, `context/`, `hooks/` (beyond
`use-debounce`), `public/`, `docs/`, test fixtures. None carry request-path or
query logic.

**Verified against production** rather than inferred: row counts and table
sizes; index existence; the GraphQL proxy's live behaviour; `pg_trgm` absence.

**Stated as uncertain:** whether `app/api/test/route.ts` is reachable in
production (no auth guard found, but not probed); whether
`leave_records`' existing index covers the overlap test at
`scheduling/schedule/entries/route.ts:90-96` — confirm with
`explain analyze` on that query.
