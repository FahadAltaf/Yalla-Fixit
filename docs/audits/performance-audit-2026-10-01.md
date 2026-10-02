# YFI Snagging: performance, offline, pagination and scalability audit

**Date:** 1 October 2026
**Scope:** inspector app `yfi-mobile-app/YFI-MobileApp` (commit `04ce640`, phone DB version 38) and the portal API `Yalla Fixit` (commit `b626c4f`, `/api/snagging/*`, `lib/server/snagging/*`, `supabase/migrations/*`).
**Mode:** read-only. No source, migration or config file was changed. No query, load test or script was run against any network database or server. Helper scripts written: `docs/audits/perf/scripts/sqlite-plans.mjs` (run locally, results below) and `docs/audits/perf/scripts/api-latency.mjs` (written for staging, **not run**).

> **Note (2 October 2026):** the helper scripts and proof tests under `docs/audits/perf/` were deleted once the Phase 1 fixes were merged into `dev`. They were never committed. References to them below are kept as the record of what was run; the results quoted here stand, but the files can no longer be re-run.

---

## 1. Executive summary

### 1.1 Scorecard

| # | Requirement | Verdict | Why, in one line | Key findings |
|---|---|---|---|---|
| R1 | Every SQL operation is fast | 🟠 At risk | Phone reads are mostly well inside budget, but the whole-job defect read misses it, user saves wait behind 150–250 ms sync transactions, and the server's base-table indexes cannot be verified from the repo | F-SQL-1, F-SQL-2, F-SQL-3, F-SQL-4, F-DB-1, F-DB-5, F-RT-2, F-RT-3 |
| R2 | Every API call < 1 s | 🔴 Fails (INFERRED) | ≈220 ms per database round trip, multiplied by 4–17 serial calls per endpoint: a defect save is ≈1.3–3.5 s, a no-change poll ≈0.9 s; a whole job is ≈300–400 KB gzipped | F-API-1/F-DB-2, F-API-2, F-API-3/F-DB-3, F-API-5, F-API-7, F-API-8 |
| R3 | Full offline mode | 🔴 Fails | The offline pack can say "Ready" after downloading nothing; an active job cannot be started offline unless it was packed online; a de-snag round's plan can be deleted; NOC and gate pass are online-only | F-OFF-1, F-OFF-2, F-OFF-3, F-OFF-4, F-OFF-9 |
| R4 | Pagination works perfectly | 🟠 At risk | Done uses a real `(created_at, id)` keyset and every server list pages, but the delta cursor has no overlap, server paging uses OFFSET (a concurrent delete can make the phone drop a live row), there are no tombstones, and the phone's Done list re-reads from the top | F-PAG-1, F-PAG-3, F-PAG-6, F-PAG-4, F-SQL-6 |
| R5 | Optimised and scalable | 🟠 At risk | Idle load is low (≈12 requests/device/hour), but push is N+1 per change, nothing is ever pruned (server or phone), retries have no jitter, a timeout is treated as offline, and every idle pass re-reads the inspector's whole history | F-DB-3, F-DB-10, F-SYNC-2, F-SYNC-3, F-SYNC-4, F-SYNC-7 |
| R6 | Fetch only the fields shown | 🟠 At risk (partial pass) | JSON shapes are well trimmed (< 6% waste), but there are no thumbnails at all, the parent job's rows are fetched and packed without being read, and link renewal re-downloads whole jobs | F-FLD-1, F-FLD-2, F-FLD-3, F-FLD-4, F-FLD-8 |
| R7 | A save is confirmed in one call | 🟠 At risk (partial pass) | Every push returns a status per change and the app confirms on it with no verify call; but video or a > 2.5 MB photo takes 5 calls, server-decided values are not echoed, and "mark all read" over 200 unread is undone by the response | F-API-11, F-API-12, F-API-13, F-API-14 |

Legend: 🔴 fails · 🟠 at risk · 🟢 passes · ⚪ could not verify. No requirement fully passes; none is "could not verify", but R2 rests entirely on inferred latency (see 2.3).

### 1.2 Top 5 problems

1. **Every serial database call costs ≈220 ms, so almost no endpoint can meet 1 s** (F-API-1, F-DB-2). The team's own comments record the 220 ms (`lib/server/snagging/sync-push.ts:241-243`, `push-plan.ts:7`), and the repo pins no function region (no `vercel.json`, no `preferredRegion`). The most likely cause is the function running in a different region from Supabase. INFERRED until the staging script reads `x-vercel-id`.
2. **Writes are N+1 on the server** (F-DB-3, F-API-2, F-API-3). A new defect costs 4–5 serial statements, and one of them reads every defect code on the job. A defect plus photo through `/sync/snag` is a 12–17 round-trip chain. A 100-change outbox is ≈1,050 database calls (≈19 s).
3. **The offline pack is unreliable** (F-OFF-1 Critical, F-OFF-2, F-OFF-3, F-OFF-4). A failed records download is swallowed (`src/sync/offlinePack.ts:278`) and the job is still marked ready (`:328-331`, verified in this audit). Starting an active job needs a pack made online. Photos that arrive later are never downloaded.
4. **Signed-link expiry drives whole-job re-downloads, and no thumbnails exist** (F-SYNC-1, F-API-5, F-API-6, F-FLD-1, F-FLD-2, F-FLD-3). Links are 1 h; the server hands them out with 30–60 min left; the phone refetches the whole job (and its parent) when one is within 10 min of expiry. So a de-snag round, visit or shared job is re-downloaded every 20–50 min while in use (0.6–1.5 MB each), and every 56 px tile decodes a full 1080 px photo.
5. **Sync can silently lose or drop data at the edges** (F-PAG-1, F-PAG-3, F-SQL-4, F-PAG-2). The `since` cursor is the app server's clock at request start with no overlap (`sync-pull.ts:116`, verified), so a row that commits late is never sent. OFFSET paging plus "a whole fetch is the full truth" can delete a live row on the phone. Writes made outside the phone's transaction queue can roll back with a failed sync transaction.

### 1.3 Top 5 quick wins (each S effort)

1. **Pin the API functions to the Supabase region** (F-API-1). One config change (`vercel.json` `"regions"` or `export const preferredRegion` on the sync routes). If the inference holds, it turns ≈220 ms per call into a few ms and brings most endpoints under 1 s with no code change.
2. **Stop the server re-touching rows it does not change.**
   - Submit should lock only unlocked defects. Add `.eq("locked", false)` at `sync-push.ts:1256` (verified: it currently re-locks every defect, so all of them re-download) (F-DB-7).
   - Make the area-status trigger update only when the status actually changes (F-DB-8).
3. **Fix three one-line correctness bugs:**
   - send `read_all: true` for "Mark all read" (F-API-13);
   - add `entity_type` to the defect-history audit lookup so it uses its index (F-DB-11);
   - filter the Realtime DELETE binding by `user_id` (F-SYNC-6).
4. **Never mark an offline pack ready after a failed download** (F-OFF-1). Check the result of `pullJob` and keep `pack_state='none'` with an error.
5. **Phone database v39 migration and two memo fixes:**
   - Drop 4 redundant indexes; a first job download went 331 → 144 ms in local runs (F-SQL-12).
   - Add the partial upload index and run `ANALYZE` (F-SQL-5).
   - Fix the duplicate checklist row (F-SQL-10).
   - Memoise the de-snag and checklist rows (F-RT-4, F-RT-5).

### 1.4 What is already good (verified)

- **Idempotent writes:** every change carries a `mutation_id`, the server records it in `snagging_sync_mutations`, and a retry returns `duplicate` instead of applying twice.
- **One-call defect saves:** `POST /sync/snag` saves a defect and its small photos in one request and returns the job-list changes in the same response. Storage uploads inside it run in parallel.
- **Done paging is a true keyset** on `(created_at, id)`, applied the same way on the server (`sync-pull.ts:666-676`) and in the phone's reconcile window (`pull.ts:367-387`).
- **Every server list that can pass 1,000 rows is paged** (`readAllRows`), and long id lists are split into groups of 150 (`readAllByIds`).
- **The phone never waits on the network to draw a screen.** Jobs paints from SQLite before the launch sync; captures are moved to `Documents/captures` before their row is written; reconciles never delete unsent work.
- **Phone single-row reads and saves are fast:** `getJob` 0.5–1.6 ms, `captureSnag` with its outbox write 3–5 ms median on a desktop (≈3–10× on a phone, still inside budget).
- **Floor-plan gestures run on the UI thread**, the jobs list is memoised and paged, and zustand selectors are single fields.

---

## 2. Scope, environment and method

### 2.1 What was measured vs analysed

| Area | Method | Confidence |
|---|---|---|
| Phone SQLite (R1, local R4) | `docs/audits/perf/scripts/sqlite-plans.mjs` builds a fresh database from the real 38 migrations (read out of `src/db/migrations.ts`, no hand-copied DDL), seeds one device at audit scale, and runs `EXPLAIN QUERY PLAN` plus timing (20 runs, 2 warm-ups) on ~40 statements copied from the code | **VERIFIED (measured)** on a desktop with Node 22.14 / SQLite 3.47.2. A mid-range phone is ≈3–10× slower. Re-run independently for this report (see 2.4) |
| Server SQL (R1, R2, R5) | Static reading of routes, helpers and migrations | Code paths **VERIFIED**; plans **INFERRED** (no safe database). Exact `EXPLAIN (ANALYZE, BUFFERS)` commands for staging are in Appendix B §5 |
| API latency (R2, R7) | Round-trip depth × the team's recorded ≈220 ms per call; payload sizes from wire shapes | **INFERRED**. A staging script is provided (Appendix C §6) |
| Offline (R3), fields (R6) | End-to-end code traces | **VERIFIED** for code paths; device behaviour needs the manual script in Appendix F |
| Pagination (R4), sync load (R5) | Code traces plus a load model from the timers | Paths **VERIFIED**; load numbers **INFERRED** with stated assumptions |
| Runtime (R1 render path, R5) | Code reading of components and stores | **VERIFIED** for code; timings **INFERRED** for a mid-range Android phone |

### 2.2 Environment and assumptions

- **No safe server environment exists.** The portal's dev server (`localhost:3032`) and every configured Supabase key point at the production project, which the rules forbid touching. Docker was not running, so the repo's local Supabase stack (`docs/LOCAL-SUPABASE.md`) could not be started. Even if it had been, it would not reproduce production indexes: the base `snagging_jobs` table, and the `job_id`-keyed child tables, are not created by any migration in the repo (verified; F-DB-1).
- **Scale (from the brief):** 200 inspectors; 5,000 active and 20,000 historical jobs; up to 60 rooms, 500 defects and 1,500 photos per job; 3,000+ alerts per user. Server-wide averages assume 150 defects per job, so ≈3.75 M defects and ≈11 M photo rows. One phone was seeded with 300 jobs (100 live), one big job (60 rooms / 500 defects / 1,500 photos / 120 checklist items), 100 more jobs with contents, 3,000 alerts, 2,000 unsent outbox rows (60 carrying a 50 KB signature) and a 3,000-defect catalogue.
- **Networks:** "3G" = 1 Mbps down / 0.5 Mbps up / 300 ms RTT; "4G" = 10 / 3 Mbps / 60 ms.
- **Latency model (INFERRED):** p50 ≈ serial critical-path depth × 220 ms; p95 ≈ (depth + 1 auth miss) × 300 ms; a cold instance adds 0.5–1 s.
- **Budget comment:** R2's "< 1 s for every API call" is realistic for reads and single saves once the function sits next to the database. For a 100-change outbox push it is not a sensible target even then. A better budget is "≤ 1 s for up to 20 changes, then linear at ≤ 30 ms per change", plus a progress indicator.

### 2.3 What could not be verified, and why

- **Real server latency and plans.** No staging environment. The 220 ms figure is the team's own past measurement; where it was taken from (a developer machine or the hosted function) is not recorded. Run `api-latency.mjs` against staging and read the `x-vercel-id` header to confirm or clear F-API-1.
- **Production indexes and triggers** on the out-of-band tables (F-DB-1). The catalog queries to run are in Appendix B §5.0.
- **On-device timings.** The SQLite numbers are a desktop lower bound; the runtime numbers are estimates. Use the device test plan in Section 7.
- **Two device behaviours** need a real phone: whether iOS plays pulled videos stored as `<id>.bin` (F-OFF-11), and whether signing out with no signal really clears the session.

### 2.4 Independent re-run of the phone benchmark

For this report the SQLite benchmark was run again on the same machine. That run was ≈1.5–2× slower than the investigator's runs (machine noise), with the same conclusions:

| Query (`file:line`) | Re-run median / p95 (ms) | Investigator median range (ms) | Verdict |
|---|---|---|---|
| Whole-job `listSnags`, 500 defects (`jobs.ts:809`) | 107.7 / 145.1 | 37–54 | Fails (≈320–1,000 ms on a phone) |
| `listSnags` per room (`jobs.ts:809`, `areaId`) | 1.3 / 2.3 | 0.3–0.8 | Passes, but nothing calls it |
| `listActiveJobs` (`jobs.ts:565`) | 32.8 / 153.3 | 11–14 | At risk |
| `listDoneJobs` after 10 scrolls (200 rows) | 83.1 / 107.3 | 24–32 | Fails (re-reads from the top) |
| `freeUpSpace` select (`freeSpace.ts:26`) | 129.4 / 225.7 | not headlined | Fails (blocking, see F-SQL-11) |
| `getJob` (`jobs.ts:601`) | 1.6 / 2.0 | 0.5 | Passes |
| `captureSnag` write incl. outbox | 5.4 / 8.8 | 3.0–5.2 | Passes |
| Whole-job pull-apply transaction | 237 total (144 apply + 50 reconcile) | 149–245 | Blocks the write queue |
| Checklist duplicate probe | 121 rows for 120 items | same | Bug confirmed (F-SQL-10) |

---

## 3. Handbook vs code discrepancies

The handbook (`Snagging App Handbook`, 1 Oct 2026) was used as a map. Where the code disagrees, the code wins:

| Handbook says | Code does | Evidence |
|---|---|---|
| "Done reads 20 at a time and fetches older pages 30 at a time" | The server half is right. The phone re-reads Done from the top with a growing `LIMIT` (20, 40, 60…) on every scroll, and re-reads the live list each time | F-SQL-6, F-PAG-7 |
| "Photo/plan links re-signed when < 10–15 min left" | Nothing re-signs a link. A link within 10 min of expiry makes the phone refetch the **whole job** (and its parent). Because the server hands out links with 30–60 min left, this happens every 20–50 min, not daily | F-SYNC-1, F-API-6, F-FLD-3 |
| "Whole-job refetch every 24 h" | Every 24 h **or** on link expiry, which in practice is far more often for jobs with server-held photos | F-SYNC-1 |
| "The delta pull relies on `updated_at`" | Partly. Photo deltas filter on `created_at` (marker edits never arrive), visits and checklist have no `updated_at` trigger, and the `snagging_jobs` trigger is not in the repo | F-PAG-2 |
| "Big lists are read in pages of 1,000" | True, but the paging is OFFSET (`.range()`), so a delete between pages skips a row, and the phone treats a whole fetch as the full truth | F-PAG-3 |
| Server cache "30 s per user" makes auth cheap | On the app's 5-minute cadence the per-instance cache almost always misses, so most requests pay one auth round trip; cold instances add feature probes | F-DB-12 |
| Tables are defined by the migrations | `snagging_jobs` and the `job_id`-keyed child tables are created outside the repo | F-DB-1 |
| `GET /sync/job/{id}` returns everyone's defects | Confirmed, by design (shown read-only). But it also returns the parent job's defects, photos and checklist, which no screen reads | F-FLD-4 |
| A code comment in `job/[id]/index.tsx:432-435` says "each sees only their own snags" | Stale; the server sends all snags on a shared job | Appendix E §3 |
| Alerts: "delta returns every change" | Correct, and unbounded. The phone gives that request 15 s, so after a 3,000-alert "mark all read" the catch-up can time out forever | F-PAG-4 |
| Today/Upcoming "draw 20 cards at a time from all live jobs" | Correct as written: every live job is read, then 20 drawn | F-SQL-7 |
| Outbox "100 per request" | Correct. The server accepts 500, but a 500-id duplicate check builds an ≈18.5 KB URL that the gateway likely rejects | F-API-15, F-SYNC-9 |

---

## 4. Findings by requirement

Each finding below uses the template from the brief (Severity, Requirement, Confidence, Where, What is wrong, Evidence, Impact, Fix, Effort/Risk, How to verify). They are grouped by the investigation that found them (4.1–4.6). This index maps them to requirements and marks where two findings share a root cause.

### 4.0 Index by requirement

| Req | Critical | High | Medium / Low (selection) |
|---|---|---|---|
| R1 | — | F-SQL-1, F-SQL-2, F-SQL-4, F-DB-1, F-RT-1, F-RT-2, F-RT-3, F-RT-4 | F-SQL-3, F-SQL-5, F-SQL-7, F-SQL-11, F-SQL-12, F-DB-5, F-DB-8, F-RT-5, F-RT-6, F-RT-7 |
| R2 | F-API-1 (= F-DB-2), F-API-2, F-API-3 (= F-DB-3), F-API-5 | F-API-6, F-API-7, F-API-8, F-DB-4, F-SYNC-1, F-SYNC-3 | F-API-4, F-API-9, F-API-10, F-API-15, F-API-16, F-API-17, F-API-18, F-DB-6, F-DB-15 |
| R3 | F-OFF-1 | F-OFF-2, F-OFF-3, F-OFF-4 | F-OFF-5, F-OFF-6, F-OFF-7, F-OFF-9, F-OFF-10, F-OFF-12, F-SYNC-8 |
| R4 | — | F-PAG-2 | F-PAG-1, F-PAG-3, F-PAG-4, F-PAG-6, F-PAG-7, F-SQL-6, F-SQL-10, F-SQL-14 |
| R5 | — | F-DB-3, F-SYNC-7, F-RT-8 | F-DB-9, F-DB-10, F-DB-11, F-DB-14, F-SYNC-2, F-SYNC-4, F-SYNC-5, F-SYNC-6, F-SYNC-9, F-SQL-8, F-SQL-9, F-RT-9, F-RT-15 |
| R6 | — | F-FLD-1, F-FLD-4 | F-FLD-2, F-FLD-3, F-FLD-5, F-FLD-6, F-FLD-7, F-FLD-8, F-DB-13 |
| R7 | — | F-API-11 | F-API-12, F-API-13, F-API-14, F-API-19 |

**Shared root causes** (fix once, several findings close):

| Root cause | Findings |
|---|---|
| Function and database not co-located (≈220 ms per call) | F-API-1, F-DB-2, and the latency in F-API-2/3/7/8/17, F-DB-6/15 |
| Per-change serial writes in push | F-API-3, F-DB-3, F-API-4, F-API-2 |
| Signed links in job payloads, renewed by whole refetch | F-SYNC-1, F-API-5, F-API-6, F-FLD-2, F-FLD-3 |
| No thumbnails | F-FLD-1, F-RT-6, F-RT-14 |
| `updated_at`/delta design (no overlap, no tombstones, OFFSET) | F-PAG-1, F-PAG-2, F-PAG-3, F-PAG-6 |
| One shared transaction queue on the phone | F-SQL-3, F-SQL-4, F-SQL-2 |
| Every pull tick re-reads and re-renders everything mounted | F-SQL-1, F-SQL-7, F-RT-2, F-RT-3, F-FLD-6 |

**Severity note.** Two investigators rated the region latency differently: Critical (F-API-1) and High (F-DB-2). This report treats it as **Critical but INFERRED**: it breaks R2 for every user today if the 220 ms holds in production, and it must be confirmed first (Section 7, step 1).

### 4.1 Phone SQLite (R1 device side, R4 local)

#### Method notes

Scope: the mobile app's local database (`yfi-mobile-app/YFI-MobileApp`, commit `04ce640`, expo-sqlite ~57.0.2, one connection opened in `src/db/client.ts:12`). Read-only audit. No source, migration or config file was changed. No network database was queried.

**How the numbers were made.** `docs/audits/perf/scripts/sqlite-plans.mjs` (in the portal repo) reads the real migration list out of `src/db/migrations.ts` by text: it cuts out the `migrations` array literal and evaluates it as plain JS, with no hand-copied DDL. It applies all 38 versions with the same PRAGMAs and one transaction per version, the way `migrate()` does. It then seeds one device at audit scale: 300 jobs (100 live, 200 finished), one open job with 60 rooms, 500 snags, 1,500 photos and 120 checklist items, 100 more jobs with contents, 3,000 alerts, 2,000 unsent outbox rows (60 of them submissions or sign-offs carrying a 50 KB base64 signature) plus 3,000 'done' rows waiting for the prune, and a 3,000-defect catalogue. Totals: 1,560 areas, 4,500 snags, 13,500 photos, 8,120 checklist rows.

The script runs `EXPLAIN QUERY PLAN` and times about 40 statements copied word for word from the code (median and p95 of 20 runs after 2 warm-ups). Every scenario gets its own freshly migrated and seeded DB. The whole script ran 5 times. Query figures below are the median of the per-run medians from runs 3 to 5. Transaction figures are the range across runs 3 to 7. Machine noise between runs was about ±30 %.

**VERIFIED means measured locally with node:sqlite** (SQLite 3.47.2, Node 22.14, desktop CPU, DB in the page cache). **That is a lower bound.** A mid-range Android phone is typically **3 to 10 times slower**, and expo-sqlite adds a JSI hop and builds a JS object for every row, which this harness does not pay. The budget column therefore applies ×3 and ×10.

Run it again with: `node docs/audits/perf/scripts/sqlite-plans.mjs --json out.json` (about 2 minutes, needs Node 22.5 or later).

Assumption: "local R4" here means how the on-device outbox and sync queue behave and stay correct at scale: enqueue, drain, retry, reconcile, and transaction isolation.

---

#### Summary verdict

**R1 (device side): AT RISK. Most reads pass. Three hot paths miss the 50 ms budget once the phone factor is applied, and user saves queue behind long sync transactions.**

- Single-entity reads have plenty of room even at ×10: getJob 0.5 ms, listAreas 0.8 ms, listChecklist 1.5 ms, checklistProgress 0.1 ms, listAlerts 1.1 ms, pendingMutations 0.5 ms, the enqueue merge lookup 0.01 ms (VERIFIED).
- **The whole-job snag read is the problem.** `listSnags({taskId})` returns 490 rows and runs 6 correlated photo subqueries per row. It takes 37 to 54 ms median on the desktop (p95 51 to 103 ms), roughly 110 to 540 ms on a phone. It runs on every focus of the inspect stack, on every pull that commits anything, and twice after every capture, edit, removal or photo add (`inspectionStore.ts:233, 337, 350, 363, 379, 430, 445, 629`; `inspect/_layout.tsx:23-26`; `verify/[snagId].tsx:103`) (VERIFIED).
- Single-row writes pass easily. captureSnag including the outbox insert and the count refresh takes 3.0 to 5.2 ms median (p95 4.4 to 8.3 ms); setChecklistStatus takes 1.2 to 2.1 ms. **But every save queues behind the serial `transaction()` chain** (`client.ts:74-87`). Sync holds that chain for 149 to 245 ms (whole-job pull-apply) and 103 to 251 ms (job-list reconcile), roughly 0.3 to 2.5 s on a phone, and the reconcile runs every 10 minutes and on every Done page (VERIFIED for SQL time; INFERRED for the phone factor).
- The job list reads every live job on every focus and every pull tick (11 to 14 ms desktop for 100 live jobs, so 33 to 140 ms on a phone). Done re-reads from the top with a growing LIMIT (24 to 32 ms at 200 jobs, against 3 ms for a keyset page). The handbook's line on Done is wrong (see F-SQL-6) (VERIFIED).
- JS thread: several loops make synchronous file-system calls without yielding: `freeUpSpace` (up to 2,506 files in the seed), `verifyPack` and `cacheSnagPhotos` (1,500 photos). These very likely block for well over 16 ms (INFERRED).

**R4 (local half): AT RISK. The outbox is well indexed and fast at 2,000 rows. Isolation and correctness gaps put data at risk.**

- `withTransactionAsync` is **not exclusive**, as expo-sqlite's own doc comment says (`node_modules/expo-sqlite/src/SQLiteDatabase.ts:120-140`). Writes made outside `transaction()` (attachPhoto, startArea, uploader state changes, outbox markDone/markRetry/markRejected, sign-out wipe) execute *inside* whatever pull transaction is open, and are rolled back with it if it fails (INFERRED, High).
- listChecklist returns a duplicate row when an item has both an 'error' and a 'queued' outbox row. The probe returned 121 rows for 120 items (VERIFIED).
- The retry and settle paths are row by row. Each row fires `notifyOutboxChanged` → `refreshCounts`, which runs 3 COUNT queries and a synchronous disk-space call, so a failed batch of 100 costs about 500 SQL calls (INFERRED from code; each call is cheap, VERIFIED).
- Planner statistics are undefined on fresh installs and frozen on upgraded devices. Under real statistics the Sync screen's `listUploads` switches to a full scan: 4.3 ms → 85 ms. A partial index plus a one-term rewrite brings it to 5.9 ms (VERIFIED).

---

#### Findings

##### F-SQL-1 · Whole-job `listSnags` (500 rows × 6 subqueries) re-read after every capture and on every pull tick
- Severity: High
- Requirement(s): R1
- Confidence: VERIFIED (SQL cost); INFERRED (phone factor)
- Where: `src/db/repositories/jobs.ts:809-838` (snags, snag_photos, inspection_areas, inspection_tasks). Callers: `src/features/inspection/inspectionStore.ts:231-235` (hydrate), `:337` and `:350` (after addSnag, and again in the send callback), `:363`, `:379-380`, `:430`, `:445`, `:629`; `app/(app)/job/[id]/inspect/_layout.tsx:23-26` (hydrate on focus **and on every `usePullTick`**); `app/(app)/job/[id]/inspect/verify/[snagId].tsx:102-108` (reads all 500 snags to show one, `rows.find(...)`); `desnag/index.tsx:325, 479, 562`.
- What is wrong: The area screen (`area/[areaId].tsx:91`) filters the store's whole-job list in JS. The per-area form of `listSnags` (`areaId`) exists but nothing calls it. Each snag row runs `photo_count`, `photo_count_this_round` (which joins `inspection_tasks` per photo) and four separate "first photo" probes, one for each of local_path, remote_path, kind and thumbnail_path. Any pull that commits rows, including another job's card delta, re-hydrates the open job (`pull.ts:166-174` → `usePullTick`).
- Evidence: Q6 = 490 rows, **37 to 54 ms median, p95 51 to 103 ms** (desktop). Breakdown (A2): base columns plus the area join 15 ms → +photo_count 25 ms → +this_round 35 ms; the four thumb probes make up the rest. The per-area read (Q7, 9 rows) takes 0.3 to 0.8 ms. Plan: `SEARCH s USING INDEX idx_snag_task_created` + 6 × `CORRELATED SCALAR SUBQUERY … idx_photo_snag_taken`.
- Impact: Every capture on a 500-snag job costs two whole-job reads after a 3 to 5 ms write, which is about 110 to 540 ms per read on a phone, and the same again on every pull tick while the inspect stack is mounted. It misses the 50 ms read budget even on the desktop at p95.
- Fix: (1) After `captureSnag`, `updateSnag` or `deleteSnag`, read only that snag (`listSnags` with `AND s.id = ?`) and patch the store; do not re-read the job. (2) Have the area screen call `listSnags({taskId, areaId})`. (3) Have `verify/[snagId]` read one snag by id. (4) Make `notifyPullApplied` pass the job ids it touched, and have `_layout.tsx` re-hydrate only when its own job is in that set. (5) Collapse the four thumb probes into one: `(SELECT json_array(p.local_path, p.remote_path, p.kind, p.thumbnail_path) FROM snag_photos p WHERE p.snag_id = s.id ORDER BY p.taken_at LIMIT 1) AS thumb`. Measured P6: 26 to 36 ms against 37 to 54 ms.
- Effort: M   Risk: Low
- How to verify the fix: `grep -n "listSnags({ taskId: jobId })" src/features/inspection/inspectionStore.ts` returns only `hydrate`. In the harness, the per-area and single-snag reads stay below 2 ms on the desktop. On a mid-range Android dev build, wrap `addSnag` with `performance.now()`: save to repaint p95 below 100 ms on the 500-snag fixture.

##### F-SQL-2 · Job-list reconcile scans every child table each time (`reconcileCards` orphan sweeps)
- Severity: High
- Requirement(s): R1, R4
- Confidence: VERIFIED
- Where: `src/sync/pull.ts:967-976` (snags, snag_photos, inspection_areas, job_checklist, floor_plans). Called from `runPull` with no cursor (`:300`), `runAuthoritative` (`:879`, every 10 min, `RECONCILE_WINDOW_MS` `:795`) and **every Done page** (`fetchDonePage` `:387`).
- What is wrong: After the card delete, the code always runs five sweeps of the form `WHERE task_id NOT IN (SELECT id FROM inspection_tasks)` across the whole of each child table, even when the delete removed nothing. Each sweep is one native call that cannot be interrupted, so every UI read and write waits behind it.
- Evidence: Whole transaction for 100 cards: **103 to 251 ms**, of which the task delete is **0.5 to 1.3 ms** and the orphan sweeps are **84 to 182 ms**. Plan for the photo sweep: `SEARCH snag_photos USING INDEX idx_photo_upload (upload_state=?)`, which visits all 12,000 uploaded photos. The area and checklist sweeps are full scans.
- Impact: About 0.3 to 1.8 s on a phone, every 10 minutes while screens read, and on every Done page an inspector scrolls to. Captures and checklist answers wait behind it.
- Fix: Sweep only what the delete removed, and skip the sweep when nothing was removed:
  ```sql
  CREATE TEMP TABLE IF NOT EXISTS _gone (id TEXT PRIMARY KEY);
  DELETE FROM _gone;
  INSERT INTO _gone SELECT id FROM inspection_tasks WHERE <where> AND id NOT IN (SELECT id FROM _card_keep) AND <TASK_NOTHING_PENDING>;
  -- if changes() = 0: stop here
  DELETE FROM inspection_tasks WHERE id IN (SELECT id FROM _gone);
  DELETE FROM snags WHERE task_id IN (SELECT id FROM _gone) AND sync_state = 'synced' AND <unsent('snag')>;  -- idx_snag_task_created
  -- likewise snag_photos (idx_photo_task_upload), inspection_areas (idx_area_task), job_checklist, floor_plans
  ```
  A full orphan sweep is still worth running once a day, in the background, outside the user's path.
- Effort: S   Risk: Low
- How to verify the fix: Harness `cards snapshot + reconcileCards`: reconcile below 5 ms when no card is removed (currently 84 to 182 ms).

##### F-SQL-3 · Whole-job pull-apply holds the single write queue for 150 to 250 ms (desktop)
- Severity: Medium
- Requirement(s): R1, R4
- Confidence: VERIFIED (SQL); INFERRED (JS-side mapping cost)
- Where: `src/sync/pull.ts:486-532` (`applyJobPayload` inside one `transaction()`), `:1335-1357`, `:1071-1146`; queue in `src/db/client.ts:74-87`.
- What is wrong: The whole job (rooms, snags, photos, checklist, plans, reconcile) is applied in one transaction: 111 statements and 2,183 rows. Every `transaction()` caller (captureSnag, setChecklistStatus, confirmArea…) waits for the end of it. A whole fetch happens on first open, daily, on "Download for offline", and **whenever any photo link is less than 10 minutes from expiry** (`pull.ts:451, 468-483`). Signed links last about an hour, so a job showing remote photos is fetched whole roughly once an hour while it is open. Building the 1,500-row parameter arrays (`photos.map` + `chooseLink` → URL expiry parsing, `pull.ts:1950-1970`) is one synchronous block on the JS thread.
- Evidence: Pull-apply of the big job: **149 to 245 ms** (apply 99 to 192 ms, reconcile 42 to 70 ms). The reconcile statements use `task_id` indexes (`SEARCH snag_photos USING INDEX idx_photo_task_upload (task_id=? AND upload_state=?)`), which is good.
- Impact: About 0.5 to 2.5 s on a phone during which a capture "Save" does not resolve.
- Fix: Apply in chunks of 1 table or 300 rows per `transaction()`, yielding to the queue between chunks. Write `markChildrenLoaded` (the cursor) only in the last chunk, so a crash re-fetches and nothing is lost. Give UI writes a priority lane: two promise chains, with sync chunks taking a turn only when the UI chain is idle. For link expiry, re-sign links on their own (`/sync/job/[id]?view=links`) instead of forcing a whole fetch.
- Effort: M   Risk: Med
- How to verify the fix: Harness, with a captureSnag issued mid-apply: wait under 50 ms on the desktop. On a device, log a timestamp around `transaction()` enqueue and run: queue wait p95 below 100 ms while a whole fetch runs.

##### F-SQL-4 · Non-exclusive transactions: writes made outside `transaction()` join, and roll back with, an open pull transaction
- Severity: High
- Requirement(s): R4
- Confidence: INFERRED (documented library behaviour plus code reading; needs a failing pull to show)
- Where: `src/db/client.ts:76-87` uses `withTransactionAsync`; `node_modules/expo-sqlite/src/SQLiteDatabase.ts:120-140` ("any queries that run while the transaction is active will be included in the transaction", recommends `withExclusiveTransactionAsync`). Un-wrapped writers: `jobs.ts:1522` (attachPhoto INSERT), `jobs.ts:1840-1852` (startArea UPDATE + enqueue; not atomic either), `uploader.ts:175, 241, 269, 287`, `sendWithMedia.ts:160, 186, 193, 267, 336`, `outbox.ts:209, 227, 249, 287, 292, 309, 316`, `push.ts:159, 186, 209`, `alerts.ts:297, 307, 356, 368, 471`, `offlinePack.ts:150, 328`, `floorPlanCache.ts:110`, `authStore.ts:256-262` (sign-out wipe: 7 DELETEs, not atomic).
- What is wrong: The `transaction()` queue serialises only its own callers. Any `rawDb.runAsync` issued while a pull's BEGIN is open runs inside that transaction. If the pull then throws, for example from a reconcile statement, an `insertMany` with no `onRowError` (the `_auth_keep` and `_card_keep` inserts), or a JS exception while mapping rows, the ROLLBACK also undoes those writes. The opposite also happens: UI reads see half-applied pull state.
- Evidence: `client.ts:79` `await sqlite.withTransactionAsync(...)`. `attachPhoto` is called in a loop right after `captureSnag` (`inspectionStore.ts:314-335`), while sync may be applying.
- Impact: Worst case is a photo whose file was persisted (`persistCapture`) but whose row is rolled back, which is evidence lost without any error shown. Outbox markDone can also roll back, which re-sends mutations (idempotent, so wasted work rather than damage).
- Fix: Send every write through the queue: add `write(sql, params)` → `transaction(() => rawDb.runAsync(...))`, or simply wrap `attachPhoto`, `startArea` (UPDATE and enqueue in one transaction), the uploader, outbox and alerts writers, and the sign-out wipe in `transaction()`. If the apply moves to `withExclusiveTransactionAsync(txn => …)`, *every* other write must be queued first, because the doc says outside writes then fail with `database is locked`.
- Effort: M   Risk: Med
- How to verify the fix: Lint rule or grep: no `rawDb.runAsync|execAsync` outside `transaction(` in `src/` (allow-list for migrations). Unit test with a fake db: start an apply that throws after the first statement, call `attachPhoto` meanwhile, and assert the photo row exists.

##### F-SQL-5 · Planner statistics: none on fresh installs, frozen on upgraded devices; Sync screen flips to a full scan under real stats
- Severity: Medium
- Requirement(s): R1
- Confidence: VERIFIED
- Where: `src/db/migrations.ts:751-759` (v29 runs `ANALYZE` once); no `ANALYZE` or `PRAGMA optimize` anywhere else. Queries: `src/db/repositories/syncQueue.ts:39-58` (listUploads), `:81-85` (uploadSummary); also `uploader.ts:213-220, 423-428`, `sendWithMedia.ts:113-126`, `sync.tsx:479`.
- What is wrong: On a fresh install v29's `ANALYZE` runs on empty tables and writes **0** `sqlite_stat1` rows (measured). Devices that upgraded through v29 keep whatever statistics existed that day. With real statistics, `upload_state` looks unselective (3 values over 13,500 rows, so about 4,500 per value on average, while in reality about 90 % are 'uploaded'), so the planner scans all photos in `snag_id` order to avoid a GROUP BY sort.
- Evidence: Q14 listUploads: no stats `SEARCH p USING INDEX idx_photo_upload` **4.3 ms** → with stats `SCAN p USING INDEX idx_photo_snag` **85 ms** (×20). Q14b uploadSummary 1.1 → 43 ms. Fix measured (D2): 5.9 ms and 0.67 ms, plan `SCAN p USING INDEX idx_photo_unsent_snag` over only the unsent rows.
- Impact: The Sync screen and the pill counts take about 250 to 850 ms on a phone for affected devices. The same code behaves differently from one device to another.
- Fix:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_photo_unsent_snag  ON snag_photos (snag_id, upload_state) WHERE upload_state <> 'uploaded';
  CREATE INDEX IF NOT EXISTS idx_photo_unsent_taken ON snag_photos (taken_at)             WHERE upload_state <> 'uploaded';
  ```
  Add the literal term `upload_state <> 'uploaded'` to every "not yet uploaded" query (SQLite only uses a partial index when its WHERE term appears in the query): listUploads, uploadSummary, uploadCounts (replace the IN list), uploadPending and choosePhotos (`AND upload_state <> 'uploaded' AND upload_state IN ('pending','error')`), readFailedPhotos. Then run `PRAGMA analysis_limit=400; PRAGMA optimize;` after the sync pass at most once a day, and in the migration that adds the indexes.
- Effort: S   Risk: Low
- How to verify the fix: Harness states B and C: P14 below 10 ms and P14b below 2 ms with stats present, and the plan names `idx_photo_unsent_*`.

##### F-SQL-6 · Done list re-reads from the top with a growing LIMIT; each scroll also re-reads the live list (handbook claim wrong)
- Severity: Medium
- Requirement(s): R1
- Confidence: VERIFIED
- Where: `src/db/repositories/jobs.ts:575-580`, `app/(app)/(tabs)/jobs/index.tsx:128-161` (`load` depends on `doneLimit`), `:240-255` (`setDoneLimit(limit + JOBS_PAGE)`), `src/sync/pull.ts:315` (`DONE_PAGE = 30`).
- What is wrong: The handbook says *"Done reads 20 at a time"*. In fact page k reads **k×20 jobs from the start** (`LIMIT limit+1`), so reading is cumulative, O(n²) over a scroll. The page unit is jobs, not cards, and one job can produce several Done cards (`DONE_CARDS_SQL`), so a page draws 20 or more cards. Because `load` is rebuilt whenever `doneLimit` changes, every Done scroll also re-runs `listActiveJobs()` (which starts `refreshFromServer`) and `countDoneCards()`. *"Fetches older pages 30 at a time"* is correct (server keyset on `(created_at, id)`), but each server page grows the local window by only 20 (`jobs/index.tsx:249`).
- Evidence: Q2 listDoneJobs(20) 4.5 to 4.9 ms; Q2b listDoneJobs(200) **24 to 32 ms**; proposed keyset page (P2) **2.8 to 3.3 ms**.
- Impact: Scrolling to page 10 of Done costs about 30 ms + 12 ms + 2 ms per page on the desktop, roughly 130 to 450 ms on a phone, growing with each page.
- Fix: Keyset on the existing sort order, appending pages:
  ```sql
  -- inside jobListSql's `keys` CTE, for the next page after the last card shown (k, code, id):
  AND (COALESCE(t.created_at, t.scheduled_date) < :k
       OR (COALESCE(t.created_at, t.scheduled_date) = :k AND (t.code > :code OR (t.code = :code AND t.id > :id))))
  ... LIMIT 21
  ```
  Split `load` so that Done paging does not re-read the active list and the count. Grow the local window by the number of jobs the server page brought.
- Effort: M   Risk: Low
- How to verify the fix: Harness P2 below 5 ms for any page. React Profiler: one SQL read per Done page and no `listActiveJobs` call on scroll.

##### F-SQL-7 · `listActiveJobs` reads every live job on every focus and every pull tick
- Severity: Medium
- Requirement(s): R1
- Confidence: VERIFIED (SQL); INFERRED (phone)
- Where: `src/db/repositories/jobs.ts:562-567`, `:471-525`; `app/(app)/(tabs)/jobs/index.tsx:128-161, 197-200, 226-231`; `app/(app)/(tabs)/notifications/index.tsx:85` (derived alerts).
- What is wrong: There is no LIMIT. All live jobs are read and turned into cards, and JS then slices 20 for drawing. The read repeats on every focus, on every `onPullApplied` from any job, and on every Done scroll (F-SQL-6). The `keys` CTE does `SCAN t` with a temp B-tree for `ORDER BY COALESCE(created_at, scheduled_date)`, followed by 3 grouped child aggregates and 4 `json_extract` calls per row.
- Evidence: Q1 = 100 rows, **11 to 14 ms median, p95 18 to 19 ms** (desktop). The `toListJob` signature cache (`jobs.ts:537-556`) avoids re-parsing; that is good.
- Impact: About 33 to 140 ms on a phone per focus or tick at 100 live jobs, and more for a lead with a larger live list.
- Fix: On a pull tick, re-read only the job ids the pull touched (`jobListSql("t.id IN (…)")`) and merge them into the state. Keep the full read for focus only. Optionally add a stored `sort_key` column, `CREATE INDEX idx_task_sort ON inspection_tasks (sort_key DESC, code, id)`, maintained in the upsert.
- Effort: M   Risk: Low
- How to verify the fix: Count `listActiveJobs` calls per pull tick (should be 0) and time the incremental read (below 2 ms in the harness for 5 ids).

##### F-SQL-8 · Outbox retry and settle are row by row, and each row triggers a full count refresh
- Severity: Medium
- Requirement(s): R4
- Confidence: INFERRED (call counts from code); per-call cost VERIFIED
- Where: `src/sync/push.ts:105-107, 143, 147, 155-164, 208-213`; `src/sync/sendWithMedia.ts:331-333`; `src/sync/outbox.ts:235-256` (markRetry = SELECT + UPDATE + `notifyOutboxChanged`); `src/sync/engine.ts:331-333` → `refreshCounts` `:109-139` (3 COUNTs + `Paths.availableDiskSpace`, a synchronous native call).
- What is wrong: A retryable server failure on a 100-row batch calls `markRetry` 100 times. That is 200 statements, plus 100 `refreshCounts`, which is 300 more queries and 100 synchronous disk-space calls on the JS thread. `settlePush` does the same for each rejection and each server-renumbered snag.
- Evidence: getPendingCount 0.1 ms, erroredCount about 0.1 ms, uploadCounts 0.37 ms (desktop). The cost is the number of bridge hops, about 500, not any single query.
- Impact: About 0.1 to 0.5 s of bridge traffic and re-renders per failed push. It is repeated every 5 minutes on a flaky connection with up to 2,000 rows queued.
- Fix: One statement per batch: `UPDATE outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE mutation_id IN (…)`. Compute one shared next time from the max attempts, or use `CASE attempts WHEN 0 THEN ? WHEN 1 THEN ? … END`. Also batch `markRejected` and the snag `sync_state` updates. Debounce `refreshCounts` (150 to 250 ms trailing) in `subscribeOutbox`.
- Effort: S   Risk: Low
- How to verify the fix: Unit test with a counting fake db: a failed 100-row push issues 5 statements or fewer and refreshes counts once.

##### F-SQL-9 · `storeAlerts` upserts row by row (one bridge hop per alert)
- Severity: Medium
- Requirement(s): R1, R4
- Confidence: VERIFIED (SQL); INFERRED (bridge cost)
- Where: `src/sync/alerts.ts:209-237`; trim `:307-311`.
- What is wrong: A catch-up delta after a long offline stretch is written with one `runAsync` per alert inside one queued transaction. The SQL is cheap; on a device each statement is a separate async JSI round trip.
- Evidence: 3,000 alerts: **30 to 78 ms** in SQL alone (desktop); 200 alerts: 1.9 to 5 ms. The trim from 3,000 to 200 takes 12 to 27 ms (plan `SCAN alerts` + `alerts_created_idx`).
- Impact: About 3,000 hops, 0.6 to 3 s on a phone, holding the write queue.
- Fix: Reuse `insertMany` from `pull.ts:1007` (9 columns → 100 rows per statement → 30 statements) with the same ON CONFLICT clause. Ask the server for at most `KEEP` (200) on a catch-up.
- Effort: S   Risk: Low
- How to verify the fix: Counting fake db: 3,000 alerts give 30 statements or fewer. Harness time below 15 ms on the desktop.

##### F-SQL-10 · `listChecklist` returns duplicate items (LEFT JOIN onto several outbox rows)
- Severity: Medium
- Requirement(s): R4 (correctness), R1
- Confidence: VERIFIED
- Where: `src/db/repositories/checklist.ts:115-127`; enqueue merge rule `src/sync/outbox.ts:110-133` (only `queued` updates are folded).
- What is wrong: An answer the server refused stays in `state='error'`. Re-answering it adds a new `queued` row. The join matches both rows, so the item is listed twice, with duplicate React keys and two different badges.
- Evidence: Harness probe: 120 items → **121 rows, 1 duplicate**.
- Fix:
  ```sql
  SELECT c.…,
         (SELECT CASE WHEN SUM(o.state = 'error') > 0 THEN 'error' ELSE 'queued' END
            FROM outbox o WHERE o.entity = 'checklist' AND o.entity_id = c.id AND o.state IN ('queued','error')) AS queue_state,
         (SELECT o.last_error FROM outbox o WHERE o.entity = 'checklist' AND o.entity_id = c.id AND o.state = 'error'
           ORDER BY o.seq DESC LIMIT 1) AS queue_error
    FROM job_checklist c WHERE c.task_id = ? ORDER BY c.created_at, c.sort_order, c.id
  ```
  (Both subqueries use `idx_outbox_entity`.)
- Effort: S   Risk: Low
- How to verify the fix: Harness probe reports `duplicate rows=0`.

##### F-SQL-11 · Synchronous file-system loops on the JS thread (free-up-space, offline pack verify)
- Severity: Medium
- Requirement(s): R1
- Confidence: INFERRED (file-system cost cannot be measured off-device); row counts VERIFIED
- Where: `src/sync/freeSpace.ts:65-84` (`new File(path).exists/size/delete` per file, no yield) after the query at `:20-32`; `src/sync/offlinePack.ts:111-123` (`onDisk`), `:194-206`, `:237-240` (`photos.filter(!onDisk)` over every family photo in one block).
- What is wrong: These are synchronous JSI file calls in tight loops. In the seed, freeUpSpace selects **2,506** rows (2 files each) and verifyPack checks **1,500** photos. The freeUpSpace query also takes 65 to 81 ms on the desktop, because its plan walks all 12,000 'uploaded' photos via `idx_photo_upload`.
- Impact: Very likely a freeze of hundreds of ms to seconds on "Free up space" and at the end of "Download for offline", far beyond 16 ms per frame.
- Fix: Process in chunks of 50, with `await new Promise(r => setTimeout(r, 0))` between chunks, or use async file APIs. In `verifyPack`, trust the `local_path` and `bytes` just written by `fetchPhoto` and check only rows that were not fetched in this run. Drive freeUpSpace from jobs: `… FROM snag_photos p WHERE p.task_id IN (SELECT id FROM inspection_tasks WHERE status IN ('submitted','in_review','approved','delivered')) AND p.upload_state = 'uploaded' …` (uses `idx_photo_task_upload`).
- Effort: S   Risk: Low
- How to verify the fix: Hermes profiler or `PerformanceObserver` long-task log during "Free up space" on the seeded device: no task above 50 ms.

##### F-SQL-12 · Four redundant indexes double the cost of downloading a job
- Severity: Medium
- Requirement(s): R1, R4
- Confidence: VERIFIED
- Where: `src/db/migrations.ts:98-100, 118` (`idx_snag_task`, `idx_snag_area`, `idx_snag_sync`, `idx_photo_snag`) against `:753-755` (`idx_photo_snag_taken`, `idx_snag_task_created`, `idx_snag_area_status`, which already start with the same leading column).
- What is wrong: Each snag insert maintains 6 B-trees and each photo insert 5. `idx_snag_sync` is chosen by no hot query once statistics exist; the other three are prefixes of newer indexes.
- Evidence: First download of the big job (2,183 rows into empty child tables), 8 interleaved pairs: **shipped 331 ms median vs proposed 144 ms**, faster in 8 of 8 pairs. The proposed schema is the 4 drops plus the 2 partial photo indexes and 2 partial alert indexes from F-SQL-5 and Appendix B. With the F-SQL-5 query rewrites, no measured read got slower. Without them, Q14 and Q14b behave as in state B, because of the statistics rather than the drops.
- Fix: `DROP INDEX IF EXISTS idx_snag_task; DROP INDEX IF EXISTS idx_snag_area; DROP INDEX IF EXISTS idx_photo_snag; DROP INDEX IF EXISTS idx_snag_sync;` in a new migration (v39), together with F-SQL-5's indexes and `PRAGMA optimize`.
- Effort: S   Risk: Low
- How to verify the fix: Harness line "first download … shipped vs proposed"; all Q-rows in state D2 (rewritten SQL on the proposed schema) no slower than A.

##### F-SQL-13 · Large signature payloads in the outbox are re-parsed with `json_extract` on every card or detail apply
- Severity: Low
- Requirement(s): R4
- Confidence: VERIFIED
- Where: `src/sync/pull.ts:1422-1434` (`loadUnsentTasks`, called from `applyCards`, `applyTaskDetail` and `applyTasks`), `:1603-1609` (EXISTS over signoff payloads per detail apply); payloads written at `jobs.ts:354-364, 1915-1929` (`signature_png`).
- What is wrong: The job id lives only inside `payload_json`, so SQLite parses each unsent 50 KB submission or sign-off JSON every time. `pendingMutations` also carries these strings across the bridge, and `JSON.parse` runs on the JS thread.
- Evidence: Q21 with 60 × 50 KB payloads: **3.5 to 6 ms median, p95 up to 9.6 ms** (desktop); plan `SEARCH outbox USING INDEX idx_outbox_entity (entity=?)` then `json_extract` on each row.
- Fix: v39: `ALTER TABLE outbox ADD COLUMN task_id TEXT; UPDATE outbox SET task_id = json_extract(payload_json,'$.task_id') WHERE state IN ('queued','error'); CREATE INDEX idx_outbox_task ON outbox (entity, task_id) WHERE state IN ('queued','error');` Set it in `enqueue`. Store the signature as a file path, as is already done for photos, and read it only when sending.
- Effort: M   Risk: Low
- How to verify the fix: Harness Q21 below 0.5 ms; plan uses `idx_outbox_task`.

##### F-SQL-14 · Room and checklist ordering: a new custom room sorts first; no unique tiebreaker
- Severity: Low
- Requirement(s): R1 (list stability)
- Confidence: VERIFIED (code + SQLite NULL ordering)
- Where: `src/db/repositories/jobs.ts:1682-1684` (addArea INSERT omits `created_at`) against `:664` `ORDER BY a.created_at ASC, a.sort_order ASC`; `checklist.ts:126`.
- What is wrong: SQLite sorts NULL first under ASC, so a room added on site is listed **above** the office's rooms until a pull backfills `created_at`, even though `sort_order` was set to "after the existing rooms" (`jobs.ts:1666-1671`). Neither query has a unique last key.
- Fix: `created_at = new Date().toISOString()` in addArea, and `ORDER BY a.created_at, a.sort_order, a.id` (likewise `c.id` for the checklist).
- Effort: S   Risk: Low
- How to verify the fix: Add a room offline; it appears last.

##### F-SQL-15 · Dead repository that reads dropped tables
- Severity: Low
- Requirement(s): R1 (risk only)
- Confidence: VERIFIED
- Where: `src/db/repositories/catalogue.ts:43-53` (joins `catalogue_area_elements`, dropped in v18, `migrations.ts:565`) and the whole file reads `catalogue_entries`, emptied in v18. Nothing imports it (grep).
- Fix: Delete `src/db/repositories/catalogue.ts`.
- Effort: S   Risk: Low
- How to verify the fix: `grep -rn "repositories/catalogue'" src app` returns nothing and `tsc` stays green.

##### F-SQL-16 · Launch: session wait is serial after migrations; launch-time prune and alert count compete with first paint
- Severity: Low
- Requirement(s): R1
- Confidence: VERIFIED (code); timings INFERRED
- Where: `app/_layout.tsx:56-59` (`initDatabase().then(bootstrap)`), `src/features/auth/authStore.ts:79, 92-104` (1.5 s cap), `src/sync/engine.ts:359-361` (`startAlerts` → 2 meta reads + unread COUNT; `pruneDoneSoon` → DELETE), `:384-416`.
- What is wrong: The session lookup does not need migrations, yet it starts only after them. The splash therefore lasts migrate time + up to 1.5 s. The outbox prune (19 to 76 ms for 3,000 rows on the desktop) and the alerts reads run on the one connection at the same moment as the Jobs screen's first `listActiveJobs` and `countDoneCards`.
- Fix: Start `launchSession()` in parallel with `migrate()` and call `startSyncEngine()` only after both finish. Delay `pruneDoneSoon()` until after first paint (`InteractionManager.runAfterInteractions` or a 30 s timer).
- Effort: S   Risk: Low
- How to verify the fix: Cold start trace: splash end ≈ max(migrate, session) rather than their sum. No DELETE on outbox before the first Jobs paint.

---

### 4.2 Server database (R1 server side, R2, R5)

#### Method notes

Phase 2, server half of R1 (sync read path: job list, job open, catalogue, alerts), R2 (capture and push write path) and R5 (behaviour at 200 inspectors and growth over time).

**Method and limits.** This is a read-only audit. I edited nothing and ran no query against any database, EXPLAIN included. The only reachable project is production. Docker was off, so there was no local Postgres either. Every plan below is **INFERRED** from the migrations and the code. Section 5 gives the exact `EXPLAIN (ANALYZE, BUFFERS)` commands to run on **staging**. Labels:
- **VERIFIED**: I read it in this repo, with file:line.
- **INFERRED**: deduced, with the reasoning shown.

**Scale assumptions** (used for every number below):

| Quantity | Value | Basis |
|---|---|---|
| Jobs | 25,000 (5,000 active + 20,000 historical); assume ~25,000 created per year | brief |
| Inspectors | 200, so ~25 active and ~100–125 total ("history H") jobs each | brief |
| Rooms per job | avg 30, max 60 | brief max; avg assumed |
| Snags per job | avg 150, max 500, so ~3.75 M snags | brief max; avg assumed |
| Photos | 3 per snag, so avg 450 and max 1,500 per job, **~11.25 M photo rows** (25,000 × 150 × 3). The 37 M worst case (every job at 500 snags) is not realistic. | brief |
| Checklist rows per job | ~80 | assumed |
| Alerts | 3,000+ per user, so ~600 k rows | brief |
| Round-trip time (RTT) | **~220 ms per PostgREST round trip**, as measured by the team (`lib/server/snagging/push-plan.ts:5-8`, `lib/server/snagging/sync-push.ts:242-245`). `lib/server/snagging/audit.ts:45-46` calls one round trip "the better part of a second". | team's own measurement |
| App cadence | a silent sync pass every 5 min; full active list every 10 min; send on save after 600 ms | `snagging-app-handbook.html` (scratchpad) |

---

#### Summary verdict

##### Server side of R1 (read path): **Amber. Correct and complete, but latency-bound, and the base schema is unverifiable from the repo.**

- **Good:** The per-screen endpoints the current app uses (`/sync/jobs`, `/sync/job/[id]?view=detail`, `/sync/catalogue`, `/sync/alerts`) are bounded and paged. Their roots run in parallel. At 200 inspectors on a 5-minute cadence the steady load is about 0.7 req/s, which is trivial for Postgres.
- **Bad: serial round trips.** The cost is the number of serial round trips multiplied by ~220 ms:
  - job list: 4–6 serial round trips (~1.1 s);
  - job open with contents: 5–6 (~1.2 s);
  - the extra delta that `/sync/snag` runs after every save: 5–6.
- **The ~220 ms is most likely a region mismatch.** No `preferredRegion` or `vercel.json` region exists in the repo (F-DB-2). Fixing it is the single biggest lever and needs no SQL change.
- **The base tables are not in the repo.** `snagging_jobs`, and the "lean" `snagging_areas`, `snagging_snags` and `snagging_snag_photos` (all keyed on `job_id`), were created out of band. So the indexes every hot query and trigger depends on cannot be confirmed (F-DB-1). The worst case is a missing `snagging_snags(area_id)` index: then every snag write sequentially scans ~3.75 M rows inside a trigger.
- **The legacy `/sync/pull` and the scoped snapshot do not scale:**
  - unchunked `IN` lists;
  - serial OFFSET paging that is O(N²/1000);
  - unbounded signing fan-out (N/100 parallel Storage calls);
  - responses estimated at 7–30 MB (F-DB-4).

##### Contribution to R2 (write path)
- **Push is N+1 per mutation** (F-DB-3):
  - a new snag costs 4–5 serial statements. Three are primary-key reads of the same row, and one reads **every snag code on the job**.
  - each photo re-reads its snag's author;
  - each de-snag verdict costs 5 serial statements, and 2 of them are identical for every verdict in the push.
  - An outbox of 100 snags, 300 photos, 30 room updates and a submission is ~1,050 PostgREST calls and ~88 serial round trips: **~19 s at 220 ms**. Batched, it would be about 50 calls and 10 round trips.
- **Submit re-locks and touches every snag on the job**, including ones already locked (F-DB-7). The area-status trigger does an unconditional extra UPDATE on every snag write (F-DB-8).
- `/sync/snag` adds the duplicate `mayWriteJob` checks and a serial list delta to every save (F-DB-15).

##### Contribution to R5 (scale and growth)
- **Nothing is ever pruned** (F-DB-10):
  - `snagging_sync_mutations` grows by ~20 M rows a year and carries 2 indexes no code reads;
  - storage orphans build up through 4 paths;
  - `snagging_notifications` is never cleaned;
  - `snagging_audit_events` cannot be pruned at all, because a rule discards DELETE.
- **Realtime publishes UPDATEs** on `snagging_notifications`, so "mark all read" on 3,000 alerts emits 3,000 change events (F-DB-9).
- **Composite `(job_id, updated_at)` indexes are missing** for delta filters (F-DB-5).
- **The defect-history audit lookup cannot use its index**; a one-line code fix solves it (F-DB-11).
- **Auth adds 1 DB round trip on most requests:** the 30 s per-instance cache almost always misses on a 5-minute cadence. Cold instances add 1–4 serial probe round trips for migrations that have all been applied (F-DB-12).

---

#### Findings

##### F-DB-1 · Base snagging tables (and their indexes) are not in the repo
- Severity: **High.** It becomes **Critical** if the staging check shows `snagging_snags(area_id)` or `snagging_snag_photos(job_id)` missing.
- Requirement(s): R1/R2/R5
- Confidence: VERIFIED that the DDL is absent; INFERRED what production holds.
- Where:
  - No `CREATE TABLE … snagging_jobs` exists anywhere under `supabase/`. The first reference is an `ALTER`: `supabase/migrations/20260821090000_snagging_property_model.sql:11`.
  - `20260821160000_snagging_audit_restore.sql:9-10` says: "the snagging_tasks -> snagging_jobs rename happened out of band".
  - `20260904100000_restore_area_status_trigger.sql:5-7` says the area trigger "was lost when that table became `snagging_jobs` out of band". A trigger is lost only when its table is recreated, so the child tables were rebuilt too.
  - The code relies on a constraint named `snag_snags_code_unique` (`lib/server/snagging/sync-push.ts:606`). The repo only defines `snagging_snags_code_unique UNIQUE (property_id, snag_code)` on the old table (`20260817090000_create_snagging_module.sql:431`).
- What is wrong:
  - The tables the mobile sync reads hardest (`snagging_jobs`, and `snagging_areas`, `snagging_snags`, `snagging_snag_photos` keyed by `job_id`) were created outside migrations.
  - The 0817 indexes (`idx_snagging_snags_area`, `idx_snagging_snag_photos_task`, `idx_snagging_areas_task`) were on the old `task_id`/`origin_task_id` tables. They cannot be assumed to exist.
  - The index review that follows is therefore a list of requirements, not a confirmed inventory. The team's own previous audit says the same: "The live schema, not the migrations folder, is the source of truth" (`AUDIT_SCALABILITY.md:419-420`).
  - Staging can be rebuilt from migrations only if someone dumps the lean DDL.
- Evidence: the area trigger runs per row on every snag insert, and on every UPDATE of `status` or `area_id`:
  ```sql
  select count(*) into v_count from public.snagging_snags
   where area_id = v_area_id and status <> 'withdrawn';     -- 20260904100000:34-37
  ```
- Impact: without an `area_id` index, each snag insert sequentially scans ~3.75 M rows, roughly 300–600 ms of I/O. A 100-snag push would spend ~40 s in triggers alone. Without `snagging_snag_photos(job_id)`, every photo read sequentially scans ~11 M rows.
- Fix:
  1. On staging, run the catalog queries in §5.0.
  2. Run `supabase db dump --schema public` and commit the lean DDL as a baseline migration (for example `20260820000000_lean_baseline.sql`, idempotent with `if not exists`).
  3. Apply the §4 index set.
- Effort: S (dump) + S (indexes)   Risk: Low
- How to verify: §5.0 lists an index whose leading column is `area_id` on `snagging_snags`, and one whose leading column is `job_id` on snags, photos and areas. Q12 shows `Index Only Scan` or `Index Scan` at under 1 ms with `Buffers: shared hit` < 20.

##### F-DB-2 · ~220 ms per database round trip, multiplied by every serial await (likely a region mismatch)
- Severity: High
- Requirement(s): R1/R2/R5
- Confidence: VERIFIED that the team measured it and that no region is configured; INFERRED cause.
- Where:
  - `lib/server/snagging/push-plan.ts:5-8` and `sync-push.ts:242-245` record "~220ms per round trip".
  - `lib/server/snagging/audit.ts:45-46` says one round trip "costs the better part of a second".
  - Grep finds no `preferredRegion` or `regions`, and there is no `vercel.json` (repo root and `app/**`).
- What is wrong:
  - Every chain below is serial: auth, then membership, then visits, then jobs, then counts.
  - A same-region PostgREST round trip is typically 2–10 ms. 220 ms is what you see when the function runs in the Vercel default region (iad1) and Supabase sits in a Gulf or EU region, or the reverse.
  - Each serial level in this code pays that.
- Evidence (serial depth counted from the code):
  - `/sync/jobs` (active): auth → roots → visits → jobs/countRooms = 4 levels.
  - `/sync/jobs?since`: 6 levels, because readJobs waits on changed ids and `countRooms` runs after readJobs (`sync-pull.ts:712-722`).
  - `/sync/job/[id]`: 5–6 levels.
  - push of 100 snags + 300 photos: ~88 levels (see F-DB-3).
- Impact at 220 ms per level:
  - job list ~0.9–1.3 s;
  - job open ~1.1–1.3 s;
  - save via `/sync/snag` ~3.3 s;
  - a large outbox ~19 s.

  At 5 ms the same chains take 20–450 ms, before any SQL changes.
- Fix: deploy the API routes in the Supabase project's region. Either add `export const preferredRegion = "<region>"` in `app/api/snagging/**/route.ts`, or a project-wide `vercel.json` `{ "regions": ["<region nearest the Supabase project>"] }`. Confirm the Supabase region in the dashboard first.
- Effort: S   Risk: Low (the portal pages move with it)
- How to verify: log `performance.now()` around a `select 1` (for example `hasColumn`) in a deployed route. Target: p50 under 15 ms. Re-time `/sync/jobs` with a target p95 under 400 ms.

##### F-DB-3 · Push is N+1 per mutation: three primary-key reads of the same snag, a full code list per snag, a snag read per photo, identical family lookups per verdict
- Severity: High
- Requirement(s): R2/R5
- Confidence: VERIFIED
- Where (`lib/server/snagging/sync-push.ts`):

  | Per-mutation statement | Lines |
  |---|---|
  | `assertMayChangeSnag` reads the snag by id | 480-484 |
  | …and when the author is someone else, `loadJobRosters` adds 2 more queries | 488 |
  | visit check reads the snag by id again (`locked`) | 532-536 |
  | `settleSnagCode` reads the snag by id a third time | 423 |
  | …**plus every snag code on the job**, paged | 424-433 |
  | upsert, with up to 3 serial retries each re-running `settleSnagCode` | 601, 606-610 |
  | `applyPhoto` → `assertMayChangeSnag` (one snag read per photo) | 771 |
  | `applyVerification` → assert | 896 |
  | …update | 915 |
  | …`writeVerdictThroughToOrigin`: copy+job select | 1449 |
  | …family select (`parent_job_id = root`), identical for every verdict in the push | 1479-1482 |
  | …update of the family's copies | 1485-1491 |

  Waves run with `inParallel(…, 12)` (`push-plan.ts:341-357`).
- What is wrong:
  - For a **new** snag all three by-id reads return nothing, so they are pure latency: 3 serial round trips.
  - The code list is up to 500 rows per snag mutation, re-read for every snag in the push even though the push knows the codes it has just assigned.
  - Photos in wave 3 re-read the authorship of snags written moments earlier in wave 2 by the same user.
  - None of this needs a round trip per row.
- Evidence:
  ```ts
  await assertMayChangeSnag(admin, ctx, job.id, ctx.mutation.entity_id);            // read #1  :501
  if (job.visit) { …select("locked").eq("id", ctx.mutation.entity_id)… }            // read #2  :531-537
  const snagCode = await settleSnagCode(admin, job.id, ctx.mutation.entity_id, …);  // read #3 + all codes :559
  ```
- Impact. Outbox of 100 new snags, 300 photos, 30 room updates and 1 submission, on a 500-snag job:

  | Cost | Calls | Serial round trips |
  |---|---|---|
  | snags | 100 × 4 = 400, plus up to 50 k code rows shipped | — |
  | photos | 300 × 2 = 600 | — |
  | rooms | 30 | — |
  | submission | ~14 | — |
  | pre-reads | 5 | — |
  | **Total** | **≈ 1,050 PostgREST calls** | **≈ 88** (rooms 3, snags 9 rounds × 3 = 27, photos 25 rounds × 2 = 50, submit ~6, pre/ledger 2) |

  At 220 ms that is **~19 s**. A de-snag round of 150 verdicts adds 150 × 5 calls, ~13 rounds × 5 = ~14 s.

  Concurrency: 12 in flight per push. Ten inspectors draining outboxes means 120 concurrent PostgREST requests against a pool of a few dozen at most (see §8), so requests queue.
- Fix (in-process, no schema change):
  1. Before the waves, preload every snag the batch touches, once:
     ```ts
     const snagIds = [...new Set(fresh.flatMap(m => m.entity === "snag" ? [m.entity_id]
                       : m.entity === "photo" || m.entity === "verification" ? [(m.payload as any).snag_id] : []).filter(Boolean))];
     const known = await readAllByIds(snagIds, (c,f,t) => admin.from("snagging_snags")
       .select("id, job_id, created_by, locked, snag_code, recorded_by:created_by(full_name,email)")
       .in("id", c).order("id").range(f,t), "push snags");
     ```
     `assertMayChangeSnag`, the visit lock check and the "existing code" read then become `Map` lookups. Snags created in wave 2 are added to the map with `created_by = userId`.
  2. Load each touched job's code set once (`select snag_code where job_id in (touched)`) into `Map<jobId, Set<string>>`. Assign codes in memory and keep the existing 23505 retry for races between pushes.
  3. Memoise `loadJobRosters` and the `writeVerdictThroughToOrigin` family per job, per push.
  4. Bulk-write independent rows: one `upsert([...rows], { onConflict: "id" })` per job for the photo wave, and one for new snags. Fall back to per-row only for rows that error.
  5. Longer term: one `snagging_apply_push(p_user uuid, p_mutations jsonb)` plpgsql RPC: one round trip, one transaction, one connection.
- Effort: M (1–4) / L (5)   Risk: Med. Authorship and lock rules must stay identical; cover them with the existing push tests.
- How to verify: on staging, reset with `select pg_stat_statements_reset()`, replay the 100/300/30/1 outbox, then sum `calls` from `pg_stat_statements where query ilike '%snagging_%'`. Targets: ≤ 60 calls, wall time under 3 s at 220 ms RTT, under 0.8 s co-located.

##### F-DB-4 · Legacy `/sync/pull` and the scoped snapshot: unchunked `IN`, serial OFFSET paging, unbounded signing, oversized responses
- Severity: High. It is Medium if telemetry shows no build still calls `/sync/pull`.
- Requirement(s): R1/R5
- Confidence: VERIFIED code; INFERRED plans and sizes.
- Where:
  - `lib/server/snagging/sync-children.ts:43-50` (`loadChanged`: `.in("job_id", jobIds)` with **no chunking**, then `readAllRows` with `.range()`);
  - `sync-children.ts:215-228` (plans, same pattern);
  - `lib/server/snagging/read-all.ts:22-34` (OFFSET loop, serial);
  - `sync-pull.ts:495-501` passes `jobIds` = every WORKABLE job the inspector has ever had, including approved and delivered (`sync-pull.ts:30-38`);
  - `sync-children.ts:180-183` → `media.ts:163-195` (one `createSignedUrls` per 100 paths, **all in parallel**).
- What is wrong:
  1. The team chunked every other id list at 150 (`read-all.ts:36-42`: "past a few hundred ids the request is longer than the gateway accepts and the whole sync fails"). The five child reads in `loadChanged`/`loadPlans` were not chunked. Even the scoped snapshot sends rooms for **all** `jobIds`.
  2. `readAllRows` pages with `LIMIT 1000 OFFSET k*1000` ordered by `id` across many jobs. Postgres must fetch and sort the whole match set for every page, so the total work is roughly N²/1000 rows, and the pages run one after another.
  3. Signing is `Promise.all` over N/100 batches with no cap.
- Evidence: plan for page k (INFERRED; Q9 checks it):
  ```
  Limit -> Sort (top-N heapsort, or external merge on deep pages) key: id
        -> Bitmap Heap Scan on snagging_snag_photos  Recheck: job_id = ANY($1)
           -> Bitmap Index Scan on <photos job_id index>
  ```
- Impact:

  | Pull | Photo rows | Pages | Rows touched in total | Serial time |
  |---|---|---|---|---|
  | **Scoped snapshot**, 25 active jobs | 11,250 | 12 | 135 k | ~2.6 s |
  | **Full legacy pull**, H = 125 | 56,250 | 57 | ~3.2 M | ~12.5 s of round trips, plus deep-page sorts that can spill past `work_mem` |

  - Scoped snapshot: 113 parallel Storage sign calls. Response ≈ 11 k × ~650 B ≈ 7 MB of photos, plus ~1.9 MB of snags.
  - Full legacy pull: **563 parallel `createSignedUrls` calls** from one function. Response ~30 MB.
  - Both exceed Vercel's 4.5 MB serverless response cap (INFERRED: hosting on Vercel). The URL for H ≥ ~300 job ids (~11 KB) also crosses the limit the team documented.
- Fix:
  - (a) Chunk `loadChanged`/`loadPlans` with `readAllByIds` (`chunk, from, to`), as the parents already are.
  - (b) Replace OFFSET with per-job reads, which are bounded at ≤ 1,500 rows, so ≤ 2 pages, and run them 4-wide:
    ```ts
    // keyset inside one job, served by (job_id, id) or the (job_id, created_at) index + small sort
    .eq("job_id", jobId).gt("id", lastId).order("id").limit(1000)
    ```
  - (c) Cap signing: `inParallel(chunks.map(c => () => signChunk(...)), 6)` in `media.ts:169`.
  - (d) Block `/sync/pull` without `scope=active` for builds that have the per-screen routes. Return 410 or redirect to `/sync/jobs`, and log `user-agent` and app version first.
- Effort: S (a, c), M (b, d)   Risk: Low
- How to verify:
  - Q9 on staging for 25 job ids. Targets: total `actual time` across pages under 150 ms and no "external merge".
  - Server log: maximum concurrent `createSignedUrls` per request ≤ 6.
  - Response size of `/sync/pull?scope=active` for the busiest staging inspector under 4 MB.

##### F-DB-5 · Delta filters have no `(job_id, updated_at)` composite indexes
- Severity: Medium
- Requirement(s): R1/R5
- Confidence: VERIFIED that the repo has none; INFERRED for the base tables.
- Where:
  - deltas: `sync-children.ts:48` (`.gt(updated_at)` on areas, snags, checklist; `.gt(created_at)` on photos, `:156`), `sync-pull.ts:1080, 1092, 1107` (jobs, visits, areas).
  - existing indexes: `snagging_job_checklist (job_id, sort_order)` and `(job_id, created_at)` (`20260821110000:42`, `20260901090000:37`); `snagging_job_visits (job_id, status)` (`20260914120000:111`); only floor plans have `(job_id, updated_at)` (`20260920100000:32`).
- What is wrong: with only a `job_id` index, a delta fetches **every** row of every job in the list, then discards nearly all of them with the time filter.
- Evidence (INFERRED plan): `Bitmap Heap Scan … Filter: (updated_at > $2)  Rows Removed by Filter: 3,750` (areas, H = 125).
- Impact per inspector per delta:

  | Delta | Rows scanned | Rows returned |
  |---|---|---|
  | List delta, every 5 min | ~3,750 room rows | ~0 |
  | Legacy full-pull delta | ~19 k snags + 56 k photos + 10 k checklist rows | a few |

  Across 200 inspectors, the legacy path is ~57 k heap rows/s for no output. `/sync/job/[id]?since` is one job: negligible.
- Fix: §4 statements 2, 3, 4 and 6. Each makes the plain `job_id` index redundant (it is a prefix), so drop that one. Net index count is unchanged.
- Effort: S   Risk: Low. Trade-off: on areas, `updated_at` becomes indexed, so the trigger's status UPDATE (F-DB-8) is no longer HOT. Fix F-DB-8 at the same time.
- How to verify: Q7 and Q10 show `Index Cond: ((job_id = ANY ($1)) AND (updated_at > $2))` and `Rows Removed by Filter` near 0.

##### F-DB-6 · Job open re-reads the same job and roster up to 4 times, and nests signers serially
- Severity: Medium
- Requirement(s): R1
- Confidence: VERIFIED
- Where:
  - `snagging_jobs` by id is read 4 times:
    - `app/api/snagging/sync/job/[id]/route.ts:73`;
    - `:99` `isOnJobRoster` → `job-roster.ts:208-217`;
    - `sync-task-detail.ts:44`;
    - `:115` `loadSigners` → `signoffs.ts:42` → `job-roster.ts:208-217`.
  - `snagging_job_inspectors` is read 3 times: `job-roster.ts:219-230` twice, and `sync-task-detail.ts:64-73`.
  - `loadSigners` (`sync-task-detail.ts:115`) starts only after the first parallel batch. Inside it, `user_profile` and sign-offs wait on the rosters (`signoffs.ts:41-59`). That is 3 serial levels inside `loadTaskDetail`.
  - Visit snag counts read every snag id on the job just to count them (`sync-task-detail.ts:51-62`).
  - A round with `parent=true` doubles everything (`route.ts:136-145`).
- What is wrong: about 38 calls per full job open (≈ 60 with parent): 1 auth + 6 access + 9 detail + 6–7 children + 15 Storage signs for 1,500 photos. Of these, 5–6 calls and 2 serial levels are duplicates.
- Evidence:
  ```ts
  const signoffs = await loadSigners(admin, jobId, (live?.id as string | undefined) ?? null); // after Promise.all, :115
  ```
- Impact: about +440 ms per job open at 220 ms, and ~6 extra statements per open. With 200 inspectors opening ~10 jobs a day that is ~12 k redundant statements a day. Small for the database; noticeable for the user.
- Fix:
  - Have `loadTaskDetail` accept `{ job, roster }` already read by the route.
  - Add an `isOnJobRoster` variant that takes the roster rows.
  - Start `loadVisitRosters`, sign-offs and `user_profile` in the first `Promise.all`, using the visit id from a `snagging_job_visits … status in (scheduled, in_progress)` read that is already there.
  - Get visit snag counts from the snags `loadSyncChildren` already returns when both run.
- Effort: M   Risk: Low
- How to verify: `pg_stat_statements` delta for one `GET /sync/job/<500-snag job>` ≤ 25 PostgREST statements; serial depth 3.

##### F-DB-7 · Submit re-locks every snag on the job and bumps all of them into the next delta
- Severity: Medium
- Requirement(s): R2/R5
- Confidence: VERIFIED code; INFERRED `updated_at` touch on the lean table.
- Where: `sync-push.ts:1256` (`update({locked:true}).eq("job_id", job.id)`) and `:1378-1382` (visit). The 0817 touch trigger pattern is at `20260817090000:706-728`; the base-table equivalent is INFERRED, because deltas filter on `updated_at` while the push never sets it on snags.
- What is wrong:
  - There is no `locked = false` filter, so a resubmission after a rejection rewrites all up-to-500 rows again.
  - Each row gets a new heap tuple. If touch exists, each also gets a new `updated_at`.
  - So every device holding the job, and the parent's viewers, re-download all 500 snags on the next delta.
- Evidence: `const { error: lockError } = await admin.from("snagging_snags").update({ locked: true }).eq("job_id", job.id);`
- Impact: ~500 dead tuples and ~500 re-sent snags (~250 KB) per device per resubmission. With (job_id, updated_at) added (F-DB-5), that is also 500 index updates.
- Fix: `.eq("job_id", job.id).eq("locked", false)`, and the same for the visit lock (`.eq("visit_id", visit.id).eq("locked", false)`).
- Effort: S   Risk: Low
- How to verify: Q13 run twice in one transaction. The second run must show `rows=0`.

##### F-DB-8 · Area-status trigger: an unconditional extra UPDATE per snag write, a double write per room confirm, lock serialisation and a race
- Severity: Medium
- Requirement(s): R2/R5
- Confidence: VERIFIED (trigger text); INFERRED (cost)
- Where: `supabase/migrations/20260904100000_restore_area_status_trigger.sql:19-54` (snag trigger) and `:58-89` (area self-trigger).
- What is wrong:
  - Every snag INSERT, every snag UPDATE of `status` or `area_id`, and every DELETE runs a count, then an UPDATE of the area **even when the status does not change**. Over the life of an area, that is about one useless area write per snag.
  - Confirming a room writes the area twice: the client update, then the trigger's status update.
  - Push runs 12 chains at once, so snags in the same room queue on the area's row lock. Each lock is held only for the length of the autocommit request, but it still serialises them.
  - Under READ COMMITTED, two concurrent withdrawals in one room can each count the other's row as live, and leave `has_snags` behind with zero live snags.
  - Verdict write-through updates family copies across areas in arbitrary order, so deadlocks (40P01) are possible. The phone then retries.
- Evidence:
  ```sql
  update public.snagging_areas set status = case … end where id = v_area_id;   -- no "is distinct from" guard (:39-45)
  ```
- Impact per snag insert: 1 index scan, 1 area tuple, a touch trigger on areas (if present), and +1 area index write if F-DB-5 indexes `updated_at`. Each area UPDATE also bumps `updated_at`, so `changedJobIds(rooms)` (`sync-pull.ts:1099-1111`) reports the job as changed after every snag.
- Fix: guard the write, so it only happens when the derived value changes:
  ```sql
  update public.snagging_areas a set status = s.new_status
    from (select case when v_count > 0 then 'has_snags'
                      when confirmed_at is not null then 'clear' else 'pending' end as new_status
            from public.snagging_areas where id = v_area_id) s
   where a.id = v_area_id and a.status is distinct from s.new_status;
  ```
  The same goes in `_self`. To remove the race, take `select … for update` on the area row before counting, or compute status at read time from `count(*) filter (…)`.
- Effort: S   Risk: Low
- How to verify: Q12b (INSERT inside BEGIN/ROLLBACK) shows `Trigger snagging_snags_refresh_area: time < 1 ms`. A second insert into an area that already has snags shows `UPDATE 0` in `auto_explain` nested output.

##### F-DB-9 · Alerts: Realtime publishes every UPDATE, "mark all read" floods it, the delta's `read_at` branch is unindexed, `select('*')`
- Severity: Medium
- Requirement(s): R5 (R1 for alerts)
- Confidence: VERIFIED (code and migration); INFERRED (Realtime fan-out)
- Where:
  - `supabase/migrations/20260924120000_snagging_notifications.sql:330-341` (whole table added to `supabase_realtime`; the default publication publishes INSERT, UPDATE and DELETE);
  - `app/api/snagging/sync/alerts/route.ts:102-108` (`read_all` updates every unread row);
  - `:131-136` (`select("*")`, `.or("created_at.gt…,read_at.gt…")`, OFFSET paging);
  - indexes at `20260924120000:34-39`.
- What is wrong:
  - "Mark all as read" with 3,000 unread rows writes 3,000 tuples, emits 3,000 WAL changes, and sends 3,000 Realtime events. Realtime checks each one against subscribers' RLS (`user_id = auth.uid()`, `:46-49`).
  - The next delta then returns all 3,000 rows (`select *`, 3 serial pages).
  - The `read_at > since` branch of the OR has no index, so the planner walks the user's whole history.
- Evidence (INFERRED plan): `Index Scan using snagging_notifications_user_idx … Filter: ((created_at > $2) OR (read_at > $2))  Rows Removed by Filter: ~3,000`
- Impact:
  - per mark-all: 3,000 events × the number of subscribed sessions to authorise (up to 200 if every inspector is subscribed), which delays everyone's live alerts;
  - ~1.5 MB delta response;
  - every 5-minute catch-up for each inspector touches 3,000 rows (200 × 3,000 / 300 s = 2 k rows/s).
- Fix:
  - Publish inserts only. Either:
    - (a) remove the table from `supabase_realtime` and broadcast from an AFTER INSERT trigger with `realtime.send(jsonb_build_object('id', new.id), 'alert', 'user:'||new.user_id, true)` on a private channel; or
    - (b) if `supabase_realtime` contains only tables where INSERT is enough, run `alter publication supabase_realtime set (publish = 'insert')` after checking `pg_publication_tables`.
  - Add the §4 #8 index.
  - Have `read_all` return `read_all_before: serverTime` so the phone marks locally, instead of returning 3,000 rows.
  - Select the 9 columns explicitly. `when_at` has existed since `20260924140000:12-13`, so the `*` fallback is no longer needed.
- Effort: M   Risk: Med (Realtime client changes for (a))
- How to verify: Q14 shows `BitmapOr` with < 50 buffers. In Realtime inspector logs, mark-all-read of 3,000 produces 0 postgres_changes events.

##### F-DB-10 · No retention anywhere: sync ledger, storage orphans, notifications; audit cannot be pruned
- Severity: Medium
- Requirement(s): R5
- Confidence: VERIFIED (no deleter; grep for `snagging_sync_mutations`, `snagging_notifications` and `.remove(` across `app/`, `lib/`, `supabase/` finds only the writers and `sync-push.ts:788`). Growth figures are INFERRED.
- Where:
  - ledger: `20260817090000_create_snagging_module.sql:669-686`; written at `sync-push.ts:316-322`, and `/sync/snag` mints new mutation ids for photos on every request (`app/api/snagging/sync/snag/route.ts:147`).
  - audit rules: `20260821160000_snagging_audit_restore.sql:147-150`.
  - orphan sources:
    - `snag/route.ts:140-145` uploads before the push and never removes the object when the photo row is rejected (`:212-223`);
    - `app/api/snagging/media/sign/route.ts:77-79` signs an upload that may never be followed by a photo row;
    - snag withdraw is a soft update (`sync-push.ts:503-509`) and keeps its files;
    - signatures are keyed by mutation id (`sync-push.ts:971-976`), so each resubmission leaves the previous PNG behind.
- What is wrong: see the §7 table.
  - `snagging_sync_mutations` (~20 M rows a year) has 3 btree indexes, and code reads only the PK (`sync-push.ts:122`). `(entity, entity_id)` and `(user_id, applied_at)` are pure write cost.
  - Storage grows by ~4.5 TB a year with no sweep.
- Impact:
  - ledger ≈ 20 M rows and ~8–12 GB a year, including indexes;
  - each mutation costs 3 index inserts (random uuid PK, so frequent page splits);
  - storage orphans are unbounded. At 1–2% failed or abandoned uploads that is ~110–225 k orphan objects a year.
- Fix:
  - Daily: `delete from public.snagging_sync_mutations where applied_at < now() - interval '30 days'`. The device outbox keeps sent changes for 24 h (handbook). Run it in batches of 10 k, using the BRIN index (§4 #10), from the existing external scheduler pattern (`app/api/snagging/approvals/escalations/run/route.ts:11`).
  - Drop `idx_snagging_sync_mutations_entity` once `pg_stat_user_indexes.idx_scan = 0` is confirmed.
  - In `snag/route.ts`, `remove()` the object when its photo mutation is rejected.
  - Weekly orphan sweep: `storage.objects` under `tasks/%/snags/%` older than 7 days with no `snagging_snag_photos.storage_path` match, deleted through the Storage API.
  - Notifications: delete read rows older than 180 days.
  - Audit: keep append-only, but plan monthly partitions so whole old partitions can be detached for archive without touching the rule.
- Effort: M   Risk: Low (ledger) / Med (storage sweep: dry-run first)
- How to verify: `select count(*), min(applied_at) from snagging_sync_mutations` stays ≤ 30 days of rows. The orphan dry-run count trends to ~0.

##### F-DB-11 · Defect history: the audit lookup cannot use its index (one-line fix)
- Severity: Medium
- Requirement(s): R1/R5
- Confidence: VERIFIED
- Where:
  - `app/api/snagging/snags/[id]/history/route.ts:91-96` filters `event_type` and `entity_id`.
  - The only writer of `snag_verified` uses `entityType: "verification"` (`sync-push.ts:938-944`).
  - Index: `(entity_type, entity_id, created_at desc)` (`20260821160000:141-142`).
  - Same pattern at `lib/server/snagging/job-detail-sections.ts:488-491`.
- What is wrong: the leading index column is unconstrained, so the planner does a sequential scan of `snagging_audit_events`. The team's previous audit found the same against the live schema (`AUDIT_SCALABILITY.md:437-442`).
- Impact: ~6–7 M rows a year. Each history open sequentially scans a growing table: about 1–3 s by year 1.
- Fix: add `.eq("entity_type", "verification")` to both queries. There is no write cost, unlike a new index.
- Effort: S   Risk: Low
- How to verify: Q15 shows `Index Scan using idx_snagging_audit_entity` with under 1 ms and < 30 buffers.

##### F-DB-12 · Auth path: 30 s cache misses on a 5-minute cadence; feature probes on cold instances; a dead column queried 3 times
- Severity: Low (DB) / Medium (latency, while F-DB-2 is open)
- Requirement(s): R1/R2
- Confidence: VERIFIED
- Where: `lib/server/user-access.ts:52-114` (cache); `lib/server/request-user-access.ts:57` (`getClaims`); probes in `lib/server/snagging/columns.ts:22-92`, awaited serially at:
  - `sync-pull.ts:232` and `:253`;
  - `sync-task-detail.ts:41`;
  - `sync-push.ts:106`;
  - `job-roster.ts:272` and `:345`;
  - `sync-children.ts:107-112`;
  - `alerts/route.ts:95`;
  - `gatepass/route.ts:42`.
- What is wrong:
  - Inspectors call every ~5 min, but the cache lives 30 s and is per instance, so steady-state requests mostly miss. Each miss costs 1 round trip (`user-access.ts:60-67`), roughly 30–50% hit rate across bursts (INFERRED).
  - Every probed migration is now in the repo, up to `20260930100000_job_gatepass.sql`. On each cold instance the probes cost up to 4 serial round trips for nothing.
  - `snagging_areas.inspector_id` "has no rows at all" and "the code stops using it" (`20260923100000_multiple_inspectors.sql:58-61`). Sync still queries it (`sync-pull.ts:232-244`, `job/[id]/route.ts:80-87`, `sync-push.ts:126-132`).
- Impact: +220 ms on most requests, and +0.4–0.9 s on the first request per cold instance.
- Fix:
  - Remove the probes. Constant-fold them to `true`, and delete the areas.inspector_id branches.
  - Either raise `ACCESS_TTL_MS` to 120 s, or move `role` and `is_active` into the JWT with a Custom Access Token Hook. With the hook, auth needs no database round trip, and revocation follows JWT expiry: the trade-off already accepted for `getClaims` (`user-access.ts:133-136`).
- Effort: S (probes) / M (hook)   Risk: Low / Med
- How to verify: count `select … limit 1` statements in `pg_stat_statements` after a deploy and warm-up: 0. `/sync/jobs` p50 drops by about 1 round trip.

##### F-DB-13 · `countRooms` ships every room row to count it; it is serial after readJobs on Done and delta
- Severity: Low
- Requirement(s): R1
- Confidence: VERIFIED
- Where: `sync-pull.ts:1124-1148`; serial await at `:715-722`.
- What is wrong:
  - Counting 25–30 jobs pulls 750–1,800 room rows (1–2 OFFSET pages).
  - On `list=done` and `since`, the count starts only after the jobs read, so it adds 1–2 serial round trips.
- Impact: +220–440 ms on the Done tab, on deltas and on every `/sync/snag` with `since`.
- Fix: one RPC:
  ```sql
  create or replace function public.snagging_room_counts(p_job_ids uuid[])
  returns table(job_id uuid, total int, done int) language sql stable as $$
    select job_id, count(*)::int, count(confirmed_at)::int
      from public.snagging_areas where job_id = any(p_job_ids) group by job_id $$;
  ```
  For Done, start it with `listIds` in parallel with readJobs and filter afterwards.
- Effort: S   Risk: Low
- How to verify: Q6b runs under 2 ms; Done tab serial depth 4.

##### F-DB-14 · Visit membership has no index on `inspector_id`
- Severity: Low (today: visits are about 5 k rows a year)
- Requirement(s): R1/R5
- Confidence: VERIFIED (repo); the previous audit confirmed it in the live schema (`AUDIT_SCALABILITY.md:444-447`)
- Where: `sync-pull.ts:210-219`, `job/[id]/route.ts:74-79` and `job-roster.ts:260-265` filter `inspector_id + status`. The only indexes are `(job_id, visit_number)` and `(job_id, status)` (`20260914120000:107-112`).
- Impact: the first parallel query of every list pull is a sequential scan. Today that is under 2 ms; it grows linearly.
- Fix: §4 #5.
- Effort: S   Risk: Low
- How to verify: Q2 shows `Index Scan using idx_snag_visits_inspector_status`.

##### F-DB-15 · `/sync/snag` repeats access work and appends a serial list delta to every save
- Severity: Low
- Requirement(s): R2
- Confidence: VERIFIED
- Where: `app/api/snagging/sync/snag/route.ts:107-111` runs `mayWriteJob` per job (`job-roster.ts:258-294`: roster 2, visit count, live visits → visit crew, area count; 2 serial levels). The push then re-derives access from jobs, rooms, visits and roster (`sync-push.ts:115-149`). After the push, `handleSyncPull(view:list, since)` runs serially (`snag/route.ts:206-210`).
- Impact:
  - About 5 duplicate statements per save, plus 2 serial levels before upload.
  - The list delta adds ~5–6 serial round trips (~1.2 s) to every save, even when the phone does not need it immediately.
- Fix:
  - Pass the push's `jobById` access result back and check photo jobs against it. Do the uploads after the access pre-read, which is one level.
  - Start the membership phase of the list delta (phases 1–2) concurrently with the push, and run only `changedJobIds` and `readJobs` after it. Or make `since` opt-in only on the final round of `sendSoon`.
- Effort: M   Risk: Low
- How to verify: a `/sync/snag` with 1 snag and 3 photos makes ≤ 12 PostgREST calls, with serial depth ≤ 6.

##### F-DB-16 · Triggers on `snagging_jobs` and `snagging_job_visits` run unconditionally with EXCEPTION blocks
- Severity: Low
- Requirement(s): R5
- Confidence: VERIFIED (text); INFERRED (cost)
- Where:
  - `snagging_notify_job_update`: AFTER UPDATE, every row, EXCEPTION block (`20260924140000:88-158`);
  - `snagging_clear_job_signoffs`: same shape (`20260924130000:41-61`);
  - `snagging_notify_visit` always reads the job and computes recipients before testing whether anything changed (`20260924140000:160-226`);
  - `snagging_clear_visit_signoffs` deletes `where visit_id = …` with no `visit_id` index (`20260924130000:63-83`; the unique index leads with `job_id`, `:30-35`).
- What is wrong: each EXCEPTION block opens a subtransaction. A bulk portal UPDATE of more than 64 jobs in one statement, where the blocks write (notify inserts, sign-off deletes), overflows the per-transaction subxid cache. That makes snapshot checks slow server-wide while it runs. Mobile writes touch one job per statement, so the mobile cost is about 0.1 ms per statement.
- Fix:
  - Add `WHEN (old.status is distinct from new.status or old.inspector_id is distinct from new.inspector_id or old.scheduled_date is distinct from new.scheduled_date or old.appointment_at is distinct from new.appointment_at)` clauses to the `CREATE TRIGGER` statements, so the function is not even called otherwise.
  - Same for visits, on (status, scheduled_date, appointment_at), plus INSERT.
  - Add §4 #9.
- Effort: S   Risk: Low
- How to verify: `pg_stat_user_functions.calls` for `snagging_notify_job_update` drops to roughly the number of status and schedule changes.

---

### 4.3 API latency and save round trips (R2, R7)

#### Method notes

Scope: Phase 3 (every endpoint the inspector app calls) and Phase 4 (network calls from a tap to "confirmed saved").
This was a read-only audit. No server, database or dev server was called. Every latency below is **INFERRED** from the code: round-trip depth, serial vs parallel, rows and bytes. **VERIFIED** means the behaviour was read in the code at the cited `file:line`.

Paths: `P:` = portal `C:\Users\Technisia\Documents\Prohelp-Work\Yalla Fixit`, `M:` = mobile `...\yfi-mobile-app\YFI-MobileApp`.

**Latency model used throughout (INFERRED):**
- One PostgREST or Storage call from the function costs **≈220 ms**. That figure is the team's own measurement, recorded at `P:lib/server/snagging/sync-push.ts:243-245` ("measured at ~220ms each") and `P:lib/server/snagging/push-plan.ts:7`. `P:lib/server/user-access.ts:30-32` puts three serial auth round trips at "about a second", and `P:lib/server/snagging/audit.ts:45-46` says "the better part of a second" on a bad connection.
- p50 ≈ critical-path depth × 220 ms. p95 ≈ (depth + 1 auth-cache miss) × 300 ms. A cold instance adds 0.5–1 s, because the per-process caches are empty and the code must be loaded.
- Phone ↔ function adds 1 RTT per call, plus 2 RTT for TCP+TLS on a new connection. Upload bytes go over the 4G uplink, which is typically 5–10 Mbps in the UAE and 1–2 Mbps at a poor site.
- Scale: 60 rooms, 500 defects and 1,500 photos per job; 300 jobs per inspector; 3,000 alerts per user.

---

#### Summary verdict

##### R2: server p95 < 1 s (p50 < 300 ms), list/detail payload < 100 KB gz. Verdict: **FAIL (INFERRED)**
- **The root cause is round-trip cost multiplied by serial depth.** The repo pins no region: there is no `vercel.json`, no `preferredRegion` and no `regions` (VERIFIED). At the recorded ≈220 ms per DB call, the warm critical paths come out as follows:
  - Only 4 of 17 measured paths fit 1 s p95: `sync/access`, the unchanged-catalogue check, `sync/alerts`, and an empty push.
  - Single-defect save via `/sync/push`: about 6 round trips, ≈1.3 s.
  - Defect + photo via `/sync/snag`: 12 round trips, ≈2.6 s (F-API-2).
  - The same save with list changes attached: 15–17 round trips, ≈3.5 s.
  - A 100-mutation push: about 23 round trips, ≈5 s (F-API-3).
  - Even a delta poll that finds nothing costs 4–5 round trips, ≈0.9–1.1 s (F-API-7, F-API-8).
- **Payload breaches.**
  - A whole job fetch (500 defects, 1,500 photos) is ≈1.6 MB raw / ≈300–400 KB gzip, 3–4× the budget.
  - It doubles with `parent=true`, which de-snag rounds and visits use.
  - Signed URLs are ≈60% of the photo bytes.
  - Link expiry triggers repeat whole fetches every 20–50 minutes on jobs whose photos are only on the server (F-API-5, F-API-6).
- **Media.** Uploads run in the background and retry with idempotent keys (VERIFIED). The direct-to-storage path costs 4 API calls plus the storage PUT, and reads videos fully into memory (F-API-11).
- **Biggest lever.** Co-locating the function with the database turns ≈220 ms per call into ≈2–5 ms (F-API-1). Next come set-based push writes (F-API-3) and dropping per-photo signing from job payloads (F-API-5).

##### R7: each write's own response confirms it, with no second verify request. Verdict: **PARTIAL PASS**
- **PASS.**
  - Every push and snag-with-photos returns a per-mutation `status` keyed by `mutation_id`, plus `error` and a canonical `snag_code`. Photos come back with `storage_path` and a signed `url`.
  - The app retires rows on these fields and makes no verify GET: `M:src/sync/push.ts:122-168`, `M:src/sync/sendWithMedia.ts:354-395`.
  - List changes ride along on the same request (`P:app/api/snagging/sync/snag/route.ts:205-210`).
- **Gaps.**
  - Server-decided fields (`visit_id`, `created_by`, `locked`, statuses written through by verdicts, `updated_at`) are not echoed. They arrive later through a job delta, which also re-downloads and re-signs the device's own writes (F-API-12).
  - The direct-to-storage path takes 3+ calls before the server knows about the photo (F-API-11).
  - Sign-off state needs a separate `GET view=detail` (F-API-14).
  - The submit screen shows success before the server answers (F-API-14).
  - "Mark all read" with more than 200 unread is contradicted by the response's own count (F-API-13).
  - A fixed 600 ms gather sits in front of every save (F-API-10).

---

#### Findings

##### F-API-1 · Function and database are not co-located: every serial DB call costs ≈220 ms
- Severity: **Critical**
- Requirement(s): R2
- Confidence: VERIFIED that no region is pinned. INFERRED that the RTT is ≈220 ms (the team's recorded measurement).
- Where:
  - `P:next.config.ts:4-24`: no region and no headers.
  - No `P:vercel.json`. No `preferredRegion` or `maxDuration` in any `P:app/api/snagging/**` route (grep).
  - `P:supabase/config.toml` describes the local stack only.
  - Measurement comments: `P:lib/server/snagging/sync-push.ts:243-245`, `P:lib/server/snagging/push-plan.ts:7`.
- What is wrong:
  - Every `.from()` and `.storage` call is its own HTTPS round trip to Supabase. With ≈220 ms per call recorded, the function is almost certainly running in a different region from the database.
  - Vercel's default is `iad1` unless it is changed in the dashboard. Every endpoint below has 2–17 serial calls, so region distance alone accounts for 0.4–3.7 s per request.
- Evidence:
  ```
  sync-push.ts:243  "Every mutation costs one to three round
  sync-push.ts:244   trips to the database, measured at ~220ms each, so a full
  sync-push.ts:245   hundred-mutation outbox took twenty seconds to a minute"
  ```
  Calculation: depth 5 (job detail) × 220 = 1.1 s; co-located, 5 × ~3 ms = 15 ms.
- Impact:
  - Moving to the DB's region takes the p50 of `/sync/job?view=detail` from ≈1.1 s to under 100 ms, `/sync/jobs?since` from ≈0.9–1.3 s to under 100 ms, and `/sync/snag` with 1 photo from ≈2.6 s to ≈0.4–0.6 s (upload-bound).
  - UAE phone ↔ function RTT then depends on the DB region: ≈30–60 ms to Mumbai, ≈110–130 ms to Frankfurt, ≈220 ms to Virginia. One phone RTT against N DB RTTs means co-locating with the DB always wins.
- Fix:
  - Confirm the Supabase project region in the dashboard.
  - Pin the function to the matching Vercel region, either in `vercel.json` (`{ "regions": ["bom1"] }` if Supabase is `ap-south-1`) or per route with `export const preferredRegion = "bom1"` on `app/api/snagging/**`.
  - Keep the edge middleware as it is; it is CORS only (`P:middleware.ts:57-69`).
- Effort: S   Risk: Low. Check the other modules that share the deployment.
- How to verify the fix:
  - Run `ALLOW_TARGET=staging BASE_URL=… BEARER=… JOB_ID=… node docs/audits/perf/scripts/api-latency.mjs`.
  - The `x-vercel-id` function segment must equal the DB region.
  - Thresholds: `GET sync/access` p50 < 100 ms, and `GET sync/jobs?since=<just now>` p95 < 300 ms.

##### F-API-2 · `POST /sync/snag` (defect + photos) is a 12–17 round-trip serial chain: the most likely 1 s breaker
- Severity: **Critical**
- Requirement(s): R2, R7
- Confidence: VERIFIED structure; INFERRED timings
- Where: `P:app/api/snagging/sync/snag/route.ts:80-253`
- What is wrong:
  - Credit first: storage uploads run **in parallel** (`Promise.all`, :117), and access is resolved once per job (:107).
  - Everything else is serial:
    - auth;
    - a full `mayWriteJob`: 5 queries at depth 2, with the visit-crew branch doing select-then-count (`P:lib/server/snagging/job-roster.ts:96-110`);
    - the uploads;
    - `handleSyncPush`, which re-reads access in its own pre-read and then runs the snag wave (3 round trips) and the photo wave (2 round trips);
    - the ledger write;
    - the optional list delta (3–5 round trips);
    - photo signing (1 round trip).
  - The access check is done twice, once in `mayWriteJob` and once in the push pre-read.
- Evidence:
  ```
  route.ts:107  await Promise.all(jobIds.map(... mayWriteJob(admin, jobId, profile.id)))   // depth 2
  route.ts:117  await Promise.all(input.photos.map(... admin.storage...upload(...)))      // 1 + transfer
  route.ts:189  const pushed = await handleSyncPush(req, {...})                          // 1+3+2+1 = 7
  route.ts:207  const listed = await handleSyncPull(req, { view: "list", since })        // 3-5
  route.ts:233  const signed = await signMediaPaths(admin, ...)                          // 1
  ```
  Depth with 1–3 photos and no `since`: auth 1 + 2 + 1 + 7 + 1 = **12 RT ≈ 2.6 s**. With `since` (Sync now, after-upload sends): **15–17 RT ≈ 3.3–3.7 s**. Add Vercel→Supabase transfer of 0.3–3.5 MB cross-region, ≈0.3–1 s on a fresh connection while TCP slow start ramps up.
- Impact:
  - Tap to confirmed, 1 photo: 600 ms gather + 4G upload ≈0.4 s + 2.6 s server ≈ **3.6 s**.
  - Every Sync-now style call (`withChanges`, `M:src/sync/engine.ts:189,233`) pays the list delta on top.
- Fix (contract unchanged):
  1. Replace `mayWriteJob` with the push's own pre-read. Extract `loadPushContext(admin, profile, touchedIds)` from `P:lib/server/snagging/sync-push.ts:97-204`, call it once in the route, check `jobById` before uploading, and pass the context into `handleSyncPush`. Saves 2 RT.
  2. After the push, run the list delta and `signMediaPaths` together: `await Promise.all([since ? handleSyncPull(...) : null, signMediaPaths(...)])`. Saves 1 RT.
  3. Make the push set-based (F-API-3), taking it from 7 RT to ≈3.
  4. F-API-1.
  - Target: ≤ 6 RT warm, which is ≈0.3–0.5 s co-located and upload-bound.
- Effort: M   Risk: Med (access rules must stay identical; reuse the same code)
- How to verify the fix: `ALLOW_WRITES=1 PHOTO_COUNTS=1,3 ONLY="sync/snag" … node docs/audits/perf/scripts/api-latency.mjs`. Thresholds: p50 < 300 ms + upload time, p95 < 1,000 ms for 1 × 300 KB.

##### F-API-3 · `POST /sync/push` applies mutations one at a time with 1–10 serial DB calls each
- Severity: **Critical**
- Requirement(s): R2
- Confidence: VERIFIED per-mutation call counts; INFERRED timings
- Where:
  - `P:lib/server/snagging/sync-push.ts:268-314` (runOne and the waves); `P:lib/server/snagging/push-plan.ts:26-35,84-101` (4 waves, 12 concurrent).
  - Appliers: snag `:498-628`, photo `:759-836`, verdict `:894-946` plus `:1444-1493`, submission `:1016-1279`.
- What is wrong:
  - The waves and 12-way concurrency are a real improvement (credit). Each mutation still issues its own serial reads and writes, so depth is the sum over waves of ceil(chains ÷ 12) × per-mutation depth.
  - Per-mutation serial round trips:

    | Mutation | Round trips | Breakdown |
    |---|---|---|
    | snag insert/update | 3 (4 on a visit) | `assertMayChangeSnag` :480, visit `locked` read :531-543, `settleSnagCode` :559, upsert :601 |
    | snag delete | 2 | |
    | photo insert | 2 | |
    | photo delete | 4 | |
    | area or checklist | 1 | |
    | verdict | 5 | assert, update, then write-through: select, family, update (:1449-1491) |
    | sign-off | 3 | storage, delete, insert |
    | submission | ≈9–10 | photos paged read 2 (:1057-1065), `loadSigners` 2, signature upload 1, `recordSignoff` 2, job update 1, snag lock 1 |

  - Fixed costs: auth 0–1, pre-read 1 (:115-149), visit start 0–1 (:217-233), ledger 1 (:316-323). The audit write runs after the response (credit, `P:lib/server/snagging/audit.ts:54-60`).
- Evidence (calculation):

  | Push | Round trips | p50 | Notes |
  |---|---|---|---|
  | 1 defect (sendSoon) | 1+1+3+1 = **6** | ≈1.3 s | |
  | 1 verdict | 1+1+5+1 = **8** | ≈1.8 s | |
  | Submit with signature | 1+1+10+1 = **13** | ≈2.9 s | |
  | 100 mixed: 10 areas, 30 snags, 60 photos (client `batchSize`, `M:src/lib/config.ts:48`) | 1+1+1×1+3×3+5×2+1 = **23** | ≈5.1 s | |
  | 500, the server max (`P:modules/snagging/schemas.ts:490`): 50 / 150 / 300 | 2+5×1+13×3+25×2+1 = **97** | ≈21 s | Plus `.in("mutation_id", ids)` (:122) puts 500 uuids, ≈18.5 KB, in one URL, past the gateway limit the code itself documents (`P:lib/server/snagging/read-all.ts:36-42`) |
- Impact:
  - Every single save on `/sync/push` misses the 1 s budget.
  - A day's offline backlog takes 5 s per 100 changes.
  - A 500 batch risks a function timeout (F-API-15).
- Fix (contract unchanged, set-based apply):
  ```ts
  // one extra read in the existing pre-read Promise.all:
  admin.from("snagging_snags").select("id, job_id, created_by, locked, snag_code")
       .in("id", snagIdsReferencedInBatch)            // chunk by ID_CHUNK
  // plus rosters for touchedIds (loadJobRosters) -> assertMayChangeSnag + locked checks in memory
  // per wave: one upsert per entity (snags[], photos[], areas[] inserts),
  // partial updates + verdict write-through in ONE rpc:
  await admin.rpc("snagging_apply_partial", { p_rows: jsonbArray })
  ```
  - Alternatively, a single plpgsql `snagging_apply_batch(p_user uuid, p_device text, p_mutations jsonb) returns jsonb` that returns per-mutation results, giving 1–2 RT total.
  - Target: 100 mutations in ≤ 6 RT.
- Effort: L   Risk: Med (rule parity; keep the per-mutation result semantics and run the existing push tests)
- How to verify the fix: `ALLOW_WRITES=1 PUSH_SIZES=1,20,100 ONLY="sync/push" …`. Thresholds: 1 mutation p95 < 500 ms; 100 mutations p95 < 1,000 ms (co-located).

##### F-API-4 · `settleSnagCode` reads every defect code on the job for every snag mutation, edits included
- Severity: Medium
- Requirement(s): R2
- Confidence: VERIFIED
- Where: `P:lib/server/snagging/sync-push.ts:415-456`, called at `:559` and in the retry loop `:606-610`
- What is wrong:
  - The "existing code" lookup and the full `readAllRows` over the job's snags run together in `Promise.all` (:422-434). The full read therefore happens even for an update, where the existing code returns immediately (:436).
  - A 500-defect job transfers ≈500 × 60 B ≈ 30 KB per snag mutation; above 1,000 defects it needs 2 serial pages.
- Evidence:
  ```
  :422 const [{ data: existing ... }, codes] = await Promise.all([
  :423   admin.from("snagging_snags").select("snag_code").eq("id", snagId).maybeSingle(),
  :424   readAllRows(... .select("id, snag_code").eq("job_id", jobId) ...),
  ```
- Impact:
  - 30 snag mutations on a 500-defect job pull ≈900 KB from DB to function.
  - It is +1 RT per mutation for jobs over 1,000 defects.
- Fix:
  - Skip it for `op === "update"`.
  - For inserts, try the device's code first and only on `23505` call a SQL function `snagging_next_snag_code(job_id, prefix)`, which runs `max(substring(...))` server-side.
  - Or read the codes once per touched job in the pre-read and allocate in memory.
- Effort: S   Risk: Low
- How to verify the fix: push 30 snag edits on a 500-defect staging job; PostgREST logs show 0 `snag_code` list reads. The `sync/push` write test p50 falls by ≥1 RT.

##### F-API-5 · Whole job fetch is ≈1.6 MB raw / ≈300–400 KB gz, 60% of it signed URLs, doubled with the parent
- Severity: **Critical**
- Requirement(s): R2 (payload)
- Confidence: VERIFIED shape; INFERRED byte counts (the script measures them)
- Where:
  - `P:app/api/snagging/sync/job/[id]/route.ts:129-157`
  - `P:lib/server/snagging/sync-children.ts:121-191`: photos select :149-157, signing :180-183, `linkOnly` :236-241
  - `P:lib/server/snagging/media.ts:129-197`: 100 per chunk, all chunks concurrent
  - Client triggers: `M:src/sync/pull.ts:442-453` (whole when no cursor, once a day, or when links are expiring), `:534-581`
- What is wrong:
  - The first open per day (and each link-expiry refresh, F-API-6) sends every defect and every photo row with a freshly signed URL. Signing 1,500 photos is 15 parallel `createSignedUrls` calls; a round with its parent makes 30.
  - Constant keys repeat on every row: `task_id` / `origin_task_id` equal the job id.
- Evidence (bytes per row, estimated from the selected columns and wire keys in `sync-children.ts:277-372`):

  | Rows | Count | Per row | Raw | gzip (est.) |
  |---|---|---|---|---|
  | snags | 500 | ≈700 B | 350 KB | ≈50 KB |
  | photos: 330 B of fields + ≈470 B signed URL (`…/object/sign/snagging/tasks/<uuid>/snags/<uuid>.jpg?token=<JWT≈290 chars>`) | 1,500 | ≈800 B | 1.2 MB | ≈280 KB (JWT signatures barely compress) |
  | areas | 60 | ≈550 B | 33 KB | |
  | checklist | 80 | ≈400 B | 32 KB | |
  | task | | | 3 KB | |
  | **total** | | | **≈1.6 MB** | **≈300–400 KB** |

  With `parent=true`, a round plus the original is ≈3.2 MB raw. With `include_catalogue` it is ≈3.7 MB raw / ≈0.7–0.9 MB gz.
  Server depth is 5–6 RT plus signing, giving p50 ≈1.4–1.7 s and p95 ≈2.5–3.5 s.
- Impact:
  - 4G at 10 Mbps takes ≈0.3–0.7 s to download it; a poor site at 2 Mbps takes 1.5–3.5 s.
  - RN `JSON.parse` of 1.6–3.7 MB plus a SQLite transaction of 2,000–4,000 rows takes seconds on a mid-range Android (INFERRED).
  - It breaks the 100 KB budget by 3–9×.
- Fix (contract):
  - (a) Stop signing in job payloads. Send `photos[]` without `signed_url` and hoist `task_id` to the top level. Add `POST /api/snagging/media/urls {ids: [...≤200]} → {urls: {id: url}, expires_at}`, called per screen for the visible tiles; the signed-URL cache already exists.
  - (b) Paginate contents: `GET /sync/job/{id}?contents=after:<snag_id>&limit=200` returns `{snags, photos(of those snags), next}`, ≈60 KB gz per page.
  - (c) The parent ("already on record") sends `{id, snag_code, area_id, defect_label, severity, status}` only, with photos only on demand.
- Effort: M   Risk: Med (the app's photo display must request links; the offline pack must call `/media/urls` before downloading)
- How to verify the fix: `ONLY="WHOLE" N=10 JOB_ID=<500-defect job> …`. Thresholds: gzKB < 100 per page, p95 < 1,000 ms.

##### F-API-6 · Signed-URL lifetime forces repeat whole fetches every 20–50 minutes on server-only photos
- Severity: High
- Requirement(s): R2, R7 (follow-up GETs)
- Confidence: VERIFIED mechanism; INFERRED frequency
- Where:
  - Server: `P:lib/server/snagging/media.ts:14` (TTL 3,600 s), `:86` (handed out while > 30 min remain).
  - Client: `M:src/sync/pull.ts:418` (10 min margin), `:451` (`linksExpiring` → whole fetch), `:468-483` (photos with no local file), `:618-635` (any screen read refreshes, 15 s throttle).
- What is wrong:
  - A URL can arrive with only 30 minutes left. Twenty minutes later, any read on the job (`listSnags`, `listAreas` and others, `M:src/db/repositories/jobs.ts:635,763,907,1159`) sees "expiring" and asks for the **whole** job again, and its parent too (`pull.ts:557`).
  - This hits exactly the photos the phone does not hold: a co-inspector's, carried photos on de-snag rounds, the parent's.
- Evidence:
  ```
  pull.ts:450  if (!Number.isFinite(fullAt) || Date.now() - fullAt > JOB_RECONCILE_MS) return null;
  pull.ts:451  if (await linksExpiring(taskId)) return null;     // null cursor = whole fetch
  media.ts:86  const REUSE_MARGIN_MS = 30 * 60 * 1000;
  ```
- Impact: a 4-hour de-snag round with 1,500 carried photos means ≈5–12 whole fetches × (round + parent ≈0.6–0.8 MB gz) ≈ **3–10 MB of polling per job**, with a 1.5–3.5 s server call each time.
- Fix:
  - Re-sign only the expiring links: client sends `POST /media/urls {ids: expiringIds}`, about 0.5 KB per URL, and `linksExpiring` no longer forces a whole fetch.
  - Or include `links_expire_at` and serve images through F-API-5(a).
- Effort: S–M   Risk: Low
- How to verify the fix: on staging, keep a round open for 90 minutes with the script's `GET sync/job/{id} WHOLE` disabled. App network log: 0 whole fetches after the first, and ≤ 1 `/media/urls` call per 30 minutes.

##### F-API-7 · `GET /sync/jobs?since=` costs 4 serial round trips when nothing changed, 6 when something did
- Severity: High
- Requirement(s): R2
- Confidence: VERIFIED; INFERRED timings
- Where: `P:lib/server/snagging/sync-pull.ts:269-274` (roots), `:400-404` (visits, parents), `:467-471` + `:1060-1121` (`changedJobIds`, 3 tables × chunks), `:712` (jobs), `:715-722` (`countRooms` after the jobs read when `since` is set), `:1124-1148`
- What is wrong:
  - The changed set depends only on job ids, but it is computed **after** the live/finished visits and parents have been read. On a no-op poll the visit reads are wasted.
  - Room counts come from reading every room row, paged 1,000 at a time **serially**.
  - The active list reads rooms for all active jobs: 60 jobs × 60 rooms = 3,600 rows, 4 serial pages, ≈320 KB DB→function.
- Evidence (depth):

  | Request | Steps | Depth | p50 |
  |---|---|---|---|
  | `since`, nothing changed | auth, roots, visits, changed | 4 | ≈0.9 s |
  | `since`, something changed | + jobs + rooms | 6 | ≈1.3 s |
  | `list=active` | auth, roots, visits, max(jobs, rooms 1–4 pages) | 4–7 | ≈0.9–1.5 s |
  | `list=done` | rooms after jobs | 5–6 | ≈1.1–1.3 s |

  Cold start adds 2 serial probe round trips (`hasAreaInspector` :232, then `hasJobInspectors` :253).
- Impact: this endpoint runs on every pull-to-refresh, every list delta and the 10-minute reconcile, which is 2 calls (`M:src/sync/pull.ts:870-884`). The no-op case is the common one.
- Fix:
  - SQL RPC `snagging_changed_jobs(p_user uuid, p_since timestamptz) returns setof uuid`, a UNION over jobs, visits and areas joined to the assignment, in 1 RT. Return `{tasks: [], server_time}` immediately when it is empty.
  - Room counts through `select job_id, count(*), count(confirmed_at) … group by job_id` (RPC or view).
  - Probes with `Promise.all`.
  - Target depth: 2 for no-op, 3 for changed.
- Effort: M   Risk: Low–Med
- How to verify the fix: `ONLY="sync/jobs" N=20 …`. Thresholds: "no-op poll" p95 < 300 ms; `list=active` p95 < 1,000 ms with 300 jobs.

##### F-API-8 · Job detail and the job bundle spend 5 serial round trips on the job screen's fields, twice per open
- Severity: High
- Requirement(s): R2
- Confidence: VERIFIED
- Where:
  - `P:app/api/snagging/sync/job/[id]/route.ts:72-100` (access: 6 queries at depth 1), `:121-125` / `:129-131`
  - `P:lib/server/snagging/sync-task-detail.ts:41-43` (detail, 4 queries), `:115` (`loadSigners` serial)
  - `P:lib/server/snagging/signoffs.ts:41-59` (rosters, then people + signoffs: 2 more RT)
  - Client: `M:app/(app)/job/[id]/index.tsx:145` (view=detail), then the inspect screens' `refreshJob` (`M:src/sync/pull.ts:646`)
- What is wrong:
  - The access checks must finish before `loadTaskDetail` starts.
  - `loadSigners` waits for the detail, then reads rosters again; `loadJobRosters` already ran inside `isOnJobRoster` (:99).
  - The bundle always recomputes `task`, even on an empty delta, so a delta is never cheaper than 5 RT. That `task` was fetched by `view=detail` seconds earlier.
- Evidence: depth = auth 1 + access 1 + detail 1 + rosters 1 + people/signoffs 1 = **5 RT ≈ 1.1 s**, on both `view=detail` and `?since` (empty delta).
- Impact: opening a job and starting work costs 2 calls × ≈1.1–1.7 s before any contents arrive.
- Fix:
  - Start `loadTaskDetail` speculatively alongside the access checks and discard it on 403.
  - Pass the roster already read into `loadSigners`.
  - Read signoffs for the job in the first wave and filter by the live visit in memory.
  - In the bundle, include `task` only when `job.updated_at > since`, a visit changed, or a sign-off happened (`If-None-Match`, F-API-9).
  - Target depth: 2.
- Effort: S–M   Risk: Low
- How to verify the fix: `ONLY="view=detail,delta" …`. Thresholds: p95 < 500 ms now, < 150 ms co-located.

##### F-API-9 · No cheap "unchanged" path: no ETag, If-None-Match, 304 or Cache-Control on any sync read
- Severity: Medium
- Requirement(s): R2
- Confidence: VERIFIED (grep for `Cache-Control|ETag|If-None-Match` across `P:app/api/snagging/**`: none in sync routes)
- Where: `P:app/api/snagging/sync/catalogue/route.ts:12-14` → `P:lib/server/snagging/sync-pull.ts:1168-1215`; `sync/access`; `sync/job/[id]`
- What is wrong:
  - "Catalogue unchanged" still costs a function invocation, auth and 3 count queries (≈0.45 s, `catalogueChangedSince` :1192-1215).
  - Job detail and access have no conditional path at all.
  - A first or changed catalogue resends the whole library: more than 1,000 defects per the comment at :1225-1228, ≈400–500 KB raw / ≈60–90 KB gz, depth 3 because defect pages are read serially (:1231-1253).
- Evidence: `catalogueForDevice` returns `null` after the counts; no header is set anywhere in the response path.
- Impact: every job open at least 10 minutes after the last check pays ≈0.45 s of server time for "nothing changed"; `/sync/access` runs on every sign-in.
- Fix:
  - A `snagging_catalogue_version` row bumped by trigger on the three tables.
  - Return `catalogue_version` in the `/sync/jobs` response so the app calls the catalogue only when it differs.
  - Serve `ETag: "<version>"` and `If-None-Match → 304` (1 cheap query).
  - Job detail: `ETag = hash(job.updated_at, max(visit.updated_at), max(signoff.signed_at))`.
- Effort: S   Risk: Low
- How to verify the fix: `ONLY="catalogue_since" …`. The `etag seen: yes` line appears; the unchanged call has p95 < 200 ms and a body < 100 B (or 304).

##### F-API-10 · `sendSoon` adds a fixed 600 ms gather to every save before the request starts
- Severity: Medium
- Requirement(s): R2 (tap to confirmed), R7
- Confidence: VERIFIED
- Where: `M:src/sync/sendSoon.ts:22,61-62` (trailing timer), `:57-60` (the in-flight `again` path already batches)
- What is wrong: even a lone tap waits 600 ms before anything goes out. Taps that arrive while a request is in flight are already folded into the next run by `again`, so the trailing timer only helps the first tap of a burst.
- Evidence:
  ```
  sendSoon.ts:22  const GATHER_MS = 600;
  sendSoon.ts:62  timer = setTimeout(() => void run(), GATHER_MS);
  ```
- Impact: +600 ms on every row of Appendix D.
- Fix: leading-edge send. When `!running`, run after ≈50–100 ms (to coalesce a single gesture's double writes) and let `again` batch everything that arrives while it runs.
- Effort: S   Risk: Low (the outbox merges updates anyway, `M:src/sync/outbox.ts:109-133`)
- How to verify the fix: instrument tap → `sync_state='synced'`. The median drops by ≥ 500 ms; the number of requests in a 10-tap checklist burst stays ≤ 3.

##### F-API-11 · Direct-to-storage media (video, or a photo over 2.5 MB) takes 5 network calls to confirm
- Severity: High
- Requirement(s): R7, R2
- Confidence: VERIFIED
- Where:
  - `M:src/sync/sendWithMedia.ts:192-197` (video and >2.5 MB skipped), `M:src/sync/sendSoon.ts:97-106` (leftover → `syncNow`)
  - `M:src/sync/engine.ts:189` (first round `withChanges`), `:219-234`
  - `M:src/sync/uploader.ts:294-303` (sign), `:316-327` (PUT), `:356-379` (enqueue photo row), `:18-31,277` (whole file read into memory)
  - Server: `P:app/api/snagging/media/sign/route.ts:45-79` (3–5 RT)
- What is wrong:
  - Save defect with a video, in sequence:
    1. `POST /sync/push` (the defect).
    2. `POST /sync/snag` with an empty body plus `since`. This is a list check only, because `syncNow` round 0 asks `withChanges`.
    3. `POST /media/sign`.
    4. `PUT` to storage.
    5. `POST /sync/snag` (photo row plus `since`).
  - Four of these are API calls, with at least 3 serial before the office knows the clip exists.
  - The video is read into a `Uint8Array` before upload, so memory ≈ file size.
- Evidence: `uploader.ts:277 const read = await readCaptured(photo.local_path);` then `:319 uploadToSignedUrl(..., bytes, ...)`.
- Impact: ≈0.6 + 1.3 + 1.1 + 0.9 + PUT + 2.6 s of serial server time before the clip is registered. A 50 MB clip read into the JS heap risks out-of-memory on low-end Android.
- Fix (contract):
  - (a) Server-side registration at sign. `POST /media/sign` takes `items[]` with full metadata. It inserts each `snagging_snag_photos` row with `upload_state='pending'` and returns `[{id, path, signed_url, token}]`. A Postgres trigger on `storage.objects` (bucket `snagging`, `tasks/%/snags/%`) marks the row uploaded, so no follow-up push is needed.
  - (b) Piggy-back. `/sync/snag` accepts `direct: [{id, content_type, bytes}]` and returns `uploads: [...]` in the same response, so the defect, the signed upload and the registration are **1 API call + 1 PUT**.
  - Drop the list-only round: from `sendSoon` call `uploadPending` directly, or pass `listFresh: true`.
  - Stream uploads with `FileSystem.uploadAsync`, which supports background sessions.
- Effort: M   Risk: Med (the trigger must ignore portal uploads; the portal must hide `pending` rows)
- How to verify the fix: record a 20 MB video on staging. The app network log shows ≤ 2 requests (1 API + 1 PUT), and the photo row is visible in the portal right after the PUT completes.

##### F-API-12 · Push results do not echo canonical rows; the next job delta re-downloads the device's own writes
- Severity: Medium
- Requirement(s): R7
- Confidence: VERIFIED
- Where:
  - `P:lib/server/snagging/sync-push.ts:57-63,330-337`: the result is only `{mutation_id, status, error?, snag_code?}`.
  - Server-decided values are written but not returned: `visit_id` :589, `created_by` :598, verdict write-through :934, submission `locked` :1256.
  - Client cursor: `M:src/sync/push.ts:122-168` never moves `children_cursor`; `M:src/sync/pull.ts:890-899` moves it only after a job fetch.
- What is wrong:
  - The phone confirms the save (good) but cannot know the values the server decided.
  - The next `GET /sync/job?since` returns every row the device wrote since the last fetch, because each upsert bumps `updated_at`. That includes its photos, each **re-signed**.
- Evidence: `MutationResult = { mutation_id; status; error?; snag_code? }` (:57-63).
- Impact: an inspector who saves 100 defects and 300 photos, then reopens the screen 15 s later, re-downloads ≈100 × 0.7 KB + 300 × 0.8 KB ≈ 310 KB raw (≈80 KB gz) of their own data, plus 3 signing batches.
- Fix (contract): add `row` to applied results, for example `{"mutation_id":"…","status":"applied","row":{"updated_at":"…","snag_code":"…","visit_id":"…","created_by":"…","locked":false,"status":"open"}}`. The client stores it and records `own_updated_at` per row. Either the job delta accepts `device_id` and excludes rows whose last write came from that device after `since` (a `last_device_id` column set by the push), or the client skips rows where `updated_at <= own_updated_at`.
- Effort: M   Risk: Low
- How to verify the fix: push 20 defects, then `GET /sync/job/{id}?since=<pre-push cursor>&device_id=…` returns 0 of them. Script `delta` gzKB < 2.

##### F-API-13 · "Mark all read" does not use `read_all`: with more than 200 unread the response puts the badge back
- Severity: Medium (High for users with large backlogs)
- Requirement(s): R7
- Confidence: VERIFIED
- Where: `M:src/sync/alerts.ts:365-378` (marks local rows only; `KEEP=200` :104), `:270` (sends ≤ 500 ids), `:314-327` (badge = server count); `P:app/api/snagging/sync/alerts/route.ts:17,102-108` (`read_all` supported, unused), `:126-138` (delta re-sends every row read)
- What is wrong:
  - With 3,000 unread, the phone holds 200, marks those, and sends their ids.
  - The server marks 200 and answers `unread: 2800`.
  - `unreadAdjust = 2800 - 0 - 0`, so the badge jumps back to 2,800. The response contradicts the action.
  - The delta also sends back the 200 rows just read, ≈90 KB raw.
- Evidence: `alerts.ts:276 body: { since, read: read.length ? read : undefined }`, with no `read_all`.
- Impact: "Mark all" appears broken for any user with more than 200 unread. Fixing it naively with `read_all` makes the delta return all 3,000 rows (≈1.35 MB raw).
- Fix: the client sends `{read_all: true}`. The server, on `read_all`, skips re-sending the rows it marked read in this request (filter `read_at.gt.since` with `read_at <> serverTime`) and returns `{unread: 0, read_applied: n, server_time}`.
- Effort: S   Risk: Low
- How to verify the fix: seed 300 unread on staging, tap "Mark all". The badge is 0 after the response and the response is < 5 KB (script `sync/alerts (delta)`).

##### F-API-14 · Submit and sign-off: confirmation is in the response but the UI ignores it or makes a second call
- Severity: Medium
- Requirement(s): R7
- Confidence: VERIFIED
- Where: `M:app/(app)/job/[id]/inspect/review.tsx:515-549` (`setDone(true)` :540 before `void syncNow()` :543); `:478-503` (sign-off, then `sendSoon` :498); `:131` (`refreshJobDetail(id, {force: true})` on each open to learn others' sign-offs); `P:lib/server/snagging/sync-push.ts:991-1014` (sign-off returns nothing beyond status)
- What is wrong:
  - The success screen appears before the server has accepted the submission. If the server refuses it (for example "2 snag(s) still have no photo uploaded", :1120), the reason only surfaces later on the Sync screen. The inspector may already have left site.
  - Sign-off returns no team state, so the review screen makes a second request, `GET view=detail` (5 RT, F-API-8), to learn who has signed.
- Evidence: `review.tsx:540 setDone(true);` then `:543 void syncNow();`.
- Impact: a false "submitted" signal at the moment it matters most, plus one redundant ≈1.1 s call per review-screen open.
- Fix (contract):
  - The submission result carries `{"status": "applied", "job": {"status": "submitted", "locked": true, "submitted_at": "…"}}` or `{"status": "rejected", "error": "…"}`.
  - The sign-off result carries `signoffs: [{id, name, signed_at}]` (the existing `loadSigners`).
  - The review screen awaits the submission's own result when online. It shows "Sent to the office" on applied and the error inline on rejected; offline it shows "Queued".
- Effort: S   Risk: Low
- How to verify the fix: submit a job with one photo-less defect on staging. The screen shows the server's reason within the same request, and no `GET view=detail` appears after a sign-off in the network log.

##### F-API-15 · Serverless limits: no `maxDuration`, the ledger is written only at the end, and the 500-id seen-check
- Severity: Medium
- Requirement(s): R2
- Confidence: VERIFIED config; INFERRED platform defaults
- Where: no `maxDuration` in `P:app/api/snagging/**` (grep; only scheduling and service-resources routes set it); `P:lib/server/snagging/sync-push.ts:316-323` (ledger after all waves), `:122` (seen-check `.in` over every id); `M:src/lib/api.ts:129` (5xx and 504 are retryable)
- What is wrong:
  - On legacy (non-Fluid) Vercel, the defaults are 10 s on Hobby and 15 s on Pro (INFERRED).
  - A 100-mutation push is ≈5 s and a 500 batch ≈21 s. A whole fetch with cold signing can take several seconds.
  - On timeout nothing has reached the ledger, so the phone retries the whole batch and every applier runs again: idempotent upserts, but double the work.
  - 500 ids in one `in.()` is past the URL limit the codebase documents.
- Evidence: `ledger.push(...)` in `runOne` (:281-302) is persisted only at :317-321.
- Impact: timeouts amplify into retry storms after long offline stretches, which is when backlogs are biggest.
- Fix:
  - `export const maxDuration = 60` on `sync/push`, `sync/snag`, `sync/job/[id]`.
  - Seen-check via `readAllByIds` (`ID_CHUNK` 150).
  - Upsert the ledger per wave.
  - Lower the server cap to 100 mutations, matching the client.
- Effort: S   Risk: Low
- How to verify the fix: `ALLOW_WRITES=1 PUSH_SIZES=100 …` never returns 504. A forced timeout followed by a retry yields `duplicate` for the waves that had finished.

##### F-API-16 · Request-body budget counts files only and can reach Vercel's 4.5 MB hard limit; a 413 then loops
- Severity: Low
- Requirement(s): R2
- Confidence: VERIFIED code; INFERRED worst case
- Where: `M:src/sync/sendWithMedia.ts:42,196-199` (files ≤ 3.5 MiB), `:294-309` (JSON of up to 100 mutations added on top); `P:lib/server/snagging/sync-push.ts:968` (signature base64 ≤ 700,000 chars); `M:src/sync/sendWithMedia.ts:351` (a 4xx is rethrown, the batch is not shrunk)
- What is wrong: worst case ≈3,670,016 B of files + 700,000 B of signature + ≈60 KB of JSON + multipart overhead ≈ 4.43 MB, against a 4,718,592 B limit (94%). A 413 is non-retryable, so the same bundle is rebuilt and fails on every sync.
- Evidence: see the lines above.
- Impact: rare but sticky, since the queue never drains without intervention.
- Fix: count `JSON.stringify(body).length` against a single 3.0 MB budget. On a 413, halve the photos, then the mutations, and retry.
- Effort: S   Risk: Low
- How to verify the fix: a staging submission with a 650 KB signature plus 3.4 MB of photos goes through in two requests, with no 413.

##### F-API-17 · NOC, gate pass and history: 4–6 serial round trips for a small answer
- Severity: Low
- Requirement(s): R2
- Confidence: VERIFIED
- Where: `P:app/api/snagging/tasks/[id]/noc/route.ts:51-57,68-74,85,100-102`; `.../gatepass/route.ts:42,46-52,56-62,69,80-82`; `P:app/api/snagging/snags/[id]/history/route.ts:53-57,62,65-78,90-97`
- What is wrong: the job select, then `mayWriteJob` (depth 2), then two signing calls one after the other. History is snag, then family, then legs, then audit.
- Evidence: `noc/route.ts:85 await signPaths(...)` followed by `:100 await admin.storage...createSignedUrl(...)`.
- Impact: ≈0.9–1.3 s per tap at the door.
- Fix: `Promise.all` the two signatures; run `mayWriteJob` alongside the job select; embed the snag and family in one select. Target depth 2–3.
- Effort: S   Risk: Low
- How to verify the fix: `ONLY="noc,gatepass,history" …` p95 < 1,000 ms (< 200 ms co-located).

##### F-API-18 · Client timeouts of 15–120 s and no staged progress, against a 1 s budget
- Severity: Low
- Requirement(s): R2 (UX)
- Confidence: VERIFIED
- Where: `M:src/lib/api.ts:77` (30 s default); `M:src/sync/push.ts:90` (60 s); `M:src/sync/sendWithMedia.ts:317` (120 s); `M:src/sync/uploader.ts:148` (120 s per object); `M:src/features/auth/authStore.ts:58` (15 s); `M:src/sync/alerts.ts:277` (15 s); `M:src/sync/pull.ts:677` (20 s)
- What is wrong:
  - A 3–5 s server answer cannot be told apart from a stall until the timeout fires.
  - Saves do not block the UI (good: `M:src/features/inspection/inspectionStore.ts:349` does not await), but per-item "sending" and "sent" state is only the sync badge.
  - Each 401 costs a refresh plus a retry, 2 more calls (`api.ts:69-71`). `getAccessToken` may itself refresh the token over the network (`M:src/lib/supabase.ts:99-103`).
- Fix: show per-row state from `sync_state` and the outbox. Lower the push timeout to 15 s and the snag timeout to 45 s; requests are idempotent, so retries are safe. Refresh the token proactively when it expires within 60 s.
- Effort: S   Risk: Low
- How to verify the fix: throttle to 1 Mbps on staging; the row shows "sending" within 100 ms and "sent" once the response arrives.

##### F-API-19 · Sign-in and the 10-minute reconcile make redundant calls
- Severity: Low
- Requirement(s): R2, R7
- Confidence: VERIFIED
- Where: `M:src/features/auth/authStore.ts:56-64` (`/sync/access`); `M:src/sync/engine.ts:384` (`/sync/jobs`), `:359` → `M:src/sync/alerts.ts:407` (`/sync/alerts`, which also returns `me`); `M:src/sync/pull.ts:870-884` (reconcile = delta, then the full active list, 2 serial calls); `M:src/db/repositories/jobs.ts:564`
- What is wrong:
  - Sign-in is Supabase auth, then access, then jobs and alerts: 4 HTTP calls plus a WebSocket. Identity and role come back twice.
  - The reconcile makes two list calls where one would do.
- Fix: `/sync/access` returns `{me, role, unread, cards: <first active page>, catalogue_version}`, or `/sync/jobs` carries `me` and `unread`. The reconcile becomes one call that returns the changes plus the active id set.
- Effort: S   Risk: Low
- How to verify the fix: the network log at sign-in shows ≤ 2 API calls after auth, and a reconcile is 1 call.

---

### 4.4 Field-level fetching and offline completeness (R6, R3)

#### Method notes

**Scope.** Phase 5 (R6) and Phase 6 (R3), read-only.
**Code read.** Mobile `yfi-mobile-app/YFI-MobileApp` at `04ce640`. Portal `Yalla Fixit` at `b626c4f`.
**Rules.** I modified no source, config, database or server. Every claim has a file:line. **VERIFIED** means I traced the code path end to end. **INFERRED** means it depends on runtime behaviour or data I did not observe. In those cases the assumption is stated and a device test is given.

Paths are shortened as follows:
- `M:` = `yfi-mobile-app/YFI-MobileApp/`
- `P:` = `Yalla Fixit/`
- `job/[id]` = `M:app/(app)/job/[id]`

**Byte estimates.** I measured no payloads, because production is off limits. Sizes are worked out from the wire shapes, using these row sizes (JSON, uncompressed, keys included):

| Row | Estimate | Derivation |
|---|---|---|
| Signed URL | ~400 B | ~162 chars of host and path, plus `?token=` and a ~230-char storage JWT |
| Photo row (`shapePhoto` + `signed_url`) | ~700 B | 12 small fields (~300 B) plus the URL |
| Snag row (`shapeSnag`) | ~775 B | 21 fields; uuids are 36 chars |
| Checklist row | ~370 B | 12 fields |
| Room row | ~475 B | 17 fields, with no zone outline |
| Job card | ~550 B | 20 fields plus a short `finished_visits` list |
| Captured photo file | ~300 KB average, 1 MB maximum | `M:src/features/inspection/mediaCapture.ts:15-31,51-52` describes "a few hundred KB" |

The reference job used below is **"J-60"**: 10 rooms, 60 snags, 150 photos, 40 checklist items, 2 floor plans.

---

#### Summary verdict

##### R6 — over-fetching / field level: **PARTIAL PASS**

The wire shapes have been trimmed carefully, and it shows:
- Cards carry 3 property fields (`P:lib/server/snagging/sync-pull.ts:872-913`).
- Opening a job asks for `view=detail` only (`M:src/sync/pull.ts:665-690`).
- The storage path is dropped when a signed URL exists (`P:lib/server/snagging/sync-children.ts:236-241`).
- `active: true` is dropped from the catalogue (`sync-pull.ts:1168-1190`).
- There is no `SELECT *` in the app's SQLite reads. The one `page.*` (`M:src/db/repositories/jobs.ts:501`) projects a CTE whose columns are all named.

Field-level waste in the JSON is small: under 6% on cards and on detail. The real over-fetch is in three other places:

1. **Images (F-FLD-1, F-FLD-2).** There are no thumbnails anywhere. A full photo of up to 1 MB at 1080 px is downloaded and decoded for every 56–60 px tile. The image cache is keyed by URL, and the URL changes roughly every hour as links are re-signed.
2. **Rows nobody reads (F-FLD-4).** The parent job's snags, photos and checklist are fetched, and the offline pack downloads every parent photo to disk. No screen reads any of it except the parent's floor plans.
3. **Payload re-sent for the wrong reason (F-FLD-3, F-FLD-8).** Renewing links refetches the whole job. Every delta of `/sync/job/{id}` re-sends the full task detail, and the parent's too.

##### R3 — offline completeness: **FAIL (one Critical, three High)**

The core offline write path is sound. Captures land in `Documents/captures` before their path is recorded (`M:src/sync/persistCapture.ts:18-38`). The outbox commits with the row. Cold launch works with no signal (`M:src/features/auth/authStore.ts:92-104`). Reconciles never delete unsent work (`pull.ts:905-918, 1099-1146`).

What fails is the **offline pack and its readiness gate**:
- The pack reports "Ready for offline" after downloading nothing whenever its records request fails (**F-OFF-1, Critical**).
- An active job cannot be started offline at all unless it was opened and packed while online (**F-OFF-2**).
- `pack_state = 'ready'` is never checked again, and photos that arrive after the pack are never downloaded (**F-OFF-3**).
- A de-snag round whose original job is not on the phone has its floor plan deleted by the next 10-minute reconcile (**F-OFF-4**).

Display-side gaps:
- A plan held only as a remote link is treated as present, so pins can be placed on a blank image (**F-OFF-5**).
- Several image views have no fallback when the remote link fails (**F-OFF-6**).
- The NOC and gate pass, needed "at the door", are online-only (**F-OFF-9**).
- The sign-out copy says "Everything is synced" while photos are still on the phone (**F-OFF-10**).

---

#### Findings

##### F-OFF-1 · Offline pack reports "Ready for offline" when nothing was downloaded
- **Severity:** Critical
- **Requirement:** R3
- **Confidence:** VERIFIED
- **Where:** `M:src/sync/offlinePack.ts:278`, `:300`, `:306`, `:318-331`; `job/[id]/index.tsx:207-232`

**What is wrong.** The records step, `pullJob(taskId, { full: true, bundle: true })`, swallows every failure with `.catch(() => undefined)`. When it fails, the job's rooms, snags, photos, checklist and plans may never have reached SQLite. `cacheFloorPlans` and `cacheSnagPhotos` then find zero rows. `verifyPack` counts zero plans missing, and `pack_state` is set to `'ready'`. The card shows "Ready for offline" ("Floor plans, areas and the defect list are on this phone"), and the Start CTA unlocks.

This happens whenever the request fails: in a basement, on a dropped connection, on a server 500, or on a 30 s timeout. It is exactly the false promise the comment at `offlinePack.ts:11-15` says was fixed.

**Evidence:**
```ts
// offlinePack.ts:278
await pullJob(taskId, { full: true, bundle: true }).catch(() => undefined);
// offlinePack.ts:328-331
await rawDb.runAsync(`UPDATE inspection_tasks SET pack_state = ? WHERE id = ?`, [
  check.plansMissing === 0 ? 'ready' : 'none', taskId ]);
// index.tsx:218-228 — plansFailed 0 → setPack('ready'); toast downloadReady
```

**Impact.**
- The inspector taps Download in a dead zone after opening the job online, so the details are present and the pack card is visible (`index.tsx:320-352`).
- They get "Ready for offline", then open Rooms, which says "No areas on this job yet" (`job/[id]/inspect/index.tsx:222-233`).
- The plan shows "not downloaded" or blank, and there is no catalogue if this is the first job.
- This holds for 100% of packs attempted while the records request fails.

**Fix.**
- Make the records step mandatory. Let `pullJob` throw. Then require `children_at IS NOT NULL` and a non-null `children_full_at` newer than the start of this pack before writing `'ready'`.
- Make `verifyPack` also check that the job has at least one room or checklist row, or record a server-sent `children_count` and compare against it.
- Disable the Download button while `!online`, with "Needs a connection".

**Effort / risk:** S / Low

**How to verify the fix.** Open the job online so the details load, switch to airplane mode, tap Download.
- **Pass:** an error such as "No connection — nothing downloaded"; `pack_state` stays `'none'`; the CTA stays disabled.
- Repeat with the server returning 500 (proxy or Charles). Same pass criterion.

---

##### F-OFF-2 · An active job cannot be started offline unless it was opened and packed online; a persistent plan failure blocks it even online
- **Severity:** High
- **Requirement:** R3
- **Confidence:** VERIFIED for the gate. The trigger for a persistent plan failure is INFERRED.
- **Where:**
  - `job/[id]/index.tsx:252-262` (gate), `:320-345` (details-missing state), `:352-405` (pack card shown only after the details load)
  - `offlinePack.ts:328-331`
  - `M:src/sync/floorPlanCache.ts:101-119`
  - `P:lib/server/snagging/media.ts:113-116` and `sync-children.ts:236-241`

**What is wrong.** The CTA is `disabled = detailsPending || (!readOnly && pack !== 'ready')`:
- A job that was assigned and synced as a card, but never opened with signal, shows "This job's details aren't on the phone yet" offline. There is no way to start it.
- A job that was opened but not packed shows "Download the job first", which needs signal.

The second case also happens online:
- If a plan's signing fails, `signChunk` returns an empty map for the whole chunk of 100 paths (`media.ts:113-116`).
- `linkOnly` then keeps the bare `storage_path`, and `remote_path` stores a non-URL.
- `cacheFloorPlans` calls `downloadFileAsync("tasks/…")`, which always fails.
- `plansMissing > 0` keeps `pack_state` at `'none'`, so the CTA stays blocked until a later full fetch re-signs the plan. A missing storage object does this permanently.

**Evidence:**
```ts
// index.tsx:252-256
const detailsPending = row ? !row.detailLoaded : false;
const canStart = pack === 'ready';
const ctaDisabled = detailsPending || (!phase.readOnly && !canStart);
```

**Impact.**
- Any job added mid-shift, or any job the inspector forgot to pack, is unworkable in a no-signal site.
- There is no "start anyway, plans later" path, even though capture itself (snags, rooms by name, checklist) needs no plan.
- A plan whose object is missing in storage locks the job for every inspector.

**Fix.**
1. Let an active job start once `children_at` is set, even when not packed. Show a non-blocking banner, "Plans/photos not on this phone", and let the floor plan screen show its own "not downloaded" state, which already exists (`floorplan.tsx:1136-1143`).
2. In `cacheFloorPlans`, skip rows whose `remote_path` is not `http*` and report them as "needs re-sign", not as failed. Trigger `refreshJob(id, { full: true })` once.
3. On the jobs list, auto-pack today's active jobs while on Wi-Fi or with good signal. This would be bounded per job, so it does not break the per-screen rule in memory note `mobile-sync-per-screen`.

**Effort / risk:** M / Med

**How to verify the fix.**
- **Case 1:** Assign a job, let the list sync, never open it, go offline, open it. **Pass:** the details-missing state explains the job cannot be worked, and Start is offered only if `children_at` is set.
- **Case 2:** Point one plan at a deleted object and tap Download. **Pass:** the job still starts; the plan screen shows "not downloaded".

---

##### F-OFF-3 · `pack_state='ready'` is never re-verified; media arriving after the pack is never downloaded
- **Severity:** High on shared and multi-inspector jobs, Medium otherwise
- **Requirement:** R3
- **Confidence:** VERIFIED
- **Where:**
  - `M:src/features/jobs/toJobSummary.ts:224`; `job/[id]/index.tsx:134`
  - `offlinePack.ts:194-212` (the only photo downloader)
  - `pull.ts:1944-1973` (pulled photos are inserted with `local_path ''`)
  - `M:src/sync/freeSpace.ts:26-33,56`

**What is wrong.** `packReady` is read straight from the stored column, and nothing recomputes it. Three things make the stored value wrong:
- **New photos stay remote.** Photos that reach the phone after the pack has finished stay remote-only. These include a co-inspector's snags on a shared job (every snag on the job is sent, `sync-children.ts:88-95`), office edits, and photos copied into a round. Only `downloadJobPack` downloads photos, and nothing calls it automatically.
- **Evicted files.** "Free up space" blanks `local_path` for approved and delivered jobs (`freeSpace.ts:56`), and nothing marks those jobs as no longer packed.
- **Plans.** These are covered, because the engine re-caches plans for opened active jobs after each sync (`engine.ts:242-246`, `floorPlanCache.ts:46-53`).

**Evidence:**
```ts
// pull.ts:1950-1955 — a pulled photo row
photo.id, photo.snag_id, photo.task_id, '', chooseLink(held, photo.signed_url ?? photo.storage_path)
// toJobSummary.ts:224
packReady: job.packState === 'ready',
```

**Impact.** On a two-inspector job, everything the other inspector captured after this phone packed shows as blank tiles offline (F-OFF-6). Each such photo also keeps `linksExpiring()` true, which forces a whole-job refetch roughly every 20–50 min while the job is on screen (F-FLD-3).

**Fix.**
- After each `applyJobPayload` for a job with `pack_state='ready'`, queue a bounded background download of new remote-only photos. Reuse `fetchPhoto`, with a concurrency of 2.
- Recompute readiness with `verifyPack` when the job opens and show "N items not on the phone".
- Have `freeUpSpace` reset `pack_state` for the jobs it touches.

**Effort / risk:** M / Low

**How to verify the fix.** Phone A packs a shared job. Phone B adds a snag with a photo. Phone A syncs, then goes offline and opens the snag.
- **Pass:** the photo renders from `Documents/snagphotos`, and `SELECT local_path FROM snag_photos WHERE id=…` is non-empty.

---

##### F-OFF-4 · A de-snag round's floor plan (the parent's) is deleted by the next reconcile when the parent job is not on the phone
- **Severity:** High
- **Requirement:** R3
- **Confidence:** VERIFIED for the deletion path. How often the parent is absent is INFERRED.
- **Where:**
  - Rounds use the parent's plans: `floorplan.tsx:170-175`, `desnag/index.tsx:351-364`, `verify/[snagId].tsx:118`, `M:src/features/inspection/CaptureSheet.tsx:408-411`
  - `pull.ts:549-560` (the bundle includes the parent only when its row exists)
  - `pull.ts:1593-1615` (`applyTaskDetail` is an UPDATE)
  - `pull.ts:967-976` (orphan purge)
  - `offlinePack.ts:229-235,295-303`
  - `sync-pull.ts:474-478` (the list sends a finished parent only on Done pages)

**What is wrong.** The sequence is:
1. A round with no plans of its own reads `listFloorPlans(parentTaskId)`. That calls `refreshJob(parent)`, which downloads the parent's whole contents (`pull.ts:571`).
2. If the parent's card has never reached the phone, the parent has no `inspection_tasks` row. Its finished card arrives only when the Done tab is paged (`sync-pull.ts:474-478`). So `applyTaskDetail` updates nothing, and `children_cursor` is never set. Every refresh of the parent is therefore a whole fetch.
3. The parent's `floor_plans`, `snags` and `snag_photos` rows are now orphans.
4. The next `reconcileCards` runs every 10 minutes from any job-list read (`pull.ts:795, 866-884`). It deletes every orphan row and the plan files on disk (`pull.ts:967-976`, `collectFiles`).
5. `verifyPack` checks only the family's plans, so the round reports `'ready'` without the parent's plan (`offlinePack.ts:229-235`).

**Evidence:**
```ts
// pull.ts:967-976
const orphan = `task_id NOT IN (SELECT id FROM inspection_tasks)`;
await collectFiles(files, photoGone, orphan);
await rawDb.runAsync(`DELETE FROM floor_plans WHERE ${orphan}`);
```

**Impact.** On a de-snag round whose original is not a card on the phone (a fresh install, or the inspector never opened Done):
- Online, the plan appears, then disappears within 10 minutes and is re-downloaded on the next view.
- Offline, there is no plan, so defects cannot be shown on it. The round still says "Ready for offline".

**Fix.**
- When applying a parent payload whose task row is missing, insert a minimal `inspection_tasks` row: `id`, `code`, `status`, plus `pack_state='none'`. The server already sends `task` (`route.ts:160-171`).
- Alternatively, exclude jobs referenced by a live job's `parent_task_id` from the orphan purge.
- Have `verifyPack` include `parent_task_id`'s plans when the round has none.

**Effort / risk:** S / Low

**How to verify the fix.**
1. Fresh install. Do not open Done. Open a round, open its floor plan online, tap Download.
2. Wait 11 minutes on the jobs list, then go offline and open the floor plan.
3. **Pass:** the plan renders, and `SELECT COUNT(*) FROM floor_plans WHERE task_id=<parent>` is greater than 0 both before and after the wait.

---

##### F-OFF-5 · The floor plan treats a remote-only (expired or offline) plan as present and enables pinning on a blank image
- **Severity:** Medium
- **Requirement:** R3
- **Confidence:** VERIFIED
- **Where:** `floorplan.tsx:224-231`, `:1155-1163`; `jobs.ts:55-60,1180-1184`

**What is wrong.** `hasPlan = Boolean(plan.uri)`, and `uri` falls back to the signed remote URL whenever there is no local file. The comment at `:224-228` says "Only a downloaded plan can be pinned on", but the code allows a remote-only plan. Offline, or once the link has expired, `<Image>` fails. `onError` only logs to the console, the skeleton is not shown because `planUri` is non-null, and every capture control stays enabled over a blank box.

**Evidence:**
```ts
// floorplan.tsx:229-231
const planUri = plan?.uri ?? null;
const hasPlan = Boolean(planUri);
const noPlan = plansLoaded && !hasPlan;
```

**Impact.** Pins are dropped blind. The positions are stored as 0..1 fractions, so they stay valid, but the inspector cannot see where they are. This affects any read-only or finished job opened offline, and any active job reached through F-OFF-2's proposed relaxation.

**Fix.**
- Use `hasPlan = plan.cached || (online && signedUrlExpiresAt(plan.uri) > Date.now())`.
- On `onError`, set a `planFailed` state that renders the existing `planNotDownloaded` empty state.

**Effort / risk:** S / Low

**How to verify the fix.** Use a job with a plan that was never cached. Go to airplane mode and open the floor plan.
- **Pass:** the "Floor plan not downloaded yet" empty state shows; the Add snag and Pin area controls are hidden.

---

##### F-OFF-6 · Remote-only images have no offline or expired fallback in five components
- **Severity:** Medium
- **Requirement:** R3
- **Confidence:** VERIFIED
- **Where:**
  - `M:src/ui/MediaThumb.tsx:35-36` (no `onError`)
  - `job/[id]/inspect/area/[areaId].tsx:449-450`
  - `desnag/index.tsx:684-688`
  - `snag/[snagId].tsx:602` (marker editor)
  - `M:src/features/inspection/PlanPinView.tsx:89-90`
  - `PlanFullScreen.tsx:235-236`
  - `floorplan.tsx:1437-1438` (plan picker thumbnail)

**What is wrong.** All of these render `<Image source={{uri}}>` with neither an error state nor a placeholder. When `local_path` is `''` and `remote_path` holds a signed link, they draw an empty tile once offline or once the link has expired. That covers every pulled photo that was not packed, the evicted files of finished jobs, and co-inspector photos (F-OFF-3). The tile looks the same as "no photo".

`EvidenceMedia`'s `LoadingImage` does this correctly, with a spinner and "Couldn't load" (`M:src/ui/EvidenceMedia.tsx:121-171`), but it is used only for the hero image and the viewer. The marker editor also accepts taps on the blank photo.

**Evidence:**
```tsx
// MediaThumb.tsx:35-36
{still ? (<Image source={{ uri: still }} style={styles.fill} resizeMode="cover" />) : video ? ...}
```

**Impact.** Offline, the inspector cannot tell "photo not on the phone" from "no photo". A row with `photos > 1` shows a count badge over a blank tile.

**Fix.**
- Extract `LoadingImage` and use it in `MediaThumb` and the five sites above.
- Add an offline-aware placeholder: a `CloudOff` glyph with "Not on phone".
- Disable marker editing while `!cached && !online`.

**Effort / risk:** S / Low

**How to verify the fix.** On a non-packed finished job, go to airplane mode and open a room with server photos.
- **Pass:** every tile shows the "not on phone" placeholder; none is a bare grey square.

---

##### F-OFF-7 · Offline submit is impossible, and the drawn signature is lost if the inspector leaves Review
- **Severity:** Medium (a product decision, but it limits R3)
- **Requirement:** R3
- **Confidence:** VERIFIED
- **Where:** `job/[id]/inspect/review.tsx:416`, `:452`, `:475`, `:520-538`, `:887-893`; `M:src/features/inspection/SignaturePad.tsx:37-39`

**What is wrong.** Every check list ends with `{ label: checkOnline, ok: !offline }`, and `canSubmit` requires all checks plus all uploads. The submission write path itself works offline: it queues the signature with the submission (`:520-526`). The UI forbids using it.

The signature strokes live only in `SignaturePad`'s `useState`. Leaving Review to wait for signal discards them, and the inspector must sign again.

**Evidence:**
```ts
{ label: strings.review.checkOnline, ok: !offline },          // review.tsx:416, :452
const canSubmit = (iSigned || signed) && activeChecks.every((c) => c.ok); // :475
```

**Impact.** The inspector cannot finish a job in the basement. They must stay until signal returns and every upload completes. On a 150-photo job at 1 Mbit/s uplink that is about 150 × 300 KB × 8 / 1 Mbit ≈ 6 min of standing still, longer on poor signal.

**Fix.**
- Option A: allow "Submit when back online". Queue the submission locally, show the job as "Submitted — waiting for signal", and let the server keep refusing until uploads land.
- Option B: at least persist the signature PNG to `Documents/captures` with a draft row, so it survives navigation.

**Effort / risk:** M / Med (server-side ordering of the submission against the uploads)

**How to verify the fix.** Offline, sign and submit, then kill the app and reconnect.
- **Pass:** the submission reaches the server after the photos, with the signature attached. With option B: sign, leave Review, return, and the signature is still there.

---

##### F-OFF-8 · Inspection screens of a job whose contents were never fetched show "No areas on this job yet" offline
- **Severity:** Low
- **Requirement:** R3
- **Confidence:** VERIFIED
- **Where:** `job/[id]/inspect/index.tsx:139`, `:222-233`; `area/[areaId].tsx:401-419`; `job/[id]/index.tsx:256` (read-only jobs bypass the pack gate)

**What is wrong.** A finished job can be opened read-only without the pack. With no signal, `refreshJob` returns at once (`pull.ts:639-644`), so `fetching` is false and `areas.length === 0`. The screen says the job has no rooms instead of saying its contents are not on the phone. `children_at` already distinguishes the two cases.

**Impact.** The inspector sees false information. No data is lost, because a locked job hides "Add area".

**Fix.** When `!job.childrenLoaded`, render "This job's rooms aren't on the phone yet — connect to load them".

**Effort / risk:** S / Low

**How to verify the fix.** Use a finished job that was never opened. Go offline, open it, tap View.
- **Pass:** the "not on the phone" copy shows instead of "No areas".

---

##### F-OFF-9 · NOC and gate pass are online-only, yet they are needed at the gate or door
- **Severity:** Medium
- **Requirement:** R3
- **Confidence:** VERIFIED
- **Where:** `job/[id]/index.tsx:733-752`; strings `nocOffline` and `gatepassOffline` (`M:src/i18n/strings.ts:151,159`); server routes `P:app/api/snagging/tasks/[id]/noc`, `/gatepass`

**What is wrong.** Every tap asks the server for a fresh link and hands it to the OS viewer. Nothing is cached, and the pack does not fetch either document. The screen's own comments say the developer "will not open the unit without it" (`:657-660`) and that security asks for it "before letting the inspector on site" (`:683-686`). Gates, basements and car parks are the classic no-signal spots.

**Impact.** The inspector is turned away at the gate, or has to walk back out to find signal. The clear offline message is good copy, but it does not get them in.

**Fix.** Have `downloadJobPack` fetch both documents to `Documents/docs/<jobId>-{noc,gatepass}.pdf` when `noc_on_file` or `gatepass_on_file` is set, and open the local file with `expo-sharing` or `Linking`. Purge them with the job.

**Effort / risk:** S / Low (PDPL: same private-folder rule as photos)

**How to verify the fix.** Pack a job that has a NOC on file. Go to airplane mode and tap View NOC.
- **Pass:** the PDF opens.

---

##### F-OFF-10 · Sync-state UX gaps: the sign-out copy ignores unsent photos; list rows and cards cannot show "evidence still on phone" or "not offline-ready"
- **Severity:** Medium
- **Requirement:** R3
- **Confidence:** VERIFIED
- **Where:**
  - Profile sign-out: `M:app/(app)/(tabs)/profile/index.tsx:48-50`, `:69-75`, `:134-139`
  - Side menu sign-out: `M:src/ui/SideMenu.tsx:52-54`, `:69-71`
  - `M:src/sync/engine.ts:129-135` (`queued` is outbox rows only)
  - `M:src/sync/outbox.ts:69-73`; `M:src/sync/uploader.ts:416-430`
  - `area/[areaId].tsx:494`
  - `M:src/features/jobs/JobCard.tsx` (never reads `packReady` or a pending count); `jobs.ts:509-510` (`pending_photo_count` is computed and never rendered)

**What is wrong.**
1. **Sign-out copy.** It counts `queued + errored` outbox rows. A photo still waiting to upload has no outbox row until it lands (`authStore.ts:236-237`), so the dialog can say "Everything is synced. You can sign out safely." with photos still on the phone. The data is retained (`authStore.ts:238-244`), so the claim is false but nothing is lost. The jobs-list pill does count photos (`jobs/index.tsx:348-353`).
2. **Room list rows.** The SyncDot reflects only the snag row. A snag sent without its large photo or video shows as synced while the evidence is still local.
3. **Job cards.** There is no "offline-ready" mark and no "N unsent" mark, so the inspector cannot tell from the list which jobs will work in the basement.

**Evidence:**
```ts
// profile/index.tsx:48-50
const queued = useSyncStore((s) => s.queued);
const errored = useSyncStore((s) => s.errored);
const unsyncedCount = queued + errored;          // pendingPhotos / failedPhotos omitted
```

**Impact.**
- An inspector signs out, a second inspector signs in on the same handset, and the first inspector's photos then upload under the second inspector's session. This is INFERRED and outside scope; it needs the server-side owner check.
- Inspectors cannot plan for the basement from the list.

**Fix.**
- Use `pending + errored + pendingPhotos + failedPhotos` in both sign-out dialogs.
- Give SyncDot a `photosPending` override: count `snag_photos` with `upload_state <> 'uploaded'` per snag in `listSnags`.
- Add `packReady` and `pendingPhotoCount` chips to `JobCard`. The data is already in the row.

**Effort / risk:** S / Low

**How to verify the fix.**
- Capture a snag with a video offline, go online long enough for the snag to send but not the video, then open Sign out. **Pass:** the dialog reports at least 1 unsent item.
- **Pass:** the room row shows "photos waiting".

---

##### F-OFF-11 · Pulled videos are stored as `<id>.bin`, so iOS may not play them offline
- **Severity:** Low
- **Requirement:** R3
- **Confidence:** INFERRED (needs a device test)
- **Where:** `offlinePack.ts:136-141`; player `EvidenceMedia.tsx:180-197`

**What is wrong.** Every pulled media file, video included, is written as `${row.id}.bin`. AVPlayer picks the container from the file extension or UTI for local `file://` URLs, so an extensionless MP4 or MOV can fail to load. Images are unaffected, because decoders sniff the content. Pulled videos also never get a poster frame, so they show as a film tile; that part is acceptable.

**Fix.** Name the file from `media_type` or the extension in `storage_path`, using `.mp4`, `.mov` or `.jpg`.

**Effort / risk:** S / Low

**How to verify the fix.** On iOS, pack a job containing a server video, go to airplane mode, and play it.
- **Pass:** it plays.

---

##### F-OFF-12 · The pack does not check free space and downloads one file at a time
- **Severity:** Low
- **Requirement:** R3
- **Confidence:** VERIFIED
- **Where:** `offlinePack.ts:194-210`; `engine.ts:116-138` (`storageLow` exists but the pack does not consult it)

**What is wrong.** There is no pre-flight estimate of `SUM(bytes)` against `Paths.availableDiskSpace`. On a nearly full phone the pack runs to completion and reports "N photos could not be fetched". Plans download first, which is the right order.

**Fix.** Before downloading, compare the remote bytes left to fetch with free space minus a 200 MB reserve. If it will not fit, refuse with "Need X MB free".

**Effort / risk:** S / Low

**How to verify the fix.** Fill the device to 150 MB free and pack a 300 MB job.
- **Pass:** a clear refusal before any download starts.

---

##### F-FLD-1 · No thumbnails exist: full photos up to 1 MB at 1080 px are downloaded and decoded for 56–60 px tiles
- **Severity:** High
- **Requirement:** R6
- **Confidence:** VERIFIED for the pipeline. Byte sizes are INFERRED from the compression targets.
- **Where:**
  - Capture: `mediaCapture.ts:15-31,70-130` (single encode at ≤1080 px); posters only for video (`mediaCapture.ts:139-147`, `inspectionStore.ts:333,420`)
  - Pulled rows never get a `thumbnail_path` (`pull.ts:1869-1872`)
  - `stillUri` falls back to the full image (`jobs.ts:72-83`)
  - Server sends no thumbnail column (`sync-children.ts:152-153`) and signs without a transform (`media.ts:109-111`)
  - Tiles: `MediaThumb.tsx:36` (56 px strip, `SnagMediaGallery.tsx:248-251,350-351`); `area/[areaId].tsx:450` (60×60, `:812-821`); `desnag/index.tsx:684-688`; `verify/[snagId].tsx:422-426`

**What is wrong.** There is one image per photo, and it is used both for the 56 px tile and the full-screen viewer:
- **Unpacked jobs, online.** Every list tile downloads the full JPEG. This covers finished jobs viewed online and photos added after the pack.
- **Every tile, packed or not.** The full image is decoded. RN `Image` on Android only downsamples when `resizeMethod` resolves to `resize`. The app never sets it (grep finds no `resizeMethod`), so decode cost depends on the platform default. That part is INFERRED.
- **Hero pager.** `SnagMediaGallery` mounts every photo at full size at once in a `ScrollView` (`SnagMediaGallery.tsx:132-184`), as the earlier audit M-5 found.

**Evidence:**
```ts
// jobs.ts:81-82 — a photo is "its own still"
return displayUri(row.thumbnail_path || row.local_path, row.remote_path);
```

**Impact (calculation).**

| Case | Calculation | Result |
|---|---|---|
| Room list, 20 snags, unpacked, online | 20 × ~300 KB, against ~15 KB for a 240 px q0.7 thumbnail | **6.0 MB vs 0.3 MB (−95%)** per view per link generation (see F-FLD-2) |
| Decode, per tile | 1080×1440×4 B = 6.2 MB, against 180×180×4 B = 130 KB for a 60 dp tile at 3× | — |
| Decode, gallery of 10 photos | Hero and strip each mount 10 decodes | up to ~124 MB if no downsampling occurs |

**Fix.**
1. At capture, write a 320 px q0.7 thumbnail with `ImageManipulator`, store it in `thumbnail_path`, and upload it as `…/snags/<id>_t.jpg`.
2. Server: add `thumb_path` to `snagging_snag_photos`. Until then, use Supabase image transforms: `createSignedUrl(path, ttl, { transform: { width: 320, quality: 70, resize: 'cover' } })`. That needs the Pro plan; confirm it is enabled.
3. Send `thumb_url` beside `signed_url` in `shapePhoto` (`sync-children.ts:356-372`). Let `stillUri` prefer it. Have list tiles, strips and `MediaThumb` use the thumbnail, and the viewer use the full image.
4. Have the pack download thumbnails for every photo, and full images only for this job's own family, not the parent (F-FLD-4).

**Effort / risk:** M / Low

**How to verify the fix.** Charles or proxy capture while opening a 20-snag room on an unpacked job.
- **Pass:** at most 20 image requests, each under 30 KB.
- Android Studio memory profiler on a 10-photo snag. **Pass:** Graphics memory rises by less than 20 MB.

---

##### F-FLD-2 · Link rotation defeats the URL-keyed image cache: about one full re-download per hour of viewing
- **Severity:** Medium
- **Requirement:** R6
- **Confidence:** VERIFIED for the code. Cache behaviour is INFERRED from platform defaults (NSURLCache and Fresco key on the full URL).
- **Where:**
  - Server TTL 60 min with a 30 min reuse margin, cached per process: `media.ts:14`, `:86`, `:145`
  - The phone keeps a held link while it has more than 15 min left: `pull.ts:1894`, `:1926-1933` (VERIFIED)
  - Refresh at less than 10 min left: `pull.ts:418,468-483`
  - Plain RN `Image`, no `cacheKey`: `MediaThumb.tsx:2,36`, `EvidenceMedia.tsx:6,150-156`
  - `mediaKey()` already exists: `M:src/lib/signedUrl.ts:14-29`

**What is wrong.** `chooseLink` correctly keeps an unchanged file's link while it has more than 15 min left. But a link reaches the phone with only 30–60 min left, because of the server reuse margin and because serverless instances do not share that cache. So every remote-only image the screens draw gets a new URL roughly every 20–50 min of continuous viewing. RN `Image` caches by URL, so the cached bytes are discarded.

**Impact.** For J-60 viewed unpacked (150 photos × ~300 KB): up to 45 MB re-downloaded per link generation for photos the inspector scrolls through. That is 2–4 generations in a 2-hour review, so 90–180 MB of avoidable traffic. With thumbnails (F-FLD-1) it falls to ~2 MB per generation.

**Fix.**
- Switch tiles to `expo-image` with `cachePolicy="disk"` and `cacheKey={mediaKey(uri)}`. The storage path is stable, while the token is only the permission to fetch.
- Or download on view to `Documents/snagphotos`, as the floor plan screen already does for plans (`floorplan.tsx:181-204`).

**Effort / risk:** S–M / Low

**How to verify the fix.** View a room, force a whole fetch (`refreshJob(id, { full: true })` after 50 min, or temporarily set the server TTL to 5 min), then view again.
- **Pass:** the proxy shows zero image GETs on the second view.

---

##### F-FLD-3 · Renewing links refetches the whole job, and the parent's whole job
- **Severity:** Medium
- **Requirement:** R6
- **Confidence:** VERIFIED
- **Where:** `pull.ts:442-453` (`jobCursor` returns null when links are expiring), `:468-483`, `:534-581`; route `P:app/api/snagging/sync/job/[id]/route.ts:160-180`; `sync-children.ts:121-191`

**What is wrong.** If any photo or plan of a job is drawn from a link with less than 10 min left, the next `refreshJob`, fired by any repository read after a 15 s window, becomes a whole fetch. That means every room, snag, checklist answer, photo and plan, plus a reconcile. `jobCursor(parent)` is evaluated the same way, so the parent can go whole too. All that was needed was fresh URLs for the remote-only files.

Triggers in normal use:
- unpacked finished jobs viewed for more than 20 min
- packed jobs with any remote-only photo (F-OFF-3)
- de-snag rounds whose parent plan is not cached (F-OFF-4)

**Impact (J-60, calculation).**

| Part | Rows × size | Total |
|---|---|---|
| Snags | 60 × 775 B | 46.5 KB |
| Photos | 150 × 700 B | 105 KB |
| Checklist | 40 × 370 B | 14.8 KB |
| Rooms | 10 × 475 B | 4.8 KB |
| Plans and detail | — | 2.6 KB |
| **Whole payload** | | **≈173 KB raw** |
| Actually needed (URLs) | 152 × ~400 B | ≈61 KB |
| **Wasted per renewal** | | **≈112 KB raw (65%)**, ×2 when the parent also renews |

At about one renewal per 40 min over an 8 h day, that is ≈1.3 MB raw per job per day, plus the server cost of a full `loadSyncChildren`, `loadTaskDetail` and two `signMediaPaths` calls each time.

**Fix.**
- Add `GET /api/snagging/sync/job/{id}/links?ids=…`, returning `{ id, signed_url }` for the photo and plan ids the phone draws remotely. The phone already computes that list in `linksExpiring`.
- Keep the 24 h whole fetch for deletion reconcile only.

**Effort / risk:** M / Low

**How to verify the fix.** Use a debug build with a 12-minute signed-URL TTL, and keep a room open for 15 min.
- **Pass:** only `/links` requests appear (each under 70 KB); there is no whole `/sync/job/{id}` without `since`.

---

##### F-FLD-4 · The parent job's snags, photos and checklist are fetched and packed, but no screen reads them; only its floor plans are used
- **Severity:** High
- **Requirement:** R6
- **Confidence:** VERIFIED for the reads (every repository read is scoped to the job's own task or snag). That nothing needs them in future is INFERRED.
- **Where:**
  - Fetch: `pull.ts:549-560,572-574`; route `sync/job/[id]/route.ts:157-171` (`loadSyncChildren(parentId)` in full)
  - Pack: `offlinePack.ts:72-100` (FAMILY_CTE covers parent photos), `:278-291`
  - Reads:
    - `listSnags`: `s.task_id = ?` (`jobs.ts:773`)
    - `listSnagPhotos`: own `snag_id` (`jobs.ts:924-927`)
    - `listMediaForRound`: own `task_id` (`jobs.ts:980-985`)
    - `listChecklist` and `checklistProgress`: own id, at every call site (`checklist.tsx:117`, `inspect/index.tsx:116`, `review.tsx:135`, `desnag/index.tsx:327`)
    - The only parent read: `listFloorPlans(parentTaskId)` at `floorplan.tsx:174`, `desnag/index.tsx:363`, `verify/[snagId].tsx:118`, `CaptureSheet.tsx:411`
  - Rounds carry their own photo copies (`job_id = round.id`): `P:app/api/snagging/tasks/[id]/rounds/route.ts:742-749`

**What is wrong.** On every opening of a round or additional visit, and on every pack, the bundle asks for `parent=true`. It receives the parent's full contents with every photo signed, and the pack then downloads every parent photo to disk. The phone never displays any of it.

The server comment calls these photos "already on record" context (`sync-pull.ts:338-345`), but no mobile screen implements that view. The round's before-photos come from its own copied rows.

**Impact (parent = J-60 sized original).**
- About 170 KB of JSON per whole parent fetch.
- Pack: 150 × ~300 KB ≈ **45 MB of disk and download per round**, for photos never shown.
- A third de-snag round packs the original's media plus round 2's ("others", `offlinePack.ts:288-291`).

**Fix.**
- Add `parent=plans` to the route. It would return only `floor_plans`, plus the minimal task row needed for F-OFF-4, through `loadPlans`.
- Restrict FAMILY_CTE photo caching to the job itself.
- If "already on record" is a real requirement, build the screen and fetch parent thumbnails only (F-FLD-1).

**Effort / risk:** S / Low

**How to verify the fix.** Pack a round-2 job whose original has 150 photos.
- **Pass:** `Documents/snagphotos` grows only by the round's own photos.
- **Pass:** the bundle response has `parent.snags` absent or empty.

---

##### F-FLD-5 · The catalogue is replaced whole on any change; there is no row delta
- **Severity:** Medium
- **Requirement:** R6
- **Confidence:** VERIFIED for the mechanism. Size is INFERRED (the server says ">1,000 rows", `sync-pull.ts:1225-1228`; the mobile code says "several thousand", `pull.ts:1193`).
- **Where:** `sync-pull.ts:1168-1218` (a change detected by `updated_at > since` on any of three tables sends the whole thing), `:1230-1291`; phone `pull.ts:1207-1217` (DELETE all, then re-insert); checked at most every 10 min on job open (`pull.ts:541-548`)

**What is wrong.** Editing one label, or retiring one defect, sends every active category, sub-category and defect to every device on its next job open. The phone deletes its three tables and re-inserts thousands of rows inside the pull transaction, which blocks the write queue behind the inspector's saves.

The counts check (`pull.ts:1153-1205`) and the empty-payload guard are good.

**Impact (assuming 2,000 defects at ~190 B).** About 380 KB raw, ~90 KB gzipped, per device per catalogue edit, plus a 2,000-row SQLite rewrite. Fine for rare edits. Costly if the office tunes guidance text during go-live week.

**Fix.**
- With `catalogue_since`, return only rows where `updated_at > since`, inactive ones included as tombstones (`active:false`), plus the counts.
- On the phone, upsert and delete tombstones; fall back to a full replace when the counts disagree.
- Keep the full replace for `include_catalogue=true`.

**Effort / risk:** M / Med (correctness depends on `updated_at` being bumped on deactivation)

**How to verify the fix.** Edit one defect label and open a job.
- **Pass:** the response's `catalogue.defects.length` is 1, and the local counts are unchanged.

---

##### F-FLD-6 · Local over-read: the shared store runs 28 columns and 6 correlated subqueries per snag on every tick, and two counts are never shown
- **Severity:** Low
- **Requirement:** R6
- **Confidence:** VERIFIED
- **Where:**
  - `jobs.ts:809-838` (`listSnags`, with 4 `LIMIT 1` sub-selects for the thumbnail and 2 counts)
  - `M:src/features/inspection/inspectionStore.ts:231-235`; `inspect/_layout.tsx:24-28` (re-hydrates on every focus and every pull tick)
  - `inspect/index.tsx:289-301` (Rooms uses only `areaId` and `severity`)
  - `jobs.ts:249-251` and `:509-520` (`snag_count` and `pending_photo_count` computed for `getJob` and the list; `JobRow.snagCount` and `pendingPhotoCount` are read nowhere, per grep)

**What is wrong.** A job with 300 snags runs about 1,800 sub-select executions per hydrate. Hydrate runs on every focus and every `onPullApplied`. The job list joins two GROUP BY subqueries per read for values no card renders.

**Impact.** CPU on the JS thread's SQLite queue; see the runtime section (06) for measured timings.

**Fix.**
- Pick the first photo with one window query: `ROW_NUMBER() OVER (PARTITION BY snag_id ORDER BY taken_at)` joined once.
- Drop the `snag_count` and `pending_photo_count` columns from `JOB_SELECT` and `jobListSql`, or render them (F-OFF-10).

**Effort / risk:** S / Low

**How to verify the fix.** Run `EXPLAIN QUERY PLAN` and time `listSnags` on 300 snags.
- **Pass:** more than 3× faster; the list query has no `s`/`p` joins.

---

##### F-FLD-7 · Small field-level waste in detail, cards, envelope and alerts
- **Severity:** Low
- **Requirement:** R6
- **Confidence:** VERIFIED
- **Where:**
  - Detail: `client_email`, `client_phone`, `city` (`P:lib/server/snagging/sync-task-detail.ts:150-157`) are read nowhere on the phone (grep finds only the type at `jobs.ts:117-118`)
  - Cards: `task_type: "single_unit"` is a constant (`sync-pull.ts:891`)
  - List envelope: always-empty `areas`, `snags`, `photos`, `floor_plans`, `verifications`, `checklist`, `catalogue:null`, `children_scope:null` (`sync-pull.ts:945-962`)
  - Alerts: the route reads `SELECT *` from `snagging_notifications` (`P:app/api/snagging/sync/alerts/route.ts:27`). This is database-to-server only, because `toAlert` projects the wire.

**Impact (calculation).**
- Detail: ~80 B of ~1.6 KB (5%).
- Cards: 26 B × 30 cards + ~130 B envelope ≈ 0.9 KB of ~16.5 KB (5.5%).

**Fix.**
- Remove the three detail fields and `task_type`.
- Omit empty arrays when `view=list`. The phone already defaults them through `?? []` (`pull.ts:498-503`), but check `CardsResponse` parsing first.
- Use named columns in the alerts route.

**Effort / risk:** S / Low

**How to verify the fix.** Diff response sizes. **Pass:** about 5% smaller.

---

##### F-FLD-8 · Every `/sync/job/{id}` delta re-sends the full task detail, and the parent's
- **Severity:** Medium
- **Requirement:** R6
- **Confidence:** VERIFIED
- **Where:** route `sync/job/[id]/route.ts:157-171` (`loadTaskDetail(admin, id)` runs unconditionally, with or without `since`, and again for the parent); `sync-task-detail.ts:40-174` (5 queries, including `readAllRows` over every snag on the job with a `visit_id`, `:52-63`)

**What is wrong.** This confirms the brief's suspicion that the full property object comes with every job fetch. A delta that brings no rows still returns the whole `task`: property, contacts, NOC and gate pass flags, team, sign-offs and finished visits, about 1.5 KB. With `parent=true` it returns the parent's too. The server pays about 10 queries for it.

`refreshJob` fires from any repository read after its 15 s window, so it runs on every screen focus and every pull tick in the inspection flow.

**Impact.**
- A typical empty delta is ~200 B of envelope plus ~3 KB of task detail, so 94% of the bytes are the detail.
- At about 60 deltas per hour of active navigation: ~180 KB/h per inspector, and ~600 server queries/h.

**Fix.**
- Send `task` only when `!since`, or when the job's or visit's `updated_at > since`. The route can ask `changedJobIds` for one id.
- Never send the parent's `task` on a delta.

**Effort / risk:** S / Low

**How to verify the fix.** Open Rooms twice, 20 s apart, with no server change.
- **Pass:** the second response has no `task` key and is under 400 B.

---

### 4.5 Pagination and sync engine (R4, R2, R5)

#### Method notes

Read-only audit, 1 Oct 2026. No source, config, database or server was touched.
Paths: mobile = `yfi-mobile-app/YFI-MobileApp/`, portal = `Yalla Fixit/`. Line numbers are from the working tree at `b626c4f` (portal) and the mobile tree as checked out today.

Scale model used throughout: 200 inspectors, 5,000 active jobs (≈25 per inspector), 20,000 historical (≈100 per inspector), a big job = 60 rooms / 500 defects / 1,500 photos, 3,000+ alerts per user. Networks: "3G" = 1 Mbps down / 0.5 Mbps up / 300 ms RTT; "4G" = 10 Mbps down / 3 Mbps up / 60 ms RTT. Photo ≈ 300 KB after compression (sendWithMedia.ts:37-44 says "a few hundred KB").

---

#### Summary verdict

##### R4 (pagination): **Partially met.** The data is paged correctly in most places, but the delta cursor can lose rows and some deletes never arrive.

- **Good:** every server list that could pass 1,000 rows now pages. That includes the four root queries the previous audit flagged (`sync-pull.ts:184-274`), the child tables (`sync-children.ts:43-50`), id lists split into chunks of 150 (`read-all.ts:42-81`) and the catalogue (`sync-pull.ts:1230-1254`). The Done tab uses a real keyset cursor on `(created_at, id)`, applied the same way on the server (`sync-pull.ts:666-676`) and in the phone's reconcile window (`pull.ts:367-387`).
- **Not good:** `readAllRows` pages with **OFFSET** (`read-all.ts:27-28`). For one job (≤2 pages) the speed cost is negligible. The real problem is that a delete landing between two page reads makes the read skip a row. A whole-job fetch counts as a full snapshot, so the phone then **deletes a row the server still has** (F-PAG-3).
- **Not good:** the `since` cursor is the app server's clock, read at the start of the request, with no overlap (`sync-pull.ts:116`, `sync/job/[id]/route.ts:116`). Some updated_at values come from a trigger running `now()` (transaction start, DB clock). Others come from whichever Node instance did the write (visits, checklist). So rows can commit "in the past" and never match `updated_at > since` again (F-PAG-1). How well updated_at is maintained is also patchy:
  - photos have no updated_at at all, so marker edits never reach other phones through a delta;
  - visits and checklist have no trigger;
  - the `snagging_jobs` trigger cannot be confirmed from the repo (F-PAG-2).
- **Not good:** there are no tombstones. Hard deletes (photos, rooms, plans) and unassignments only reach the phone through whole fetches. Job contents get a whole fetch once every 24 h. The active job list is reconciled only when a screen read triggers it, and Done cards are never reconciled outside a Done page window (F-PAG-6).
- **Not good:** the alerts delta has no upper bound, but the phone keeps only 200 alerts and gives the request 15 s. After someone marks 3,000 alerts read, the catch-up can fail forever (F-PAG-4).
- **Fetch-all-then-slice:** only in the Done page merge (31 rows × number of chunks, bounded; `sync-pull.ts:657-698`). Acceptable.
- **Unbounded lists:**
  - the alerts delta (`alerts/route.ts:126-142`);
  - the job-list delta (bounded by history);
  - the legacy `/sync/pull` (bounded by workload, with an unchunked `in()`; F-PAG-5);
  - phone-side `listSnags` and the active list (bounded by one job or by workload: acceptable).

##### R2/R5 (sync engine efficiency and scalability): **Mostly good at idle, but some paths are expensive or fragile and need fixing before 200 devices.**

- **Idle cost is low:** one HTTP request every 5 minutes per device (`engine.ts:187-209`, `sendWithMedia.ts:252-253`). That is ≈12 req/device/h, or **≈40 req/min across 200 idle devices**.
- **Active cost:** ≈140 req/h per device typical and ≈450/h at the top end. Across the fleet that averages **≈290 req/min (≈5 rps)** in working hours, with sustained peaks of **≈25 rps** (Appendix H).
- **Biggest avoidable bandwidth:** a job with server-held photos is refetched whole because its signed links are about to expire. This affects every de-snag round, visit and shared job. It happens **every ~20-50 min while the job is in use**, and the parent job is refetched too. Each refetch is 0.6-1.5 MB per job and re-signs 1,500-3,000 URLs (F-SYNC-1).
- **Biggest reliability risk:** a timeout is treated as "offline". There is no backoff and the 3.5 MB bundle never gets smaller, so on an uplink below ~0.23 Mbps the outbox stalls permanently and re-sends ~3.5 MB every 5 minutes. A 60-second video can never upload on a 0.3 Mbps uplink (F-SYNC-3).
- **Scalability of an idle pass:** each one re-reads the inspector's **entire history** (every job, every finished visit), not just what changed. Cost grows linearly with tenure: ≈11 DB calls per pass at 125 jobs, ≈60 at 1,500 (F-SYNC-2).
- **Thundering herd:** no jitter anywhere. Retry delays are fixed, a reconnect does clearBackoff and an immediate sync, and a failed alerts catch-up retries with no backoff (F-SYNC-4). There is no AppState handling either: Android keeps polling in the background, and iOS can resume up to 5 minutes stale (F-SYNC-5).
- **Realtime:** one channel per device and a good upsert-by-id dedup. But the **DELETE binding has no filter**, so every notification deleted (including job-delete cascades) is broadcast to every device (F-SYNC-6).
- **Device growth:** captured photo files (≈450 MB for a 1,500-photo job), finished jobs' contents, Done cards and floor-plan files are **never pruned automatically**. "Free up space" is manual and only covers approved or delivered jobs (F-SYNC-7).

---

#### Findings

##### F-PAG-1 · The delta cursor is app-server time at request start, with no overlap, so rows that commit late are lost
- Severity: Medium
- Requirement(s): R4, R2
- Confidence: VERIFIED (code paths); INFERRED (probability)
- Where: portal `lib/server/snagging/sync-pull.ts:116`, `:1072-1113` (changedJobIds); `app/api/snagging/sync/job/[id]/route.ts:115-116`; `lib/server/snagging/sync-children.ts:43-50`; `supabase/migrations/20260817090000_create_snagging_module.sql:30-38` (trigger `NEW.updated_at = NOW()`); explicit Node timestamps at `sync-push.ts:219-226`, `:856`, `:1366-1372`, `app/api/snagging/tasks/[id]/visits/[visitId]/route.ts:270-271`; mobile `src/sync/pull.ts:270`, `:301`, `:514`, `:890-898` (cursor written as-is).
- What is wrong: `serverTime = new Date()` is read on the Vercel instance before the reads. That part is correct. The next request then asks for `updated_at > serverTime` exactly. `updated_at` is either `now()` from the trigger, which is the *transaction start* on the DB clock, or `new Date()` on whichever Node instance did the write, taken before its PostgREST round trip.

  Take a write whose updated_at is earlier than the cursor T_s but which commits after the snapshot of the read that would have returned it. That read is `changedJobIds` for the list (≥2 sequential DB round trips after T_s), or the `loadChanged` page for job contents. Such a write is **lost for good**: it will never satisfy `> T_s`. Every page and chunk is a separate PostgREST request with its own snapshot, so nothing protects the window.
- Answer to the explicit question: **yes, it is lost.** Recovery depends on what was lost:
  - a change that leaves the card in the active set: only `runAuthoritative`, which runs only when a screen read triggers `refreshFromServer` more than 10 minutes after the last one (`pull.ts:840-848`, `:870-884`). The 5-minute timer never reconciles;
  - a change that moves a job to Done or edits a Done card: never, unless that Done page is refetched;
  - a change to job contents: only the whole fetch, at most 24 h later (`pull.ts:416`, `:450`).

  A row updated *after* T_s but before the read is simply sent twice, which is harmless (upsert).
- Evidence:
  ```
  sync-pull.ts:116   const serverTime = new Date().toISOString();
  sync-pull.ts:1080  .gt("updated_at", since)
  migration :35      NEW.updated_at = NOW();            -- transaction start, DB clock
  sync-push.ts:219   const now = new Date().toISOString(); // writer's Node clock
  sync-push.ts:226   updated_at: now,                   // commits ≥1 RTT later
  ```
  Window per write ≈ (commit time − updated_at) + clock skew between the reader instance and the DB or writer − (T_read − T_s).
  - Normal case: ≈50-150 ms − ≥100-300 ms, so usually ≤0.
  - Under DB contention (lock waits, pooler queueing, bulk statements of 1,000+ rooms as `sync-pull.ts:1066-1070` mentions) the commit lag reaches 1-10 s, and the window opens to seconds.
  - Expected volume: 200 devices × 12 deltas/h is 2,400 deltas/h, against perhaps thousands of writes/h. Even a 0.1% window hit rate means **several silently missed job changes per day**, each fixed only by chance reconciliation.
- Impact: an inspector can miss a booked visit, a send-back or a reassignment until they happen to browse the Jobs list (active cards). A Done-card change is missed indefinitely. A content change is missed for up to 24 h.
- Fix:
  1. Take the cursor from the DB clock, not Node. Add an RPC `select now()` once per request, or get it from the root query.
  2. Return `server_time = db_now − 60 s` as an **overlap**. This must be at least the longest expected statement or transaction plus skew. Keep `statement_timeout` for the service role under 30 s so the overlap really bounds it.
  3. Keep `gt` but accept duplicates. Every apply on the phone is already an idempotent upsert (`pull.ts:1446`, `:1701`, `:1806`, `:1877`).

  Cost: changes from the last 60 s are re-sent on each pass, typically 0-3 rows.
- Effort: S   Risk: Low
- How to verify the fix: integration test. Start a transaction that updates a job, read `/sync/jobs?since=` while it is open, commit 2 s later, then call again with the returned `server_time`. The changed job must be in the second response. Run 1,000 iterations with random delays of 0-5 s: **0 misses**.

##### F-PAG-2 · updated_at is maintained unevenly: photos have none, visits and checklist have no trigger, and the snagging_jobs trigger cannot be confirmed
- Severity: High
- Requirement(s): R4, R2
- Confidence: VERIFIED (photos, visits, checklist); INFERRED (`snagging_jobs` trigger, since the table is not created in the repo's migrations)
- Where:
  - portal `sync-children.ts:147-157` (photos delta on **`created_at`**); `sync-push.ts:802-803` (marker update, no timestamp); `sync-push.ts:789` (photo hard delete);
  - migrations `20260914120000_visits_as_appointments.sql:25,65` and `20260821110000_snagging_checklist.sql:28,39`: `updated_at default now()` with **no** `BEFORE UPDATE` trigger. Only the tables listed at `20260817090000_create_snagging_module.sql:711-728` (old names, e.g. `snagging_tasks`) and floor plans (`20260920100000_floor_plan_updated_at.sql:27-30`) have one;
  - `app/api/snagging/tasks/[id]/route.ts:297-302` updates `snagging_jobs` without setting `updated_at`;
  - `sync-pull.ts:1072-1113` reads `updated_at` on jobs, visits and rooms.
- What is wrong: the delta trusts `updated_at`, but nothing guarantees it is maintained:
  1. A photo's marker edit (`marker_x/y`) never changes `created_at`, so other phones (co-inspectors, reviewers' devices, a second device) never get it through a delta. Only a whole fetch brings it.
  2. Visits and checklist depend on every writer remembering `updated_at: new Date()`. All current writers do, but any future one that forgets is silently invisible to every phone.
  3. `snagging_jobs` is updated without an explicit `updated_at` (e.g. the inspector reassignment route). If the rename from `snagging_tasks` did not carry the `_touch` trigger, job-level changes made from the portal never reach phones through deltas.
- Evidence:
  ```
  sync-children.ts:156   "created_at",                   // photos: delta column
  sync-push.ts:803       .update({ marker_x: placed ? x : null, marker_y: placed ? y : null })
  tasks/[id]/route.ts:299 .from("snagging_jobs").update(updates)   // no updated_at in `updates`
  migrations: no CREATE TRIGGER on snagging_job_visits / snagging_job_checklist
  ```
- Impact:
  - Marker edits on shared jobs are stale on other phones for up to 24 h, or until the link-expiry refetch (F-SYNC-1).
  - If the jobs trigger is missing, every portal reassignment, reschedule and status edit stays invisible to deltas. On an active card it is fixed at the next reconcile, which only runs while the list is browsed. A Done card is never fixed.
- Fix:
  - A migration that adds `updated_at timestamptz not null default now()`, plus the `snagging_touch_updated_at` trigger, to `snagging_snag_photos`, `snagging_job_visits`, `snagging_job_checklist`, `snagging_job_inspectors` and (idempotently) `snagging_jobs`.
  - Switch the photo delta to `updated_at` (`sync-children.ts:156`).
  - Add `snagging_job_inspectors.updated_at` to `changedJobIds`.
  - A CI check that fails if any table read with `.gt("updated_at")` lacks the trigger.
- Effort: S   Risk: Low
- How to verify the fix:
  - `select tgrelid::regclass, tgname from pg_trigger where tgname like '%_touch'`: the 6 tables are present.
  - E2E: move a marker on device A; device B's next `/sync/job/[id]?since` contains the photo with the new marker; **latency ≤ 1 sync pass**.

##### F-PAG-3 · readAllRows pages with OFFSET: speed is fine at one-job size, but a concurrent delete skips a row and the whole fetch then deletes it on the phone
- Severity: Medium
- Requirement(s): R4
- Confidence: VERIFIED (code); INFERRED (frequency)
- Where: portal `lib/server/snagging/read-all.ts:22-34`; used by `sync-children.ts:43-50`, `:215-228`, `alerts/route.ts:127-138`, `sync-pull.ts:184-274`, `:313-397`, `:1036-1047`, `:1130-1140`; mobile `src/sync/pull.ts:511-513`, `:1055-1123` (a whole fetch deletes whatever it did not receive).
- What is wrong: `.range(from, to)` means `LIMIT 1000 OFFSET from` over `ORDER BY id`, and each page is its own snapshot.
  - An INSERT with a lower uuid between pages shifts rows down, so a row is duplicated (harmless).
  - A **DELETE** below the boundary shifts rows up, so one row is **skipped**.
  - For a whole-job snapshot (no `since`), the phone runs `reconcileDeletions`, which deletes every synced row missing from the payload.

  So a co-inspector or reviewer deleting one photo or room while device A fetches a 1,500-photo job (2 pages, ~1-3 s apart) makes A drop a different, live photo. A delta never brings it back, because its timestamp has not moved. It reappears only at the next whole fetch.
- At what depth OFFSET matters for speed: with `job_id IN (…)` plus `ORDER BY id`, Postgres builds the full match set and does a top-N sort for each page. The cost per page is about N, so the total is about N²/1000.
  - 1,500 photos: 2 pages, ≈3k row visits, negligible.
  - Alerts delta of 3,000: 3 pages, negligible.
  - Catalogue of ~3-5k rows: negligible.
  - Legacy `/sync/pull` for 125 jobs × 1,500 photos = 187,500 rows: 188 pages, ≈17.6M row visits, many seconds and past function limits.

  **Rule of thumb: OFFSET stops being acceptable above ~20k rows per query.** The per-job path is far below that. The consistency issue applies at any size above 1 page.
- Evidence:
  ```
  read-all.ts:27  for (let from = 0; ; from += PAGE_SIZE) {
  read-all.ts:28    const { data, error } = await build(from, from + PAGE_SIZE - 1);
  pull.ts:511-512 if (!since) { await reconcileDeletions(rows, { scope: [taskId], rooms: true, tasks: false }, files); }
  ```
- Impact: a live photo, snag or room goes missing on the phone for up to 24 h (or ~50 min where F-SYNC-1 fires) on big shared jobs during active capture. It can also corrupt a report preview that was built from the phone's data.
- Fix: keyset paging in `readAllRows`. Callers pass `(lastKey) => query.gt("id", lastKey).order("id").limit(1000)`. Floor plans and the catalogue switch to ordering by `id` only and sort on the client. A deleted row then simply does not appear, and nothing shifts.
- Effort: S   Risk: Low
- How to verify the fix: test. Seed 2,500 photos on a job. While the whole fetch is paging, delete 10 random photos and insert 10. Assert that payload ids = (initial − deleted) ∪ (any of inserted) with **0 surviving ids missing**. Also check that p95 latency is unchanged (±10%).

##### F-PAG-4 · The alerts catch-up has no upper bound but a 15 s timeout and row-by-row inserts, so it can fail forever after a bulk "mark read" or a long time offline
- Severity: Medium
- Requirement(s): R4, R2
- Confidence: VERIFIED (code); INFERRED (timings)
- Where: portal `app/api/snagging/sync/alerts/route.ts:126-142` (delta: `readAllRows`, no cap, `select("*")` at `:27`), `:143-149` (first load capped at 200); mobile `src/sync/alerts.ts:277` (15 s), `:212-232` (one `runAsync` per row), `:306-311` (keeps 200), `:334` (a failure sets `lastSyncAt = 0`, so it retries at once with no backoff), `:455-465` (Realtime UPDATE: one transaction per event).
- What is wrong: a delta returns *every* alert created **or read** since the cursor. One "Mark all read" in the portal on 3,000 alerts sends all 3,000 to every device of that user, plus 3,000 Realtime UPDATE events each opening its own SQLite transaction. The phone then keeps only 200. The cursor only advances when the whole request succeeds, so a timeout repeats the full download on every trigger (Alerts tab focus, reconnect, Realtime `SUBSCRIBED`).
- Evidence / calculation:
  - Payload: about 350 B per alert × 3,000 ≈ 1.05 MB of JSON.
  - 3G (1 Mbps): 8.4 s to transfer, plus 0.9 s for TLS/RTT, plus 3 sequential DB pages and a count (≈0.3-0.6 s): **≈10 s**.
  - At 0.6 Mbps: ≈15 s, which is the timeout. It fails every time.
  - Applying it: 3,000 `runAsync` calls at ≈1-2 ms each ≈ 3-6 s of bridge traffic in one transaction.
- Impact: a badge or list that never converges, and ≈1 MB burned per retry with no backoff (worst case several MB/h).
- Fix:
  - Server: cap the delta at `limit` (200) newest by `(created_at desc, id desc)` and return `truncated: true` when more matched. The phone treats `truncated` like a first load (it replaces its 200-row window; unread comes from the server count, which already exists at `:151-158`). Select only the 9 columns instead of `*`.
  - Phone: `insertMany` for alerts.
  - Phone: coalesce Realtime UPDATE bursts with a 1 s debounce into one transaction.
  - Phone: on failure, back off 30 s → 2 min → 10 min (with ±20% jitter) instead of `lastSyncAt = 0`.
- Effort: S   Risk: Low
- How to verify the fix: seed 3,000 unread, mark all read in the portal, then sync over a 3G-throttled link (1 Mbps/300 ms). Pass if it completes in **≤3 s**, with **≤100 KB** response and the badge showing 0.

##### F-PAG-5 · Legacy `/sync/pull` is unbounded by workload and its child `in()` is not chunked
- Severity: Low
- Requirement(s): R4, R5
- Confidence: VERIFIED
- Where: portal `app/api/snagging/sync/pull/route.ts:9-11`; `sync-pull.ts:492-502` → `sync-children.ts:47` (`.in("job_id", jobIds)` with every job, not chunked); `:637` (`jobIds` = whole history).
- What is wrong: the current app never calls `/sync/pull` (mobile `apiRequest` call sites: `pull.ts:289,338,563,675,717,872` only). Older builds still can. For an inspector with about 200+ jobs, the unchunked `in()` passes the gateway URL limit, which is the exact failure `read-all.ts:36-41` describes. Without `scope=active` it also streams every photo of every job.
- Impact: old builds fail or time out for long-tenured inspectors. Server memory grows with workload.
- Fix: return `410 Gone` with an "update the app" body once the minimum supported version passes the per-screen sync. Until then, chunk `loadChanged` with `readAllByIds`.
- Effort: S   Risk: Low
- How to verify the fix: call `/sync/pull` with a token for an inspector holding 1,000 jobs. Expect 410 (or 200 in under 10 s with chunking).

##### F-PAG-6 · No tombstones: deletes and unassignments reach the phone only through whole fetches, and Done cards of unassigned jobs stay forever
- Severity: Medium
- Requirement(s): R4, R2 (and a PDPL angle)
- Confidence: VERIFIED
- Where: portal `sync-push.ts:789` (photo hard delete), `app/api/snagging/tasks/[id]/areas/route.ts:236`, `app/api/snagging/floor-plans/route.ts:271-272`, `app/api/snagging/tasks/[id]/route.ts:314-333` (roster replaced; a removed inspector's `jobIds` no longer contains the job, so `changedJobIds` never mentions it: `sync-pull.ts:1060-1121`); mobile `pull.ts:300` / `:879` (only **active** cards are reconciled), `:367-387` (Done only inside a fetched page's window), `:416` (job contents every 24 h).
- What is wrong: a delta can only say "these rows changed". It cannot say "this row is gone" or "this job is no longer yours".
  - Content deletions wait for the 24 h whole fetch.
  - An unassigned active job waits for the 10-minute reconcile, which runs only on a screen read.
  - An unassigned **finished** job, with its client name, address and photos, is never removed from the phone unless the inspector scrolls the Done tab over that exact window.
- Impact: stale or wrong data for up to 24 h. Client personal data stays indefinitely on the devices of inspectors who were taken off a job. It also forces the costly whole-fetch mechanism (F-SYNC-1).
- Fix:
  - Table `snagging_tombstones(entity text, id uuid, job_id uuid, inspector_id uuid null, deleted_at timestamptz default now())`, filled by `AFTER DELETE` triggers on photos, areas, floor plans and checklist, and by the roster or inspector change (one row per removed inspector, `entity='job'`).
  - `/sync/job/[id]?since` and `/sync/jobs?since` return `deleted: [{entity,id}]` from `deleted_at > since − overlap`.
  - The phone deletes those rows, using the same guards against unsent work as `pull.ts:905-918`.
  - Keep a weekly whole-fetch safety net. Purge tombstones older than 30 days.
- Effort: M   Risk: Med
- How to verify the fix: remove inspector B from job J in the portal. B's next timer pass (≤5 min) removes J's card and its children. Delete a photo on device A: device B drops it within 1 pass. No whole fetch should happen during the test (count requests).

##### F-PAG-7 · Done paging re-fetches pages the phone already has, and the local page cursor re-reads from the top
- Severity: Low
- Requirement(s): R4
- Confidence: VERIFIED
- Where: mobile `app/(app)/(tabs)/jobs/index.tsx:36`, `:240-255`; `src/db/repositories/jobs.ts:481`, `:575-581`; `src/sync/pull.ts:315-321` (cursor kept only in memory), `:331-397`; portal `sync-pull.ts:657-698`.
- What is wrong:
  - The phone draws 20 jobs a step (`LIMIT doneLimit+1`, which grows 20 → 40 → …, so each step re-reads the first N rows).
  - The server pages 30.
  - Server pages are requested only after the local rows run out, and `doneNextBefore` resets on every launch. An inspector with 200 Done jobs cached from earlier sessions scrolls through them locally, then fetches server page 2, 3, … in turn: rows the phone already has.
  - Every Done request also re-runs the full root and visits reads (F-SYNC-2).
  - The server fetches `pageSize+1` from **each** 150-id chunk and then slices. That is bounded (31 × ⌈H/150⌉), which is acceptable.
- Impact: about 7 extra round trips to reach Done row 210 (≈1.1 s each on 3G). It is O(N²) in local SQLite rows read, but N is small. Minor.
- Fix: persist `done_next_before/_id` in `sync_meta`. When local rows run out, start the server fetch from the oldest `(created_at,id)` the phone holds (`before=<oldest local>`), not from page 2.
- Effort: S   Risk: Low
- How to verify the fix: with 200 cached Done jobs, scrolling to the end makes **≤1** server request beyond the first page.

##### F-SYNC-1 · Signed-link expiry forces a whole-job refetch roughly every 20-50 min for every job with server-held photos (and its parent)
- Severity: High
- Requirement(s): R2, R5
- Confidence: VERIFIED (logic); INFERRED (sizes and timings)
- Where: mobile `src/sync/pull.ts:416-418`, `:442-453` (jobCursor returns null when `linksExpiring`), `:468-483`, `:549-560` (the parent's cursor runs the same check), `:618-635` (refreshJob runs on every screen read, 15 s throttle), `:1894`, `:1926-1933` (keep held link if >15 min left), `:1954` (pulled photos get `local_path=''`); portal `lib/server/snagging/media.ts:14` (TTL 3,600 s), `:85` (instance cache reuses a URL while >30 min remain), `:163-195` (100 paths per `createSignedUrls`, all chunks in parallel); `app/api/snagging/tasks/[id]/rounds/route.ts:667-748` (rounds copy photos as **new** rows, so none of them are on the phone).
- What is wrong: the whole-fetch trigger fires on *any* photo or plan of the job that is drawn from a link (no local file) and expires within 10 min. Photos pulled from the server never have a local file unless the offline pack ran. That covers:
  - every carried-over photo on a de-snag round;
  - the parent job's photos (fetched in the same bundle);
  - co-inspectors' photos;
  - everything after a reinstall.

  The server hands out links with **30-60 min** left (cache reuse margin), so the job falls due for a whole fetch **every 20-50 min** on the next screen read. In a split case a held link with 16 min left is kept, then triggers again ~6 min later. A whole fetch re-sends and re-signs every row: snags, photos, checklist, rooms, plans, plus the parent.
- Evidence / calculation (one 500-defect / 1,500-photo job):
  - snags 500 × ~650 B = 325 KB
  - photos 1,500 × (~330 B fields + ~350 B signed URL) ≈ 1.0 MB
  - rooms 60 × ~500 B (zones can be more) ≈ 30 KB
  - checklist 100 × 300 B = 30 KB
  - detail ≈ 3 KB
  - **Total ≈ 1.4-1.5 MB raw; ≈0.55-0.65 MB gzip** (the high-entropy URL tokens compress only ~1.3×; INFERRED that Vercel gzips responses).

  | | 3G (1 Mbps, 300 ms RTT) | 4G (10 Mbps, 60 ms RTT) |
  |---|---|---|
  | TLS + request | 0.9 s | 0.2 s |
  | server (2 photo pages + 15 sign calls) | 1.0-1.5 s | 1.0-1.5 s |
  | transfer gzip / raw | 4.8 s / 11.6 s (+≈1 s slow start) | 0.5 s / 1.2 s |
  | client apply (insertMany, heldLinks, reconcile temp tables) | 0.5-1.5 s | 0.5-1.5 s |
  | **total, one job** | **≈8-9 s gzip / ≈15 s raw** | **≈2-3 s** |
  | **with parent (de-snag round)** | **≈14-28 s** (raw at 0.5 Mbps ≈ 46 s, over the 30 s timeout at `pull.ts:565`, so it fails, backs off 30 s and repeats) | ≈3-5 s |

  Frequency: one 8-hour de-snag day comes to 10-24 whole fetches × 1.2-3 MB, so **12-72 MB per inspector per day**. With an assumed 100 of 200 inspectors on rounds, visits or shared jobs, that is 2-7 GB/day of avoidable egress. Server signing: 400 whole fetches/h × 2,000 paths ≈ **800k signatures/h (≈220/s)**, each a `storage.objects` lookup, so ≈8,000 storage DB queries/h.
- Impact: data, battery, a job spinner (`trackLoading`) during inspection, constant re-signing load, and on slow 3G an endless fail-and-retry loop of 1-3 MB downloads.
- Fix (in order):
  1. **Separate link refresh from content refresh.** Add `POST /api/snagging/sync/links {ids:[…≤500], kind:'photo'|'plan'}` that returns `{id, url}` only. Remove `linksExpiring` from `jobCursor` (`pull.ts:451`). Call `links` for rows expiring within 15 min, ideally only for the rows currently on screen (`expo-image` `onError` → re-sign a batch of ≤50). Worst case 1,500 × ~400 B ≈ 600 KB, typically ≤25 KB.
  2. Make server-held photos local for **active** jobs: download thumbnails in the background (≈30 KB each, so ≈45 MB for 1,500) when the job is opened on Wi-Fi or 4G, the same way `cacheFloorPlans` works.
  3. Sign with `REUSE_MARGIN_MS` ≥ 50 min (`media.ts:85`), so links always arrive with ≥50 min left.
  4. Once tombstones exist (F-PAG-6), stretch `JOB_RECONCILE_MS` from 24 h to 7 days.
- Effort: M   Risk: Low
- How to verify the fix: keep a de-snag round with 1,500 carried photos open for 3 h on a throttled 3G profile. Count `/sync/job/<id>` responses over 100 KB: **0 after the first open** (today ≈4-9). Total bytes ≤ 2 MB plus actual changes.

##### F-SYNC-2 · Each idle pass and each Done page re-reads the inspector's whole history, so cost grows with tenure, not with change
- Severity: Medium
- Requirement(s): R5, R2
- Confidence: VERIFIED
- Where: portal `sync-pull.ts:184-274` (4 root reads, statuses including approved and delivered = history), `:313-404` (live visits, **all finished visits**, parents, over every job id), `:1060-1121` (changedJobIds: 3 chunked reads over every job id); mobile `src/sync/engine.ts:189` and `src/sync/sendWithMedia.ts:252` (every 5-min pass sends `since`), `sync/snag/route.ts:206-210`.
- What is wrong: even when nothing changed, every pass does the following. With H = all jobs the inspector was ever on and C = ⌈H/150⌉ chunks:
  - 4 root reads (the room-held read returns **one row per room**: 60 × jobs rows, ~8 pages at 125 jobs);
  - 3 × C visit reads, including `doneVisits`, which returns every submitted or completed visit of the whole history;
  - 2-3 × C changed-id reads.
- Evidence / calculation (DB calls per idle pass, plus JWKS-cached auth):

  | Tenure (H) | C | DB calls / idle pass | Fleet (200 devices, 12 passes/h) |
  |---|---|---|---|
  | 125 jobs (today's model) | 1 | ≈11 (+ ~8 room-row pages if the inspector holds rooms) | ≈2,400 passes/h → ≈26-50k queries/h ≈ 7-14 qps |
  | 1,500 jobs (≈5 years) | 10 | ≈60-70 | ≈150k queries/h ≈ 42 qps of pure polling |
- Impact: baseline DB load rises linearly with history size. Pass latency on 3G gains about 50-100 ms per extra sequential stage. The `rooms` root read is the largest waste.
- Fix: one SQL RPC, `snagging_sync_changed_jobs(p_inspector uuid, p_since timestamptz)`, returning the job ids changed since the cursor across jobs, visits, rooms and roster, using indexes on `(…, updated_at)` (`EXISTS` joins on the inspector's assignment). Then load visits and cards **only for the changed ids**. The root sets (four reads) are needed only for no-cursor lists; replace the room read with `select distinct job_id`. Target: **3 DB calls per idle pass regardless of H**.
- Effort: M   Risk: Med
- How to verify the fix: pg_stat_statements over 1 hour of 200 simulated idle devices: **≤4 statements per `/sync/snag` with no changes**, and p95 server time under 120 ms at H = 1,500.

##### F-SYNC-3 · A timeout counts as "offline": no backoff and no shrinking bundle, so a slow uplink stalls the outbox and burns data. Timeouts do not fit the real link speeds
- Severity: High
- Requirement(s): R2, R5
- Confidence: VERIFIED (code); INFERRED (link speeds)
- Where: mobile `src/lib/api.ts:96-121` (abort → `OfflineError`), `src/sync/sendWithMedia.ts:42` (3.5 MB budget), `:124` (20 photos), `:317` (120 s), `:323-349` (Offline → no `markRetry`, photos back to `pending`), `src/sync/engine.ts:193-195` (no progress → stop until the next 5-min pass), `:256-257` (status set to `offline`); `src/sync/uploader.ts:30` (reads the whole file into memory), `:148` (120 s), `:240-246` (offline → no backoff); `src/features/inspection/mediaCapture.ts:245` + `videoCompress.native.ts:7` (60 s at 1 Mbps ≈ 7.5 MB video); `src/sync/push.ts:90` (60 s).
- What is wrong:
  - The upload size is fixed and the timeout is fixed. When the link cannot move 3.5 MB in 120 s, every attempt fails the same way.
  - A timeout is classed as lost signal, so nothing backs off and nothing shrinks. The same 20-photo bundle is re-sent every 5 min, and the UI says "offline" while the phone is online.
  - Partial progress is thrown away. The server may even have applied it: that is idempotent, but the 3.5 MB of bytes is re-sent.
  - Videos take the direct path with a 120 s ceiling and no resume.
- Calculation:
  - Bundle: 3.5 MB = 28 Mbit. 28 s at 1 Mbps up, 56 s at 0.5 Mbps, 112 s at 0.25 Mbps. **Below ≈0.23 Mbps sustained it can never finish**.
  - Video: 7.5 MB at 0.5 Mbps = 120 s (right at the limit); at 0.3 Mbps = 200 s, so **it never uploads**. Retries back off to 60 min (`uploader.ts:197`).
  - Wasted data: ≈3.5 MB × 12 passes/h ≈ **42 MB/h** per stalled device.
  - "1 s budget": on 3G a fresh request costs 3 RTT ≈ 0.9 s before the server even starts (warm keep-alive: ≈0.6 s), plus 0.1-0.4 s server time (cold start +0.5-2 s). So **a 1 s end-to-end network budget is not achievable on 3G** (p50 ≈1.1-1.5 s for the smallest call). On 4G with a warm connection it is (≈0.3-0.6 s). The 1 s target can only apply to the local-first UI path, which the app already meets (screens paint from SQLite, `pull.ts:751-786`), not to network completion.
- Impact: inspectors on weak basement or tower links never clear their backlog, see a false "offline", and burn data and battery. Videos on weak links never arrive, and the submit gate blocks on `pendingUploadCount` (`uploader.ts:398-405`).
- Fix:
  1. In `send()`, tell a timeout (`controller.signal.aborted`) apart from a network error: throw `TimeoutError` (retryable, slow link).
  2. **Adaptive bundle**: `budget` starts at 3.5 MB. On `TimeoutError`, halve it (floor: one photo, ≤500 KB). After 3 successes, double it. Persist it per network type.
  3. **Timeout derived from payload**: `timeout = 15 s + bytes / (64 kbit/s)`, capped at 300 s; so 3.5 MB → ≈450 s cap → 300 s. Use separate time-to-first-byte (20 s) and idle-stall (30 s with no upload progress, via XHR `upload.onprogress`) timers rather than one wall clock.
  4. Videos: Supabase resumable uploads (TUS, 6 MB chunks) via `/storage/v1/upload/resumable`. Stream from file instead of `file.bytes()`.
  5. Progress UX: per-bundle `bytesSent/total` in the sync pill, from XHR progress; show "slow connection" (not "offline") on `TimeoutError`.
- Effort: M   Risk: Med
- How to verify the fix: network-link conditioner at 0.2 Mbps up / 300 ms. 50 queued photos and one 7.5 MB video all upload with **0 permanent failures in ≤60 min**, and no bundle is re-sent more than twice. The UI shows "slow connection".

##### F-SYNC-4 · No jitter anywhere: fixed retry delays, immediate reconnect sync, and no backoff on alerts failures, so devices synchronise into waves
- Severity: Medium
- Requirement(s): R5
- Confidence: VERIFIED (code); INFERRED (wave sizes)
- Where: mobile `src/lib/config.ts:50` (`[5s,15s,60s,300s]`), `src/sync/outbox.ts:177-198` (no jitter), `src/sync/engine.ts:351-355` (reconnect → `clearBackoff` + `syncNow` + `syncAlerts` at once), `:363-371` (timer phase = launch time), `:384-416` (launch: list + send + alerts, reconcile +60 s at `pull.ts:807-808`), `src/sync/alerts.ts:334` (retry at once on failure), `:477` (every `SUBSCRIBED` → `syncAlerts`), `src/sync/uploader.ts:197`.
- What is wrong:
  - In normal running, timers are spread by launch time, which is fine.
  - But every shared event lines devices up:
    - a portal or DB 5xx incident: all devices hit at T retry at T+5, +20, +80, +380 s;
    - a cell, site or carrier outage ending: every device's NetInfo flips at once, giving clearBackoff + full sync + alerts, each with its whole backlog;
    - a Realtime server restart: 200 rejoins, then 200 alerts POSTs within seconds.
  - Nothing reads `Retry-After`.
- Calculation:
  - A launch storm at shift start (200 launches in 10 min, about 5 requests each): ≈100 req/min, fine.
  - A forced update or mass relaunch within 30-90 s: ≈1,000 heavy requests, about **11-33 rps** of list and roots reads, ≈150-400 PostgREST calls/s.
  - A 1-hour carrier outage during capture: each device holds ≈45 actions + ≈135 photos, which is ≈12-14 bundles of 3.5 MB. That is 200 × 14 = **2,800 requests and ≈9.8 GB of uploads** started inside ~10 s, with ≈200 functions held open for 30-120 s while bodies trickle in.
  - A 5xx incident during that burst puts all devices into the same 5/20/80/380 s retry slots.
- Impact: overload amplification. A brief outage turns into a self-sustaining 5xx storm on pooler or function concurrency.
- Fix (numbers):
  - **Timer:** replace `setInterval` with a `setTimeout` chain. Delay = 300 s × U(0.8, 1.2). First pass at launch + U(30, 90) s.
  - **Adaptive:** after 3 consecutive idle passes (0 changes) with Realtime connected, step the interval to 600 s and then 900 s. Reset to 300 s on any change, capture, foreground or alert.
  - **Reconnect:** wait U(0, 10) s before `syncNow`; wait U(5, 20) s before `syncAlerts`. Clear backoff only for rows with `attempts < 3`.
  - **Retries:** full jitter, `delay = U(0, min(600 s, 5 s × 2^attempt))`. Honour `Retry-After` on 429/503.
  - **Circuit breaker:** after 3 consecutive 5xx or timeouts, suspend background sync for U(120, 300) s. The manual "Sync now" still works.
  - **Alerts failure:** back off 30 s → 2 min → 10 min ±20%.
  - **Server:** per-user rate limit of 120 req/min with `Retry-After`. Return 503 with `Retry-After: 30-90` (randomised) when the pool is saturated.
- Effort: S   Risk: Low
- How to verify the fix: simulator with 200 virtual devices and a 60 s server outage. After recovery, the peak request rate must be **≤2× steady state** and must settle within 3 min. Histogram of retry times: no bucket over 10% of devices per second.

##### F-SYNC-5 · No AppState handling: Android keeps polling in the background, iOS resumes stale, and the Realtime socket is left open
- Severity: Medium
- Requirement(s): R5, R2
- Confidence: VERIFIED (no `AppState` anywhere in `src/` or `app/`); INFERRED (OS timer behaviour)
- Where: mobile `src/sync/engine.ts:326-419` (only NetInfo plus `setInterval`); `src/sync/alerts.ts:397-478` (channel is never paused).
- What is wrong:
  - On Android, RN timers keep running while the process is alive in the background. A phone in a pocket keeps making 12 sync requests/h and holds the Realtime WebSocket (heartbeat every ~25-30 s, which wakes the radio each time; on 3G each wake carries ~5-10 s of high-power "tail"). That is ≈15-20 min/h of radio-high time, a meaningful battery drain over a 10-hour shift.
  - On iOS, timers are suspended. On return, sync happens only when the overdue interval fires or the socket reconnects, so screens can show data up to 5+ min old, and alerts written while the app was suspended arrive only after the socket rejoins.
- Cost/benefit of syncing on foreground:
  - Cost: +1 request (combined push + delta) per foreground, which is ≈5-20/day.
  - Benefit: staleness bounded at about 0 s on resume, and an immediate send of anything captured just before backgrounding.
  - Net: clearly positive, **provided** it is throttled (≥60 s since the last pass) and jittered.
- Fix:
  - `AppState.addEventListener('change')`.
  - `'active'`: if `Date.now() − lastSyncedAt > 60 s`, run `syncNow({silent:true})` after U(0, 3) s; `syncAlerts()`; restart the timer chain.
  - `'background'`: stop the timer; after 30 s remove the Realtime channel (it resubscribes on `active`; the catch-up covers the gap).
  - Optional: `expo-background-fetch` for a 15-min OS-scheduled push of the outbox only.
- Effort: S   Risk: Low
- How to verify the fix:
  - Android, 1 hour backgrounded: **0** sync HTTP requests and no WebSocket frames after 30 s.
  - Resume after 2 h: the list is updated within **≤3 s** of foreground (one request seen).

##### F-SYNC-6 · The Realtime DELETE binding has no filter, so every notification delete is broadcast to every device
- Severity: Medium (High if a retention purge deletes in bulk)
- Requirement(s): R5
- Confidence: VERIFIED (code); INFERRED (platform behaviour: Supabase cannot filter DELETE events and does not apply RLS to them)
- Where: mobile `src/sync/alerts.ts:466-473`; portal `supabase/migrations/20260924120000_snagging_notifications.sql:19-20` (`on delete cascade` from jobs and visits), `:333-338` (table in `supabase_realtime`).
- What is wrong: `{ event: 'DELETE', table: 'snagging_notifications' }` has no `user_id` filter, and Supabase cannot filter deletes. Every deleted notification row, including cascades when a job or visit is deleted and any retention purge, produces one message **per subscribed device**. Each phone then runs one `DELETE FROM alerts WHERE id = ?` per message.
- Calculation: purging 50,000 old notifications (≈250 per user) sends 200 × 50,000 = **10M Realtime messages**. That is about twice the Pro plan's monthly 5M included messages in a single night, and 50,000 SQLite statements on each phone.
- Impact: Realtime quota overrun or throttling, battery drain, and in theory leaked notification ids across users (ids only).
- Fix:
  - Remove the DELETE binding.
  - Treat deletions as data: either soft-delete (`dismissed_at`) and include it in the catch-up, or put the notification ids in the tombstones table from F-PAG-6.
  - Longer term, move the live feed to **Broadcast** on a private per-user topic from the trigger (`realtime.send`), which avoids per-subscriber evaluation in Postgres Changes.
- Effort: S   Risk: Low
- How to verify the fix: delete 1,000 notifications belonging to user A. Device B (user B) receives **0** Realtime messages. A's device removes them at the next catch-up.

##### F-SYNC-7 · Device storage grows without limit: captured photos, finished jobs' contents, Done cards and plan files are never pruned automatically
- Severity: High
- Requirement(s): R5
- Confidence: VERIFIED (code); INFERRED (volumes)
- Where: mobile `src/sync/freeSpace.ts:7`, `:19-33` (manual only, approved or delivered only), `src/features/shell/useFreeSpace.ts:13-33` (behind a confirmation in Profile and Settings); `src/sync/pull.ts:950-977`, `:1129-1146` (the only automatic task deletes are reconcile paths); `src/sync/floorPlanCache.ts:100-114` (plan files are never deleted); `src/lib/config.ts:52` (500 MB low-storage warning only).
- What is wrong: nothing ages data off the phone:
  - every captured photo and video file stays until an inspector taps "Free up space";
  - every Done card and every opened job's rooms, snags, photo rows and checklist stay for good;
  - floor-plan image files are never cleaned up.
- Calculation:
  - A 1,500-photo job is ≈450 MB of captured files. A typical job (assume 150 defects, 450 photos) is ≈135 MB.
  - At ≈3 jobs/week: ≈20 GB/year of files.
  - SQLite: ≈0.35 MB per typical job (≈1.2 MB per big job) → ≈50-100 MB/year.
  - A phone with 20 GB free hits the 500 MB warning after ≈45 big jobs (a few months) and then fails captures.
- Impact: capture failures, OS cache eviction of the app's files (the "file is gone" path, `sendWithMedia.ts:146-166`), slower SQLite scans (the `TASK_NOTHING_PENDING` sub-selects at `pull.ts:905-918` scan joins over every row).
- Fix: automatic retention, run after the hourly prune (`engine.ts:87-94`):
  1. For jobs in `approved` or `delivered` whose last activity was over 14 days ago, with nothing pending: delete local photo and plan files (rows keep `remote_path`).
  2. After 60 days, delete the job's children rows and keep only the card.
  3. Delete Done cards older than 180 days, which come back through the Done paging if the inspector scrolls to them.
  4. When `freeBytes < 1 GB`, run step 1 immediately for jobs finished more than 2 days ago.
- Effort: M   Risk: Med
- How to verify the fix: seed 100 finished jobs with 450 photos each (≈13 GB). After one retention pass, files for jobs finished more than 14 days ago are gone and the app's storage is ≤ the active jobs' share. No row with pending outbox work is touched (assert the outbox count is unchanged).

##### F-SYNC-8 · The offline pack downloads photos one at a time and outlives the signed links on big jobs
- Severity: Medium
- Requirement(s): R2, R5
- Confidence: VERIFIED (sequential loop, TTL); INFERRED (timings)
- Where: mobile `src/sync/offlinePack.ts:194-210` (sequential, then one retry pass using the **same** URLs), `:278` (links minted once at the start); portal `media.ts:14`, `:85` (links arrive with 30-60 min left).
- What is wrong: 1,500 photos are fetched one after another from links signed once at the start of the pack. The retry pass re-uses those same, possibly expired, links.
- Calculation:
  - 3G: 450 MB ÷ 1 Mbps = 60 min, plus 1,500 × ~0.6 s of per-request latency = 15 min, so **≈75 min**. Links expire after 30-60 min, so roughly the last 20-60% of photos fail. "Ready" is decided only by floor plans (`offlinePack.ts:321-333`), so the inspector goes offline without the photos.
  - 4G: ≈6 min transfer plus ≈4 min latency ≈ 10 min, which is fine.
- Fix:
  - Concurrency of 4 (keep the per-row atomic `local_path` update).
  - Before each batch of 100, re-sign rows whose link expires within 10 min (the links endpoint from F-SYNC-1).
  - Offer a "thumbnails only" pack (≈45 MB) on cellular.
- Effort: S   Risk: Low
- How to verify the fix: pack a 1,500-photo job on 3G throttling. **0 failures from expired links**, and wall time ≤ 70% of the sequential baseline.

##### F-SYNC-9 · The outbox batch is 100 against a server limit of 500, and a long offline backlog drains over several 5-minute passes
- Severity: Low
- Requirement(s): R2
- Confidence: VERIFIED
- Where: mobile `src/lib/config.ts:48`; `src/sync/engine.ts:188-196` (≤20 rounds), `:213-225` (≤21 × 10 direct uploads); `src/sync/sendSoon.ts:87` (≤5 rounds); portal `modules/snagging/schemas.ts:490` (`max(500)`).
- What is wrong: after 2-3 days offline on a big job (≈3,000 mutations: 500 snags + updates + 1,500 photo records + checklist + rooms), plain JSON pushes of 100 take 30 requests. Each sync pass also caps rounds at 20, so the tail waits for the next 5-minute timer. Photos are bundled ≤20 at a time (~11 at 300 KB). 1,500 photos need ≈136 bundle requests, spread over about 7 passes, so **≥35 min** before everything is even attempted, independent of bandwidth.
- Fix:
  - JSON-only pushes: batch 250.
  - While the previous pass made progress and the queue is not empty, schedule the next pass after 5 s (with jitter) rather than 5 min.
  - Keep bundles at 100 mutations.
- Effort: S   Risk: Low
- How to verify the fix: 3,000 queued mutations and 1,500 photos on 4G drain with **no idle gap over 10 s** between requests.

---

### 4.6 Phone runtime (R1 render path, R5)

#### Method notes

Repo: `yfi-mobile-app/YFI-MobileApp` @ `04ce640` (Expo SDK 57, RN 0.86, Hermes, reanimated 4.5, RNGH 2.32). Read-only audit; no code run on a device.
Paths are relative to the repo root. **VERIFIED** = read in code. **INFERRED** = an estimate, with the reasoning given. Timing figures assume a mid-range Android phone (Snapdragon 6-series class, Hermes), which is the slowest phone an inspector is likely to carry.

Scale used throughout: one job = 60 rooms, 500 defects, 1,500 photos; jobs list ≈ 300 jobs; 3,000 alerts; the Done list.

---

#### Summary verdict

**R1, render-path budget (nothing > 16 ms on the JS thread in a render path): NOT MET at the stated scale. Partly met.**
- **Good:** the screens with the heaviest data volume are designed well: the jobs list (memoised `JobCard`, per-row object cache, paging), the floor plan's pinch, pan and tap (all on the UI thread, built once), alerts (capped at 200 on the phone), the catalogue picker (paged and debounced), and the Sync screen (capped and windowed).
- **Bad:** a 500-defect job breaks the budget in four places:
  1. `inspectionStore.hydrate` rebuilds every snag and room object on each focus and each pull tick. That defeats every memo below it, and the resulting re-render across 3–5 mounted screens lands in one commit, estimated at 20–50 ms (F-RT-2).
  2. Every pull tick re-renders every mounted screen in the stack, focused or not. The de-snag screen also re-queries SQLite on every tick even when it is not on screen (F-RT-3).
  3. The de-snag list and the checklist re-render every mounted row on each tap (F-RT-4, F-RT-5).
  4. Background uploads load each file into JS memory, and RN networking base64-encodes it on the JS thread. Estimated block: 20–50 ms per photo and 150–400 ms per video, at any moment, on any screen (F-RT-1).

**R5, runtime (memory, media, cold start): PARTLY MET.**
- **Good:**
  - Photos are capped at 1080 px and 1 MB.
  - Video players mount only on tap.
  - Video is compressed to 480p.
  - `inlineRequires` is on, lucide loads one module per icon, migrations are versioned, and SQLite runs in WAL mode.
  - The Jobs screen paints from SQLite and never waits on the network (the 4 s launch wait sits behind the first paint, not in front of it).
- **Risks:**
  - Gallery multi-select compresses every picked photo in parallel, each from a full-resolution decode, and the picker has already re-encoded it once (F-RT-8).
  - The camera holds the preview for about 0.5–1.3 s (F-RT-9).
  - Thumbnails are full 1080-px files drawn in 56-px tiles through RN `Image`. Remote URLs are not downsampled on Android (F-RT-6).
  - A cold start with an expired access token can sit on the splash for up to 1.5 s (F-RT-15).

The three highest-value changes, in order:
1. **F-RT-1:** stream uploads natively instead of handing bytes to JS.
2. **F-RT-2 + F-RT-3:** reuse unchanged objects in `hydrate`, and set `freezeOnBlur` on the job stacks.
3. **F-RT-4 + F-RT-5:** memoise the de-snag and checklist rows.

Together these remove every JS-thread block above 16 ms identified here.

---

#### Findings

##### F-RT-1 · Background uploads put whole files on the JS heap and base64-encode them on the JS thread
- Severity: **High**
- Requirement(s): R1, R5
- Confidence: VERIFIED (the code path) / INFERRED (the cost, from RN's `convertRequestBody`, which base64-encodes `ArrayBuffer` and typed-array bodies in JS before crossing to native networking)
- Where: `src/sync/uploader.ts:18-31` (`readCaptured` → `file.bytes()`), `src/sync/uploader.ts:316-325` (`uploadToSignedUrl(..., bytes, ...)`), concurrency `src/sync/uploader.ts:188,257-259`; videos are always routed here by `src/sync/sendWithMedia.ts:190-193`.
- What is wrong:
  - Every file the uploader sends is read whole into a `Uint8Array` on the JS heap.
  - That array is handed to supabase-js, which `fetch`es with it as the body. whatwg-fetch clones the buffer, and RN's XHR base64-encodes it in JS before the bridge. That is three copies and a base64 pass for every file.
  - Videos never take the streamed bundle path (`sendWithMedia` skips them), and the same applies to photos left over after the bundle cap. So this path carries the heaviest files.
  - Up to 3 workers run at once.
- Evidence:
  ```ts
  // uploader.ts:26-30
  const file = new File(localPath);
  ...
  return { bytes: await file.bytes() };
  // uploader.ts:317-319
  supabase.storage.from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, bytes, { contentType, upsert: true })
  ```
- Impact (INFERRED):
  - base64-js on Hermes costs about 20–50 ms per MB.
  - A 1 MB photo blocks the JS thread for about 20–50 ms. An 8 MB, 60-second clip blocks it for about 150–400 ms, and temporarily needs about 30 MB of heap (bytes + clone + a base64 string 1.33× the size).
  - On Android, a clip picked from the library is passed through uncompressed when the compressor is unavailable (`videoCompress.native.ts:46-47`). That can be 100 MB or more, which puts the app at real risk of running out of memory.
  - These blocks land while the inspector is scrolling or capturing, because uploads run in the background.
- Fix: stop handing bytes to JS. Option (b) is preferred because it is already proven in this codebase.
  - (a) Upload to `signed_url` with `expo-file-system/legacy` `uploadAsync(signed_url, localPath, { httpMethod: 'PUT', uploadType: FileSystemUploadType.BINARY_CONTENT, headers: { 'content-type': contentType, 'x-upsert': 'true' } })`. This streams natively.
  - (b) Build a `FormData` with `{ uri: photo.local_path, name, type }`, the same streamed form `sendWithMedia.ts:214` already uses, and pass it to `uploadToSignedUrl`. storage-js forwards `FormData` bodies unchanged.
  - With either option, `readCaptured` stays web-only.
- Effort: S   Risk: Low (behind the existing `withTimeout`; the server contract does not change)
- How to verify the fix: Perf Monitor while 10 photos and 1 video upload during a scroll of the area list: JS FPS ≥ 55 throughout. A Hermes sampling profile should contain no `fromByteArray` or `encodeChunk` frames. Memory (Android Studio profiler) should rise by less than 10 MB while a 60 s clip uploads.

##### F-RT-2 · `inspectionStore.hydrate` rebuilds all 500 snags and 60 rooms on every focus and pull tick, which defeats every memo below it
- Severity: **High**
- Requirement(s): R1
- Confidence: VERIFIED (the code) / INFERRED (the timings)
- Where: `src/features/inspection/inspectionStore.ts:223-272` (`hydrate`), `:170-208` (`toSampleSnags`), triggered from `app/(app)/job/[id]/inspect/_layout.tsx:23-28`. Query: `src/db/repositories/jobs.ts:758-895` (`listSnags`).
- What is wrong:
  - Each hydrate reads three queries and replaces `areas` and `snags` with brand-new arrays of brand-new objects, even when nothing changed.
  - Every component that selects `s.snags` or `s.areas` re-renders: the inspect index, the area screen, and the floor plan and review screens if they are mounted. Every list row then receives a new `item`, so no row memo can ever hold.
  - `listSnags` runs 6 correlated sub-selects per row (2 COUNTs and 4 `ORDER BY taken_at LIMIT 1` lookups). It is index-backed (`idx_photo_snag_taken`, `migrations.ts:753`), but rows are mapped twice in JS (repo mapping, then `toSampleSnags`).
- Evidence:
  ```ts
  // inspectionStore.ts:231-235, 240-249
  const [job, areaRows, snagRows] = await Promise.all([
    getJob(jobId), listAreas(jobId), listSnags({ taskId: jobId }),
  ]);
  set({ ..., areas: areaRows.map((area) => ({ id: area.id, ... })),
          snags: toSampleSnags(snagRows, jobId) });
  ```
- Impact (INFERRED) at 500 snags:
  - Native SQLite: 3,000 index probes, about 15–60 ms (off the JS thread).
  - JSI row marshalling: 500 × 27 columns, about 3–6 ms on the JS thread.
  - Two mapping passes and about 1,100 new objects: about 1–3 ms.
  - The single commit then re-renders the area list (10–30 mounted rows), the inspect index (60 rows) and, if mounted, the floor plan (about 120 pin views). Total: **about 20–50 ms in one JS task**, which drops 1–3 frames each time a pull lands or the inspector re-enters the flow.
- Fix:
  1. Reuse unchanged objects, the same way `toListJob` does (`jobs.ts:537-558`): keep a `Map<id, {signature, obj}>` per entity, where `signature` is `Object.values(row).join('␟')`, and return the previous object when the row is unchanged.
  2. In `hydrate`, skip `set` for `areas` or `snags` when every element is reference-equal to the current array and the length matches.
  3. Then memoise the row components (F-RT-4, F-RT-6, F-RT-13) so unchanged rows skip rendering.
  4. Optionally split the thumbnail sub-selects into one `snag_photos` query grouped in JS (`WHERE task_id=? ORDER BY snag_id, taken_at`), the same pattern as `listMediaForRound`.
- Effort: M   Risk: Low
- How to verify the fix: React DevTools Profiler, with the area screen open on a 500-snag fixture, trigger `notifyPullApplied` with no data change. The commit should be under 4 ms and the area rows should show "did not render". With one snag changed, only that row renders, and the commit is under 8 ms.

##### F-RT-3 · Each pull tick re-renders every mounted screen, and the de-snag screen re-queries SQLite even when hidden
- Severity: **High**
- Requirement(s): R1, R5
- Confidence: VERIFIED
- Where: `src/sync/usePullTick.ts:15-21`. Used in 10 screens: `jobs/index.tsx:156`, `notifications/index.tsx:112`, `job/[id]/index.tsx:69`, `inspect/_layout.tsx:23`, `inspect/index.tsx:109`, `floorplan.tsx:159`, `checklist.tsx:178`, `review.tsx:112`, `snag/[snagId].tsx:121`, `verify/[snagId].tsx:134`. The listener that is not gated on focus: `app/(app)/job/[id]/desnag/index.tsx:410-416` (and the upload listener at `:424-437`). Notifier: `src/sync/pull.ts:166-174`. No `freezeOnBlur` anywhere (grep: none in `app/**/_layout.tsx`).
- What is wrong:
  - `usePullTick` calls `setTick` in every subscribed screen, so every mounted screen re-renders with its whole subtree. Only the SQLite read inside `useFocusEffect` is gated on focus; the render itself is not.
  - `notifyPullApplied` is global. A pull for any job, a Done page (`pull.ts:396` always notifies), or the 10-minute reconcile (`pull.ts:883` always notifies) wakes every screen.
  - The de-snag screen subscribes with a raw `onPullApplied` and runs its whole `readRound` whether or not it is visible.
- Evidence:
  ```ts
  // usePullTick.ts:18
  useEffect(() => onPullApplied(() => setTick((value) => value + 1)), []);
  // desnag/index.tsx:410-414 -- not focus-gated
  useEffect(() => onPullApplied(() => { void readRound(() => true, { local: true }); }), [readRound]);
  ```
- Impact, queries and renders per tick (VERIFIED by tracing the code):
  - **Stack: Jobs tab → job → inspect index → area (area focused).**
    - 4 screens re-render because of `setTick`: jobs, job detail, inspect index, and the inspect layout.
    - Only `inspect/_layout` passes the focus gate, so it hydrates: **3 SQL statements** (`getJob`, `listAreas`, `listSnags`), plus a possible `refreshJob` network request (throttled to once per 15 s).
    - The store update then re-renders the inspect index and area screens again.
  - **Stack: job → de-snag → floor plan (floor plan focused).**
    - The de-snag screen runs `listSnags` + `getJob` + `checklistProgress` + `listAreas` + `listFloorPlans` (+ the parent's `getJob` and `listFloorPlans`) + `listMediaForRound` = 6–8 statements.
    - hydrate adds 3 statements, and the floor plan's focus effect adds 2–3.
    - Total: **11–14 statements per tick, with `listSnags` over 500 rows run twice**, and three full list re-renders.
  - INFERRED total: about 30–80 ms of JS work per tick on a big job.
  - A self-sustaining loop can follow: hydrate → `listAreas` → `refreshJob` (after 15 s) → rows applied → tick → hydrate. It continues every 15 s while a co-inspector is capturing on the same job.
- Fix:
  1. Set `freezeOnBlur: true` in `screenOptions` on `app/(app)/job/_layout.tsx`, `app/(app)/job/[id]/inspect/_layout.tsx` (its `<Stack>`), `app/(app)/job/[id]/desnag/_layout.tsx` and the tab stacks. react-native-screens then suspends renders of covered screens, and focus effects still run on return.
  2. Make `usePullTick` focus-aware: `const focused = useIsFocused();` keep a `dirty` ref, call `setTick` only when focused, and bump once on refocus if dirty.
  3. Replace the de-snag raw listener with the same `usePullTick` + `useFocusEffect` pattern the other screens use. Gate its `onMediaUploadChanged` handler the same way.
  4. Notify only when rows were actually applied: make `runAuthoritative` (`pull.ts:883`) and `pullDoneJobs` (`pull.ts:396`) check `response.tasks.length > 0`. Optionally pass a `taskId` scope so the jobs list ignores per-job pulls.
- Effort: S (items 1, 3, 4) / M (item 2)   Risk: Low (freeze is standard react-native-screens behaviour; check that no screen relies on rendering while covered)
- How to verify the fix: add a temporary `console.count` per SQL statement and per screen render. With stack B and one tick fired, there should be at most 3 statements and only the focused screen plus the layout should render. React Profiler: tick commit under 10 ms.

##### F-RT-4 · De-snag cards are not memoised: each verdict tap and each upload event re-renders every mounted card
- Severity: **High**
- Requirement(s): R1
- Confidence: VERIFIED (the code) / INFERRED (the timings)
- Where: `app/(app)/job/[id]/desnag/index.tsx:671-952` (`renderCard`, an inline closure), `:1008-1083` (`SectionList` with default windowing, `renderItem={({ item }) => renderCard(item)}`), `:424-437` (an upload event remaps every item), `:198` (`verdicts` state read inside every card).
- What is wrong:
  - Each card is about 40–60 native views (thumbnail, 3 verdict chips, a status pill, comment, and a horizontal after-photo `ScrollView` built with `map`).
  - `renderCard` closes over `verdicts`, `busyPhotoFor`, `readOnly` and handlers recreated on every render, and nothing is memoised.
  - Any state change (a verdict tap, the busy flag, the viewer opening, a toast-driving state) re-renders every mounted card. Each media upload event also builds new `item` objects for all items.
  - The defaults (`windowSize` 21, about 10 screens either side) keep a large number of cards mounted.
- Evidence:
  ```tsx
  // desnag/index.tsx:428-432
  void listMediaForRound(id, roundRef.current).then((afterAgain) =>
    setItems((current) => current.map((item) => ({ ...item, after: afterAgain[item.id] ?? [] }))))
  // :1082
  renderItem={({ item }) => renderCard(item)}
  ```
- Impact (INFERRED): a round re-checking about 500 defects mounts about 40–80 cards after a scroll. At about 0.4–0.8 ms per card, that is **20–60 ms per verdict tap**. Two `mediaUploadChanged` events per uploaded photo (`uploader.ts:252,272`) repeat that cost during a sync.
- Fix:
  - Extract `const DesnagCard = memo(function DesnagCard({ item, verdict, busy, readOnly, onVerdict, onOpen, onPhoto, onComment, onViewer, onRemoveAfter }) {...})`. The handlers should be stable `useCallback`s that take `item.id`. Pass `verdict={verdicts[item.id]}` and `busy={busyPhotoFor === item.id}` as primitive props.
  - In the upload listener, keep the existing object when the media list is unchanged: compare ids and `uploadState`, and return `item` itself.
  - Set `initialNumToRender={6} maxToRenderPerBatch={6} windowSize={7}`.
- Effort: M   Risk: Low
- How to verify the fix: React Profiler on a 300-item round. Tap a verdict: only one `DesnagCard` renders and the commit is under 8 ms. Fire `mediaUploadChanged` for one item: one card renders.

##### F-RT-5 · Checklist: each answer causes 3–5 renders of every mounted row and 1–2 full re-reads
- Severity: **Medium**
- Requirement(s): R1
- Confidence: VERIFIED (the code) / INFERRED (the timings)
- Where: `app/(app)/job/[id]/inspect/checklist.tsx:235-281` (`answer`), `:453-560` (`renderItem`, inline and not memoised), windowing `:363-367`.
- What is wrong:
  - A single tap calls `setItems` (optimistic), `setSaving`, then `setSaveError`, then awaits the write, then `load()`. `load()` replaces every item with new objects, then `setSaving(null)` fires, then `sendSoon(id, undefined, load)` runs a second full `load()`.
  - Every one of these re-renders every mounted row. The window is intentionally wide (20 first, 11 screens), so about 100+ rows can be mounted.
- Evidence:
  ```ts
  // checklist.tsx:237-241, 263, 280
  setItems((current) => current.map((i) => i.id === item.id ? { ...i, status, ... } : i));
  ...
  if (id) await load();
  ...
  if (online && id) sendSoon(id, undefined, load);
  ```
- Impact (INFERRED): about 100 rows × about 0.2 ms × 4–5 renders = **about 80–100 ms of JS work spread over the second after each tap**. Individual commits are about 20 ms each, which exceeds the 16 ms budget. Rapid answering ("pass, pass, pass") stutters.
- Fix:
  - Extract `const ChecklistRow = memo(...)` with props `item, busy, error, readOnly, onPick` (a stable `useCallback` that reads state through refs).
  - In `load`, reuse each row object whose fields are unchanged (the same signature cache as F-RT-2), so the reload after a write renders only the answered row.
  - Drop the `await load()` on the success path (`:263`). The optimistic row plus the `sendSoon` refresh are enough. Keep the reload on the error path.
- Effort: M   Risk: Low
- How to verify the fix: Profiler on a 300-item checklist. One answer gives at most 2 commits, each under 8 ms, and only one `ChecklistRow` renders.

##### F-RT-6 · The area defects list: inline rows, and full-size photos used as 56-px thumbnails through RN `Image`
- Severity: **Medium**
- Requirement(s): R1, R5
- Confidence: VERIFIED (the code) / INFERRED (decode behaviour: on Android RN downsamples only local `file://` and `content://` URIs when `resizeMethod` is `auto`; remote https URLs decode at full size)
- Where: `app/(app)/job/[id]/inspect/area/[areaId].tsx:396-564` (`FlatList`, inline `renderItem`, default window), `:450` (`<Image source={{ uri: item.thumbUri }} style={styles.thumbImage} />`). The thumbnail source is the first photo itself (`jobs.ts:880-887`, `stillUri`); only videos have a separate `thumbnail_path`. The same pattern is in `src/ui/MediaThumb.tsx:36` and `desnag/index.tsx:684`.
- What is wrong:
  - Rows are not memoised and `data={snags}` gets a new array on every hydrate (F-RT-2), so every mounted row re-renders.
  - Each thumbnail is the stored ≤1080-px JPEG.
  - For photos from another device (signed remote URL) or after a cache cleanup, Android decodes the full 1080×810 bitmap (about 3.5 MB) per 56-px tile.
  - Signed URLs change when they are refreshed, so the image cache misses as well. `KEEP_LINK_MS` in `pull.ts:1894` mitigates this.
- Impact (INFERRED): a busy room with 80 defects mounts about 30 rows. At about 3.5 MB per remote thumbnail that is about 100 MB of bitmap memory, plus decode jank of about 5–15 ms per image on the decoder thread and GC pressure. Every re-render of the row tree costs about 5–15 ms.
- Fix:
  - Generate a 240-px JPEG thumbnail at capture time for photos too (`ImageManipulator` resize width 240, compress 0.7, in `compressPhoto`'s caller). Store it in `snag_photos.thumbnail_path`, which already exists for video posters, so `stillUri` prefers it.
  - Until then, add `resizeMethod="resize"` to the thumbnail `<Image>` in `area/[areaId].tsx:450`, `MediaThumb.tsx:36` and `desnag/index.tsx:684`.
  - Better still, switch these three to `expo-image` with `recyclingKey={item.id}`, `cachePolicy="memory-disk"` and fixed dimensions (expo-image downsamples remote images to view size on both platforms).
  - Extract `const SnagRow = memo(...)` with `onOpen` and `onDelete` as stable callbacks, and pass `retrying={retryingSnag === item.id}`.
- Effort: M   Risk: Low
- How to verify the fix: Android Studio memory profiler while scrolling a room with 80 remote-photo defects: graphics memory under 40 MB. Perf Monitor UI and JS FPS ≥ 55 during a fling.

##### F-RT-7 · Floor plan: the gestures are excellent, but pins re-render on every state change and the plan bitmap is decoded at view size
- Severity: **Medium**
- Requirement(s): R1, R5
- Confidence: VERIFIED (the code) / INFERRED (decode size and timings)
- Where: `app/(app)/job/[id]/inspect/floorplan.tsx:1168-1188` (snag pins), `:1229-1254` (zone labels), `:1316-1329` (room pins), `:1156-1163` (plan `<Image resizeMode="cover">`), `:1438` (the plan picker loads each full plan as a thumbnail). The same `<Image>` pattern is in `src/features/inspection/PlanPinView.tsx:90` and `PlanFullScreen.tsx:236`.
- What is wrong:
  - Pins are inline `Animated.View`s with new style objects on every render of a 1,911-line screen component. Any state change re-renders up to 120 animated views plus their `Text`: a filter tap, `setLocalPins`, `setSuggestedAreaId`, the room-query typing in the picker (`roomQuery`), a pull tick, or a store hydrate.
  - The zoom is a reanimated transform over an `Image` that RN decodes at roughly view size (downsampled for local files on Android, and to target size on iOS). At 5× (`MAX_SCALE = 5`, `:48`) the plan is an upscaled ~1080-px bitmap, which hurts legibility where an inspector most needs detail.
  - The opposite problem: a remote, not-yet-cached plan decodes at full resolution, and nothing caps the size of the downloaded file (`src/sync/floorPlanCache.ts:107` downloads it as-is).
- Evidence:
  ```tsx
  // floorplan.tsx:1173-1180
  <Animated.View key={snag.id} pointerEvents="none"
    style={[styles.pin, { left: `${snag.pin.x}%`, top: `${snag.pin.y}%`, backgroundColor: fillColor }, pinStyle]}>
  ```
- Impact (INFERRED):
  - 120 animated pins at about 0.08–0.15 ms each means a **10–20 ms render per state change**. Each keystroke in "which room?" costs this.
  - Plan memory is fine as it stands (about 2–4 MB at view size), but the plan is soft at 2.5–5× zoom.
  - The hit test is cheap: ≤ 60 pins + ≤ 60 zones × ≤ 64 points ≈ 4k edge tests per tap, under 0.2 ms (`insideZone`, `:78-89`).
- Fix:
  - Extract `const PlanPin = memo(({ x, y, fill, label, pinStyle }) => ...)` and `const RoomMark = memo(...)` with primitive props. Hoist `pinStyle` (already shared). Memoise `shownPins`, `shownZones` and `shownAreaPins` (`:425,434-435`) with `useMemo`.
  - Move the "which room?" modal (`:1492`) into its own component so typing does not re-render the plan.
  - For the plan, cap the downloaded file to 4096 px on the long edge in `cacheFloorPlans` (`ImageManipulator` resize at download time), then render it with `expo-image` (`allowDownscaling={false}`) or RN `Image` `resizeMethod="scale"`, so a zoomed plan stays sharp. Peak: 4096×2028×4 ≈ 33 MB, which is bounded.
  - Use a 200-px cached thumbnail for the plan picker rows.
- Effort: M   Risk: Low–Med (memory at 4096 px should be checked on a 3 GB phone)
- How to verify the fix: React Profiler, filter chip tap with 60 pins: commit under 8 ms. Typing in the room picker: the plan subtree does not render. Visual check: room labels on the plan are legible at 4× on a device.

##### F-RT-8 · Gallery multi-select compresses every photo in parallel, after the picker has already re-encoded it, with up to 12 full decodes per photo
- Severity: **High**
- Requirement(s): R5
- Confidence: VERIFIED (the code) / INFERRED (memory: expo-modules async functions run on a parallel background dispatcher; a 12 MP decode is about 48 MB)
- Where: `src/features/inspection/mediaCapture.ts:253-286` (`Promise.all(result.assets.map(async ... compressPhoto ...))`), `:233-249` (picker `quality: 0.8`, `allowsMultipleSelection: true`, no `selectionLimit`), `:80-114` (the quality × edge loop calls `manipulateAsync(uri, ...)` on the original each time).
- What is wrong:
  - All picked photos are compressed concurrently.
  - Each `manipulateAsync` decodes the full-resolution original, and the loop can do so up to 4 × 3 = 12 times per photo, because each attempt starts from `uri`, not from a resized intermediate.
  - The picker's `quality: 0.8` already re-encodes each image at full resolution on iOS (and on Android), so every pick is encoded twice before the loop even starts.
  - Separately, the caller then awaits `attachPhoto` serially in `addSnag` (`inspectionStore.ts:319-345`), which is fine.
- Impact (INFERRED):
  - 20 photos from a 12 MP camera, with about 4–8 decodes running at once, peak at about **200–400 MB of native bitmap memory**. That is a real risk of the OS killing the app on 3–4 GB Android phones, which loses the selection.
  - Latency: about 20 × (300–600 ms picker re-encode + 200–500 ms compress), split across cores. The capture sheet shows only a spinner for several seconds.
  - Worst case per photo (a high-entropy shot over 1 MB): 12 decodes ≈ 2–4 s.
  - The JS thread is not blocked (everything is native).
  - EXIF parsing is trivial: `exif.ts` is 50 lines with two regex and field reads.
- Fix:
  - Process picks with a concurrency of 2: a small `mapLimit(assets, 2, ...)` replacing the `Promise.all`.
  - Set `quality: 1` in `launchImageLibraryAsync` (the app compresses afterwards anyway), and add `selectionLimit: 10`.
  - Rewrite `compressPhoto` with the contextual API, so it decodes and resizes once and encodes N times:
    ```ts
    const ctx = ImageManipulator.manipulate(uri);
    if (longest > edge) ctx.resize(...);
    const img = await ctx.renderAsync();
    for (const q of QUALITY_STEPS) {
      const out = await img.saveAsync({ compress: q, format: SaveFormat.JPEG });
      ...
    }
    ```
    Re-render only when stepping down an edge. `manipulateAsync` is also the deprecated API in SDK 52+.
- Effort: S–M   Risk: Low
- How to verify the fix: pick 20 × 12 MP photos on a 4 GB Android phone. Peak native heap (Android Studio profiler) under 150 MB, no OOM, all 20 attached. Time to sheet-ready under 8 s. Unit-time `compressPhoto` on a high-entropy 12 MP image: under 1.2 s.

##### F-RT-9 · The camera holds the review for full-res capture + compress, and unmounts the camera for every review
- Severity: **Medium**
- Requirement(s): R5
- Confidence: VERIFIED (the code) / INFERRED (the timings)
- Where: `app/(app)/job/[id]/inspect/camera.tsx:109-134` (`takePictureAsync({ quality: 0.8, exif: true })` then `await compressPhoto(...)` before `setShotUri`), `:286-300` (`{!shot ? <CameraView .../> : ...}`, so the camera is torn down while reviewing and rebuilt on Retake).
- What is wrong:
  - The shutter-to-preview time is the sum of a full-resolution JPEG encode (12 MP) and a full decode/resize/encode.
  - Unmounting `CameraView` for the Keep/Retake step means every Retake pays the camera cold-open cost again.
- Impact (INFERRED): about 0.5–1.3 s from shutter to preview on a mid-range Android phone, plus about 0.3–0.8 s to reopen the camera on Retake. For an inspector raising 100+ snags a day, that adds minutes. The JS thread is idle meanwhile (awaits only).
- Fix:
  - Show `photo.uri` as the preview immediately (`setShotUri(photo.uri)`), and start `compressPhoto` as a promise held in a ref. `keep()` awaits it, which is typically finished by then.
  - On Android pass `skipProcessing: true` (EXIF orientation is applied by the manipulator anyway). Consider choosing a `pictureSize` around 2–3 MP via `getAvailablePictureSizesAsync`, since the stored output is 1080 px.
  - Keep `CameraView` mounted under the preview (render the preview as an absolute overlay, and pause the camera with `active={false}` if supported) instead of unmounting it.
- Effort: S   Risk: Low
- How to verify the fix: stopwatch or `performance.now()` logs: shutter to preview under 300 ms, Retake to live viewfinder under 200 ms on the reference Android phone.

##### F-RT-10 · Signature pad: a React render per touch point, a gesture rebuilt per render, and an O(n) path rebuild
- Severity: **Low**
- Requirement(s): R1
- Confidence: VERIFIED (the code) / INFERRED (the cost)
- Where: `src/features/inspection/SignaturePad.tsx:81-84` (`extend` copies the array and calls `setCurrent` per event), `:95-108` (`Gesture.Pan()` created on every render, not memoised), `:26-30, 130-139` (`toPath(current)` rebuilds the whole stroke string per render), `:119-129` (every finished stroke's `<Path>` is re-reconciled per event).
- What is wrong: each move event (60–120 Hz) goes worklet → `runOnJS` → array copy → `setState` → render → string rebuild → native SVG re-parse of the live path. RNGH also receives a new gesture object on every render.
- Impact (INFERRED): about 1–2 ms of JS per event at 200 points, which is fine on an idle JS thread. When the JS thread is busy (for example an upload encoding, F-RT-1), events queue and the stroke visibly lags or straightens. `toDataURL` is native and async, about 20–60 KB, so it is not a concern.
- Fix:
  - `const pan = useMemo(() => Gesture.Pan()..., [])`.
  - Keep points in a `useSharedValue<string>` path, and render the live stroke as an `Animated.createAnimatedComponent(Path)` with `useAnimatedProps(() => ({ d: live.value }))`, so drawing stays on the UI thread.
  - `runOnJS` only on `onFinalize` to commit the stroke to React state.
- Effort: S   Risk: Low
- How to verify the fix: draw a 5-second signature while a 1 MB upload runs. No visible lag. JS FPS during drawing is irrelevant once the live path is on the UI thread.

##### F-RT-11 · Jobs screen header: 7 sync-store subscriptions and a new `Intl.DateTimeFormat` per render
- Severity: **Low**
- Requirement(s): R1
- Confidence: VERIFIED
- Where: `app/(app)/(tabs)/jobs/index.tsx:101-111` (7 selectors), `:57-63` (`timeLocal` constructs a formatter on every footer render, `:429`). The same per-call construction is in `app/(app)/job/[id]/index.tsx:545,559`, `app/(app)/sync.tsx:504` and `src/features/jobs/jobPhase.ts:45`.
- What is wrong:
  - Every change to `pending`, `pendingPhotos`, `status` and so on re-renders the whole Jobs screen. These change on every enqueue and every upload (`engine.ts:330-332`, which calls `refreshCounts` on each outbox change).
  - The FlatList's inline `ListFooterComponent`, `ListEmptyComponent` and `refreshControl` props are rebuilt on each render. `JobCard` memo holds, so cards do not re-render, but the screen still pays the reconciliation cost.
  - Building an Intl formatter costs about 0.5–2 ms on Hermes (`src/lib/time.ts:10` says so itself).
- Impact (INFERRED): about 2–5 ms per sync-counter change. That is minor, but it repeats dozens of times during a sync.
- Fix: move the refresh button and `ErrorCountPill` into a `JobsHeaderRight` component that owns the 7 subscriptions. Replace `timeLocal` with `clockTime` from `src/lib/time.ts`, and use a module-level formatter in the other three files.
- Effort: S   Risk: Low
- How to verify the fix: React Profiler during a 10-photo upload. `JobsScreen` does not render, only `JobsHeaderRight` does, with commits under 2 ms.

##### F-RT-12 · Notifications: quadratic grouping (harmless at the 200-row cap)
- Severity: **Low**
- Requirement(s): R1
- Confidence: VERIFIED
- Where: `app/(app)/(tabs)/notifications/index.tsx:151-158`. The cap is `src/sync/alerts.ts:104` (`KEEP = 200`), with `listAlerts` `LIMIT ${KEEP}` at `:171`.
- What is wrong: `groups.set(title, [...(groups.get(title) ?? []), item])` copies the group array once per item. That is O(n²): about 20k element copies at 200 rows, and about 4.5 M if the cap were ever raised to 3,000.
- Impact: under 1 ms today. A 3,000-alert scale cannot reach the phone, because of the cap and the prune at `alerts.ts:310`. Rows are not memoised, but 200 rows under default windowing is fine.
- Fix: `const list = groups.get(title); if (list) list.push(item); else groups.set(title, [item]);`
- Effort: S   Risk: Low
- How to verify the fix: unit test with 3,000 synthetic alerts: `sections` builds in under 5 ms.

##### F-RT-13 · Inspect index: room rows are not memoised, and each row scans its snags on every render
- Severity: **Low**
- Requirement(s): R1
- Confidence: VERIFIED
- Where: `app/(app)/job/[id]/inspect/index.tsx:216-330` (`SectionList`, inline `renderItem`, default window). Per-row work: `snags.some(...)` ×2 plus caption building (`:288-310`).
- What is wrong: 60 rooms is small enough for the defaults, but each hydrate or pull tick re-renders all 60 rows (F-RT-2/3), even though the screen is usually not focused while that happens.
- Impact (INFERRED): about 60 × 0.15 ms ≈ 9 ms per store update.
- Fix:
  - Compute `{ count, worst }` per room inside the existing `snagsByArea` `useMemo` (`:142-150`).
  - Extract `const AreaRow = memo(...)` with primitive props `name, caption, worst, confirmed, recheck, mine` and an `onOpen(id)` callback.
  - `freezeOnBlur` (F-RT-3) removes the background renders.
- Effort: S   Risk: Low
- How to verify the fix: Profiler: after an unrelated snag edit, at most 1 `AreaRow` renders.

##### F-RT-14 · The snag media pager renders and decodes every photo of a snag at full width
- Severity: **Low**
- Requirement(s): R5
- Confidence: VERIFIED (the code) / INFERRED (memory)
- Where: `src/features/inspection/SnagMediaGallery.tsx:132-184` (a horizontal `ScrollView` with `photos.map` builds one full-width `EvidenceMedia` page per photo), `:231-259` (a thumbnail strip with `map`). `src/ui/MediaViewer.tsx` is good: it mounts one item at a time.
- What is wrong: every page is mounted and decoded on open. 1,500 photos over 500 snags averages 3 per snag, which is fine, but a snag with 20 or more photos (carried rounds plus after-shots) decodes them all at once.
- Impact (INFERRED): about 3.5 MB per page, so about 70 MB for a 20-photo snag, plus 20 simultaneous decodes on open.
- Fix: horizontal `FlatList` with `pagingEnabled`, `windowSize={3}`, `initialNumToRender={1}`, `getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}`. Strip thumbnails use the 240-px thumbnail from F-RT-6.
- Effort: S   Risk: Low
- How to verify the fix: open a 25-photo snag. Graphics memory rises by less than 20 MB, and there is no first-open stall over 100 ms.

##### F-RT-15 · Cold start: up to 1.5 s on the splash when the access token has expired
- Severity: **Medium**
- Requirement(s): R5 (cold start ≤ 3 s per the BRD note in `app/_layout.tsx:21-29`)
- Confidence: VERIFIED (the code) / INFERRED (how often it happens)
- Where: `src/features/auth/authStore.ts:79-104` (`launchSession` races `getSession()` against a 1,500 ms timer), awaited by `app/_layout.tsx:56-58` before `dbReady`, which gates the splash at `:102`.
- What is wrong:
  - `getSession()` refreshes an expired access token over the network before it resolves. Supabase access tokens last about 1 h, so the first launch of the day almost always hits this.
  - The stored session is read only **after** the 1.5 s timer. The best case with a refresh is one round trip (about 300–800 ms on site 4G); the worst case is the full 1.5 s.
- Impact (INFERRED): +0.3–1.5 s on most morning cold starts, on top of fonts and migrations (about 100–300 ms; migrations skip quickly via `user_version`, `migrations.ts:916-941`).
- Fix: read the stored session first. If it exists, use it at once (`initialising: false`, start the engine), and let `getSession()` refresh behind it. `onAuthStateChange` (`:158`) already reconciles. Race only when storage is empty.
- Effort: S   Risk: Low–Med (when the token refresh fails, the engine starts with an expired token; `getAccessToken` already refreshes per call, as the comment at `:88-90` says)
- How to verify the fix: cold start with an expired token (set the device clock forward 2 h) on 3G throttling. Splash to painted Jobs list under 1.2 s, measured with a `performance.now()` log at `RootLayout` mount and at the first `setActiveJobs`.

---

---

## 5. Appendices (evidence)

### Appendix A · Phone SQLite: statement inventory, query plans and timings, local pagination, start-up, proposed v39 migration

#### 3. Appendix A: statement inventory

Legend: freq = how often it runs; idx = index used (state A plan unless noted); ✓ = within budget even at ×10; ⚠ = see finding.

##### src/db/client.ts and src/db/migrations.ts
| file:line | statement (abbrev.) | called from | freq | tables | index used? | verdict |
|---|---|---|---|---|---|---|
| client.ts:79 | `withTransactionAsync(work)` behind a promise chain | every domain write and every sync apply | constant | n/a | n/a | ⚠ F-SQL-3/4 (non-exclusive; one queue) |
| migrations.ts:906-916 | PRAGMA WAL, foreign_keys, synchronous=NORMAL, temp_store=MEMORY; `PRAGMA user_version` | launch | 1 per launch | n/a | n/a | ✓ good settings |
| migrations.ts:920-942 | each version in its own tx + `PRAGMA user_version = n` inside it | launch (pending versions) | one-off | all | n/a | ✓ fresh install 38 versions 51 to 114 ms (desktop) |
| migrations.ts:278-292 (v5) | `DELETE FROM` 14 tables | upgrade | one-off | all | n/a | ✓ |
| v6..v28 | `DELETE FROM sync_meta WHERE key='pull_cursor'`; v15/16 `DELETE FROM sync_cursor` | upgrade | one-off | sync_meta | PK | ✓ (a full re-pull follows: network cost) |
| :505 (v17) | `UPDATE inspection_tasks SET pack_state='none'` | upgrade | one-off | tasks | scan | ✓ |
| :752-758 (v29) | 6 × CREATE INDEX + `ANALYZE` | upgrade | one-off | photos, snags, outbox, tasks | n/a | ⚠ F-SQL-5 (stats on empty DB = none) |
| :774-775 (v30) | `UPDATE … SET children_at WHERE id IN (SELECT task_id FROM job_checklist UNION SELECT task_id FROM snags)` | upgrade | one-off | tasks | scan | ✓ |
| :807 (v32) | `UPDATE … SET detail_at = children_at` | upgrade | one-off | tasks | scan | ✓ |

##### src/db/repositories/jobs.ts
| file:line | statement (abbrev.) | called from | freq | tables | index used? | verdict |
|---|---|---|---|---|---|---|
| :565 / :471-525 | `jobListSql(LIVE_SQL)`: keys CTE + page + 3 grouped child counts + 4 json_extract | Jobs tab, Alerts tab (derived) | every focus, pull tick, Done scroll | tasks, areas, snags, photos | `SCAN t` + temp B-tree; idx_area_task, idx_snag_task_created, idx_photo_task_upload | ⚠ F-SQL-7: 11 to 14 ms |
| :576 | `jobListSql(DONE_CANDIDATE_SQL, LIMIT ?)` | Done tab | every Done scroll (growing LIMIT) | same | same | ⚠ F-SQL-6: 4.5 ms @20, 24 to 32 ms @200 |
| :584-588 | `SUM(DONE_CARDS_SQL)` with 3 × `json_each` per row | Jobs tab | every load (all tabs) | tasks | `SCAN t` + `SCAN v VIRTUAL TABLE` | ✓ 1.9 ms (wasteful on Today; F-SQL-6) |
| :601 | `JOB_SELECT WHERE t.id=?` (6 correlated counts; property, team and signoffs JSON parsed in JS) | job detail, inspect hub, checklist, review, floor plan, capture sheet, desnag (up to 5× per desnag flow) | every focus or tick per screen | tasks, areas, snags, photos | PK + idx_area_task, idx_snag_task_created, idx_photo_task_upload (covering) | ✓ 0.4 to 0.5 ms |
| :342-353 | `SELECT signoffs_json`; `UPDATE … signoffs_json` + enqueue(signoff, 50 KB PNG) | review, sign-off | per sign | tasks, outbox | PK | ✓ (payload: F-SQL-13) |
| :636-666 | listAreas: `… (SELECT COUNT(*) FROM snags WHERE area_id=a.id AND status<>'withdrawn') … ORDER BY created_at, sort_order` | hydrate, removeSnag, desnag | every inspect focus or tick | areas, snags | idx_area_task + idx_snag_area_status (covering); temp B-tree | ✓ 0.8 ms; ordering F-SQL-14 |
| :780-840 | listSnags `task_id=?` with 6 photo subqueries | hydrate, after every write, verify screen, desnag | very hot | snags, areas, photos, tasks | idx_snag_task_created + 6 × idx_photo_snag_taken | ⚠ F-SQL-1: 37 to 54 ms, p95 to 103 ms |
| :780-840 | listSnags `… AND area_id=?` | **never called** | n/a | same | idx_snag_area_status (stats) / idx_snag_task_created | ✓ 0.3 to 0.8 ms (use it, F-SQL-1) |
| :906 | `SELECT task_id FROM snags WHERE id=?` | listSnagPhotos refresh | per open | snags | PK | ✓ |
| :924-926 | `… FROM snag_photos WHERE snag_id=? ORDER BY taken_at DESC` | snag detail, verify | per open, upload event | photos | idx_photo_snag_taken (no sort) | ✓ 0.04 ms |
| :980-986 | `… WHERE task_id=? AND round_number>=? ORDER BY taken_at` | desnag screen (5 call sites) | per open or refresh | photos | idx_photo_task_upload + temp B-tree | ✓ on rounds; 19 ms if run with round 1 on a 1,500-photo job |
| :1024 | `UPDATE snag_photos SET marker_x,marker_y` + enqueue(update, merge) | photo marker | per tap | photos, outbox | PK, idx_outbox_entity | ✓ |
| :1075-1098 | `UPDATE snags SET status,verdict_note,sync_state`; `SELECT verdict_note` + enqueue | verify verdict | per tap | snags, outbox | PK | ✓ |
| :1121-1141 | `SELECT … FROM snag_photos WHERE id=?`; `DELETE …`; enqueue(delete) | remove photo | rare | photos, outbox | PK | ✓ |
| :1170-1173 | `… FROM floor_plans WHERE task_id=? ORDER BY sort_order,label` | floor plan, capture sheet, verify, desnag | per open | plans | idx_floorplan_task | ✓ |
| :1201-1204 | `SELECT snag_code FROM snags WHERE task_id=?` then regex max in JS | every capture | per capture | snags | idx_snag_task_created | ✓ 0.7 ms (500 rows into JS; Low) |
| :1256-1291 | `INSERT INTO snags …`; `UPDATE inspection_areas SET status='has_snags'`; enqueue(insert) | captureSnag | per capture | snags, areas, outbox | PK | ✓ whole path 3 to 5 ms (p95 ≤ 8.3) |
| :1382-1416 | `SELECT … FROM snags WHERE id=?`; `UPDATE snags …`; enqueue(update) | edit snag | per edit | snags, outbox | PK, idx_outbox_entity | ✓ |
| :1428-1494 | `SELECT task_id,area_id,locked`; `COUNT(*) FROM outbox WHERE entity='snag' AND entity_id=? AND op='insert' AND state IN(…)`; `DELETE FROM outbox WHERE state IN(…) AND (entity_id=? OR entity_id IN (SELECT id FROM snag_photos WHERE snag_id=?))`; DELETE photos/snag; conditional `UPDATE inspection_areas … NOT EXISTS(…)` | delete snag | rare | snags, outbox, photos, areas | idx_outbox_entity; outbox DELETE via idx_outbox_state (scans ≤2,000 unsent) | ✓ |
| :1522-1545 | `INSERT INTO snag_photos …` (**outside transaction()**) | attachPhoto after capture, add photos | per photo | photos | PK | ⚠ F-SQL-4 |
| :1558-1582 | `COUNT(*) FROM snags WHERE area_id=? AND status<>'withdrawn'`; UPDATE area; enqueue | confirm area | per confirm | snags, areas, outbox | idx_snag_area_status | ✓ |
| :1608-1642 | `SELECT confirmed_at`; UPDATE area access; enqueue | area access | per change | areas, outbox | PK | ✓ |
| :1667-1713 | `SELECT COALESCE(MAX(sort_order),0)+10 … WHERE task_id=?`; `INSERT INTO inspection_areas` (no created_at); enqueue | add room | rare | areas, outbox | idx_area_task | ⚠ F-SQL-14 |
| :1736 / :1764-1769 / :1792 / :1819 | area pin, zone, reopen, startJob UPDATE + enqueue | floor plan, area, job | per action | areas, tasks, outbox | PK | ✓ |
| :1840-1852 | `UPDATE inspection_areas SET started_at … WHERE started_at IS NULL` then enqueue (**two writes, no tx**) | area screen open | per first open | areas, outbox | PK | ⚠ F-SQL-4 |
| :1872-1929 | `COUNT(*) FROM snag_photos WHERE task_id=? AND upload_state<>'uploaded'`; attempt SELECT; INSERT submission; UPDATE task; `UPDATE snags SET locked=1 WHERE task_id=?`; enqueue(submission + PNG) | submit | per job | photos, tasks, snags, submissions, outbox | idx_photo_task_upload (covering), idx_snag_task_created | ✓ (payload: F-SQL-13) |

##### src/db/repositories/checklist.ts
| file:line | statement | called from | freq | tables | index | verdict |
|---|---|---|---|---|---|---|
| :65-73 | activeVisit `SELECT active_visit_* FROM inspection_tasks WHERE id=?` | every answer, screens | hot | tasks | PK | ✓ |
| :98-128 | listChecklist `LEFT JOIN outbox ON entity='checklist' AND entity_id=c.id AND state IN(…)` | checklist screen (focus, tick, after each answer) | hot | checklist, outbox | idx_job_checklist_task + idx_outbox_entity; temp B-tree | ⚠ F-SQL-10 duplicates; 1.5 ms |
| :198-201 | `SELECT round_number …` | checklistProgress | hot | tasks | PK | ✓ |
| :216-233 | progress `COUNT/SUM … WHERE task_id=?` | inspect hub, review, desnag | hot | checklist | idx_job_checklist_task | ✓ 0.1 ms |
| :262-291 | `UPDATE job_checklist …` + enqueue(update, merge) | answer | per tap | checklist, outbox | PK, idx_outbox_entity | ✓ 1.2 to 2.1 ms |

##### src/db/repositories/syncQueue.ts and app/(app)/sync.tsx
| file:line | statement | called from | freq | tables | index | verdict |
|---|---|---|---|---|---|---|
| syncQueue.ts:39-58 | listUploads `GROUP BY snag_id … ORDER BY state='error' DESC, MIN(taken_at) LIMIT 100` | Sync screen focus, after sync | per visit | photos, snags | idx_photo_upload (no stats) / **SCAN via idx_photo_snag (stats)** | ⚠ F-SQL-5: 4.3 → 85 ms |
| :81-85 | uploadSummary `COUNT(DISTINCT …)` | Sync screen | per visit | photos | idx_photo_upload / scan | ⚠ F-SQL-5: 1.1 → 43 ms |
| :103-120 | listPendingChanges `LEFT JOIN snags, areas … ORDER BY state='error' DESC, seq LIMIT 100` | Sync screen | per visit | outbox, snags, areas | idx_outbox_state + PKs; temp B-tree over 2,000 | ✓ 4.5 ms |
| :133-136 | changeSummary | Sync screen | per visit | outbox | idx_outbox_state (covering) | ✓ 0.3 ms |
| sync.tsx:475-479 | `SELECT id,snag_id,upload_error FROM snag_photos WHERE upload_state='error'` (no LIMIT) | Sync screen | per visit | photos | idx_photo_upload | ✓ 0.4 ms |

##### src/db/repositories/catalogueTree.ts (live) and catalogue.ts (dead)
| file:line | statement | called from | freq | tables | index | verdict |
|---|---|---|---|---|---|---|
| catalogueTree.ts:97-112 | categories with correlated defect count | capture sheet | per open | categories, subs, defects | idx_catalogue_sub_category, idx_catalogue_defect_sub | ✓ 0.7 ms |
| :128-142 | subcategories of a category | capture sheet | per tap | subs, defects | idx_catalogue_sub_category | ✓ |
| :156-159 | defects of a sub-category | capture sheet | per tap | defects + parents | idx_catalogue_defect_sub | ✓ |
| :176-186 | searchDefects `d.label LIKE '%x%' OR s.label LIKE … OR c.label LIKE …` | capture search (per keystroke, at least 2 chars) | hot while typing | 3 tables | `SCAN d` (3,000) + PKs; temp B-tree | ✓ 3.6 to 4.9 ms at 3,000 defects; FTS5 only if the catalogue passes about 20k |
| :198-207 | recent defects | capture sheet | per open | recents + catalogue | PKs | ✓ 0.3 ms |
| :212-217, :222-224 | markDefectUsed upsert; catalogueSize | capture, Sync screen | per capture | recents, defects | PK | ✓ |
| catalogue.ts:43-171 | element and defect lookups on `catalogue_entries` / `catalogue_area_elements` | **nothing imports it** | n/a | dropped/emptied | n/a | ⚠ F-SQL-15 |

##### src/sync/outbox.ts
| file:line | statement | called from | freq | tables | index | verdict |
|---|---|---|---|---|---|---|
| :70-73 / :259-270 | `COUNT(*) WHERE state='queued'` / `'error'` | refreshCounts after **every** enqueue and settle | very hot | outbox | idx_outbox_state (covering) | ✓ 0.1 ms each; call storm F-SQL-8 |
| :111-116 | merge lookup `WHERE entity=? AND entity_id=? AND op='update' AND state='queued' ORDER BY seq` | every update enqueue | hot | outbox | idx_outbox_entity (entity, entity_id, state) | ✓ 0.01 ms |
| :127-131, :139-150 | DELETE merged rows; INSERT new row | every enqueue | hot | outbox | idx_outbox_entity | ✓ |
| :176-192 | pendingMutations `WHERE state='queued' AND (next_attempt_at IS NULL OR <= ?) ORDER BY seq LIMIT ?` | push and sendWithMedia | per sync request | outbox | idx_outbox_state (state, seq), no sort | ✓ 0.5 ms (payload strings: F-SQL-13) |
| :209-212 | markDone `UPDATE … WHERE mutation_id IN (≤100)` | settle | per request | outbox | unique autoindex | ✓ |
| :227-230 | markRejected per row | settle | per refusal | outbox | autoindex | ⚠ F-SQL-8 |
| :240-254 | markRetry `SELECT attempts` + `UPDATE` per row | push failure, waiting-for-parent | per row | outbox | autoindex | ⚠ F-SQL-8 |
| :287, :292-296, :309-311 | discard; retryErrored `UPDATE … WHERE state='error'`; clearBackoff | Sync now, launch, reconnect | per sync | outbox | idx_outbox_state | ✓ |
| :316-319 | pruneDone `DELETE WHERE state='done' AND created_at < ?` | launch + hourly (`engine.ts:87-94`) | hourly | outbox | idx_outbox_state | ✓ 19 to 76 ms for 3,000 rows (move off launch: F-SQL-16) |

##### src/sync/pull.ts
| file:line | statement | called from | freq | tables | index | verdict |
|---|---|---|---|---|---|---|
| :96-121, :104-108 | read and write `sync_meta` | every pull | per pull | sync_meta | PK | ✓ |
| :230-232 | `COUNT(*) FROM catalogue_defects` | job open bundle, capture sheet | per open | defects | full count (3,000) | ✓ |
| :268-275 | tx{applyCards + writeCursor} | sync request with `since` | per sync | tasks | PK | ✓ |
| :295-303 | tx{applyCards; reconcileCards (no cursor); writeCursor} | launch list, deltas | per pull | tasks + children | see below | ⚠ F-SQL-2 |
| :352-389 | tx{applyCards; reconcileCards(window)} | **each Done server page** | per page | tasks + children | see below | ⚠ F-SQL-2 |
| :443-446 | jobCursor `SELECT children_cursor, children_full_at` | job open | per open | tasks | PK | ✓ |
| :469-476 | linksExpiring (UNION ALL over photos and plans of the job) | job open | per open | photos, plans | idx_photo_task_upload, idx_floorplan_task | ✓ 0.5 ms (decides whole fetch: F-SQL-3) |
| :506-516 | tx{applyTaskDetail; applyRows; reconcileDeletions(job); markChildrenLoaded} | job open whole or delta, offline pack | per open, daily, hourly with remote links | all job tables | see below | ⚠ F-SQL-3: 149 to 245 ms whole |
| :549-554 | parent lookup (self-join) | job open | per open | tasks | PK | ✓ |
| :680-682 | tx{applyTaskDetail} | job detail open | per open | tasks, outbox | PK + EXISTS json_extract over signoffs | ✓ (F-SQL-13) |
| :738-745 | tx{DELETE 3 catalogue tables; insertMany ×3; writeMeta} | catalogue changed | rare | catalogue | n/a | ✓ 44 to 90 ms (rare) |
| :892-898 | markChildrenLoaded UPDATE | each job apply | per apply | tasks | PK | ✓ |
| :956-976 | reconcileCards: temp `_card_keep`; `DELETE FROM inspection_tasks WHERE … AND TASK_NOTHING_PENDING`; **5 orphan sweeps** `task_id NOT IN (SELECT id FROM inspection_tasks)` | list reconcile, Done pages | 10 min + per Done page | tasks, snags, photos, areas, checklist, plans | task delete: SCAN tasks + idx_outbox_entity; sweeps: idx_photo_upload / idx_snag_sync / full scans | ⚠ F-SQL-2: sweeps 84 to 182 ms vs delete 0.5 to 1.3 ms |
| :932-936 | collectFiles (UNION ALL photos and plans with the same WHERE) | inside reconciles | per reconcile | photos, plans | as the delete | ✓ |
| :1007-1039 | `insertMany`: multi-row `INSERT … VALUES (…),(…) ON CONFLICT …`, 900 params, row-by-row fallback | all appliers | per apply | n/a | n/a | ✓ good design |
| :1071-1146 | reconcileDeletions: temp `_auth_keep`, `_auth_scope`; 5 scoped DELETEs + 1 SELECT; optional task delete | whole job fetch | per whole fetch | job tables | idx_photo_task_upload, idx_area_task, idx_job_checklist_task, idx_floorplan_task (scoped); snags via idx_snag_sync | ✓ 42 to 70 ms of the apply |
| :1372-1376 | loadPendingIds `WHERE state IN(…) AND entity IN(…)` | each apply | per apply | outbox | idx_outbox_state | ✓ 3 ms (1,289 rows) |
| :1422-1434 | loadUnsentTasks: temp `_task_unsent` ← UNION incl. `json_extract(payload_json,'$.task_id')` over submissions | applyCards, applyTaskDetail, applyTasks | per apply | outbox | idx_outbox_entity (entity=?) | ⚠ F-SQL-13: 3.5 to 6 ms |
| :1515-1548 | mergeFinishedVisits `SELECT id, finished_visits_json … IN (chunk)` + JSON parse in JS | applyCards | per card apply | tasks | PK | ✓ |
| :1556-1588 | applyCards insertMany(CARD_COLUMNS, CARD_CONFLICT with `json_patch`) | pulls | per pull | tasks | PK | ✓ |
| :1596-1634 | applyTaskDetail UPDATE (EXISTS json_extract over signoff payloads; `json_patch`) | job open | per open | tasks, outbox | PK | ✓ (F-SQL-13) |
| :1752-1757 | applyAreas: UPDATE per pending area (≤ rooms) | apply | per apply | areas | PK | ✓ |
| :1763, :1830, :1947, :2010, :2050 | insertMany for areas, snags, photos (PHOTO_CONFLICT EXISTS per conflicting row), checklist, plans | apply | per apply | job tables | PK; EXISTS via idx_outbox_entity | ✓ batched (redundant index cost: F-SQL-12) |
| :1905-1908 | heldLinks `SELECT id, remote_path … WHERE id IN (≤900)` | photo or plan apply | per apply | photos, plans | PK | ✓ |

##### src/sync/alerts.ts
| file:line | statement | called from | freq | tables | index | verdict |
|---|---|---|---|---|---|---|
| :109-121 | sync_meta read and write | launch, alerts sync | per sync | sync_meta | PK | ✓ |
| :169-172 | listAlerts `ORDER BY created_at DESC LIMIT 200` | Alerts tab (focus, version bump, tick) | hot | alerts | alerts_created_idx (no sort) | ✓ 1.1 ms |
| :190-193 | unread `COUNT(*) WHERE read_at IS NULL` | every badge refresh | hot | alerts | `SCAN alerts` | ✓ 0.24 ms at 3,000 (partial index → 0.09 ms, optional) |
| :211-236 | storeAlerts: upsert **per alert** in one tx | catch-up, realtime | per sync, per event | alerts | PK | ⚠ F-SQL-9 |
| :270 | `SELECT id WHERE read_pending=1 LIMIT 500` | alerts sync | per sync | alerts | scan | ✓ |
| :297-310 | `UPDATE … read_pending=0 WHERE id IN`; trim `DELETE … id NOT IN (… ORDER BY created_at DESC LIMIT 200)` | alerts sync | per sync | alerts | scan + alerts_created_idx | ✓ 12 to 27 ms at 3,000, under 1 ms at 200 |
| :322-324, :356-371, :471, :499-504 | pending count; mark read (one / all); realtime delete; clear on sign-out | taps, events | per action | alerts, sync_meta | PK / scan | ✓ (outside tx: F-SQL-4) |

##### src/sync/uploader.ts, sendWithMedia.ts, push.ts, sendSoon.ts
| file:line | statement | called from | freq | tables | index | verdict |
|---|---|---|---|---|---|---|
| uploader.ts:169-180 | reclaimStranded `SELECT id WHERE upload_state='uploading'`; `UPDATE … IN` | each upload pass | per sync | photos | idx_photo_upload | ✓ |
| :213-222 | pick 10 `WHERE upload_state IN('pending','error') AND (…) ORDER BY taken_at LIMIT ?` | upload loop (up to 21 passes per sync) | hot in sync | photos | idx_photo_upload + temp B-tree | ✓ 0.6 ms (→ partial index F-SQL-5) |
| :241-247, :269, :287-290, :343-379 | per-photo state UPDATEs; success tx {UPDATE + enqueue photo insert} | upload loop | per photo | photos, outbox | PK | ✓ (un-wrapped: F-SQL-4) |
| :261-263, :399-404 | remaining COUNT; pendingUploadCount `task_id=? AND upload_state<>'uploaded'` | upload loop, submit gate | hot | photos | idx_photo_upload / idx_photo_task_upload (covering) | ✓ 0.24 ms |
| :423-429 | uploadCounts | refreshCounts (every enqueue) | very hot | photos | idx_photo_upload (covering) | ✓ 0.37 ms |
| :440-446, :473-492 | requeueFailed; uploadProgress (2 queries) | review screen | per open | photos | idx_photo_task_upload | ✓ 0.8 ms |
| sendWithMedia.ts:113-126 | choosePhotos (LIMIT 20, ordered by this snag first) | every send | hot | photos | idx_photo_upload + temp B-tree | ✓ 1 ms |
| :131-136 | `SELECT entity_id FROM outbox WHERE entity='snag' AND op='insert' AND state IN(…)` | every send | hot | outbox | idx_outbox_entity (entity=?) | ✓ |
| :160-193, :267, :336-340, :358-392, :409-412 | per-photo marks; claim `UPDATE … IN`; revert; outcome tx; photosWaiting COUNT | every send | hot | photos | PK / idx_photo_upload | ✓ |
| :331-333 | markRetry per mutation on failure | send failure | per failure | outbox | autoindex | ⚠ F-SQL-8 |
| push.ts:53-67 | device_id read and write | every push | hot | sync_meta | PK | ✓ (could be cached in memory) |
| :105-107, :143, :147, :159-163, :186-213 | markRetry and markRejected per result; snag_code per result; snags synced `IN`; per-failure UPDATE | settle | per request | outbox, snags | PK | ⚠ F-SQL-8 |
| sendSoon.ts:98-103 | `COUNT(*) … WHERE snag_id=? AND upload_state IN(…) AND …` | after save | per save | photos | idx_photo_snag | ✓ |

##### src/sync/freeSpace.ts, floorPlanCache.ts, offlinePack.ts, src/features/auth/authStore.ts
| file:line | statement | called from | freq | tables | index | verdict |
|---|---|---|---|---|---|---|
| freeSpace.ts:20-32 | finished-job uploaded photos with a local file | "Free up space" | rare | photos, tasks | idx_photo_upload ('uploaded' → 12k rows) + PK | ⚠ F-SQL-11: 65 to 81 ms + sync FS loop |
| :51-60 | tx{`UPDATE … SET local_path='' … WHERE id IN (≤500)`} | same | rare | photos | PK | ✓ batched |
| floorPlanCache.ts:47-51 | openActiveJobIds `WHERE children_at IS NOT NULL AND status NOT IN(…)` | every sync pass | per sync | tasks | `SCAN` (300) | ✓ |
| :67-72, :110 | plans of the named jobs; UPDATE local_path per plan | every sync pass | per sync | plans | idx_floorplan_task | ✓ |
| offlinePack.ts:72-99 | FAMILY_CTE (recursive up and down) + photos `task_id IN family OR snag_id IN (snags of family)` | Download for offline (×2: fetch + verify) | per pack | tasks, snags, photos | MULTI-INDEX OR: idx_photo_task_upload + idx_photo_snag; idx_task_parent | ✓ 11 to 14 ms |
| :150-153 | `UPDATE snag_photos SET local_path=?` per downloaded photo (autocommit) | pack | per photo (up to 1,500) | photos | PK | ✓ (downloads dominate; un-wrapped: F-SQL-4) |
| :229-235, :280-287, :328 | family plans; family ids; parent; pack_state | pack | per pack | tasks, plans | PK, idx_floorplan_task | ✓ (sync FS verify: F-SQL-11) |
| authStore.ts:238-242 | pending outbox + photo count | sign-out | rare | outbox, photos | covering idx | ✓ |
| :251-262 | all media paths (13,500 rows into JS) + 7 un-wrapped DELETEs | sign-out | rare | all | scan | ⚠ F-SQL-4 (not atomic). Wrap in `transaction()` |

---

#### 4. EXPLAIN QUERY PLAN and timings

##### 4.1 Timings (desktop node:sqlite, ms; median of the per-run medians over 3 runs of 20; budget estimate = A median × 3 to ×10)

| # | statement (file:line) | rows | A median | A p95 | B median (with stats) | proposed (state C/D) | phone est. (×3 to ×10) vs 50 ms budget |
|---|---|---:|---:|---:|---:|---:|---|
| Q1 | listActiveJobs (jobs.ts:565) | 100 | 10.7 | 19.3 | 13.7 | 11.5 | 32 to 107: **at risk** (F-SQL-7) |
| Q2 | listDoneJobs(20) (jobs.ts:576) | 21 | 4.9 | 8.8 | 4.5 | keyset P2 2.8 | 15 to 49: ok |
| Q2b | listDoneJobs(200) after 10 scrolls | 201 | 31.8 | 43.0 | 23.7 | keyset P2 2.8 | 95 to 318: **fails** (F-SQL-6) |
| Q3 | countDoneCards (jobs.ts:584) | 1 | 1.9 | 2.9 | 2.0 | 2.8 | ok |
| Q4 | getJob, big job (jobs.ts:601) | 1 | 0.54 | 0.72 | 0.44 | 0.65 | ok |
| Q5 | listAreas, 60 rooms (jobs.ts:654) | 60 | 0.84 | 1.46 | 1.25 | 0.90 | ok |
| Q6 | listSnags per job, 500 snags (jobs.ts:809) | 490 | **53.6** | **102.5** | 36.6 | one-probe P6 26 to 36 | 110 to 540: **fails** (F-SQL-1) |
| Q7 | listSnags per area (jobs.ts:809 + areaId) | 9 | 0.81 | 1.54 | 0.27 | 0.29 | ok (unused today) |
| Q8 | listSnagPhotos (jobs.ts:924) | 3 | 0.04 | 0.06 | 0.03 | 0.04 | ok |
| Q8b | listMediaForRound, round ≥ 1 (jobs.ts:980) | 1,500 | 19.2 | 26.3 | 21.8 | 17.2 | 58 to 192 if called with round 1; on real rounds rows ≪ 1,500 |
| Q9 | listChecklist, 120 items (checklist.ts:115) | 120 | 1.49 | 3.12 | 1.17 | 1.80 | ok (dup bug F-SQL-10) |
| Q9b | checklistProgress (checklist.ts:222) | 1 | 0.10 | 0.16 | 0.06 | 0.07 | ok |
| Q10 | pendingMutations(100) (outbox.ts:185) | 100 | 0.52 | 1.32 | 0.45 | 0.61 | ok |
| Q11 | enqueue merge lookup (outbox.ts:112) | 1 | 0.01 | 0.01 | 0.01 | 0.04 | ok |
| Q11b | getPendingCount (outbox.ts:71) | 1 | 0.12 | 0.21 | 0.11 | 0.25 | ok |
| Q12 | uploadCounts (uploader.ts:424) | 1 | 0.37 | 0.64 | 0.28 | P12 0.29 | ok |
| Q12b | pendingUploadCount (uploader.ts:400) | 1 | 0.24 | 0.48 | 0.19 | 0.47 | ok |
| Q12c | uploadProgress (uploader.ts:480) | 1 | 0.82 | 2.06 | 1.22 | 1.20 | ok |
| Q12d | uploadPending pick 10 (uploader.ts:213) | 10 | 0.63 | 1.34 | 0.78 | P12d 0.73 | ok |
| Q12e | choosePhotos (sendWithMedia.ts:113) | 20 | 1.01 | 2.25 | 0.72 | P12e 1.23 | ok |
| Q13 | listAlerts 200 (alerts.ts:170) | 200 | 1.14 | 1.66 | 1.26 | 2.36 | ok |
| Q13b | alerts unread count (alerts.ts:191) | 1 | 0.24 | 0.28 | 0.44 | 0.09 | ok |
| Q13c | alerts read_pending count (alerts.ts:323) | 1 | 0.37 | 1.17 | 0.39 | 0.02 | ok |
| Q14 | listUploads 100 (syncQueue.ts:39) | 100 | 4.3 | 6.8 | **85.1** | P14 **5.9** | B: 255 to 850: **fails** (F-SQL-5) |
| Q14b | uploadSummary (syncQueue.ts:81) | 1 | 1.1 | 2.2 | **43.4** | P14b **0.67** | B: 130 to 434: **fails** (F-SQL-5) |
| Q14c | listPendingChanges 100 (syncQueue.ts:103) | 100 | 4.5 | 7.1 | 4.5 | 6.2 | 14 to 45: ok |
| Q14d | changeSummary (syncQueue.ts:133) | 1 | 0.27 | 0.50 | 0.27 | 0.54 | ok |
| Q14e | readFailedPhotos (sync.tsx:479) | 150 | 0.47 | 1.02 | 0.38 | P14e 0.44 | ok |
| Q15 | searchDefects "grout" (catalogueTree.ts:176) | 40 | 4.0 | 6.0 | 3.6 | 4.9 | 12 to 40: ok per keystroke |
| Q15b | listCategories (catalogueTree.ts:103) | 20 | 0.73 | 1.58 | 1.05 | 1.37 | ok |
| Q15c | listRecentDefects (catalogueTree.ts:198) | 6 | 0.34 | 0.60 | 0.32 | 0.43 | ok |
| Q16 | nextSnagCode (jobs.ts:1201) | 500 | 0.66 | 2.75 | 0.82 | 0.92 | ok |
| Q17 | loadPendingIds (pull.ts:1372) | 1,289 | 3.1 | 5.4 | 3.2 | 4.1 | inside sync tx |
| Q18 | linksExpiring (pull.ts:469) | 3 | 0.47 | 1.45 | 0.60 | 0.77 | ok |
| Q19 | freeUpSpace select (freeSpace.ts:26) | 2,506 | 81.3 | 90.9 | 72.7 | 65.5 | one-off; F-SQL-11 |
| Q20 | familyPhotos (offlinePack.ts:89) | 350 | 13.9 | 19.8 | 11.4 | 13.3 | one-off |
| Q21 | loadUnsentTasks (pull.ts:1425), 60 × 50 KB | 31 | 6.1 | 9.2 | 4.3 | 4.6 | inside sync tx; F-SQL-13 |

listSnags breakdown (state A, ms): base columns + area join 15.2 → + photo_count 25.4 → + photo_count_this_round 34.6 → full query (adds 4 thumb probes) 53.6.

**Write transactions** (each on a fresh DB; range of per-run medians, runs 3 to 7):

| transaction | statements / rows | desktop ms | phone est. | holds `transaction()` queue? |
|---|---|---:|---|---|
| pull-apply whole big job (pull.ts:506) | 111 / 2,183 | 149 to 245 (apply 99 to 192, reconcile 42 to 70) | 0.45 to 2.5 s | yes (F-SQL-3) |
| same, first download (empty child tables), shipped vs proposed indexes, 8 interleaved | n/a | **331 vs 144** (8/8 pairs faster) | n/a | yes (F-SQL-12) |
| cards snapshot + reconcileCards, 100 cards (pull.ts:295/879/352) | ~15 | 103 to 251 (task delete 0.5 to 1.3, orphan sweeps 84 to 182) | 0.3 to 2.5 s | yes (F-SQL-2) |
| catalogue replace, 3,000 defects (pull.ts:738) | 33 | 44 to 90 | 0.13 to 0.9 s | yes (rare) |
| storeAlerts 3,000 row by row (alerts.ts:211) | 3,000 | 30 to 78 (SQL only) | plus 3,000 bridge hops | yes (F-SQL-9) |
| alerts trim 3,000 → 200 (alerts.ts:307) | 1 | 12 to 27 | n/a | no (autocommit) |
| pruneDone 3,000 rows (outbox.ts:316) | 1 | 19 to 76 | n/a | no (autocommit, at launch) |
| captureSnag (jobs.ts:1239): code scan + INSERT + UPDATE + enqueue + 3 counts | 7 | median 3.0 to 5.2, p95 4.4 to 8.3 | under 100: **passes** | queued behind the rows above |
| setChecklistStatus with merge (checklist.ts:244) | 7 | median 1.2 to 2.1, p95 1.5 to 2.8 | **passes** | queued |

##### 4.2 Plans (state A = shipped schema, fresh install)

```
-- Q1 listActiveJobs / Q2 listDoneJobs (same shape; keys CTE then 3 grouped child counts)
MATERIALIZE a
  SEARCH inspection_areas USING INDEX idx_area_task (task_id=?)
  LIST SUBQUERY 4
    SEARCH t USING COVERING INDEX sqlite_autoindex_inspection_tasks_1 (id=?)
    LIST SUBQUERY 2
      SCAN t
      USE TEMP B-TREE FOR ORDER BY
MATERIALIZE s
  SEARCH snags USING INDEX idx_snag_task_created (task_id=?)   [B: idx_snag_task]
MATERIALIZE p
  SEARCH snag_photos USING COVERING INDEX idx_photo_task_upload (task_id=?)
SEARCH t USING INDEX sqlite_autoindex_inspection_tasks_1 (id=?)
SEARCH a|s|p USING AUTOMATIC COVERING INDEX (task_id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY

-- Q3 countDoneCards
SCAN t
CORRELATED SCALAR SUBQUERY 1..3
  SCAN v VIRTUAL TABLE INDEX 1:          (json_each over finished_visits_json)

-- Q4 getJob
SEARCH t USING INDEX sqlite_autoindex_inspection_tasks_1 (id=?)
CORRELATED SCALAR SUBQUERY 1..4  SEARCH a USING (COVERING) INDEX idx_area_task (task_id=?)
CORRELATED SCALAR SUBQUERY 5     SEARCH s USING INDEX idx_snag_task_created (task_id=?)
CORRELATED SCALAR SUBQUERY 6     SEARCH p USING COVERING INDEX idx_photo_task_upload (task_id=?)

-- Q5 listAreas
SEARCH a USING INDEX idx_area_task (task_id=?)
CORRELATED SCALAR SUBQUERY 1
  SEARCH s USING COVERING INDEX idx_snag_area_status (area_id=?)
USE TEMP B-TREE FOR ORDER BY

-- Q6 listSnags (per job)                          -- Q7 (per area) is identical except:
SEARCH s USING INDEX idx_snag_task_created (task_id=?)   -- SEARCH s USING INDEX idx_snag_area_status (area_id=?) [stats]
SEARCH a USING INDEX sqlite_autoindex_inspection_areas_1 (id=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1  SEARCH p USING COVERING INDEX idx_photo_snag (snag_id=?)
CORRELATED SCALAR SUBQUERY 2  SEARCH p USING INDEX idx_photo_snag (snag_id=?)
                              SEARCH pt USING INDEX sqlite_autoindex_inspection_tasks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3..6  SEARCH p USING INDEX idx_photo_snag_taken (snag_id=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY

-- Q8 listSnagPhotos
SEARCH snag_photos USING INDEX idx_photo_snag_taken (snag_id=?)
-- Q8b listMediaForRound
SEARCH snag_photos USING INDEX idx_photo_task_upload (task_id=?)
USE TEMP B-TREE FOR ORDER BY
-- Q9 listChecklist
SEARCH c USING INDEX idx_job_checklist_task (task_id=?)
SEARCH o USING INDEX idx_outbox_entity (entity=? AND entity_id=? AND state=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
-- Q9b checklistProgress
SEARCH c USING INDEX idx_job_checklist_task (task_id=?)
-- Q10 pendingMutations
SEARCH outbox USING INDEX idx_outbox_state (state=?)
-- Q11 enqueue merge lookup
SEARCH outbox USING INDEX idx_outbox_entity (entity=? AND entity_id=? AND state=?)
-- Q11b / Q14d counts
SEARCH outbox USING COVERING INDEX idx_outbox_state (state=?)
-- Q12 uploadCounts
SEARCH snag_photos USING COVERING INDEX idx_photo_upload (upload_state=?)
-- Q12b pendingUploadCount / Q12c uploadProgress
SEARCH snag_photos USING (COVERING) INDEX idx_photo_task_upload (task_id=?)
-- Q12d uploadPending pick / Q12e choosePhotos
SEARCH snag_photos USING INDEX idx_photo_upload (upload_state=?)
USE TEMP B-TREE FOR ORDER BY
-- Q13 listAlerts
SCAN alerts USING INDEX alerts_created_idx
-- Q13b / Q13c alert counts
SCAN alerts                       [C: SCAN alerts USING (COVERING) INDEX idx_alerts_unread / idx_alerts_read_pending]
-- Q14 listUploads
SEARCH p USING INDEX idx_photo_upload (upload_state=?)
SEARCH s USING INDEX sqlite_autoindex_snags_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR ORDER BY
   [B, with stats:  SCAN p USING INDEX idx_photo_snag  -> 85 ms]
   [D2, rewrite + partial index:  SCAN p USING INDEX idx_photo_unsent_snag -> 5.9 ms]
-- Q14b uploadSummary
USE TEMP B-TREE FOR count(DISTINCT) x2
SEARCH snag_photos USING INDEX idx_photo_upload (upload_state=?)
   [B: full SCAN (43 ms)]   [D2: SCAN snag_photos USING COVERING INDEX idx_photo_unsent_snag (0.67 ms)]
-- Q14c listPendingChanges
SEARCH o USING INDEX idx_outbox_state (state=?)
SEARCH s USING INDEX sqlite_autoindex_snags_1 (id=?) LEFT-JOIN
SEARCH a USING INDEX sqlite_autoindex_inspection_areas_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
-- Q15 searchDefects
SCAN d
SEARCH s USING INDEX sqlite_autoindex_catalogue_subcategories_1 (id=?)
SEARCH c USING INDEX sqlite_autoindex_catalogue_categories_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
-- Q16 nextSnagCode
SEARCH snags USING INDEX idx_snag_task_created (task_id=?)
-- Q17 loadPendingIds
SEARCH outbox USING INDEX idx_outbox_state (state=?)
-- Q19 freeUpSpace
SEARCH p USING INDEX idx_photo_upload (upload_state=?)
SEARCH t USING INDEX sqlite_autoindex_inspection_tasks_1 (id=?)
-- Q20 familyPhotos
MULTI-INDEX OR
  INDEX 1  ... SEARCH p USING INDEX idx_photo_task_upload (task_id=?)   (family via idx_task_parent, recursive)
  INDEX 2  ... SEARCH p USING INDEX idx_photo_snag (snag_id=?)
-- Q21 loadUnsentTasks
COMPOUND QUERY
  SEARCH outbox USING COVERING INDEX idx_outbox_entity (entity=?)
  UNION USING TEMP B-TREE
  SEARCH outbox USING INDEX idx_outbox_entity (entity=?)     + json_extract(payload_json) per row

-- reconcileCards task delete (pull.ts:959)
SCAN inspection_tasks
LIST SUBQUERY 1  SCAN _card_keep
LIST SUBQUERY 2  SEARCH outbox USING COVERING INDEX idx_outbox_entity (entity=?)
LIST SUBQUERY 6  COMPOUND (snags|areas|photos|checklist JOIN outbox via idx_outbox_entity + PK)
-- reconcileCards orphan photo sweep (pull.ts:973)
SEARCH snag_photos USING INDEX idx_photo_upload (upload_state=?)          <- all 12,000 'uploaded' rows
USING INDEX sqlite_autoindex_inspection_tasks_1 FOR IN-OPERATOR
-- reconcileDeletions, job scope (pull.ts:1106-1123)
SEARCH snags USING INDEX idx_snag_sync (sync_state=?) + _auth_keep/_auth_scope bloom filters
SEARCH snag_photos USING INDEX idx_photo_task_upload (task_id=? AND upload_state=?)
SEARCH inspection_areas USING INDEX idx_area_task (task_id=?)
SEARCH job_checklist USING INDEX idx_job_checklist_task (task_id=?)
SEARCH floor_plans USING INDEX idx_floorplan_task (task_id=?)
-- alerts trim (alerts.ts:307)
SCAN alerts
LIST SUBQUERY 1  SCAN alerts USING INDEX alerts_created_idx
-- pruneDone (outbox.ts:316)
SEARCH outbox USING INDEX idx_outbox_state (state=?)
```

The full plan dump, including the state B and C differences, is printed by the script. In the planner-statistics comparison, 14 of the 38 timed statements change plan between A and B.

---

#### 5. Local pagination matrix

| list | where | page size | cursor | stable order? | has_more | memory-bounded? | dup/skip possible? | verdict |
|---|---|---|---|---|---|---|---|---|
| Today / Upcoming | `jobs.ts:562-567` (SQL, no LIMIT); drawn `jobs/index.tsx:226-231` | SQL: **all live jobs**; drawn 20 at a time | none (JS slice) | yes: `sort_key DESC, code, id` (`jobs.ts:457`) | JS `visible.length > page.length` | by live-job count, not by 20 | no | Handbook "draw 20 from all live jobs" is **correct**, but reading and card-building cover every live job on each focus and tick (F-SQL-7) |
| Done (phone) | `jobs.ts:575-580`; `jobs/index.tsx:240-249` | grows 20 → 40 → 60 … **jobs** (not cards) | none: `LIMIT n+1` from the top each time | yes (same key) | `rows.length > limit` | no: grows with scroll, re-reads all | no (re-read from top) | Handbook "Done reads 20 at a time" is **wrong**: cumulative re-read, job unit, plus active list and count re-read per scroll (F-SQL-6) |
| Done (server pages) | `pull.ts:315-397` | 30 cards (`DONE_PAGE`) | keyset `(before, before_id)` on `(created_at, id)` | yes | `has_more` from server | yes | no (pair cursor; window reconcile respects ties) | Correct. Local window grows by only 20 per page (`jobs/index.tsx:249`); each page also runs the full orphan sweeps (F-SQL-2) |
| Rooms | `jobs.ts:633-686` | all (≤ 60) | none | **partly**: `created_at, sort_order`, no id; NULL created_at first | n/a | yes (≤ 60) | no | OK size; ordering bug F-SQL-14 |
| Defects per room | area screen filters the store's whole-job list (`area/[areaId].tsx:91`); per-area SQL unused | all of the job (500) | none | yes: `created_at DESC, id DESC` | n/a | by job size (500 rows × 27 cols) | no | **Fix**: per-area query (F-SQL-1) |
| Defect detail / verify | `verify/[snagId].tsx:102-108` | all of the job, to show 1 | none | n/a | n/a | no | no | **Fix**: read by id (F-SQL-1) |
| Checklist | `checklist.ts:98-128` | all (≈120) | none | partly (no id tiebreak) | n/a | yes | **dup: yes** (F-SQL-10) | Fix the join |
| Alerts | `alerts.ts:168-174` | 200 (`KEEP`) | none | mostly (`created_at DESC`, no id) | none (older than 200 unreachable on the phone) | yes (trim to 200 + pending reads) | no | OK |
| Sync: uploads | `syncQueue.ts:39-58` | 100 snags | none | mostly (`state='error' DESC, MIN(taken_at)`) | headline counts via uploadSummary | yes | no | OK size; plan regression F-SQL-5 |
| Sync: changes | `syncQueue.ts:103-120` | 100 | none | yes (`seq` unique) | headline via changeSummary | yes | no | OK |
| Sync: failed photos | `sync.tsx:475-479` | **unbounded** | none | no ORDER BY | n/a | by failures (150 in seed) | no | OK in practice; add `LIMIT 500` |
| Outbox drain | `outbox.ts:173-203` | 100 (`config.ts:48`) | `seq` order + state filter | yes | `pendingMutations(1)` after settle | yes | no | Good |
| Upload drain | `uploader.ts:213-222` | 10 × up to about 21 passes | `taken_at` order + state filter | mostly (no id tiebreak) | remaining COUNT | yes | no | Good |

---

#### 6. Startup critical path (device)

Order (`app/_layout.tsx:52-60`, `authStore.ts:130-169`, `engine.ts:326-419`):

1. **Splash** stays until fonts, `dbReady` and a **300 ms floor** (`_layout.tsx:30`) are all done. The floor only matters if everything else finishes within 300 ms.
2. **`initDatabase()`**: 4 PRAGMAs + `PRAGMA user_version`. At the latest version there is no other SQL. A fresh install applies 38 versions in **51 to 114 ms on the desktop** (VERIFIED), roughly 0.15 to 1 s on a phone, once. An upgrade crossing v29 builds 6 indexes over existing data plus an `ANALYZE` (once, proportional to data).
3. **Then, serially, `bootstrap()` → `launchSession()`**, capped at **1.5 s** (`authStore.ts:79`) when token refresh hangs offline. It needs no tables. **It could run in parallel with step 2** (F-SQL-16).
4. **`startSyncEngine()`** (still inside bootstrap, so before `dbReady`). It is synchronous, but it starts SQL on the single connection: `startAlerts` → 2 `sync_meta` reads + unread COUNT; `pruneDoneSoon` → `DELETE FROM outbox WHERE state='done' AND created_at < ?` (**19 to 76 ms for 3,000 rows on the desktop**); `pullJobList()` (network, then a transaction applying cards, plus the reconcile and orphan sweeps on a device with no cursor, F-SQL-2).
5. The **Jobs screen's first read**: `listActiveJobs` (11 to 14 ms desktop) + `countDoneCards` (1.9 ms), queued behind whatever the step 4 statements are doing on the connection.
6. The **launch sync waits up to 4 s** for the job list (`engine.ts:315, 401-416`) before pushing the outbox or photos. That keeps the connection and network free for first paint; it is good.
7. The first full reconcile is deferred 60 s (`pull.ts:807-808`); also good.

What could move off the critical path: run the session lookup in parallel with migrations; run `pruneDoneSoon` after first paint; skip `countDoneCards` while the Today tab is showing (only the Done badge needs it, and it could be computed lazily). There is no heavy SQL at launch beyond the prune and, on a device with no cursor, the card reconcile.

---

#### 7. Things already done well

- **Batched upserts.** `insertMany` (`pull.ts:1007-1039`) uses 900-parameter multi-row `INSERT … ON CONFLICT` with a row-by-row fallback that isolates a bad row. The catalogue (3,000 rows) applies in 33 statements.
- **Pending-work guards are read once per apply** (`loadPendingIds`, `loadUnsentTasks` into a keyed temp table) instead of one outbox lookup per row.
- **Outbox indexes fit the access paths exactly.** `idx_outbox_state (state, seq)` serves the drain with no sort (0.5 ms for 100 of 2,000). `idx_outbox_entity (entity, entity_id, state)` serves the merge lookup (0.01 ms), the checklist join and every `NOT IN (SELECT entity_id …)` guard.
- **Update coalescing in enqueue** is one indexed SELECT plus one DELETE, and merges oldest-first so no field is lost (`outbox.ts:109-133`).
- **The job list builds no JSON in JS.** Card fields are picked out with `json_extract` in SQL, sign-offs are not read for cards, and `toListJob` returns the same object for an unchanged row (`jobs.ts:537-556`), so memoised cards skip re-render.
- **Counts are grouped over just the page's jobs** (`jobListSql`) instead of correlated per-row counts. Done is counted in SQL (`countDoneCards`, 1.9 ms).
- **Server Done paging is a proper keyset** on `(created_at, id)`, and the window reconcile handles ties correctly (`pull.ts:355-386`).
- **The Sync screen and alerts are capped** (100 / 100 / 200) with separate headline counts; the outbox and upload drains are bounded per pass.
- **Good PRAGMAs:** WAL, `synchronous=NORMAL`, `temp_store=MEMORY`. Each migration runs atomically with its `user_version` stamped inside the transaction.
- **v29 added the right composite indexes** (`idx_photo_task_upload`, `idx_photo_snag_taken`, `idx_snag_task_created`, `idx_snag_area_status`, `idx_outbox_entity`). Every per-job read in section 4 is an index SEARCH.
- **Files are deleted only after the commit** (`collectFiles` + `deleteLocalFiles`), so a rolled-back reconcile never orphans rows.
- **`freeUpSpace` updates rows in one batched transaction** before deleting files.
- **Reads never wait on the network** (refresh is fire-and-forget with coalescing and a 15 s window). The first reconcile is deferred 60 s after launch, and the launch sync waits for the list first.

---

##### Proposed v39 migration (measured as "state C" in the harness)

```sql
CREATE INDEX IF NOT EXISTS idx_photo_unsent_snag  ON snag_photos (snag_id, upload_state) WHERE upload_state <> 'uploaded';
CREATE INDEX IF NOT EXISTS idx_photo_unsent_taken ON snag_photos (taken_at)             WHERE upload_state <> 'uploaded';
CREATE INDEX IF NOT EXISTS idx_alerts_unread       ON alerts (created_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_read_pending ON alerts (id)         WHERE read_pending = 1;
DROP INDEX IF EXISTS idx_snag_task;      -- prefix of idx_snag_task_created
DROP INDEX IF EXISTS idx_snag_area;      -- prefix of idx_snag_area_status
DROP INDEX IF EXISTS idx_photo_snag;     -- prefix of idx_photo_snag_taken
DROP INDEX IF EXISTS idx_snag_sync;      -- not chosen by any hot query once stats exist
PRAGMA analysis_limit = 400;
PRAGMA optimize;
```
It ships together with the `upload_state <> 'uploaded'` query terms from F-SQL-5; without them the planner cannot use the partial photo indexes. Local only, so the pull cursor stays untouched.

### Appendix B · Server database: call inventory, indexes and CREATE INDEX statements, staging EXPLAIN commands, triggers and RLS, growth, auth path

#### 3. Appendix B: database-call inventory (mobile endpoints)

Notation: **H** = inspector's job history (~125). **A** = active jobs (~25). Per job: R (rooms) 30–60, S (snags) 150–500, P (photos) 450–1,500. "∥" = runs in parallel with its siblings; "→" = serial after the previous level. "Index" is taken from repo migrations; "base?" means it depends on out-of-band DDL (F-DB-1).

##### B.1 Auth (every endpoint)

| file:line | table | columns | filters | order / limit | rows at scale | index | serial / ∥ | verdict |
|---|---|---|---|---|---|---|---|---|
| `lib/server/request-user-access.ts:57` | (JWT, local) | — | ES256 verify; JWKS fetched once per 10 min per process (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:34-60`, `lib/constants.js:30`) | — | — | — | 0 RTT | Good |
| `lib/server/user-access.ts:60-67` | `user_profile` ⋈ `roles` ⋈ `role_access` | 8 cols + embeds | `id = uid` | maybeSingle | 1 + ~40 | PK | → 1 RTT on cache miss | OK; F-DB-12 |

##### B.2 `/sync/jobs`, `/sync/catalogue`, `/sync/pull` (`lib/server/snagging/sync-pull.ts`)

| file:line | table | columns | filters | order / limit | rows at scale | index | serial / ∥ | verdict |
|---|---|---|---|---|---|---|---|---|
| 189-196 | snagging_jobs | id, status, parent_job_id | inspector_id = me, status IN 7 | id; range(1000) | ~H (125) | `idx_snagging_jobs_inspector_status` (20260905090000:88) | L1 ∥ | Good |
| 210-219 | snagging_job_visits | job_id | inspector_id = me, status IN 2 | job_id; range | 0–5 | **none** (seq scan) | L1 ∥ | F-DB-14 |
| 232 / 253 | probes | `select col limit 1` | — | — | 1 | — | → cold only | F-DB-12 |
| 234-241 | snagging_areas ⋈ jobs!inner | job_id, job(id, status) | areas.inspector_id = me | job_id; range | 0 (dead column) | `snagging_areas_inspector_id_idx` partial (20260922100000:14-16) | L1 ∥ | Remove (F-DB-12) |
| 255-262 | snagging_job_inspectors ⋈ jobs!inner | job_id, job(id, status) | inspector_id = me, job.status IN 7 | job_id; range | ~H | `snagging_job_inspectors_inspector_idx` + jobs PK | L1 ∥ | Good |
| 323-331 | snagging_job_visits | id, job_id, visit_number, review_note, dates | job_id IN chunk(150), status IN 2 | visit_number desc, id; range | ≤ A | `(job_id, status)` | L2 ∥ (4 workers) | Good |
| 356-366 | snagging_job_visits | 9 cols | job_id IN chunk, status IN (submitted, completed) | same | ≤ H × visits | `(job_id, status)` | L2 ∥ | OK (reads full history every call) |
| 386-394 | snagging_jobs | id, parent_job_id | id IN chunk, visit_type = additional, parent not null | id | ≤ H | PK | L2 ∥ | Good |
| 1038-1045 | snagging_snags | id, visit_id | visit_id IN chunk, status ≠ withdrawn | id; range | done-visit snags | `snagging_snags_visit_idx` (20260914120000:135) | L3 ∥ (non-list only) | OK |
| 1073-1084 | snagging_jobs | id | id IN chunk, updated_at > since | id | few | PK + filter | L3 ∥ (delta) | Good |
| 1085-1096 | snagging_job_visits | id, job_id | job_id IN chunk, updated_at > since | id | few | `(job_id, status)` + filter | L3 ∥ | OK |
| 1100-1111 | snagging_areas | id, job_id | job_id IN chunk(H), updated_at > since | id | scans H × R ≈ 3,750 | base? job_id | L3 ∥ (list delta) | F-DB-5 |
| 495 → sync-children | (B.3) | | all H jobs (legacy) / A (scoped) | | | | L3 ∥ | F-DB-4 |
| 1130-1139 | snagging_areas | id, job_id, confirmed_at | job_id IN listIds | id; OFFSET pages | A × R = 750–1,500 | base? | L3 ∥ (active) / **→ L4 serial** (done, delta) `:715-722` | F-DB-13 |
| 600 | probe hasGatepass | | | | 1 | | → cold | F-DB-12 |
| 638-648 | snagging_jobs | CARD_COLUMNS or 40+ cols + 3 embeds | id IN chunk | id; range | A (list) / H (pull) | PK | L3 → after changed ids on delta | Good |
| 663-677 | snagging_jobs | CARD_COLUMNS | id IN chunk(150), keyset (created_at, id) | created_at desc, id desc; limit 31 | 31 per chunk | PK (150 lookups + top-N) | L3 ∥ 4 | Good: correct keyset, merge-sorted |
| 1203-1208 | 3 catalogue tables | count head | updated_at > since | — | ≤ 3 k each | seq (tiny) | ∥ 3 | OK; no index needed (< 1 ms) |
| 1235-1248 | 3 catalogue tables | 5–8 cols | active = true | sort_order, id; range | ~1–3 k | seq + sort (tiny) | ∥ 3 (serial pages inside) | OK |
| 1262-1265 | 3 catalogue tables | count head | active = true | — | — | seq | ∥ 3 | OK (could fold into the reads) |

##### B.3 `loadSyncChildren` (`lib/server/snagging/sync-children.ts`), used by `/sync/pull` and `/sync/job/[id]`

| file:line | table | columns | filters | order / limit | rows at scale | index | serial / ∥ | verdict |
|---|---|---|---|---|---|---|---|---|
| 107-112 | 4 probes | | | | | | → cold | F-DB-12 |
| 122-131 | snagging_areas | 18 cols | job_id IN **all jobIds (unchunked)** [, updated_at > since] | id; OFFSET | job: R; pull: H × R | base? | ∥ 5 | F-DB-4 / F-DB-5 |
| 132-144 | snagging_snags | 20 cols + recorded_by embed | job_id IN heavyIds [, updated_at > since] | id; OFFSET | job: S ≤ 500; scoped: A × S = 3,750; pull: 19 k | base? | ∥ | F-DB-4 / 5 |
| 147-157 | snagging_snag_photos | 12 cols | job_id IN heavyIds [, created_at > since] | id; OFFSET | job: P ≤ 1,500 (2 pages); scoped 11 k (12); pull 56 k (57) | base? | ∥ (serial pages) | **F-DB-4** |
| 158-167 | snagging_job_checklist | 10–12 cols (+answerer embed) | job_id IN [, updated_at > since] | id; OFFSET | ~80 per job | `(job_id, sort_order)`, `(job_id, created_at)` | ∥ | F-DB-5 |
| 215-228 | snagging_floor_plans | 7 cols | job_id IN [, updated_at > since] | created_at, sort_order, id | 1–4 per job | `(job_id, updated_at)` (20260920100000:32) | ∥ | Good (unchunked: F-DB-4) |
| 180-183 → `media.ts:109-111` | Storage `createSignedUrls` | — | 100 paths per call | — | P/100 calls | `storage.objects (bucket_id, name)` | **all ∥, uncapped** | F-DB-4 |

##### B.4 `/sync/job/[id]` (`app/api/snagging/sync/job/[id]/route.ts`) + `loadTaskDetail` (`lib/server/snagging/sync-task-detail.ts`) + sign-offs

| file:line | table | columns | filters | order / limit | rows at scale | index | serial / ∥ | verdict |
|---|---|---|---|---|---|---|---|---|
| route:73 | snagging_jobs | id, inspector_id, parent_job_id | id | maybeSingle | 1 | PK | L1 ∥ 5 | dup (F-DB-6) |
| route:74-79 | snagging_job_visits | count | job_id, inspector_id, status IN 2 | head | 0–1 | `(job_id, status)` | L1 ∥ | OK |
| route:80-87 | snagging_areas | count | job_id, inspector_id | head | 0 | partial inspector idx | L1 ∥ (after probe) | dead (F-DB-12) |
| route:93-97 | snagging_jobs | count | parent_job_id = id, inspector_id = me | head | 0–3 | base? parent index | L1 ∥ | §4 #7 |
| route:99 → `job-roster.ts:208-217, 219-230` | jobs + job_inspectors | id, inspector_id / job_id, inspector_id | id IN [id] / job_id IN [id] | range | 1 / 1–3 | PK / PK | L1 ∥ | dup (F-DB-6) |
| task-detail:44 | snagging_jobs ⋈ property, client, lead | 35 cols + 3 embeds | id | maybeSingle | 1 | PK | L2 ∥ 4 | dup |
| task-detail:45-50 | snagging_job_visits | 6 cols | job_id, status IN 4 | visit_number desc | ≤ 3 | `(job_id, status)` | L2 ∥ | Good |
| task-detail:51-62 | snagging_snags | id, visit_id | job_id, visit_id not null, status ≠ withdrawn | id; OFFSET | ≤ S | base? | L2 ∥ | ships ids to count (F-DB-6) |
| task-detail:64-73 | snagging_job_inspectors ⋈ user_profile | inspector_id, name | job_id | created_at | 1–3 | PK prefix | L2 ∥ | dup |
| task-detail:115 → `signoffs.ts:41-44` | jobs + job_inspectors (again), visit_inspectors | | | | | PK | **L3 →** | dup, serial (F-DB-6) |
| `signoffs.ts:50-58` | user_profile; snagging_job_signoffs | id, name / inspector_id, signed_at | id IN; job_id [, visit_id] | — | 1–3 | PK / unique `(job_id, coalesce(visit_id), inspector_id)` | **L4 →** | serial |
| route:130-145 | loadSyncChildren(job) ∥ parent detail + children | (B.3) | | | ×2 with parent | | L2 ∥ | OK |

##### B.5 Push (`lib/server/snagging/sync-push.ts`); `/sync/push` and `/sync/snag`

| file:line | table | columns | filters | rows at scale | index | serial / ∥ | verdict |
|---|---|---|---|---|---|---|---|
| 106 | probe | | | | | → cold | F-DB-12 |
| 122 | snagging_sync_mutations | mutation_id, status | mutation_id IN (≤ batch) | ≤ 100 | **PK** (20260817090000:670) | L1 ∥ 5 | Good |
| 124 | snagging_jobs | id, status, code, inspector_id | id IN touched | 1–3 | PK | L1 ∥ | Good |
| 127-131 | snagging_areas | job_id | inspector_id = me, job_id IN | 0 | partial | L1 ∥ | dead |
| 134-139 | snagging_job_visits | 5 cols | job_id IN, status IN 2 | 0–3 | `(job_id, status)` | L1 ∥ | Good |
| 142-147 | snagging_job_inspectors | job_id | inspector_id = me, job_id IN | 1–3 | PK / inspector idx | L1 ∥ | Good |
| 217-233 | snagging_job_visits UPDATE | status, started_at, updated_at | id, status = scheduled | 0–1 | PK | → L2 | Good (once per push) |
| 480-484 (+488) | snagging_snags (+ rosters) | created_by + embed | id | 1 | PK | per snag/photo/verdict → | **N+1** (F-DB-3) |
| 532-536 | snagging_snags | locked | id | 1 | PK | per snag on a visit → | N+1 |
| 422-434 | snagging_snags ×2 | snag_code / id, snag_code | id / **job_id (all codes)** | 1 / ≤ 500 | PK / code-unique (base?) | per snag → | **N+1, O(S) each** |
| 601, 607-609 | snagging_snags UPSERT | 17 cols | on conflict id | 1 | PK, code-unique | per snag → | triggers F-DB-8 |
| 504-508 | snagging_snags UPDATE | status = withdrawn | id, locked = false | 1 | PK | per delete | triggers F-DB-8 |
| 686 (+691) | snagging_areas UPSERT | 9 cols | on conflict id | 1 | PK | per room insert | OK |
| 720-726 | snagging_areas UPDATE … RETURNING name | ≤ 8 cols | id, job_id | 1 | PK | per room update | OK (self-trigger on confirm) |
| 764-768, 779-783 | snagging_snag_photos | snag_id / storage_path | id | 1 | PK | per photo (conditional) | OK |
| 788-789 | Storage remove + photos DELETE | | id | 1 | PK | per photo delete (serial) | order: file before row |
| 801-805 | snagging_snag_photos UPDATE | marker_x, marker_y | id | 1 | PK | per marker | OK |
| 834 | snagging_snag_photos UPSERT | 16 cols | on conflict id | 1 | PK | **per photo** | batchable (F-DB-3) |
| 845-868 | snagging_job_checklist UPDATE … RETURNING | 4–6 cols | id, job_id | 1 | PK | per item | OK |
| 915-919 | snagging_snags UPDATE | status [, verdict_note] | id | 1 | PK | per verdict | triggers F-DB-8 |
| 1449-1453 | snagging_snags ⋈ jobs | snag_code, job(…) | id | 1 | PK | per verdict → | N+1 |
| 1479-1482 | snagging_jobs | id | parent_job_id = root | 1–4 | base? parent | per verdict → (same answer each time) | memoise |
| 1485-1491 | snagging_snags UPDATE | status | job_id IN family, snag_code, id ≠ | 1–3 | code-unique (base?) | per verdict → | triggers × 3 |
| 977-979 / 92-104 | Storage upload; signoffs DELETE → INSERT | | job_id, inspector_id [, visit_id] | 1 | unique | per sign-off (serial ×3) | OK |
| 1031-1074 | jobs; snags (paged); photos (paged); checklist | | job_id | 1; S; P; ~80 | PK; base?; base?; `(job_id, …)` | submission L ∥ 4 | OK (bounded per job) |
| 1171-1181 | snagging_snags | id, verdict_note | id IN poor | ≤ S | PK | → | could reuse the 1042 read |
| 1205 → `signoffs.ts:119-120` | (B.4 signers) | | | | | → 2–3 levels | OK |
| 1227 → `signoffs.ts:150-156` | snagging_job_signoffs | 3 cols | job_id, inspector_id, visit_id null | 0–1 | unique | → | OK |
| 1235-1253 | snagging_jobs UPDATE | 11 cols | id | 1 | PK | → | fires 2–3 triggers (F-DB-16) |
| 1256 / 1378-1382 | snagging_snags UPDATE locked | | job_id [, visit_id] | **all ≤ 500** | base? | → | F-DB-7 |
| 1304-1330 | snags; photos (paged) | | job_id, visit_id | S; P | snags_visit_idx; base? | ∥ 2 | OK |
| 1413-1417 | snagging_jobs UPDATE | status, started_at | id, status IN 2 | 1 | PK | per task mutation | OK |
| 316-322 | snagging_sync_mutations UPSERT | 7–8 cols | on conflict mutation_id | batch | PK + 2 unused | → once | **Good (one statement)** |
| 328 → `audit.ts:459` | snagging_audit_events INSERT | 9 cols | — | batch | PK + 2 | after() | **Good** |

##### B.6 `/sync/snag` extras (`app/api/snagging/sync/snag/route.ts`)

| file:line | table | what | rows | serial / ∥ | verdict |
|---|---|---|---|---|---|
| 107-111 → `job-roster.ts:258-294` | jobs, job_inspectors, job_visits ×2, visit_inspectors, areas | `mayWriteJob` per photo job | 1–3 each | L1 ∥, 2 levels | dup (F-DB-15) |
| 140-142 | Storage upload | ≤ 20 files | — | L2 ∥ | OK |
| 189 | push (B.5) | | | L3 | |
| 207 | list delta (B.2 delta path) | | | **L4 serial** | F-DB-15 |
| 233 | Storage `createSignedUrls` | 1 call | ≤ 20 | L5 | OK |

##### B.7 `/sync/alerts` (`app/api/snagging/sync/alerts/route.ts`)

| file:line | table | columns | filters | order / limit | rows | index | serial / ∥ | verdict |
|---|---|---|---|---|---|---|---|---|
| 95 | probe | | | | | | cold | F-DB-12 |
| 102-108 | snagging_notifications UPDATE | read_at | user_id, read_at null | — | up to 3,000 | `snagging_notifications_unread_idx` partial | → L1 | F-DB-9 (Realtime flood) |
| 109-116 | UPDATE | read_at | user_id, id IN (≤ 500), read_at null | — | ≤ 500 | PK | → L1 | OK |
| 126-138 | SELECT `*` | all | user_id, (created_at > s OR read_at > s) | created_at desc, id desc; OFFSET | 0–3,000 | user_idx + filter | L2 ∥ (pages serial) | F-DB-9 |
| 143-149 | SELECT `*` | all | user_id | same; limit 200 | 200 | `(user_id, created_at desc)` | L2 ∥ | OK (`*` unnecessary) |
| 153-157 | count head | id | user_id, read_at null | — | count | partial unread idx | L2 ∥ | Good |

##### B.8 `media/sign`, `noc`, `gatepass`, snag history

| file:line | table | columns | filters | rows | index | serial / ∥ | verdict |
|---|---|---|---|---|---|---|---|
| `media/sign/route.ts:45-49` | snagging_jobs | id, inspector_id | id | 1 | PK | L1 | OK |
| `media/sign/route.ts:65` | `mayWriteJob` (≤ 6 queries) | | | | | L2 (non-lead only) | OK |
| `media/sign/route.ts:77-79` | Storage `createSignedUploadUrl` | | | — | | L3 | orphans (F-DB-10) |
| `tasks/[id]/noc/route.ts:51-57` | snagging_jobs ⋈ property | 4 cols + embed | id | 1 | PK | L1 | OK |
| `noc/route.ts:71`, `:85`, `:100-102` | `mayWriteJob`; sign ×2 (serial) | | | | | L2–L4 | the 2 signs could run ∥ |
| `tasks/[id]/gatepass/route.ts:42`, `:46-52`, `:59`, `:69`, `:80-82` | probe; jobs; `mayWriteJob`; sign ×2 | | id | 1 | PK | L1–L5 | probe removable; signs ∥ |
| `snags/[id]/history/route.ts:53-57` | snagging_snags | job_id, snag_code | id | 1 | PK | L1 | OK |
| `history:62` → `job-family.ts:89-96` | snagging_jobs + 2 self-embeds | id, parent, visit_type, round | id | 1 + children | PK + base? parent | L2 | Good (one round trip) |
| `history:66-77` | jobs; snags + `photos(count)` + recorded_by | | id IN family / job_id IN family, snag_code | ≤ 5 | PK; code-unique (base?) | L3 ∥ | Good (count embedded) |
| `history:91-96` | snagging_audit_events | entity_id, actor_label, created_at, payload | event_type, entity_id IN legs | ≤ 5 | **unusable** | L4 | **F-DB-11** |

---

#### 4. Indexes: what exists, and what to add

##### 4.1 Existing indexes on `snagging_*` tables that the mobile path uses (from migrations)

| Table | Index (migration:line) | Used by mobile? |
|---|---|---|
| snagging_jobs | `idx_snagging_jobs_inspector_status (inspector_id, status)` (20260905090000:88) | yes: sync-pull:189 |
| snagging_jobs | `idx_snagging_jobs_review_queue (status, submitted_at)`, `idx_snagging_jobs_reviewer (reviewer_id) partial`, `idx_snagging_jobs_escalation (approval_due_at) partial` (20260904090000:38-51); `_delivered`, `_approved`, `_developer` (20260905090000:77-86); `idx_snagging_jobs_property` (20260821190000:42) | no (portal) |
| snagging_jobs | PK, parent_job_id index, other base indexes | **unknown, out of band** (F-DB-1). The previous audit lists `idx_snag_jobs_client` in production (`AUDIT_SCALABILITY.md:418`). |
| snagging_job_visits | `snagging_job_visits_number_idx UNIQUE (job_id, visit_number)`, `snagging_job_visits_job_status_idx (job_id, status)` (20260914120000:107-112) | yes |
| snagging_areas | `snagging_areas_visit_idx (visit_id)` (20260918110000:22); `snagging_areas_inspector_id_idx (inspector_id) WHERE inspector_id IS NOT NULL` (20260922100000:14); `idx_snagging_areas_floor_plan` (20260824090000:35); **job_id index: unknown (base)** | partial idx only (dead column) |
| snagging_snags | `snagging_snags_visit_idx (visit_id)` (20260914120000:135); constraint `snag_snags_code_unique` (base; columns unknown, presumably `(job_id, snag_code)`); **job_id / area_id: unknown** | yes |
| snagging_snag_photos | **all unknown (base)** | yes |
| snagging_job_checklist | `UNIQUE (job_id, code)` (20260821110000:40); `(job_id, sort_order)` (:42); `(job_id, created_at)` (20260901090000:37) | prefix only |
| snagging_floor_plans | `(job_id, sort_order)` (20260821170000:23); `(job_id, updated_at)` (20260920100000:32) | yes |
| snagging_job_inspectors | PK `(job_id, inspector_id)`; `(inspector_id)` (20260923100000:28-33) | yes |
| snagging_visit_inspectors | PK `(visit_id, inspector_id)`; `(inspector_id)` (20260924150000:24-29) | yes |
| snagging_area_inspectors | PK; `(inspector_id)` (20260923100000:41-46) | **never read by code** |
| snagging_job_signoffs | `UNIQUE (job_id, coalesce(visit_id, 0-uuid), inspector_id)` (20260924130000:30-35) | yes |
| snagging_sync_mutations | PK `(mutation_id)`; `(entity, entity_id)`; `(user_id, applied_at desc)` (20260817090000:670-686) | PK only |
| snagging_audit_events | PK; `(task_id, created_at desc)`; `(entity_type, entity_id, created_at desc)` (20260821160000:139-142) | entity index unusable as queried (F-DB-11) |
| snagging_notifications | `(user_id, created_at desc)`; `(user_id) WHERE read_at IS NULL`; `(job_id)` (20260924120000:34-39) | yes |
| catalogue v2 | UNIQUE `code`; UNIQUE `(category_id, code)`, `(subcategory_id, code)`; `(category_id, sort_order)`, `(subcategory_id, sort_order)` (20260910090000:36-78); `snagging_catalogue_defects_source_code_idx` (20260910100000:26) | no index needed: ≤ 3 k rows, seq scan < 1 ms for `active` and `updated_at` |

**Indexes I checked and do not recommend:**
- **Done paging on `(created_at, id)`:** the query filters `id IN (≤150)`, so the PK serves it. An index on `(created_at, id)` would not be chosen.
- **Ledger PK:** `snagging_sync_mutations(mutation_id)` already exists, and the push's `onConflict: "mutation_id"` would fail without it.
- **Catalogue `(active, updated_at, sort_order)`:** not worth it at ≤ 3 k rows.

##### 4.2 Recommended statements

Run on staging first, outside any transaction, one at a time. First run §5.0 and skip any index that already exists under another name.

```sql
-- 1. Area status trigger and room counts (F-DB-1, F-DB-8) -- verify first; Critical if absent
create index concurrently if not exists idx_snag_snags_area_live
  on public.snagging_snags (area_id) where status <> 'withdrawn';

-- 2. Snag delta + every job_id lookup (F-DB-5); makes a plain (job_id) index redundant
create index concurrently if not exists idx_snag_snags_job_updated
  on public.snagging_snags (job_id, updated_at);

-- 3. Photo delta (filters created_at) + job lookups (F-DB-4/5)
create index concurrently if not exists idx_snag_photos_job_created
  on public.snagging_snag_photos (job_id, created_at);

-- 4. Room delta (list "changed rooms") + room counts (F-DB-5, F-DB-13)
create index concurrently if not exists idx_snag_areas_job_updated
  on public.snagging_areas (job_id, updated_at);

-- 5. Visit membership (F-DB-14)
create index concurrently if not exists idx_snag_visits_inspector_status
  on public.snagging_job_visits (inspector_id, status) where inspector_id is not null;

-- 6. Checklist delta (F-DB-5)
create index concurrently if not exists idx_snag_checklist_job_updated
  on public.snagging_job_checklist (job_id, updated_at);

-- 7. Rounds/visits of a job: job route access, verdict write-through, job family embed
create index concurrently if not exists idx_snag_jobs_parent
  on public.snagging_jobs (parent_job_id) where parent_job_id is not null;

-- 8. Alerts delta "read since cursor" branch (F-DB-9)
create index concurrently if not exists idx_snag_notif_user_read
  on public.snagging_notifications (user_id, read_at) where read_at is not null;

-- 9. Sign-off clear on visit send-back (F-DB-16)
create index concurrently if not exists idx_snag_signoffs_visit
  on public.snagging_job_signoffs (visit_id) where visit_id is not null;

-- 10. Ledger pruning (F-DB-10): tiny, append-ordered
create index concurrently if not exists brin_snag_sync_mutations_applied
  on public.snagging_sync_mutations using brin (applied_at);

-- 11. ONLY if F-DB-11's code fix cannot ship:
-- create index concurrently if not exists idx_snag_audit_event_entity
--   on public.snagging_audit_events (event_type, entity_id, created_at desc);
```

**Drop candidates.** Drop only after `pg_stat_user_indexes.idx_scan` stays at 0 for 14 days on production stats. That is a read-only check: ask the database owner.

```sql
drop index concurrently if exists public.idx_snagging_sync_mutations_entity;   -- no reader in code
-- plain single-column job_id indexes on snags / photos / areas once #2-#4 exist (find names via §5.0)
-- one of snagging_job_checklist (job_id, sort_order) / (job_id, created_at) if the portal does not order by it
```

**Per-insert cost:**
- #2–#4 replace plain `job_id` indexes, so the index count is unchanged.
- #1 adds one entry per live snag.
- #4 makes area status UPDATEs non-HOT (`updated_at` is indexed), so ship F-DB-8's guard with it.
- Net: about +1 index write per snag and −1 per mutation (dropping the ledger index).

---

#### 5. Top 15 queries: EXPLAIN on **staging only**

##### 5.0 Setup and catalog checks (read-only, staging)

```sql
-- sample ids: the busiest inspector, the biggest job, a heavy alerts user
select inspector_id, count(*) n from public.snagging_jobs group by 1 order by 2 desc limit 1;      -- :insp
select job_id, count(*) n from public.snagging_snag_photos group by 1 order by 2 desc limit 1;     -- :job
select user_id, count(*) n from public.snagging_notifications group by 1 order by 2 desc limit 1;  -- :usr
\set insp '''<uuid>'''
\set job  '''<uuid>'''
\set usr  '''<uuid>'''
\set since '''2026-09-30T00:00:00Z'''

-- what really exists (F-DB-1)
select tablename, indexname, indexdef from pg_indexes
 where schemaname = 'public' and tablename like 'snagging_%' order by 1, 2;
select tgrelid::regclass, tgname, pg_get_triggerdef(oid) from pg_trigger
 where not tgisinternal and tgrelid::regclass::text like '%snagging_%' order by 1, 2;
select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
 where conname = 'snag_snags_code_unique';
select relname, n_live_tup, seq_scan, idx_scan, n_tup_upd, n_tup_hot_upd, n_dead_tup
  from pg_stat_user_tables where relname like 'snagging_%' order by n_live_tup desc;
select relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
  from pg_stat_user_indexes where relname like 'snagging_%' order by idx_scan;
select pubname, pubinsert, pubupdate, pubdelete from pg_publication where pubname = 'supabase_realtime';
select * from pg_publication_tables where pubname = 'supabase_realtime';
show work_mem;
```

Optional: on staging only, enable PostgREST plans (`alter role authenticator set pgrst.db_plan_enabled = true; notify pgrst, 'reload config';`). Then call the real routes with `Accept: application/vnd.pgrst.plan+text; options=analyze|buffers` to get the plan of the exact PostgREST SQL.

##### 5.1 The 15 queries

Each SQL block below is the closest equivalent of the PostgREST request at the cited line. Expected plans are INFERRED.

**Q1: assigned jobs** (`sync-pull.ts:189-196`)
```sql
explain (analyze, buffers)
select id, status, parent_job_id from public.snagging_jobs
 where inspector_id = :insp and status = any('{assigned,in_progress,submitted,in_review,rejected,approved,delivered}')
 order by id limit 1000 offset 0;
```
Expect: `Bitmap Index Scan on idx_snagging_jobs_inspector_status`, then `Sort` of ~125 rows; < 1 ms.

**Q2: visit membership** (`sync-pull.ts:210-219`)
```sql
explain (analyze, buffers)
select job_id from public.snagging_job_visits
 where inspector_id = :insp and status = any('{scheduled,in_progress}') order by job_id limit 1000;
```
Expect today: `Seq Scan on snagging_job_visits` (all rows). After §4 #5: `Index Scan using idx_snag_visits_inspector_status`.

**Q3: roster membership with inner job filter** (`sync-pull.ts:255-262`)
```sql
explain (analyze, buffers)
select r.job_id, j.id, j.status from public.snagging_job_inspectors r
  join public.snagging_jobs j on j.id = r.job_id
 where r.inspector_id = :insp
   and j.status = any('{assigned,in_progress,submitted,in_review,rejected,approved,delivered}')
 order by r.job_id limit 1000;
```
Expect: `Nested Loop`: `Index Scan snagging_job_inspectors_inspector_idx`, then `Index Scan snagging_jobs_pkey`; ~125 loops; < 2 ms.

**Q4: Done page** (`sync-pull.ts:663-677`). Use ~150 of the inspector's non-active job ids.
```sql
explain (analyze, buffers)
select id, code, status, round_number, visit_type, scheduled_date, rejection_reason, created_at, unit_label
  from public.snagging_jobs
 where id = any(array(select id from public.snagging_jobs where inspector_id = :insp limit 150))
   and (created_at < now() or (created_at = now() and id < '00000000-0000-0000-0000-000000000000'))
 order by created_at desc, id desc limit 31;
```
Expect: `Index Scan using snagging_jobs_pkey` (150 lookups), then `top-N heapsort`; < 3 ms.

**Q5: active job cards** (`sync-pull.ts:638-648`, view=list). Same shape as Q4 without the keyset, ordered by id. Expect PK lookups; < 3 ms.

**Q6: room counts**, current (`sync-pull.ts:1130-1139`) and proposed (F-DB-13)
```sql
explain (analyze, buffers)
select id, job_id, confirmed_at from public.snagging_areas
 where job_id = any(array(select id from public.snagging_jobs where inspector_id = :insp
                           and status in ('assigned','in_progress','rejected')))
 order by id limit 1000 offset 1000;
-- Q6b proposed
explain (analyze, buffers)
select job_id, count(*), count(confirmed_at) from public.snagging_areas
 where job_id = any(array(select id from public.snagging_jobs where inspector_id = :insp
                           and status in ('assigned','in_progress','rejected')))
 group by job_id;
```
Expect: Bitmap on the areas job_id index, then `Sort`. Q6b is `HashAggregate` with no sort; < 2 ms.

**Q7: changed rooms on a list delta** (`sync-pull.ts:1100-1109`)
```sql
explain (analyze, buffers)
select id, job_id from public.snagging_areas
 where job_id = any(array(select id from public.snagging_jobs where inspector_id = :insp))
   and updated_at > :since
 order by id limit 1000;
```
Expect today: `Bitmap Heap Scan … Filter: (updated_at > …)  Rows Removed by Filter ≈ H×R`. After §4 #4: `Index Cond` on both columns, Rows Removed ≈ 0.

**Q8: snags of one job** (`sync-children.ts:134-144`)
```sql
explain (analyze, buffers)
select s.id, s.job_id, s.area_id, s.snag_code, s.status, s.created_by, p.full_name, p.email
  from public.snagging_snags s left join public.user_profile p on p.id = s.created_by
 where s.job_id = :job order by s.id limit 1000 offset 0;
```
Expect: `Index Scan` on the snags job_id index (or code-unique prefix), then Sort of ≤ 500 rows, Nested Loop to the `user_profile` PK; < 5 ms. If you see `Seq Scan on snagging_snags`, it is Critical.

**Q9: photos, deep OFFSET page.** One job, then the scoped set (`sync-children.ts:147-157`, `read-all.ts:27-33`).
```sql
explain (analyze, buffers)
select id, snag_id, job_id, storage_path, media_type, bytes, width, height, taken_at, round_number, marker_x, marker_y
  from public.snagging_snag_photos where job_id = :job order by id limit 1000 offset 1000;
explain (analyze, buffers)
select id, snag_id, job_id, storage_path from public.snagging_snag_photos
 where job_id = any(array(select id from public.snagging_jobs where inspector_id = :insp
                           and status in ('assigned','in_progress','rejected')))
 order by id limit 1000 offset 10000;
```
Expect: Bitmap Heap Scan over all matches, then `Sort Method: top-N heapsort`. Watch for `external merge Disk:` on the second; F-DB-4 is confirmed if the deep page costs about the same as page 1 multiplied by the number of pages.

**Q10: photo delta** (`sync-children.ts:48,156`)
```sql
explain (analyze, buffers)
select id from public.snagging_snag_photos
 where job_id = any(array(select id from public.snagging_jobs where inspector_id = :insp))
   and created_at > :since order by id limit 1000;
```
Expect today: Filter with large Rows Removed. After §4 #3: `Index Cond: job_id = ANY … AND created_at > …`.

**Q11: snag code settlement, per snag** (`sync-push.ts:424-433`) and the proposed point check
```sql
explain (analyze, buffers)
select id, snag_code from public.snagging_snags where job_id = :job order by id limit 1000;
explain (analyze, buffers)
select 1 from public.snagging_snags where job_id = :job and snag_code = 'X-S001';
```
Expect: the first is an Index Scan returning ≤ 500 rows. The second is an `Index Only Scan using snag_snags_code_unique` with ~3 buffers.

**Q12: area trigger count, and the trigger cost inside an INSERT** (`20260904100000:34-45`)
```sql
explain (analyze, buffers)
select count(*) from public.snagging_snags
 where area_id = (select area_id from public.snagging_snags where job_id = :job limit 1)
   and status <> 'withdrawn';
-- Q12b: trigger time, rolled back
begin;
load 'auto_explain'; set local auto_explain.log_min_duration = 0;
set local auto_explain.log_nested_statements = on; set local auto_explain.log_analyze = on;
explain (analyze, buffers)
insert into public.snagging_snags (id, job_id, area_id, snag_code, catalogue_code, severity)
select gen_random_uuid(), job_id, area_id, 'EXPLAIN-S999', 'X', 'low'
  from public.snagging_snags where job_id = :job limit 1;
rollback;
```
Expect: `Index (Only) Scan` < 0.5 ms, and `Trigger snagging_snags_refresh_area: time < 1 ms, calls=1`. A `Seq Scan` here is **Critical** (F-DB-1). Adjust the INSERT column list to the base table's NOT NULL columns.

**Q13: bulk lock on submit** (`sync-push.ts:1256`)
```sql
begin;
explain (analyze, buffers) update public.snagging_snags set locked = true where job_id = :job;
explain (analyze, buffers) update public.snagging_snags set locked = true where job_id = :job and locked = false;
rollback;
```
Expect: the first statement updates every row (≤ 500, plus touch trigger time); with the fix the second updates 0 rows (F-DB-7).

**Q14: alerts delta** (`alerts/route.ts:126-138`)
```sql
explain (analyze, buffers)
select id, job_id, visit_id, type, title, body, created_at, read_at, when_at
  from public.snagging_notifications
 where user_id = :usr and (created_at > :since or read_at > :since)
 order by created_at desc, id desc limit 1000 offset 0;
```
Expect today: `Index Scan using snagging_notifications_user_idx`, Filter, Rows Removed ≈ 3,000. After §4 #8: `BitmapOr` (user_idx + idx_snag_notif_user_read), < 50 buffers.

**Q15: defect-history verdicts** (`snags/[id]/history/route.ts:91-96`), current and fixed
```sql
explain (analyze, buffers)
select entity_id, actor_label, created_at, payload from public.snagging_audit_events
 where event_type = 'snag_verified'
   and entity_id = any(array(select id from public.snagging_snags where job_id = :job limit 5))
 order by created_at desc;
explain (analyze, buffers)
select entity_id, actor_label, created_at, payload from public.snagging_audit_events
 where entity_type = 'verification' and event_type = 'snag_verified'
   and entity_id = any(array(select id from public.snagging_snags where job_id = :job limit 5))
 order by created_at desc;
```
Expect: the first is a `Seq Scan on snagging_audit_events` (F-DB-11). The second is an `Index Scan using idx_snagging_audit_entity`, < 1 ms.

Also run (not counted in the 15) the ledger lookup `select mutation_id, status from snagging_sync_mutations where mutation_id = any($100)`. Expect: `Index Scan using snagging_sync_mutations_pkey`.

---

#### 6. Triggers and RLS: cost table

| Trigger / policy (migration:line) | Fires on | Work per fire | Write amplification / locks | Verdict |
|---|---|---|---|---|
| `snagging_snags_refresh_area` (20260904100000:51-54) | AFTER INSERT, UPDATE OF status/area_id, DELETE on snags; per row | `count(*)` by area_id (index: base?) + **unconditional** `UPDATE snagging_areas` | +1 area tuple per snag write; + touch on areas (base?); row lock on the area serialises parallel chains in the same room; stale-status race on concurrent withdrawals | **F-DB-8**; F-DB-1 if index missing |
| `snagging_areas_refresh_status` (20260904100000:86-89) | AFTER UPDATE OF confirmed_at on areas | count + second UPDATE of the same row | 2 tuples per confirm; no recursion (status only) | F-DB-8 |
| `*_touch` → `snagging_touch_updated_at` (20260817090000:30-38, 706-728; floor plans 20260920100000:65-78) | BEFORE UPDATE, per row | sets `updated_at` | negligible CPU, but turns non-semantic updates (bulk lock, area status recompute) into delta re-sends | presence on lean tables INFERRED (§5.0) |
| `snagging_notify_job_update` (20260924140000:88-158) | AFTER UPDATE on jobs, **every row** | label + condition checks; on transition, a recipients query and `snagging_notify` (2 EXISTS + INSERT) per recipient | EXCEPTION block = subtransaction per row | F-DB-16 (add WHEN) |
| `snagging_clear_job_signoffs` (20260924130000:41-61) | AFTER UPDATE on jobs, every row | DELETE only on → rejected | EXCEPTION block | F-DB-16 |
| `snagging_notify_visit` (20260924140000:160-226) | AFTER INSERT/UPDATE on visits, every row | **always** reads the job + builds the recipients array before checking for change | small (~0.1 ms) | F-DB-16 |
| `snagging_clear_visit_signoffs` (20260924130000:63-83) | AFTER UPDATE on visits | DELETE `where visit_id =` (no index) | seq scan of sign-offs (small table) | §4 #9 |
| `snagging_notify_roster_insert` (20260924140000:57-86) | AFTER INSERT on job_inspectors | job read + notify | portal delete-then-insert roster: deduped by the EXISTS check | OK |
| `snagging_notify` dedupe (20260924140000:35-50) | per alert | EXISTS (user, job, 'assigned'): served by `(job_id)`; EXISTS within 1 min: `(user_id, created_at)` | — | OK |
| Audit rules `DO INSTEAD NOTHING` on UPDATE/DELETE (20260821160000:147-150) | UPDATE/DELETE on audit | rewrite to nothing | blocks retention | F-DB-10 |
| RLS on all snagging tables (20260817090000:949-970 and each later migration) | server uses the service role (BYPASSRLS) | **0** for API traffic | — | Good |
| `snagging_notifications_select_own` `user_id = auth.uid()` (20260924120000:46-49) | Realtime authorisation per change event, per subscriber; direct client reads | 1 comparison; `auth.uid()` per row (advisor "auth_rls_initplan") | UPDATE events are published too | prefer `(select auth.uid())`; F-DB-9 |
| Legacy `snagging_is_task_member()` policies (20260817090000:929-1058) | old `task_id` tables only | function with 2 EXISTS per row | — | not on the lean tables per their comments ("RLS on, no policies", e.g. 20260821170000:161-162); confirm with `select * from pg_policies where tablename like 'snagging_%'` |

Per-write totals (INFERRED):

| Write | Statements in Postgres (including the client write) | Heap tuples |
|---|---|---|
| snag insert | 3 | 2 |
| snag status change (verdict on a round) | ~3 + 3 × (family copies) | ~2 + 2 × copies |
| room confirm | 3 | 2 |
| submission | 1 + ≤ 500 + 2–3 trigger evaluations | — |

---

#### 7. Growth and retention

| table / object | grows per | est. rows/yr at scale | cleaned by | verdict |
|---|---|---|---|---|
| snagging_sync_mutations | every mobile mutation (rooms, snags, photos, checklist, verdicts, sign-offs); photos via `/sync/snag` get a fresh id per request (`snag/route.ts:147`) | ~25 k jobs × ~800 = **~20 M** (~8–12 GB with 3 indexes) | **nothing** | F-DB-10: prune > 30 days; drop the unused index |
| snagging_audit_events | snag create/update/withdraw, room confirm/access, not-checked, verdict, sign-off, submit, start | ~25 k × ~250 = **~6 M** | **cannot be deleted** (rule) | partition monthly; fix F-DB-11 |
| snagging_notifications | per recipient per assign / reject / approve / reschedule / visit event | ~150 k/yr (600 k already, 3 k per user) | nothing | prune read > 180 days; F-DB-9 |
| snagging_snags | capture | ~3.75 M | soft delete (`withdrawn`) | OK (core data) |
| snagging_snag_photos | capture | ~11.25 M | hard delete on photo delete only (`sync-push.ts:789`) | OK; index set per §4 |
| snagging_areas / checklist | job setup | ~0.75–1.5 M / ~2 M | none | OK |
| snagging_job_signoffs | per inspector per pass | ~30–60 k | trigger delete on reject / send-back | OK |
| storage `snagging/tasks/*/snags/*` | each photo/video | ~11 M objects, **~4.5 TB/yr** at ~400 KB | photo delete only | orphans below |
| storage orphans: uploaded but photo row rejected | `/sync/snag` (`route.ts:140-145`, `212-223`) | unknown; ~1% would be ~110 k | **nothing** | F-DB-10 |
| storage orphans: upload URL signed, never recorded | `media/sign` (`route.ts:77-79`) | unknown | **nothing** | weekly sweep |
| storage: withdrawn snags' photos | soft withdraw keeps files | ~5% of photos? | nothing | decide on a retention policy (PDPL §7 says "purged at retention time", `media.ts:203-205`) |
| storage: superseded signatures | each submission/sign-off mutation id (`sync-push.ts:971-976`) | ~1–2 per job | nothing | small |
| storage.objects rows | mirror of the above | ~11 M+ | Storage API only | `createSignedUrls` stays an index lookup on `(bucket_id, name)`; OK |

Index cost per insert (INFERRED, after §4):

| Table | Index entries per insert |
|---|---|
| snags | ~5 (PK, job_updated, area_live, visit, code-unique) |
| photos | ~3–4 (PK, job_created, snag_id?, storage_path unique?) |
| ledger | 3 today, 2 after the drop (PK + BRIN; BRIN is near-free) |
| audit | 3 |
| notifications | 4 (PK, user, unread, job) + 1 when read (#8) |

---

#### 8. Auth path: database round trips before real work

| Step | Where | Round trips (warm instance) | Cold instance |
|---|---|---|---|
| JWT verify (`getClaims(token)`) | `request-user-access.ts:57` | **0**. Local ES256 with JWKS cached 10 min process-wide (auth-js 2.93.3, `GoTrueClient.js:34-60, 2789-2840`; `JWKS_TTL` 10 min, `constants.js:30`). Asymmetric keys: stated in `user-access.ts:129-131` and **not verifiable from the repo** (INFERRED). With HS256 it falls back to `getUser` = 1 HTTP call. | +1 JWKS fetch |
| Profile + role access | `user-access.ts:60-67` | 1 on cache miss, 0 on hit. TTL 30 s, per instance (`:52`). On a 5-min cadence this is mostly a miss; bursts (save → push + delta in one request, which share the promise) hit. Estimated hit rate 30–50% (INFERRED). | 1 |
| Feature probes | `columns.ts`; awaited at sync-pull:232, 253; sync-children:107; task-detail:41; push:106; job-roster:272, 345; alerts:95; gatepass:42 | 0 ("present" is cached forever) | **+1–4 serial** |
| Route access checks | job route:72-100 (1 level, 6 queries); push:115-149 (1 level, 5); `mayWriteJob` for noc / gatepass / media-sign non-lead / snag route (2 levels, ≤ 6) | 1–2 | same |
| **Total before real work** | | **1–3 serial round trips** (≈ 0.2–0.7 s at 220 ms) | **3–7** |

Concurrency against the connection pool:
- **Calls in flight per request:**

  | Request | In flight |
  |---|---|
  | list pull | ≤ 6 |
  | job open | ≤ ~25 (incl. 15 Storage signs) |
  | push | 12 workers + 5 pre-reads |
  | legacy pull | 20+ PostgREST + **N/100 Storage**, uncapped |

- **Pool size:** PostgREST's DB pool is fixed per compute size, a few dozen at most. Measure on staging with `select count(*) from pg_stat_activity where application_name ilike '%postgrest%'`.
- `readAllByIds` with 4 workers is irrelevant at H ≈ 125 (one chunk).
- The real pressure is concurrent pushes (12 × number of inspectors draining) and uncapped signing. Fix F-DB-3 (batching) and F-DB-4 (cap of 6).

---

#### 9. Already good (verified)

- `readAllRows`/`readAllByIds` (`read-all.ts:22-81`): every root and child read is paged with a unique order, so the silent 1,000-row truncation that deleted data on phones is gone. Id lists are chunked at 150 everywhere except `loadChanged`/`loadPlans` (F-DB-4).
- Membership roots run in parallel, and room and roster membership are joined `!inner` in the database rather than in a second round trip (`sync-pull.ts:222-274`).
- The Done tab uses a correct `(created_at, id)` keyset with a tie-breaker, per-chunk top-N and a merge (`sync-pull.ts:651-698`).
- A delta reads only changed jobs, and a changed visit or room counts as a changed job (`sync-pull.ts:631-637, 1060-1121`).
- Catalogue: read only when asked for or changed. The 3 change counts and 3 paged reads run in parallel and the catalogue is no longer read twice (`sync-pull.ts:135-159, 1192-1291`). It is small enough that no index is needed.
- The per-screen split (`/sync/jobs` cards with no children; `/sync/job/[id]?view=detail` with no contents) keeps the current app off the heavy path (`job/[id]/route.ts:38-45, 121-125`).
- Push applies the ledger once per push as a single upsert (`sync-push.ts:316-322`). Only applied mutations count as duplicates (`:156-168`). Visits start once per push, not per mutation (`:206-233`). Audit is one batched insert after the response (`audit.ts:412-464`). Waves preserve dependencies, and same-row chains stay in order (`push-plan.ts:308-332`).
- Room and checklist updates use `UPDATE … RETURNING`, avoiding a read-after-write (`sync-push.ts:717-726, 845-868`).
- The access cache stores the promise, so concurrent requests share one query; failures and "no profile" are not cached (`user-access.ts:90-114`). Auth uses local `getClaims` (0 round trips for ES256).
- The signed-URL cache reuses URLs that still have more than 30 minutes left, with request coalescing (`media.ts:86-197`).
- Defect history embeds `photos(count)` and loads the job family in one round trip (`history/route.ts:70-77`, `job-family.ts:82-97`).
- Alerts: the unread badge uses the partial index, and deltas page through everything instead of capping at 50 (`alerts/route.ts:119-158`).
- Trigger functions use `security definer` + `set search_path = public`, and alert triggers never block the business write (EXCEPTION → warning).

---

##### Out-of-scope observations, for the security and correctness owners (VERIFIED, not performance)

- `app/api/snagging/snags/[id]/history/route.ts:42-62`: any user with Snagging VIEW can read any snag's history. There is no job-membership check.
- `app/api/snagging/media/sign/route.ts:61-66`: if `job.inspector_id` is null, any user with EDIT may get an upload URL for that job.
- `sync-pull.ts:210-219` finds visit jobs only through `snagging_job_visits.inspector_id`. A second crew member in `snagging_visit_inspectors` can write to the visit (`job-roster.ts:271-285`) but is not handed the job by the pull.
- `snagging_area_inspectors` (20260923100000:35-46) is never read by any code.
- `job/[id]/route.ts:58, 63` passes `since` and `parent_since` without validating them. A bad value gives a 500 rather than a 400.

### Appendices C and D · Endpoint scorecard, save-flow round trips, serverless and caching notes, staging script

#### 3. Appendix C: endpoint scorecard

Depth is the number of serial round trips on the warm critical path. p50/p95 are INFERRED at ≈220 ms per round trip (see the model at the top), assuming the profile cache misses (30 s TTL per instance, `P:lib/server/user-access.ts:52`). Auth is local JWT verification (JWKS cached for 10 min, globally, in `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:41` and `lib/constants.js:30`) plus 0–1 profile query (`P:lib/server/request-user-access.ts:57-65`).

| method/path | auth (RT) | DB calls (count; serial/parallel; depth) | storage | payload shape | est. size at scale | p50 / p95 (INFERRED) | risk > 1 s | notes |
|---|---|---|---|---|---|---|---|---|
| GET /sync/access | 0–1 | 0 beyond auth | 0 | `{id, full_name, role}` | 0.1 KB | 0.25 / 0.6 s | Low | Duplicates `me` in /sync/alerts (F-API-19) |
| GET /sync/jobs?list=active | 0–1 | ≈10–14: 4 roots ∥ → 3 visit reads ∥ (150-id chunks, ×4) → jobs ∥ countRooms (1,000-row pages, serial); depth 4–7 (`sync-pull.ts:269,400,504,712`) | 0 | cards ≈650 B | 60 cards 39 KB raw / ≈5 KB gz; 300 cards ≈195 / ≈25 KB | 0.9–1.5 / 1.5–2.4 s | **High** | Every room row read to count (F-API-7) |
| GET /sync/jobs?list=done&limit=30 | 0–1 | as above; countRooms after jobs; depth 5–6 (`:715-722`) | 0 | 30 cards + `next_before(_id)` | ≈20 KB / ≈3 KB | 1.1–1.3 / 1.8–2.1 s | **High** | |
| GET /sync/jobs?since= | 0–1 | roots → visits → changed (3 tables × 2 chunks for 300 jobs) → [jobs → rooms]; depth 4 (no-op) / 6 | 0 | changed cards | usually < 5 KB | 0.9 / 1.5 s (no-op); 1.3 / 2.1 s | **High** | Visits read before the changed set (F-API-7) |
| GET /sync/job/{id}?view=detail | 0–1 | access 6 ∥ → detail 4 ∥ → rosters 2 ∥ → people + signoffs; ≈14; depth 5 | 0 | `{task}` | 2–3 KB / ≈1 KB | 1.1 / 1.8 s | **High** | `loadJobRosters` runs twice (F-API-8) |
| GET /sync/job/{id}?since (delta) | 0–1 | as detail + 5 child loads ∥; depth 5 (bound by `task`) | 0–n sign batches | children changed + task | small; own writes come back (F-API-12) | 1.1 / 1.8 s | **High** | |
| GET /sync/job/{id} whole (500/1,500) | 0–1 | ≈20; photos 2 serial pages; depth 5–6 | 15 `createSignedUrls` ∥ (+ plans) | 5 arrays + task | **≈1.6 MB raw / ≈300–400 KB gz** | 1.4–1.7 / 2.5–3.5 s | **Critical** | Signed URLs ≈60% (F-API-5/6) |
| … + include_catalogue + parent | 0–1 | ≈40; depth 5–6 | ≈30 ∥ | + parent + catalogue | ≈3.7 MB / ≈0.7–0.9 MB gz | 1.6–2.0 / 3–4 s | **Critical** | De-snag rounds and visits |
| GET /sync/catalogue?include_catalogue | 0–1 | 3 paged reads (defects > 1,000 → 2 serial pages) ∥ 3 counts; depth 3 (`sync-pull.ts:1230-1291`) | 0 | 3 arrays + counts | ≈400–500 KB / ≈60–90 KB gz (defect count unknown, > 1,000) | 0.7 / 1.2 s | Medium | Whole library on any change |
| GET /sync/catalogue?catalogue_since (unchanged) | 0–1 | 3 head counts ∥; depth 2 | 0 | `{catalogue: null}` | 0.1 KB | 0.45 / 0.8 s | Low | No ETag/304 (F-API-9) |
| POST /sync/push | 0–1 | pre-read 5 ∥ + per mutation 1–10 serial × ceil(n/12) per wave + ledger; audit after response | sign-off/submission upload; photo delete removal | `{results[{mutation_id, status, error?, snag_code?}], applied, rejected}` | ≈90 B per mutation (100 → 9 KB) | 1 defect 1.3 / 2.0 s; 100 mixed ≈5 s; 500 ≈21 s | **Critical** | F-API-3/4/15 |
| POST /sync/snag (1–3 photos) | 0–1 (×3 handlers, cached) | `mayWriteJob` depth 2 → push 7 → sign 1; depth 12 | N parallel uploads + 1 sign | results + `photos[{id, status, storage_path, url}]` + `changes` | ≈1–3 KB (+ cards) | 2.6 / 3.8 s (+ upload transfer) | **Critical** | F-API-2 |
| POST /sync/snag (+ since) | 0–1 | + list delta 3–5; depth 15–17 | as above | + `changes` (cards) | + a few KB | 3.3–3.7 / 5 s | **Critical** | Sync now, after-upload sends |
| POST /sync/snag (empty + since: pull-to-refresh) | 0–1 | list delta; depth 4–6 | 0 | `{results: [], photos: [], changes}` | < 5 KB | 0.9–1.3 / 1.5–2.1 s | **High** | Multipart POST used as a read |
| POST /media/sign | 0–1 | job 1 → `mayWriteJob` 0–2 (`route.ts:45-65`); depth 3–5 | 1 `createSignedUploadUrl` | `{bucket, path, signed_url, token}` | 0.6 KB | 0.7–1.1 / 1.2–1.6 s | Medium | One call per file, serial with the PUT (F-API-11) |
| POST /sync/alerts | 0–1 | read update 0–1 → list ∥ unread count; depth 2–3 | 0 | `{server_time, me, alerts[], unread}` | first 200 × 450 B = 90 KB / ≈15 KB gz; delta small; `read_all` on 3,000 would return 1.35 MB | 0.45–0.7 / 1.0 s | Low–Med | F-API-13 |
| GET /tasks/{id}/noc | 0–1 | job 1 → `mayWriteJob` 0–2; depth 4–6 | 2 serial signs | `{required, url, download_url, file_name, expires_in}` | 1 KB | 0.9–1.3 / 1.6–2.0 s | Medium | F-API-17 |
| GET /tasks/{id}/gatepass | 0–1 | as NOC (+ cached probe) | 2 serial | same | 1 KB | 0.9–1.3 / 1.6–2.0 s | Medium | |
| GET /snags/{id}/history | 0–1 | snag → family → jobs ∥ legs → audit; depth 5 | 0 | `{legs[]}` | < 5 KB | 1.1 / 1.7 s | Medium | No assignment check (out of scope) |
| (GET /sync/pull) | | not called by the current app (no caller in `M:src`) | | | | | | Legacy route only |

Cold instance (INFERRED): +1 JWKS fetch, +1 profile query, +1–2 serial column/table probes (`sync-pull.ts:232,253`; `sync-push.ts:106,142`; `columns.ts:22-80`), an empty signed-URL cache (full re-sign), and loading the code: ≈+0.6–1.2 s.

---

#### 4. Appendix D: save flows, network calls from tap to "confirmed saved"

Common prefix for every `sendSoon` row: local SQLite write plus outbox (`M:src/sync/outbox.ts:80-154`), then a **600 ms gather** (`M:src/sync/sendSoon.ts:22,62`), then `sendWithMedia` (`M:src/sync/sendWithMedia.ts:246-261`). With no pending files and no `since`, that becomes `/sync/push` (`M:src/sync/push.ts:82-115`); otherwise it is multipart `/sync/snag`.
Follow-up rounds run while `remaining > 0 && applied > 0`, at most 5 (`sendSoon.ts:87-89`). Leftover media for the saved defect triggers `syncNow` (`:97-106`).
Confirmation is always consumed by `settlePush` (`push.ts:129-164`: `results[].status/error/snag_code` → outbox retired, `snags.sync_state='synced'`) and, for files, by `sendWithMedia.ts:359-383` (`photos[].status/storage_path/url`).

| action | calls (sequence) | blocking UI? | confirmation fields consumed | redundant call? | recommended single-response contract |
|---|---|---|---|---|---|
| Save defect, 0 photos | gather 600 ms → `POST /sync/push` (1) | No (`inspectionStore.ts:349` not awaited) | `results[].status`, `snag_code` | Later delta re-pulls it (F-API-12) | Result + `row{updated_at, snag_code, visit_id, created_by, locked}` |
| Save defect, 1 small photo | gather → `POST /sync/snag` multipart (1) | No | + `photos[].status/storage_path/url` | none | As above + `photos[].url, expires_at` |
| Save defect, 3 small photos | gather → `POST /sync/snag` (1); ≤ 20 files / 3.5 MiB (`sendWithMedia.ts:42,124`); server uploads in parallel (`route.ts:117`) | No | same | none | same |
| Save defect, photo > 2.5 MB | `/sync/push` → `syncNow`: `/sync/snag` (empty + since) → `/media/sign` → storage PUT → `/sync/snag` (photo row + since) = **4 API + 1 PUT** | No; tile spins | outbox + `uploaded` state | **Yes**: list-only `/sync/snag`; separate sign | Defect response returns `uploads[{id, path, signed_url, token}]`, registered on upload (F-API-11) → 1 API + 1 PUT |
| Save defect with video | same as above (`sendWithMedia.ts:192-195`) | No | same | **Yes** | same |
| Edit defect | gather → `/sync/push` (1) | No | `results[].status` | Server reads every code on the job (F-API-4) | `row` echo |
| Withdraw defect | gather → `/sync/push` (1) | No | `results[].status` | — | `row{status: "withdrawn"}` |
| Add photo to an existing defect | gather → `/sync/snag` (1) | No | `photos[]` | — | as above |
| Remove photo | gather → `/sync/push` (1); server 4 RT incl. storage remove (`sync-push.ts:773-791`) | No | status | — | — |
| Add room | gather → `/sync/push` (1) (`inspectionStore.ts:468`) | No | status | — | `row` |
| Start room (open area) | `startArea` → gather → `/sync/push` (1) (`area/[areaId].tsx:115`) | No | status | — | — |
| Finish / reopen / access | gather → `/sync/push` (1) (`inspectionStore.ts:571,594`) | No | status | — | `row{confirmed_at, status}` |
| Room pin | gather → `/sync/push` (1) (`inspectionStore.ts:485,499`) | No | status | — | — |
| Room outline | gather → `/sync/push` (1) (`:518,532`) | No | status | — | — |
| Photo marker | gather → `/sync/push` (1) (`snag/[snagId].tsx:168`) | No | status | — | — |
| Checklist answer | gather → `/sync/push` (1 per burst; +1 if a tap lands mid-flight) (`checklist.tsx:280`) | No | status; `NOT_ON_SERVER_YET` → wait (`push.ts:135-144`) | — | `row{answered_by_name, visit_id}` |
| De-snag verdict | gather → `/sync/push` (1) (`desnag.ts:140`); server 5 RT | No | status | Write-through values not returned | `row` + `origin_updated: n` |
| Verdict + after photos | gather → `/sync/snag` (1) (`desnag.ts:169`) | No | status + `photos[]` | — | same |
| Sign-off (shared job) | `/sync/push` with base64 PNG (1) (`review.tsx:498`) → on the next open `GET view=detail` (`review.tsx:131`) | Button spins on local write only | status | **Yes**: detail GET to learn team sign-offs | Result carries `signoffs[{id, name, signed_at}]` |
| Submit with signature | `syncNow()` → `/sync/snag` (submission + since) (1); then floor-plan caching downloads (`engine.ts:242-246`) | No; success shown before the response (`review.tsx:540`) | status (Sync screen only) | — | Await the result; `job{status, locked, submitted_at}` or `error` inline (F-API-14) |
| Start inspection | `startJob` enqueues only, no send (`jobs.ts:1814-1832`, `index.tsx:506`); entering inspect → `GET /sync/job/{id}` bundle (1) | No | — (rides the next send) | Start reaches the office only with the next save or the 5-min timer (`engine.ts:363-371`) | `sendSoon` after `startJob`, or fold the start into the bundle request |
| Mark alert read | 800 ms debounce → `POST /sync/alerts {read: [id]}` (1) (`alerts.ts:346-363`) | No | `unread`, `server_time` | — | `{unread, read_applied}` |
| Mark all read | → `POST /sync/alerts {read: [≤500 local ids]}` (1) | No | `unread` (**contradicts** when > 200) | — | `{read_all: true}` → `{unread: 0, read_applied}` (F-API-13) |
| Sign-in + access | Supabase password grant → `GET /sync/access` → `GET /sync/jobs?list=active` ∥ `POST /sync/alerts` (+ realtime WebSocket) = **4 HTTP** (`authStore.ts:56-64`, `engine.ts:384,359`) | Yes (access, ≤ 15 s timeout) | 200/401/403; cards; `me`/`unread` | **Yes**: identity twice | `/sync/access` → `{me, role, unread, cards, catalogue_version}` |
| Pull-to-refresh | `POST /sync/snag` (empty + since) (1) (`engine.ts:294`); `/sync/jobs` if no cursor; reconcile every 10 min = 2 serial `/sync/jobs` (`pull.ts:870-884`) | Spinner | `changes.tasks`, `server_time` | Reconcile makes 2 | 1 call returning changes ∪ active ids |
| Opening a job | `GET /sync/job/{id}?view=detail` (1) (`index.tsx:145`); unknown job: `/sync/jobs` then detail (2) (`:112-113`); entering inspect: `GET /sync/job/{id}?[since][catalogue_since\|include_catalogue][parent]` (1), whole once a day or when links expire (`pull.ts:442-453`) | Skeleton only if not on the phone | task, rows, catalogue, parent | **Yes**: bundle recomputes `task`; whole re-fetch on link expiry (F-API-6/8) | Detail with ETag; contents paginated without signed URLs (F-API-5) |
| NOC / gate pass | `GET /tasks/{id}/noc` (1), then open the URL | Button spinner | `url`, `download_url` | — | — |
| Defect history | `GET /snags/{id}/history` (1) (`SnagHistory.tsx:79`) | Section loader | `legs[]` | — | — |

Example of tap-to-confirmed timing (INFERRED, UAE 4G, today's ≈220 ms per DB round trip): 1 photo ≈ 0.6 s gather + 0.25 s phone RTT + 0.4 s upload + 2.6 s server ≈ **3.9 s**. After F-API-1/2/3/10 it would be ≈ 0.05 + 0.05 + 0.4 + 0.3 ≈ **0.8 s**.

---

#### 5. Serverless and caching notes

- **Runtime.** Every route uses Node.js; only `sync/snag` declares it (`P:app/api/snagging/sync/snag/route.ts:42`). Next 16.1.0, supabase-js ^2.89 (`P:package.json:29,50`). Middleware is CORS-only and runs on every `/api/snagging/*` call (`P:middleware.ts:57-73`).
- **maxDuration.** Not set on any snagging route; the only ones are `scheduling/*` and `service-resources` (grep). That means the platform default applies: 300 s with Fluid compute, or 10/15 s legacy (INFERRED). See F-API-15.
- **Region.** No `vercel.json`, no `preferredRegion` (VERIFIED). The Supabase region cannot be determined from the repo, because `supabase/config.toml` is the local stack. The recorded 220 ms per call points to cross-region (F-API-1). The script prints `x-vercel-id`, which settles it.
- **DB access.** Every query is PostgREST over HTTPS through supabase-js.
  - A new admin client is created per call (`P:lib/supabase/supabase-helpers.ts:53-69`): the route, the push, the pull and auth each make one.
  - Connection reuse comes from Node's global fetch pool (INFERRED).
  - Per-process caches cover: access, 30 s (`user-access.ts:52`); signed URLs, ≥ 30 min reuse with 20k entries (`media.ts:86-100`); column and table probes (`columns.ts:19-80`); JWKS, 10 min.
  - Serverless instances each keep their own caches, so hit rates fall with instance count.
- **Body limit.** Vercel's 4.5 MB request limit sits against a 3.5 MiB file budget plus unbudgeted JSON and up to 700 KB of base64 signature (F-API-16). `req.formData()` buffers the whole body (`route.ts:88`). Large media goes to storage directly (`media/sign`), which is correct.
- **Compression.**
  - There is no explicit config (`next.config.ts` has no `compress` or headers).
  - Vercel compresses compressible responses at the edge when `Accept-Encoding` is sent, and RN's networking (OkHttp, NSURLSession) sends `gzip` by default (INFERRED).
  - The script's `enc` column shows the real `content-encoding`. Gzip does not rescue the whole-job payload, because signed-URL tokens are high-entropy (F-API-5).
- **HTTP caching.** No `Cache-Control`, `ETag`, `If-None-Match` or 304 on any sync read (VERIFIED by grep). The only unchanged path is the app-level `catalogue_since`, which still costs about 2 RT (F-API-9).
- **Client timeouts.** 15/20/30/60/120 s (F-API-18), against a 1 s budget. Progress UX is the sync badge plus per-row `sync_state`; saves never block the UI (good).
- **Out of scope, seen in passing.** `GET /snags/[id]/history` checks only the Snagging VIEW permission, not whether the caller is on the job (`P:app/api/snagging/snags/[id]/history/route.ts:42-62`). Flag this to the security pass.

---

#### 6. How to run the measurement script (staging only; not run as part of this audit)

File: `C:\Users\Technisia\Documents\Prohelp-Work\Yalla Fixit\docs\audits\perf\scripts\api-latency.mjs`. Plain Node 22, no dependencies. It passed `node --check`, the only thing done with it.

```bash
# read-only probe (no rows written)
ALLOW_TARGET=staging \
BASE_URL=https://<staging-host> \
BEARER=<staging inspector access token> \
JOB_ID=<staging job with ~60 rooms / ~500 defects / ~1,500 photos> \
SNAG_ID=<a defect on that job recorded by the same inspector> \
N=20 WARMUP=1 OUT=perf-api.json \
node docs/audits/perf/scripts/api-latency.mjs

# write paths (creates staging rows; cleans up its photos at the end)
ALLOW_WRITES=1 PUSH_SIZES=1,20,100 PHOTO_COUNTS=1,3 PHOTO_KB=300 ... node docs/audits/perf/scripts/api-latency.mjs

# one area only
ONLY="sync/job,sync/snag" ... node docs/audits/perf/scripts/api-latency.mjs
```

- **Guards.**
  - It refuses to run unless `ALLOW_TARGET=staging`.
  - Optional `PROD_HOST` is a host fragment to refuse.
  - localhost is refused unless `ALLOW_LOCAL=1`, because the local dev server on 3032 is wired to production.
  - It prints a warning that it cannot verify the target itself.
- **Output.** One row per endpoint: n / ok, p50 / p95 / max (ms), `first` (the warm-up call, a cold-start indicator), TTFB p50, bytes sent, response raw / gzip / brotli KB (computed locally with zlib), observed `content-encoding`, and a PASS/FAIL against p95 ≤ 1,000 ms, p50 ≤ 300 ms and gzip ≤ 100 KB for list/detail.
- **Region and caching evidence.** It also prints `x-vercel-id` samples (edge::function region), the `cache-control` values seen, and whether any `etag` appeared.
- **Exit code.** `STRICT=1` makes it exit 1 on any FAIL, for CI.
- **Get a token** by signing in to staging with a test inspector (for example with supabase-js `signInWithPassword` against the staging project). Never use a production account.
- **For a valid p95,** use N ≥ 20; below that, p95 is effectively the max. Run it from a UAE network or VM for the phone-side numbers, and from the function's region to isolate server time.

---

#### 7. Already good (verified)

- **Defect and photos in one request** (`P:app/api/snagging/sync/snag/route.ts:15-40`, `M:src/sync/sendWithMedia.ts:224-406`). Uploads run in parallel (`route.ts:117`). A photo's record is refused with its defect, and a refused photo is reported per item (`:212-223`).
- **Idempotency.**
  - Every mutation carries a client UUID; the ledger counts only *applied* rows as duplicates, so a refused change can be retried (`P:lib/server/snagging/sync-push.ts:156-168,316-323`).
  - Storage keys derive from the media id with upsert, so retries overwrite rather than orphan (`P:lib/server/snagging/media.ts:207-221`, `M:src/sync/uploader.ts:316-327`).
  - `sendLock` serialises sends so nothing is posted twice (`M:src/sync/sendWithMedia.ts:224-244`).
- **Dependency waves with 12-way concurrency** replaced a strictly serial push (`P:lib/server/snagging/push-plan.ts:26-101`). The audit trail is written after the response (`P:lib/server/snagging/audit.ts:54-60`).
- **Auth.** Local JWT verification, profile and permissions in one embedded query, a 30 s promise-coalesced cache (`P:lib/server/user-access.ts:27-114`), and a global JWKS cache.
- **Signing.**
  - Batched at 100 paths per call, with all batches concurrent, an in-flight dedupe, and URL reuse that keeps image caches warm (`P:lib/server/snagging/media.ts:65-197`).
  - `storage_path` is dropped when a link exists (`P:lib/server/snagging/sync-children.ts:236-241`).
  - The client keeps a held link that still has more than 15 minutes left (`M:src/sync/pull.ts:1894-1932`).
- **List changes ride along on sends** (`route.ts:205-210`, `M:src/sync/sendWithMedia.ts:395`). `syncNow` pulls only when it did not hear back (`M:src/sync/engine.ts:187-209`), and launch skips a duplicate list request (`:405-416`).
- **Per-screen sync.**
  - Cards only for the list, `view=detail` for the job screen, and catalogue plus parent folded into one job request (`P:app/api/snagging/sync/job/[id]/route.ts:28-44`, `M:src/sync/pull.ts:534-581`).
  - Per-job cursors, with the whole fetch reduced from every 10 minutes to daily (`M:src/sync/pull.ts:399-453`).
- **Client coalescing.** In-flight sharing for the list, job, catalogue and alerts, with 15 s freshness windows and failure back-off (`M:src/sync/pull.ts:202-209,591-651,696-710`; `M:src/sync/alerts.ts:255-266`).
- **Outbox update merging.** Repeated edits to one row become one mutation without losing fields (`M:src/sync/outbox.ts:109-133`).
- **Completeness.** Paged reads and id chunking stop silent 1,000-row truncation (`P:lib/server/snagging/read-all.ts:1-81`).
- **Signature inside the submission** removed two calls and keeps the signature safe offline (`P:lib/server/snagging/sync-push.ts:948-982`).
- **Alerts.** Reads are piggy-backed on the fetch request, and live inserts arrive over Realtime with no request (`M:src/sync/alerts.ts:262-341,429-479`).

### Appendices E and F · Screen field matrix, offline matrix and manual device test script, image pipeline

#### 3. Confirm or clear: the specific suspicions

| Suspicion | Verdict | Evidence |
|---|---|---|
| Full property object (contacts, size, location, NOC flags) on every job fetch | **Cards: CLEARED.** **`/sync/job` deltas: CONFIRMED** (F-FLD-8) | `cardTask` has 3 property fields, `sync-pull.ts:907-911`. `loadTaskDetail` runs on every bundle call, `route.ts:160-161` |
| "Everyone's defects" when a screen shows a subset | **CLEARED (by design).** All snags on a shared job are sent and shown read-only with "recorded by" | `sync-children.ts:88-95`; `area/[areaId].tsx:512-518`. Note: `job/[id]/index.tsx:432-435` says "Each sees only their own snags", which is a stale comment contradicting the server |
| Signed links for ALL photos when list screens need thumbnails or counts | **CONFIRMED** for whole fetches; deltas sign only changed rows | `sync-children.ts:176-183`; F-FLD-1, F-FLD-3 |
| `GET /sync/job/{id}` serves Rooms the same payload as Defect | **CONFIRMED, mitigated.** One shared `refreshJob` (`jobs.ts:635,763,907,1159`; `checklist.ts:89,194`), coalesced (`pull.ts:618-635`), usually a delta | Waste only in whole mode (F-FLD-3) and the always-present `task` (F-FLD-8) |
| Job cards carry unused fields | **CLEARED.** Only the `task_type` constant is unused. `finished_visits` drives the Done history cards (`toJobSummary.ts:293-313`); `code` is the unit fallback and a sort key | `sync-pull.ts:872-913` against the `JobCard` field list |
| Catalogue full vs delta | **CONFIRMED whole replace.** Change detection is a head count; the payload is the full catalogue | F-FLD-5 |
| `chooseLink` keeps held links with more than 15 min left | **VERIFIED** | `pull.ts:1894,1926-1933`. It is defeated by link lifetime (F-FLD-2) |

---

#### Appendix E — Screen field matrix (R6)

**Key.**
- **Whole** = `/sync/job/{id}` without `since`. This happens on the first open, every 24 h, when links are expiring, and on pack.
- **Delta** = with `since`.
- All SQLite reads use named columns; there is no `SELECT *`.

| Screen | Endpoint (client file:line → server) | Fields returned | Fields actually used | Wasted fields | Wasted bytes (est., calc) |
|---|---|---|---|---|---|
| **Jobs (cards)** | `GET /sync/jobs?list=active` or `?since=` (`pull.ts:289-292`); `?list=done&limit=30` (`:338-347`) → `cardTask` (`sync-pull.ts:872-913`), `CARD_COLUMNS` (`:25-27`). SQLite: `jobListSql` (`jobs.ts:471-523`) | id, code, status, task_type, round_number, visit_type, scheduled_date, created_at, rejection_reason, active_visit_{id,number,note,date}, last_visit_{number,status,date}, finished_visits[{id,number,status,date}], property{unit_label,building_name,community}, area_total, area_done; envelope with 8 empty keys, list, has_more, next_before(_id) | All card fields: `JobCard` uses unit, community, whenLabel, overdue, badge, visitLabel, areasDone/Total, rejectionReason, visit, pass, bucket, type | `task_type` (constant); empty envelope arrays. **SQLite:** `snag_count`, `pending_photo_count` joins (`jobs.ts:509-520`); `team_json` parsed but no card renders it | 30 × 26 B + 130 B ≈ **0.9 KB / 16.5 KB (5.5%)** |
| **Job detail** | `GET /sync/job/{id}?view=detail` (`pull.ts:675-678`) → `loadTaskDetail` (`sync-task-detail.ts:40-174`). SQLite: `JOB_SELECT` (`jobs.ts:226-252`) | id, parent_task_id, notes, locked, active_visit_at, finished_visits[+appointment_at, snag_count], remediation_due_at, appointment_at, lead_inspector_id, inspectors[], signoffs[], property{25 keys} | property_type, bedrooms, built-up/plot area, floors, external_areas, developer_name, noc_required/on_file, gatepass_on_file, 4 contacts, lat/lng, unit/building/community, client_name, notes, appointment, team (`index.tsx:407-486,574-870`); signoffs and lead go to Review | `client_email`, `client_phone`, `city`. **SQLite:** 2 correlated counts unused (`jobs.ts:249-251`) | ~35 + 30 + 14 = **~80 B / ~1.6 KB (5%)** |
| **Rooms** (`inspect/index`) | Store hydrate (`_layout.tsx:24-28` → `inspectionStore.ts:231-235`) plus `refreshJob` (`jobs.ts:635`) → `GET /sync/job/{id}[?since][&catalogue_since][&parent=true]` (`pull.ts:534-581`) → `loadSyncChildren` (`sync-children.ts:121-191`) + `loadTaskDetail` + parent | Delta: changed rows + task. Whole: all areas (17 fields), snags (21), photos (12 + URL), checklist (12), plans (7 + URL), task, parent bundle | areas{id,name,status,confirmed_at,access_state,access_reason,inspector_id,note}; snags{area_id,severity} (`inspect/index.tsx:288-355`); checklist counts; active visit | For this screen alone: photos, plans and most snag fields (shared store, so needed one tap later). Always: `task` on deltas (F-FLD-8); parent contents (F-FLD-4). **SQLite:** 26 of 28 snag columns and 6 sub-selects per snag | Delta: **~3 KB task** of ~3.2 KB. Whole J-60: photos 105 KB + plans 1 KB = **~106 KB of 173 KB** not used by Rooms |
| **Room** (`area/[areaId]`) | Same store and `refreshJob` | As Rooms | snag{id, defect, severity, status, sync, syncError, reviewNote, othersSnag, recordedBy, thumbUri, thumbKind, photos} (`[areaId].tsx:421-562`) | Full-size photo as a 60 px thumbnail (F-FLD-1) | 20 snags × (300 − 15) KB = **5.7 MB per unpacked view** |
| **Defect** (`snag/[snagId]`) | Store + `listSnagPhotos` (`jobs.ts:898-938`) → `refreshJob` (`:907`); `listFloorPlans` (`:1157-1185`); `GET /snags/{id}/history` (`SnagHistory.tsx:79`, server `snags/[id]/history/route.ts`) | Whole job as above; history legs {job_code, round, visit_type, status, photo_count, recorded_by, verified_by} | All 12 photo columns (uri, thumb, kind, duration, upload state, round, w/h, marker); plan for the pin; history legs | Strip decodes full images (F-FLD-1). History is refetched on every mount with no cache | Strip: N × (300 − 15) KB when unpacked |
| **Checklist** | `listChecklist` (`checklist.ts:83-152`) + `refreshJob` (`:89`) | Checklist rows (12 fields) | group_name, label, mandatory, status, reason, visit_id, answered_by_name, answered_at, sync | `code` (not rendered; INFERRED from `checklist.tsx` reads). Parent checklist is never read (F-FLD-4) | Parent: 40 × 370 B ≈ **15 KB per whole parent fetch** |
| **Floor plan** | `listFloorPlans(id)` and the parent's (`floorplan.tsx:165-175`) → `refreshJob(id)` and `refreshJob(parent)`; `cacheFloorPlans` on view (`:196-204`) | plans{id,task_id,label,signed_url,width,height,sort_order} | All | Parent bundle beyond plans (F-FLD-4); parent orphan refetch loop (F-OFF-4) | ~170 KB per parent whole fetch |
| **Review** | Store + `checklistProgress` + `uploadProgress` + `getJob`; `refreshJobDetail(force)` on refresh (`review.tsx:131`) | Detail as above | signoffs, team, lead, upload state, snag photo counts | None material | — |
| **Verify** (`verify/[snagId]`) | `listFloorPlans(id/parent)` (`verify:117-118`), `listSnagPhotos(…, {refresh:false})` (`:161`), store | As Defect | Photos (after shots), plan, verdict, note | Full images in the strip (F-FLD-1) | As Defect |
| **De-snag** | `listSnags`, `checklistProgress`, `listFloorPlans(id/parent)`, `listMediaForRound` (`jobs.ts:961-1011`), `getJob` (`desnag/index.tsx:327-374`) | Round rows (own copied photos) + parent bundle | Round snags, before thumb, after media, plan | Parent snags, photos and checklist (F-FLD-4) | Round of a J-60 original: ~170 KB JSON + **~45 MB pack** |
| **Alerts** | `POST /sync/alerts` (`alerts.ts:274-278`) → `route.ts:126-169`; local `listAlerts` (`alerts.ts:168-174`) or `derivedAlerts` → `listActiveJobs` (which fires `refreshFromServer`, `jobs.ts:564`) | alerts{id,job_id,visit_id,type,title,body,created_at,read_at,when_at}, me, unread | All | Server DB `SELECT *` (not on the wire). Opening Alerts before the server has alerts triggers a job-list refresh as a side effect | 0 on the wire |
| **Sync** | Local only (`sync.tsx:76-97`) | — | — | — | 0 |
| **Profile** | Local `me` from `sync_meta` (`alerts.ts:244-253`), counts from the sync store | — | — | — | 0 |

---

#### Appendix F — Offline matrix (R3)

**Key.**
- **Yes** = works with no signal from data already on the phone.
- **Pack** = only after "Download for offline".
- **Opened** = only after the screen or job was opened once with signal.
- **No** = needs signal.

| Screen | Data / file | Offline? | Evidence |
|---|---|---|---|
| Launch | Session, splash → jobs | Yes (stored session, 1.5 s cap) | `authStore.ts:92-104,130-154`; `app/(app)/_layout.tsx:40-42` |
| Jobs | Today/Upcoming cards | Yes, after one list pull | `jobs.ts:562-567`; `pull.ts:287-309` |
| Jobs | Done, beyond pages already on the phone | No. "Load older" needs signal | `pull.ts:331-347`; `jobs/index.tsx:177-187` |
| Jobs | Pack-ready or unsent state on a card | Not shown (F-OFF-10) | `JobCard.tsx` field list |
| Job detail | Fields, contacts, property, team | Opened (`detail_at`); otherwise "details aren't on the phone yet" | `index.tsx:252,320-345`; `pull.ts:665-690` |
| Job detail | Location | Coordinates yes; the map app needs signal | `M:src/ui/LocationMap.tsx:33` (no tiles drawn) |
| Job detail | NOC / gate pass | **No** (F-OFF-9) | `index.tsx:733-752` |
| Job detail | Start CTA (active job) | **Pack + Opened** (F-OFF-1, F-OFF-2) | `index.tsx:252-262` |
| Rooms / Room | Rooms, snags, counts | Pack, or Opened through an inspection screen online (`children_at`) | `inspectionStore.ts:231-235`; `pull.ts:890-898` |
| Room / Defect | Photos taken on this phone (`Documents/captures`) | **Yes** | `persistCapture.ts:18-38`; `jobs.ts:55-60` (local preferred) |
| Room / Defect | Server photos | **Pack only.** Not cached when viewed: RN Image disk cache only, URL-keyed, dies with the link | `offlinePack.ts:171-213`; `MediaThumb.tsx:36` |
| Room / Defect | Photos arriving after the pack (co-inspector, office) | **No** (F-OFF-3) | `pull.ts:1950-1955` |
| Defect / Verify | Snag history | **No.** Clear message shown | `SnagHistory.tsx:76-104` |
| Defect / Verify | Server video playback | Pack; iOS playback of `.bin` uncertain (F-OFF-11) | `offlinePack.ts:136` |
| Floor plan | This job's plans (`Documents/floorplans`) | Yes once cached. Caching happens on pack, on view (`floorplan.tsx:196-204`), and after each sync for opened active jobs (`engine.ts:242-246`) | `floorPlanCache.ts:55-123` |
| Floor plan | Parent's plans (de-snag round) | **Unreliable**: purged as orphans within 10 min when the parent is not a card (F-OFF-4) | `pull.ts:967-976` |
| Floor plan | Remote-only plan | Blank but pinnable (F-OFF-5) | `floorplan.tsx:229-231` |
| Capture sheet | Catalogue | Yes after the first fetch; it persists | `pull.ts:704-749,1171-1314` |
| Checklist | Items and answers | Pack or Opened | `checklist.ts:83-152` |
| Review | Checks, signature pad | Viewable; **submit blocked offline**; signature not persisted (F-OFF-7) | `review.tsx:416,452,475`; `SignaturePad.tsx:37-39` |
| Review | Shared-job sign-off | Yes (queued) | `jobs.ts:334-365` |
| De-snag | Round snags, before photos (copied rows) | Pack | `rounds/route.ts:742-749`; `offlinePack.ts:88-100` |
| De-snag | Parent job | Only when the parent card is on the phone; contents unused except plans (F-FLD-4) | `pull.ts:549-560` |
| Return visit | Visit number, note, date, checklist `visit_id` | Yes (on the card); `active_visit_at` once Opened | `pull.ts:1482-1506,1593-1615` |
| Alerts | The newest 200 alerts | Yes; older ones are dropped | `alerts.ts:104,168-174,307-311` |
| Alerts | Tapping an alert for a job not on the phone | Shows "Job not found … no longer on your list", which is false when offline | `index.tsx:106-125,184-191`; `strings.ts:124-125` |
| Profile | `me` (name, role) | Yes (`sync_meta`) | `alerts.ts:244-253,286` |
| Profile | Free up space | Yes. Evicts approved/delivered media (F-OFF-3) | `freeSpace.ts:19-87` |
| Sync | Outbox, uploads, storage | Yes. Distinguishes "saved on phone" from "synced" | `sync.tsx:259-275` |
| Sign-out | Pending work | Kept on the device; **copy ignores photos** (F-OFF-10) | `authStore.ts:225-268`; `profile/index.tsx:48-75` |

##### Image behaviour offline

| Situation | What renders | Evidence |
|---|---|---|
| `local_path=''`, valid signed `remote_path`, online | Downloads the full image (F-FLD-1) | `jobs.ts:55-60` |
| `local_path=''`, offline or expired link | Blank tile (`MediaThumb`, room row, de-snag before photo, plan views); "Couldn't load" only in `EvidenceMedia` | F-OFF-6 |
| Pull replaces the link | The held link stays while it has more than 15 min left; the local file is never touched (`PHOTO_CONFLICT` omits `local_path`) | `pull.ts:1877-1887,1926-1933` |
| Bare storage path (signing failed) | `displayUri` returns `''`, so a placeholder icon; the plan reads as "not downloaded" | `jobs.ts:55-60`; `sync-children.ts:236-241` |
| Low storage | `StorageBanner`; the pack does not pre-check (F-OFF-12) | `engine.ts:116-138`; `app/(app)/_layout.tsx:47` |
| Server video without a poster | Film tile with duration (good) | `MediaThumb.tsx:37-49`; `EvidenceMedia.tsx:83-99` |

##### Manual device test script

Use a physical Android mid-range device and an iPhone, with release builds. Use test accounts for inspectors A and B. Prepare these jobs:
- **J1**: active, 2 plans, 10 snags with server photos and one server video.
- **J2**: active, assigned after the last sync, never opened.
- **J3**: a de-snag round of an original that is not on Done.
- **J4**: a finished job.
- **J5**: a shared job (A and B).
- **J6**: has a NOC on file.

**Scenario 1 — Cold launch fully offline.**
1. Sign in online, let the list load, kill the app, turn on airplane mode, launch.
   - **Expect:** splash for 1.5 s or less, jobs list from the phone, offline banner ("You're offline — changes are saved on this device").
   - **Expect:** the pill does *not* claim "Synced". Today it shows "Synced" when nothing is pending; note this as a UX gap.
2. Open J2.
   - **Expect today:** "This job's details aren't on the phone yet" and a disabled Start (F-OFF-2).
3. Open J1, packed earlier.
   - **Expect:** details, a "Ready for offline" card, and an enabled Start.
4. Rooms → Room → Defect on J1.
   - **Expect:** every server photo renders. Check `SELECT COUNT(*) FROM snag_photos WHERE task_id='J1' AND local_path=''` = 0.
5. Play the server video on iOS.
   - **Expect:** it plays. Record the result for F-OFF-11.
6. Floor plan on J1.
   - **Expect:** plan renders and pins are tappable.
7. Floor plan on J4, never viewed.
   - **Expect (correct):** "Floor plan not downloaded yet". **Today:** blank plan with pinning enabled on an active job (F-OFF-5).
8. Alerts tab.
   - **Expect:** stored alerts listed, no spinner stuck.
9. Profile.
   - **Expect:** name and role shown from the phone.

**Scenario 2 — Pack under failure.**
1. Open J2 online so the details load.
2. Turn on airplane mode and tap Download for offline.
   - **Expect (correct):** an error and `pack_state='none'`. **Today:** "Ready for offline" (F-OFF-1). This is a release blocker.
3. Online, with the proxy returning 500 for `/sync/job/J2`, tap Download.
   - **Expect:** the same result as step 2.

**Scenario 3 — Offline mid-capture.**
1. Online on J1, start capturing a snag.
2. At the photo step, turn on airplane mode. Take 3 photos and 1 video, save.
   - **Expect:** "Saved on this phone · will sync"; the SyncDot shows Local/Queued; the photo badges show "Waiting for signal" (`MediaUploadBadge.tsx:21-27`).
3. Kill the app, relaunch offline.
   - **Expect:** the snag and its media are still present. Files are in `Documents/captures/` (`adb shell run-as … ls files/captures`).
4. Edit the defect text and mark a photo spot offline.
   - **Expect:** saved locally; one queued update.

**Scenario 4 — Offline for 24 h or more.**
1. Pack J5, capture 5 snags offline. Leave the device offline for at least 25 h, or advance the device clock by 25 h with auto-time off.
2. While still offline, open J5's rooms.
   - **Expect:** packed media renders. Remote-only photos added by B show blank tiles (F-OFF-3/6).
3. Reconnect, stay on Rooms.
   - **Expect:** one whole `/sync/job/J5` (24 h reconcile), outbox drains, local snags are kept (`sync_state` goes to synced), no duplicates. The proxy shows `since`-less requests to J5 at most once.
4. Check `children_full_at` is updated (`pull.ts:890-898`).

**Scenario 5 — Sign-out offline with pending work.**
1. Offline on J1, capture a snag with a video. Turn the network on just long enough for the snag to send (watch the SyncDot go to Synced), then go offline before the video uploads.
2. Profile → Sign out.
   - **Expect (correct):** "You have 1 change that has not sent yet". **Today:** "Everything is synced" (F-OFF-10).
3. Confirm sign-out offline, kill the app, relaunch.
   - **Expect:** the login screen. If the jobs list appears, the Supabase sign-out did not clear storage offline (INFERRED risk; record it).
4. Sign in as A again online.
   - **Expect:** the video uploads, and `snag_photos.upload_state` becomes 'uploaded'.

**Scenario 6 — Offline submit.**
1. Finish J1 offline and open Review.
   - **Expect today:** a "Connected" check fails, "Ready to submit. Waiting for a connection.", Submit disabled (F-OFF-7).
2. Sign the pad, go back to Rooms, return to Review.
   - **Expect today:** the signature is gone.
3. Reconnect.
   - **Expect:** uploads finish, then Submit is enabled.

**Scenario 7 — De-snag round's parent plan (F-OFF-4).**
1. Fresh install, do not open Done. Online, open J3 → Floor plan.
   - **Expect:** the parent's plan renders.
2. Tap Download on J3, return to the Jobs list, and wait 11 min with the app in the foreground.
3. Airplane mode → J3 → Floor plan.
   - **Expect (correct):** the plan renders. **Today:** "no plan" or not downloaded. Confirm with `SELECT COUNT(*) FROM floor_plans WHERE task_id=<parent>` before and after.

**Scenario 8 — Reconnect storm.**
1. Offline, capture 40 snags with 3 photos each on J1, and answer 30 checklist items.
2. Reconnect on 3G (the network link conditioner set to 750 kbps up).
   - **Expect:** a single `syncNow` (`engine.ts:349-353`) and no parallel duplicate requests to `/sync/snag`. The list and job deltas come before the photo backlog (`engine.ts:198-209`). The pill counts down. No screen goes back to a skeleton.
   - **Expect:** the proxy shows at most one in-flight `/sync/job/J1`, and requests to `/sync/job/J1` are throttled to at most one per 15 s per job (`pull.ts:618-635`).
3. Toggle airplane mode 5 times in 30 s.
   - **Expect:** no duplicate snags on the server; outbox idempotency holds.

**Scenario 9 — Per-screen checks, offline, on packed J1.**

| Screen | Check |
|---|---|
| Jobs | Counts match before going offline; pull-to-refresh shows "No connection. Showing what is on this phone." |
| Job detail | NOC tap shows "Connect to the internet to open the NOC." (F-OFF-9) |
| Rooms | Checklist card counts are right; adding a room offline works and shows locally |
| Room | Every tile shows an image or a clear placeholder, never a blank square |
| Defect | Photos render; history shows "needs a connection" |
| Checklist | Answering shows the queued state per item |
| Floor plan | Pins render; a snag can be placed |
| Review | Checks are correct; only the Connected and uploads checks fail |
| Verify / De-snag | Before photos render; after shots capture with "Waiting for signal" |
| Alerts | List renders; marking one read offline persists after relaunch (read_pending) |
| Sync | "All saved on this phone" (not "All synced") while items are queued |
| Profile | Name and role shown; the sign-out count includes photos (after the fix) |

**Sync-state UX verdict.** Mostly good:
- The global offline banner (`app/(app)/_layout.tsx:46`).
- The Sync screen separates "saved on phone" from "synced" (`sync.tsx:259-275`).
- The jobs pill counts photo uploads (`jobs/index.tsx:348-353`).
- Per-photo `MediaUploadBadge`; checklist items show queued or error.

Gaps:
- Sign-out copy (F-OFF-10).
- Room rows reflect only the snag row (F-OFF-10).
- No pack-ready or unsent marker on job cards (F-OFF-10).
- The pill shows green "Synced" while offline with nothing queued, which a stale list can make misleading. It could add "as of HH:MM" when offline. Low.

---

#### 5. Image pipeline notes

| Stage | What happens | Evidence |
|---|---|---|
| Capture (photo) | `ImageManipulator`, longest edge ≤1080 px, JPEG q 0.8 → 0.3, ≤1 MB; EXIF read first; **no thumbnail** | `mediaCapture.ts:15-31,70-130` |
| Capture (video) | Poster frame at 500 ms through `expo-video-thumbnails` → `thumbnail_path` | `mediaCapture.ts:139-147`; `camera.tsx:150` |
| Persist | Copied from the cache to `Documents/captures/<id>.<ext>` before the row is written | `persistCapture.ts:18-38`; `jobs.ts:1519-1520` |
| Upload | Signed upload URL; the object key comes from the media id (idempotent) | `P:app/api/snagging/media/sign/route.ts:70-79`; `media.ts:207-221` |
| Server read | `createSignedUrls` in batches of 100, TTL 60 min, reused while 30 min or more remain (per process); **no transform** | `media.ts:14,86-197` |
| Wire | `signed_url` only; `storage_path` dropped when signed | `sync-children.ts:180-191,236-241` |
| Phone store | `remote_path` = signed URL; `chooseLink` keeps a held link with more than 15 min left; `local_path ''` for pulled media; `thumbnail_path` only for this phone's videos | `pull.ts:1894-1973` |
| Display choice | `displayUri`: lasting local file, else remote http, else blob/data; `stillUri`: video poster or null, photo = thumbnail or local or remote | `jobs.ts:55-83` |
| Components | RN `Image` everywhere (`expo-image` is not a dependency, `package.json:19-37`); `EvidenceMedia.LoadingImage` has loading and failed states; `MediaThumb` has none; `expo-video` only after a tap (good) | `MediaThumb.tsx:2,36`; `EvidenceMedia.tsx:121-197` |
| Lists | Room list: `FlatList` (virtualised). Gallery hero and strip: `ScrollView` + `.map` (all mounted). Plan picker: `ScrollView` | `[areaId].tsx:396`; `SnagMediaGallery.tsx:132-184,231-271` |
| Cache | Platform HTTP cache keyed by the full URL, so it is defeated by re-signing (F-FLD-2). `mediaKey()` exists to strip the token but only feeds `chooseLink` | `signedUrl.ts:14-29` |
| Offline files | `Documents/captures` (own), `Documents/snagphotos/<id>.bin` (pack), `Documents/floorplans/<id>.img`; cleanup on reconcile and sign-out | `localFiles.ts:19`; `pull.ts:926-941`; `authStore.ts:251-263` |
| Memory | Full-resolution decode for tiles is likely (no `resizeMethod`); worst case ~6.2 MB per decoded photo | F-FLD-1 |

**Recommended target pipeline.**
1. 320 px thumbnail at capture (and a server-side transform for legacy rows).
2. Send `thumb_url` beside `signed_url`.
3. Use `expo-image` with `cacheKey = mediaKey(url)` and `cachePolicy="disk"`.
4. The pack downloads thumbnails for every photo and full images for the job's own photos.
5. Move the gallery hero and strip to a horizontal `FlatList`.
6. Add an offline placeholder to every tile.

---

#### 6. Already good (credit)

- **Per-screen fetch discipline.** Cards only on launch. Done is paged, on demand, with a stable `(created_at, id)` cursor and a window-scoped reconcile (`pull.ts:240-256,331-397`; `sync-pull.ts:617-697`).
- **Job open asks for `view=detail` only.** It no longer fetches every photo to show a page that uses none (`pull.ts:653-690`; route `:30-39,147-153`).
- **Trimmed wire shapes.** 3-field property on cards. `storage_path` dropped when signed. `active` dropped from the catalogue. No GPS or EXIF on pulled photos (`sync-children.ts:145-146`).
- **Delta per job with its own cursor, 24 h reconcile and coalescing.** A 15 s window, a shared in-flight request, and a 30 s backoff after failure (`pull.ts:399-453,591-651`).
- **`chooseLink`.** It keeps the held link for an unchanged object and never replaces a working link with a bare path (`pull.ts:1915-1933`).
- **Capture durability.** Files are moved out of the OS cache before the path is recorded (`persistCapture.ts`). The outbox is in the same transaction. Reconciles never drop unsent work (`pull.ts:905-918,1099-1146`). Sign-out keeps pending work and counts photos in its *data* check (`authStore.ts:236-244`).
- **Offline cold launch.** The stored session is used after 1.5 s, and the access check never locks out on a bad connection (`authStore.ts:50-104`).
- **Plans cached on view and after each sync** for opened active jobs (`floorplan.tsx:181-204`; `engine.ts:242-246`). Zero-byte and partial files are rejected (`offlinePack.ts:111-123`; `floorPlanCache.ts:89-99`).
- **Pack honesty on disk.** Readiness is computed from the filesystem rather than from the download loop. Family-wide before-photos are covered. Downloads are streamed, not buffered (`offlinePack.ts:134-159,215-241`). F-OFF-1 is the one hole in this.
- **Catalogue integrity.** It is refused when a level is empty or its counts are short, so the mark does not move (`pull.ts:1153-1205`). It is checked at most every 10 min, and the check is folded into the job-open request (`pull.ts:541-548`).
- **Clear offline copy.** For NOC and gate pass, snag history, pull-to-refresh, the review wait state, and the Sync screen's "saved on phone" vs "synced". The global offline banner is calm and appears only when offline (`M:src/ui/feedback.tsx:127-178`).
- **Alerts offline.** The local store of 200, offline reads kept as `read_pending` across the trim, `me` cached for Profile (`alerts.ts:209-341`).
- **No `SELECT *` in app SQLite.** All repository reads name their columns. The server child selects are explicit column lists.

### Appendices G and H · Pagination matrix, sync load model, device growth and retention

#### Appendix G · Pagination matrix (every list, server and phone)

Legend: OFFSET = PostgREST `.range()`; "dup/skip" = what concurrent writes can do between page requests.

| # | List | Where (filter) | Page size | Cursor type | Stable order (unique tiebreak)? | has_more | Memory-bounded? | Dup / skip possible? | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Jobs active, no cursor `GET /sync/jobs?list=active` (`sync-pull.ts:485-489`, `:637-649`; phone `pull.ts:287-309`, `:870-884`) | inspector's jobs (4 roots) ∩ activeSet | all (chunks of 150 ids × pages of 1,000) | none | id ✔ (`:646`) | n/a | by workload (~25 cards, ~17 KB) | ids only, harmless | **OK** (reconcile drops missing **active** cards only) |
| 1a | Roots: assigned / visits / room-held / roster (`sync-pull.ts:184-274`) | `inspector_id = me` | 1,000 | OFFSET | assigned: id ✔; visits/rooms/roster: **job_id only ✘** | page<1,000 | rooms read = 1 row **per room** (≈7.5k rows at 125 jobs) | ties only inside the same job_id, so the distinct job id is still seen; harmless | **OK, but wasteful** (F-SYNC-2) |
| 2 | Jobs since-delta `/sync/jobs?since`, `/sync/snag {since}` (`sync-pull.ts:1060-1121`, `:637`) | jobs/visits/rooms `updated_at > since` over all job ids | chunk 150, page 1,000 | timestamp `server_time` | id ✔ | n/a | unbounded in time, bounded by #jobs | **misses**: late commits (F-PAG-1), untriggered updated_at (F-PAG-2), unassign/delete (F-PAG-6) | **Needs fix** |
| 3 | Jobs done `?list=done&limit&before&before_id` (`sync-pull.ts:619-698`, `:713`, `:940-953`; phone `pull.ts:331-397`) | inspector's jobs ∉ activeSet | 30 (max 100) | **keyset (created_at, id)** | ✔ both server and phone window | ✔ (+1 row) | ✔ 31 × ⌈H/150⌉ rows, then slice | none from deletes; a job turning Done above the cursor shows on the next first-page load | **Good**; Low: re-fetches pages already cached (F-PAG-7) |
| 4 | Job contents (rooms, snags, photos, checklist) `/sync/job/[id]` (`sync-children.ts:43-50`, `:121-169`) | `job_id in [id]` (+ `> since`) | 1,000 | OFFSET | id ✔ | page<1,000 | ✔ one job (≤1,500 rows, ~1.5 MB) | insert → dup (harmless); **delete → skip → wrong local delete on whole fetch** (F-PAG-3); photo delta on `created_at` misses marker edits (F-PAG-2) | **Needs fix** |
| 4a | Floor plans (`sync-children.ts:205-229`) | job (+ `updated_at > since`) | 1,000 | OFFSET | (created_at, sort_order, id) ✔ | page<1,000 | ✔ | as #4 | OK (switch to keyset) |
| 5 | `readAllByIds` chunks (`read-all.ts:59-81`) | `in(chunk of 150)` | 150 ids × 1,000 rows, concurrency 4 | OFFSET within chunk | by caller (id) ✔ | per chunk | holds all rows (bounded by caller) | as #4 | OK |
| 6 | Visits live/finished/parents (`sync-pull.ts:313-397`) | all job ids | chunk 150 / 1,000 | OFFSET | (visit_number desc, id) ✔ | — | grows with **history** every pass | harmless | **Wasteful** (F-SYNC-2) |
| 7 | Room counts for cards (`sync-pull.ts:1124-1148`) | listed jobs | chunk / 1,000 | OFFSET | id ✔ | — | ≈60 × cards | harmless | OK |
| 8 | Alerts first load (`alerts/route.ts:143-149`) | `user_id = me` | 200 (max 200) | none | (created_at desc, id desc) ✔ | none (older alerts ignored by design) | ✔ | — | **OK** |
| 9 | Alerts since-delta (`alerts/route.ts:126-142`; phone `alerts.ts:212-232`, `:277`) | `created_at > since OR read_at > since` | 1,000/page, **unbounded total** | timestamp + OFFSET | ✔ | none | ✘ (3,000+ rows parsed, then trimmed to 200) | insert → dup (upsert, harmless); delete → skip (minor) | **Needs fix** (F-PAG-4) |
| 10 | Phone alerts list (`alerts.ts:168-172`, `:306-311`) | local | 200 | none | created_at only (no id tiebreak) | — | ✔ 200 | — | OK (add `, id DESC`) |
| 11 | Outbox push (phone `outbox.ts:173-202`, `config.ts:48`; bundles `sendWithMedia.ts:250-309`; server `schemas.ts:490`) | queued and due | 100 (+≤20 photos, ≤3.5 MB); server allows 500 | seq | seq ✔ | `remaining` via `pendingMutations(1)` (`push.ts:135`) | ✔ | backed-off rows can be overtaken by newer rows for the same entity; mitigated by the WAITING_FOR_PARENT retry (`push.ts:107-115`) | OK (F-SYNC-9 tuning) |
| 12 | Sync screen (`syncQueue.ts:28`, `:38-66`, `:102-120`) | not-uploaded / queued+error | 100 each | none | errors first, then taken_at / seq ✔ | headline counts shown separately (`uploadSummary`) | ✔ | — | **OK** (no "show more", acceptable) |
| 13 | Checklist (phone `checklist.ts:83-…`; server via #4) | job | all (~100) | none | sort_order | — | ✔ | — | OK |
| 14 | Defects per room / job (`jobs.ts:758-…`) | `task_id` (+ area) | all (≤500) | none | (created_at desc, id desc) ✔ | — | ✔ per job; 6 correlated sub-selects per row | — | OK (watch 500 × 6 sub-selects) |
| 15 | Catalogue (server `sync-pull.ts:1230-1291`; phone `catalogueTree.ts:171-204`) | active rows | 1,000 | OFFSET | (sort_order, id) ✔ + **count guard** (`pull.ts:1153-1170`) | page<1,000 | ✔ (few k rows) | a deactivation mid-paging could skip a row that the count guard does not catch (rare) | **Good** |
| 16 | Snag history (`app/api/snagging/snags/[id]/history/route.ts:64-100`; phone `SnagHistory.tsx:79`) | snag_code within the family | all | none | ordered by round in code | — | ✔ (≤ rounds) | — | OK |
| 17 | Done list, local (`jobs/index.tsx:36`, `:240-255`; `jobs.ts:575-581`) | DONE_CANDIDATE_SQL | 20-job steps, LIMIT grows (N+1 re-reads) | none (growing LIMIT) | (sort_key desc, code, id) ✔ (tiebreak differs from server, harmless) | `rows > limit` | ✔ | — | OK (Low, F-PAG-7) |
| 18 | Active list, local (`jobs.ts:562-566`) | LIVE_SQL | all; UI slices 20 | none | ✔ | — | by workload | — | OK |
| 19 | Legacy `/sync/pull` (`sync-pull.ts:492-502`, `sync-children.ts:47`) | all jobs, all children | 1,000 OFFSET, **unchunked `in()`** | none / since | ✔ | — | ✘ (workload) | as #4; URL overflow at about 200+ jobs | **Retire** (F-PAG-5) |
| 20 | Media signing (`media.ts:128-195`) | paths | 100 per call, all calls parallel | — | — | — | ✔ | — | OK |
| 21 | Upload queue (`uploader.ts:213-222`, `:188`; `sendWithMedia.ts:113-126`) | pending/error and due | 10 per call × 3 workers (≤21 calls/pass); bundle 20 | none | taken_at (no tiebreak) | `remaining` count | ✔ | — | OK |

Done keyset same-timestamp test: the server filters `created_at < b OR (created_at = b AND id < bid)` (`sync-pull.ts:672-674`). The merge sort compares the timestamp string, then the id string (`:686-697`; Postgres trims only trailing zeros, so the strings sort chronologically). The phone's reconcile window uses the same pair (`pull.ts:369-386`). **No skip or duplicate on ties; deletes during paging cannot shift a keyset.** ✔

---

#### Appendix H · Sync load model

##### H.1 Per device, per hour (requests counted as HTTP calls to the portal; WebSocket frames separate)

Assumptions: the app is in the foreground. "Active" means capturing or browsing one job and returning to the Jobs list about every 6 min. Throttles: list 15 s and reconcile 10 min (`pull.ts:787`, `:795`), job 15 s (`:625`), alerts 20 s (`alerts.ts:106`). Captures: 1 request per action after a 600 ms gather (`sendSoon.ts:22`).

| Source (file:line) | Idle foreground | Active typical | Active heavy (upper bound) | Notes |
|---|---|---|---|---|
| 5-min timer pass, `engine.ts:363-371` (1 × `POST /sync/snag` with `since`; +1 `GET /sync/jobs` only if `changes` is missing) | 12 | 12 | 12 | ≈11 DB calls each (F-SYNC-2); floor-plan caching costs nothing on the network once cached (`floorPlanCache.ts:89-99`) |
| Captures `sendSoon` → `/sync/push` or `/sync/snag` | 0 | 60 | 90 | one per defect, checklist tick or room confirm |
| Job screens `refreshJob` → `/sync/job/[id]?since` (15 s throttle) | 0 | 40 | 240 | each ≈12 DB calls; delta usually empty |
| Whole-job refetch (24 h or links expiring, F-SYNC-1) | 0 | 0-3 (×2 with parent) | 3 | **0.6-3 MB each** |
| Jobs list `refreshFromServer` delta | 0 | 10 | 60 | |
| Authoritative reconcile (delta + active list) every 10 min, on screen reads | 0 | 6 (3 × 2) | 12 | |
| Job detail `?view=detail` (15 s throttle) | 0 | 5 | 20 | |
| Alerts catch-up (focus, reconnect, `SUBSCRIBED`) | 0-1 | 3 | 20 | |
| Direct uploads (sign + PUT; videos, overflow) | 0 | 0-4 | 20 | |
| **Total HTTP / h** | **≈12-13** | **≈136-143 (≈140)** | **≈450** | |
| Realtime WebSocket | 1 channel, heartbeat ≈25-30 s (≈120-144 frames/h) | same | same | plus 1 event per alert |
| Bytes / h (excluding photo uploads) | ≈30-60 KB | ≈0.5-1 MB (≈3-6 MB with F-SYNC-1) | ≈10 MB | photo uploads ≈300 KB × photos taken |

##### H.2 Extrapolation to 200 devices

| Scenario | Assumption | Requests/min | Requests/s | DB calls/s (≈8 per request on average) |
|---|---|---|---|---|
| Overnight / all idle in foreground | 200 × 12/h | 40 | 0.7 | ≈7 |
| **Working-hours average** | 120 active (140/h) + 50 idle (13/h) + 30 suspended or offline | **≈290** | **≈4.9** | ≈40 |
| Sustained peak | 200 active-heavy (450/h) | ≈1,500 | ≈25 | ≈200 |
| Launch at shift start, 200 within 10 min | ≈5 requests per launch (list, send, alerts, reconcile ×2 at +60 s) | +100 for 10 min | +1.7 | +15 |
| Mass relaunch within 30-90 s (forced update) | 1,000 heavy requests | 670-2,000 | **11-33** | 150-400 |
| Recovery after a 1 h carrier outage (no jitter, F-SYNC-4) | 200 × ≈14 bundles of 3.5 MB started within ≈10 s | 2,800 within ≈5-10 min | bursts of tens | ≈9.8 GB uploaded; ≈200 functions open for 30-120 s each |
| Whole-job refetch signing (F-SYNC-1) | 100 inspectors × 2-4/h × ≈2,000 paths | — | — | ≈110-220 storage signatures/s |

Proposed controls (F-SYNC-4/5): timer 300 s ×U(0.8,1.2), adaptive to 600/900 s when idle and Realtime is up; first pass +U(30,90) s; reconnect +U(0,10) s; full-jitter backoff 5 s × 2^n capped at 600 s; circuit breaker U(120,300) s after 3 failures; stop when backgrounded. Expected effect: idle fleet load **40 → ≈15-25 req/min**; recovery peak **≤2× steady state**.

##### H.3 Device growth and retention

| Store | Growth driver | Retention today (file:line) | Bounded? | 1-year estimate (one inspector) | Recommendation |
|---|---|---|---|---|---|
| `outbox` | every change | `done` rows older than 24 h pruned hourly (`engine.ts:87-94`, `outbox.ts:315-319`); queued/error kept | ✔ | <1 MB | OK |
| `alerts` | notifications | trimmed to newest 200 per catch-up (`alerts.ts:306-311`), never trimming unsent reads; Realtime inserts are not trimmed until the next catch-up | ✔ | ≈200 rows | OK |
| Captured photo/video files | 300 KB × photos | **manual "Free up space" only**, approved/delivered jobs only (`freeSpace.ts:7`, `:19-33`) | ✘ | **≈20 GB** (450 MB per big job) | auto-retention (F-SYNC-7) |
| Offline-pack photo files | packs | same as above | ✘ | up to 450 MB per pack | same |
| Floor-plan files | opened active jobs (`floorPlanCache.ts:46-53`, `:100-114`) | never deleted except through reconcile row deletes | ✘ | ≈150 jobs × 1-5 MB = 0.15-0.75 GB | include in retention |
| `inspection_tasks` cards | every job seen, Done pages | active: reconciled every 10 min on screen reads; Done: only within fetched page windows (`pull.ts:367-387`); **never by age** | ✘ | ≈150-250 rows (small) | 180-day age-off |
| Children of opened jobs (rooms, snags, photo rows, checklist) | every job opened | removed only when the card is removed or by a 24 h whole fetch | ✘ | ≈50-100 MB SQLite | 60-day age-off for finished jobs |
| Catalogue | admin edits | replaced whole, with a count guard (`pull.ts:1171-…`) | ✔ | few k rows | OK |
| Sync temp tables `_card_keep`, `_auth_keep`, `_auth_scope` | per reconcile | `TEMP`, emptied before each use (`pull.ts:956-958`, `:1071-1093`) | ✔ (peak = one job's ids, ≈2k) | — | OK |
| In-memory caches | — | `listJobCache` ≤2,000 (`jobs.ts:537-538`); server `urlCache` ≤20,000 per instance (`media.ts:87`) | ✔ | — | OK |

Server-side growth (covered by another auditor, noted only): the `snagging_sync_mutations` ledger gains one row per mutation for good (`sync-push.ts:316-322`); `snagging_notifications` gains 3,000+ per user; audit events; storage objects (1,500 per job).

---

#### 5. Already good (credit where due)

- **Cursor stamped before the reads** in both the list route (`sync-pull.ts:116`) and the per-job route (`sync/job/[id]/route.ts:115-116`), and the list cursor comes from the pull *after* the push inside `/sync/snag` (`snag/route.ts:205-210`). The cursor only moves on a clean apply (`pull.ts:270`, `:297-302`, `:509-515`).
- **The previous audit's truncation bug is fixed.** All four root queries are paged (`sync-pull.ts:175-198`). Id lists are chunked at 150 to stay under the gateway URL limit (`read-all.ts:36-49`). The catalogue pages with a unique tiebreak and sends counts so the phone rejects a short catalogue (`sync-pull.ts:1239-1288`, `pull.ts:1153-1170`).
- **Proper keyset paging for Done**, on `(created_at, id)`, applied the same way on the server, in the merge sort and in the phone's reconcile window, including the case of an older server that sends no id (`pull.ts:360-386`).
- **Idle cost is one request.** Push and list delta are combined (`snag/route.ts:22-31`, `engine.ts:176-209`). After-upload pulls are skipped when nothing was uploaded (`engine.ts:227-234`).
- **Coalescing and throttling everywhere:**
  - pull gate (`pull.ts:183-194`), `listPullInFlight` (`:202-209`), `jobInFlight` (`:603`), `catalogueInFlight` (`:697-710`), `sendLock` (`sendWithMedia.ts:236-244`);
  - 15 s freshness windows, a 30 s failure backoff per job (`pull.ts:612-616`), and the first reconcile delayed 60 s after launch (`:807-808`);
  - whole-job reconcile cut from 10 min to 24 h (`pull.ts:399-416`).
- **Losing signal does not burn backoff** (`sendWithMedia.ts:324-334`, `push.ts:80-87`, `uploader.ts:240-246`). Uploads to storage are hard-bounded by `withTimeout` (`uploader.ts:316-327`).
- **Idempotency:** the mutation ledger turns retries into `duplicate`, which is treated as applied (`push.ts:101-103`). Photo objects are keyed by id with upsert (`snag/route.ts:139-142`, `uploader.ts:316-327`). Alerts are upserted by id, so a Realtime insert and the catch-up never duplicate, and local unsent reads are preserved (`alerts.ts:212-232`, `:306-311`).
- **Unsent work is protected on every reconcile delete** (`pull.ts:905-918`, `:1099-1146`), and files are removed only after commit (`pull.ts:517-518`).
- **Image-cache stability:** `chooseLink` keeps the held URL for an unchanged object while it has more than 15 min left, so thumbnails are not re-downloaded on every whole fetch (`pull.ts:1915-1933`).
- **Queued updates are merged** in the outbox (one row per entity, fields folded oldest-first: `outbox.ts:80-134`), and the outbox is pruned hourly (`engine.ts:79-94`).
- **Floor-plan caching is scoped** to open active jobs and skips files already on disk (`floorPlanCache.ts:45-99`), so a sync pass makes no plan requests at steady state.
- **Bulk SQLite writes** in chunks under the 999-parameter limit, with a row-by-row fallback on failure (`pull.ts:993-1039`).

### Appendix I · Runtime: list virtualisation table, re-render and store notes, cold-start path

#### 3. List virtualisation table

| Screen | Component file:line | List type | Items at scale | Virtualised? | Memo rows? | Props (keyExtractor / getItemLayout / initial / batch / window / clip) | Verdict |
|---|---|---|---|---|---|---|---|
| Jobs, Today/Upcoming | `app/(app)/(tabs)/jobs/index.tsx:369-434` | FlatList, page-sliced 20 at a time (`:226-232`) | ≤300 live jobs → cards | Yes, plus manual paging | **Yes**: `JobCard = memo` (`JobCard.tsx:140`), stable `renderCard`/`openJob` (`:258-268`), card cache (`toJobSummary.ts:376-385`, `jobs.ts:537-558`) | inline key / none / 8 / 10 / 9 / default | **Good** (see F-RT-11 for the header) |
| Jobs, Done | same `:369` | FlatList, SQLite pages of 20 (`listDoneJobs`, `jobs.ts:575-580`) | hundreds | Yes | Yes | same | **Good** |
| Alerts | `app/(app)/(tabs)/notifications/index.tsx:183-260` | SectionList | **200 max** (`alerts.ts:104`) | Yes (defaults) | No (inline) | inline key / none / default ×4 | OK; O(n²) grouping (F-RT-12) |
| Sync | `app/(app)/sync.tsx:239-320` | SectionList | capped lists plus a "N more" footer (`:212,220`) | Yes | No | inline key / none / 15 / 15 / 9 / default | **Good** |
| Inspect index (rooms) | `app/(app)/job/[id]/inspect/index.tsx:216` | SectionList | 60 | Yes (defaults) | **No**, inline `renderItem` with per-row scans | inline / none / defaults | Acceptable; F-RT-13 |
| Inspect index, room picker | `inspect/index.tsx:478-479` | ScrollView + map | 60 | No | No | n/a | OK at 60 |
| Area defects | `app/(app)/job/[id]/inspect/area/[areaId].tsx:396-564` | FlatList | 8 avg, ~100 worst room | Yes (defaults) | **No**; full-size `Image` thumbnails (`:450`) | inline / none / defaults | **Fix**: F-RT-6 |
| De-snag list | `app/(app)/job/[id]/desnag/index.tsx:1008-1083` | SectionList by room | up to ~500 | Yes (defaults: window 21) | **No**, heavy 40–60-view cards; nested `ScrollView`+map of after-photos (`:871-948`) | inline / none / defaults | **Fix**: F-RT-4 |
| Checklist | `app/(app)/job/[id]/inspect/checklist.tsx:337-560` | SectionList | 50 to "several hundred" (`:352`) | Yes, wide window | **No**, inline `renderItem` | inline / none / 20 / 20 / 11 / **false** (deliberate, `:359-361`) | **Fix**: F-RT-5 |
| Snag media gallery | `src/features/inspection/SnagMediaGallery.tsx:132-141, 231-236` | horizontal ScrollView + map (×2) | 3 avg, 20+ worst | **No** | No | n/a | F-RT-14 |
| Verify after-photo strip | `app/(app)/job/[id]/inspect/verify/[snagId].tsx:413-442` | horizontal ScrollView + map | a few | No | No | n/a | OK |
| CaptureSheet media strip | `src/features/inspection/CaptureSheet.tsx:658-664` | ScrollView + map | a few | No | No | n/a | OK |
| CaptureSheet plan strip | `CaptureSheet.tsx:780-785` | ScrollView + map | plans (≤10) | No | No | n/a | OK |
| Catalogue pickers | `src/ui/SelectField.tsx:200-248` | ScrollView, grown in pages of 40 (`:28,115-128`) | ~20 / 160 / up to thousands | Manual paging (nested scroll makes FlatList impossible, `:17-27`) | No | key = `option.value` | **Good**; search debounced (`CaptureSheet.tsx:160-162`) |
| Floor plan, snag pins | `app/(app)/job/[id]/inspect/floorplan.tsx:1168-1188` | map, capped at `MAX_PINS = 60` (`:51,425`) | 500 snags → 60 drawn, "+N more" chip | Capped | **No** | key = `snag.id` | Cap is good; F-RT-7 |
| Floor plan, zones and room pins | `floorplan.tsx:1199-1254, 1316-1329` | SVG Polygon + map, capped at 60 combined (`:434-435`) | ≤60 | Capped | No | key = id | OK; F-RT-7 |
| Floor plan, plan picker | `floorplan.tsx:1412-1438` | ScrollView + map | plans (≤10) | No | No | full-plan `Image` thumbs | Low; use small thumbs (F-RT-7) |
| Floor plan, room pickers | `floorplan.tsx:1492-1493, 1594-1595, 1639-1640` | ScrollView + map | ≤60 | No | No | n/a | OK |
| Review | `app/(app)/job/[id]/inspect/review.tsx:650, 793` | map in `Screen scroll` | checks (≤10), team (≤5) | No | No | n/a | OK |
| Job detail property rows | `app/(app)/job/[id]/index.tsx:614` | map | ≤15 | No | No | n/a | OK |

No list uses `getItemLayout` (row heights vary; acceptable). No `FlashList` (not needed once the rows are memoised).

---

#### 4. Re-render and store notes

- **zustand selectors are good everywhere.** All 30 `useSyncStore` uses, all `useAlertsStore` uses, `useUiStore` and `useInspectionStore` select single primitives or stable references (for example `jobs/index.tsx:101-111`, `area/[areaId].tsx:88-101`, with the comment at `:85-87` showing the team knows the new-array-per-selector trap). No whole-store selects, no selectors returning derived arrays. `useLoading` returns a boolean (`src/sync/loading.ts:47-51`). The toast lives alone in `uiStore` (`src/features/shell/uiStore.ts:17-30`) and only `Toast` subscribes to it (`src/ui/Toast.tsx:18`).
- **The real fan-out is the data, not the selectors:**
  - `inspectionStore.hydrate` hands out new objects every time (F-RT-2).
  - `usePullTick` renders every mounted screen (F-RT-3).
  - De-snag and checklist hold their own `items` state that is rebuilt wholesale (F-RT-4, F-RT-5).
  - Only one component in the app is memoised (`JobCard`). React Compiler is not enabled (`app.json` has no `experiments.reactCompiler`). Enabling it is a broad, cheap option once the data reuses unchanged objects, but it should be trialled on one route first because of hook-rule edge cases (Risk Med).
- **Sync-store churn:** `refreshCounts` runs on every outbox change (`engine.ts:330-332`). Its subscribers are the Jobs screen header (F-RT-11), `SideMenu` (`src/ui/SideMenu.tsx:52-53`), Profile and Review. Each `MediaUploadBadge` subscribes to `online` (`src/ui/MediaUploadBadge.tsx:47`); `online` changes rarely, so this is fine.
- **Per-tick SQLite count:** see F-RT-3 (3 statements with area focused; 11–14 with de-snag under the floor plan). `refreshJob` and `refreshFromServer` are throttled to 15 s (`pull.ts:618-631, 810-825`) and share requests already in flight, so the side-effect network calls do not storm. The only loop is the 15-second re-poll while another device keeps changing the job (F-RT-3).
- **`hydrate` cost at 500 snags:** about 20–50 ms of JS per call (F-RT-2). It runs on entering the inspect flow, on every applied pull, and after every capture, edit or retry (`inspectionStore.ts:351,364,431,446,630` re-read `listSnags` + `toSampleSnags`; these partial re-reads have the same object-reuse problem).
- **Upload events:** `mediaUploadChanged` fires on claim, release, start and finish (`uploader.ts:102-117, 252, 272`). Its listeners are de-snag (all items remapped), snag detail (`snag/[snagId].tsx:107-108`) and verify (`verify/[snagId].tsx:160-161`). None of them is gated on focus.
- **Pull apply:** batched multi-row inserts (`pull.ts:983-1033`), and the response is parsed once by `response.json()` (`src/lib/api.ts:123`). The cards-only reconcile is small. A whole-job bundle with 1,500 photo rows is a JSON.parse of a few hundred KB, about 5–20 ms on Hermes (INFERRED). That is borderline but infrequent, so it is not raised as a finding.

---

#### 5. Cold-start critical path (to an interactive Jobs screen)

1. **Bundle evaluation (JS):** `inlineRequires: true` (`metro.config.js:27-38`) defers modules until first use. lucide per-icon imports (`babel-plugin-lucide-icons.js`) avoid evaluating the ~1,800-icon barrel. At root: `app/_layout.tsx` imports `@/db/client`, whose `openDatabaseSync` runs **at module scope** (`src/db/client.ts:12`; a few ms, synchronous), and `authStore`, which imports `supabase-js` (`createClient` at module scope in `src/lib/supabase.ts`) and the sync engine. supabase-js is the largest JS dependency evaluated before the first frame (INFERRED: about 20–50 ms of evaluation). It is needed for auth, so this is acceptable. `drizzle-orm` is referenced only from `src/db/schema.ts`, and the only runtime import of that file is the type-only `import { type OutboxOp }` (`src/sync/outbox.ts:4`), which Babel elides (INFERRED).
2. **Splash gates (in parallel):**
   - `useFonts`: 6 TTFs (`app/_layout.tsx:40-47`), loaded natively and asynchronously. Optional: embed them at build time via the `expo-font` plugin `fonts: [...]` to remove the runtime load.
   - `initDatabase`: WAL and pragmas, then a `user_version` check, then pending migrations only (`migrations.ts:905-941`).
   - `bootstrap` → `launchSession`: **up to 1.5 s when the token has expired** (F-RT-15).
   - `SPLASH_MIN_MS = 300` (`app/_layout.tsx:30`).
3. **First screen:** `(app)/_layout` → Tabs → `JobsScreen` renders a skeleton. `useFocusEffect` → `listActiveJobs()` (one CTE query, `jobs.ts:471-535`) → `setActiveJobs` → **first paint from SQLite, no network wait**. `listActiveJobs` also fires a throttled `refreshFromServer()` in the background (`jobs.ts:564`).
4. **Behind the paint:** `startSyncEngine` (`engine.ts:325-420`) starts NetInfo, alerts realtime, `pullJobList()` (shared with the screen's refresh through `listPullInFlight`, `pull.ts:204-209`), and then `syncNow` after the list lands or **4 s** (`LAUNCH_SYNC_WAIT_MS`, `engine.ts:315,401-404`). This 4 s wait holds back only the outbox and photo send, not the screen. Credit: this is the right ordering.
5. **Heavy synchronous module-scope work:** none found beyond `openDatabaseSync`. `strings.ts` (928 lines) is a plain object literal. The Intl formatters are built once at module scope in `src/lib/time.ts:13-21` and `toJobSummary.ts:30-35`.

Estimated cold start to an interactive Jobs screen (INFERRED, mid-range Android): native init + bundle ≈ 0.8–1.3 s, plus splash gates ≈ 0.3 s (fresh token) or up to 1.8 s (expired token), plus first query and paint ≈ 0.1–0.2 s. So about **1.2–1.8 s with a fresh token and about 2.5–3.3 s with an expired one**. F-RT-15 brings the latter under 2 s.

---

#### 6. Already good (credit)

- **Jobs list** (`jobs/index.tsx`, `JobCard.tsx`, `toJobSummary.ts`, `jobs.ts:537-580`):
  - Memoised card, stable handler and renderer, and a WeakMap card cache keyed on a per-row identity cache, so a reload re-renders only changed cards.
  - Card fields come from `json_extract` in SQL, not by parsing `property_json` per card (`jobs.ts:460-462, 489-494`).
  - Done is paged from SQLite and from the server. Intl formatters are hoisted, and "today" is cached per minute (`toJobSummary.ts:24-52`).
  - This answers the scope question: **`property_json`, `team_json` and `finished_visits_json` are not re-parsed per render or per card**. They are parsed once per changed row in `buildJob` (`jobs.ts:266-307`), and unchanged rows are reused by `toListJob`.
- **Floor plan gestures** (`floorplan.tsx:688-771`, `PlanFullScreen.tsx:120-200`):
  - Pinch, pan, double-tap and tap are reanimated worklets on the UI thread, built once, reading shared values and refs. React does not re-render during a gesture.
  - Pins counter-scale with one shared animated style. Pins and room marks are capped at 60 each, with an overflow count.
  - The hit test is a cheap even-odd ray cast (`:78-89`).
- **Catalogue picker:** paged rendering (`SelectField.tsx:28-128`) and a debounced whole-catalogue search (`CaptureSheet.tsx:154-162`).
- **Alerts:** capped at 200 on the phone, pruned (`alerts.ts:104,171,310`), with the unread count from SQLite.
- **Sync screen:** capped lists with "N more" and explicit windowing (`sync.tsx:205-247`).
- **Media:**
  - Photos stored at ≤1080 px and ≤1 MB (`mediaCapture.ts:15-19`); videos re-encoded to 480p at ~1 Mbps (`videoCompress.native.ts:4-7,50-58`).
  - Video players mount only on tap, never one per row (`EvidenceMedia.tsx:40-44,75-107`). `MediaViewer` mounts one item at a time (`src/ui/MediaViewer.tsx:63-74`).
  - Image `source` objects are memoised (`EvidenceMedia.tsx:142`).
- **Animations:** all `Animated` loops and banners use `useNativeDriver: true` (`src/ui/feedback.tsx:54-73,148-155,193-206`; `Toast.tsx:25-38`).
- **Data layer:**
  - Versioned migrations, WAL, `synchronous=NORMAL`, `temp_store=MEMORY` (`migrations.ts:905-941`).
  - Covering indexes for the hot sub-selects (`migrations.ts:752-757`).
  - Serialised transactions (`db/client.ts:74-87`) and batched multi-row upserts in pull apply (`pull.ts:983-1033`).
  - Requests in flight are shared and refreshes are throttled per job (`pull.ts:198-209, 604-631, 810-825`), with failure back-off (`pull.ts:612-616`).
- **Bundle:** `inlineRequires` on (`metro.config.js:27-38`), and the lucide per-icon import rewrite (`babel-plugin-lucide-icons.js`).
- **Cold start:** the Jobs screen paints from SQLite before any network call. The launch list pull and the outbox send are ordered so the screen never waits on the backlog (`engine.ts:375-420`).
- **De-snag media read:** one grouped query (`listMediaForRound`, `jobs.ts:961-1012`) instead of N per-snag pulls.

---

## 6. Prioritised remediation roadmap

Effort: S ≤ 1 day, M 2–5 days, L > 1 week. Owner: Mobile, Portal, Database. Each item names the findings it closes; the detailed fix is in that finding.

### 6.1 Now (this sprint)

| # | Change | Closes | Effort | Expected gain | Risk | Owner | How to verify |
|---|---|---|---|---|---|---|---|
| N1 | Confirm the function region on staging (`api-latency.mjs`, read `x-vercel-id`), then pin the snagging routes to the Supabase region (`vercel.json` `"regions"` or `export const preferredRegion` in each `app/api/snagging/**/route.ts`) | F-API-1, F-DB-2 | S | ≈220 ms → single-digit ms per DB call; most endpoints drop under 1 s | Low | Portal | `api-latency.mjs`: p95 < 1 s on `sync/jobs`, `sync/job/{id}?view=detail`, `sync/snag` (single defect) |
| N2 | Offline pack: fail the pack when `pullJob(..., {full:true})` fails; never mark `ready` without a successful records fetch and every plan file on disk | F-OFF-1 | S | No false "Ready for offline" | Low | Mobile | Airplane-mode test F-1/F-2 in Appendix F |
| N3 | Submit locks only unlocked defects (`.eq("locked", false)`, `sync-push.ts:1256`); area-status trigger writes only when the status changes | F-DB-7, F-DB-8 | S | Submit stops re-sending every defect; one fewer UPDATE per defect write | Low | Portal, Database | Count rows in the next delta after a submit: only changed rows |
| N4 | One-line fixes: `read_all: true` for Mark all read; `entity_type` in the history audit lookup; Realtime DELETE filtered by `user_id`; filter checklist duplicates (`listChecklist` join on the newest outbox row only) | F-API-13, F-DB-11, F-SYNC-6, F-SQL-10 | S | Correct badge; indexed history; no cross-user DELETE events; no duplicate checklist rows | Low | Mobile, Portal | Unit probes; checklist probe returns 120 rows for 120 items |
| N5 | Phone DB migration v39 (the investigator's proposal in Appendix A): drop 4 redundant indexes, add the partial unsent-photo index, `ANALYZE` after migrate and after big pulls | F-SQL-5, F-SQL-12 | S | First job download 331 → 144 ms (desktop); Sync screen stays at ≈6 ms under real stats | Low | Mobile | `sqlite-plans.mjs` state C vs A |
| N6 | Every write the phone makes goes through `transaction()` (attachPhoto, startArea, uploader state, outbox marks) | F-SQL-4 | S | A failed sync can no longer roll back a captured photo's row | Med | Mobile | Fault-injection test: throw inside a pull apply while capturing; the photo row survives |
| N7 | Memoise de-snag and checklist rows; `freezeOnBlur` on the job stacks; make `usePullTick` focus-aware | F-RT-3, F-RT-4, F-RT-5 | S–M | Removes most > 16 ms commits on taps and pull ticks | Low | Mobile | React DevTools profiler: commit < 16 ms on a verdict tap with 500 defects |
| N8 | Treat a timeout as "slow", not "offline": back off with jitter, and shrink the next bundle (fewer photos per request) | F-SYNC-3, F-SYNC-4 | S | Slow uplinks drain instead of resending 3.5 MB every 5 min | Low | Mobile | Throttled-network test at 0.25 Mbps up: outbox drains |

### 6.2 Next (2–4 weeks)

| # | Change | Closes | Effort | Expected gain | Risk | Owner | How to verify |
|---|---|---|---|---|---|---|---|
| X1 | Set-based push: batch reads per wave (one read of all touched snags, one code lookup per job, one photo-author read), batched upserts; return canonical rows (`snag_code`, `visit_id`, `created_by`, `locked`, `updated_at`) in each result | F-DB-3, F-API-3, F-API-4, F-API-2, F-API-12 | M–L | 100-change push ≈1,050 → ≈50 DB calls; defect save ≈2 round trips; no re-download of own writes | Med | Portal | `api-latency.mjs` write probes: 1 defect p95 < 1 s; 100 changes p95 < 4 s |
| X2 | Stop putting signed URLs in job payloads: send storage paths, and add `POST /sync/media/links {paths[]}` that signs only what a screen is about to show (or sign with a 24 h TTL for offline packs). Remove the "link expiring → whole refetch" rule | F-SYNC-1, F-API-5, F-API-6, F-FLD-2, F-FLD-3 | M | Whole job ≈1.6 MB → ≈0.6 MB raw; no 20–50 min re-downloads; stable image cache keys | Med | Portal, Mobile | Payload size of a 500-defect whole fetch < 100 KB gz without links; no whole refetch in a 2 h session |
| X3 | Thumbnails: generate a ≈320 px JPEG at capture (phone) and on upload (server or storage transform); lists and tiles use it; full image only in the viewer | F-FLD-1, F-RT-6, F-RT-14 | M | 20-defect room ≈6 MB → ≈0.3 MB; far less decode memory | Low | Mobile, Portal | Network log of opening a room; memory profile on a 500-photo room |
| X4 | Offline start and pack completeness: allow Start offline when the job's contents are on the phone; re-verify `pack_state` on open; download new photos after the pack; keep a de-snag round's parent plans while the round exists; cache NOC and gate pass files in the pack | F-OFF-2, F-OFF-3, F-OFF-4, F-OFF-9 | M | The inspection works offline end to end | Med | Mobile | Appendix F scenarios 1–9 |
| X5 | Delta correctness: take the cursor from the database (`now()` in the same query) and overlap it by 2–5 s; give photos an `updated_at` with a trigger; add touch triggers to visits and checklist; add a tombstones table (or soft deletes) so deletes and unassignments arrive by delta; switch `readAllRows` to keyset (`id > last`) | F-PAG-1, F-PAG-2, F-PAG-3, F-PAG-6 | M | No lost or wrongly deleted rows; the 24 h whole refetch becomes a safety net, not the delete channel | Med | Portal, Database | Concurrency test on staging: update a row inside a long transaction during a pull; it arrives next pull |
| X6 | Narrow and cache reads: `sync/job/{id}` deltas send `task` only when it changed; drop the parent's snags/photos/checklist (send plans only); ETag + `If-None-Match` → 304 on catalogue, job detail and access | F-FLD-4, F-FLD-8, F-API-9, F-API-8 | M | Fewer bytes and round trips on every open; de-snag pack ≈45 MB smaller | Low | Portal, Mobile | 304 rate on repeat opens; pack size of a round |
| X7 | Phone reads: per-room snag query on the room screen; whole-job list only where needed; Done keyset (`created_at, id` after the last row) instead of growing `LIMIT`; reconcile sweeps scoped to the changed jobs | F-SQL-1, F-SQL-2, F-SQL-6, F-SQL-7 | M | Whole-job read off the hot path; Done scroll ≈3 ms per page | Low | Mobile | `sqlite-plans.mjs`: Q6 not on any capture path; Q2b ≤ 5 ms |
| X8 | `inspectionStore.hydrate` reuses unchanged objects (like `toListJob`) and notifies only on real changes | F-RT-2, F-FLD-6 | M | Pull ticks stop re-rendering 500 rows | Low | Mobile | Profiler: pull tick commit < 16 ms |
| X9 | Uploads by file path (FormData `{uri}` or `uploadAsync`) instead of reading bytes into JS; gallery compression one at a time from the original; direct-to-storage registers the photo server-side so the confirmation is one call | F-RT-1, F-RT-8, F-API-11 | M | No 20–400 ms JS blocks during uploads; lower memory peaks; 5 calls → 2 for video | Med | Mobile, Portal | JS FPS ≥ 55 during a video upload; call count per video save |

### 6.3 Later

| # | Change | Closes | Effort | Expected gain | Risk | Owner | How to verify |
|---|---|---|---|---|---|---|---|
| L1 | Retention: prune `snagging_sync_mutations` older than 30 days (drop its unread indexes), purge read notifications older than 180 days, sweep storage orphans; allow archiving `snagging_audit_events` (the DELETE-discard rule blocks it) | F-DB-10, F-DB-9 | M | Bounded tables (ledger ≈20 M rows/yr today) | Low | Database | Row counts flat month on month |
| L2 | Phone retention: auto-free local copies of uploaded photos and plans for jobs finished > 14 days; prune Done cards older than N months; low-storage trigger | F-SYNC-7 | M | Device storage bounded (≈450 MB per big job today) | Low | Mobile | Storage after a 30-day soak test |
| L3 | Sync cadence: jitter (±20%) on the 5-min pass and retries; AppState pause in background and sync on foreground; delta-only idle pass instead of re-reading the whole history | F-SYNC-2, F-SYNC-4, F-SYNC-5 | M | Smoother server load; no background polling; idle cost independent of tenure | Low | Mobile, Portal | Request histogram across 200 simulated devices |
| L4 | Capture SQL indexes for the out-of-band tables in a migration (after checking production with the catalog queries), add the recommended `(job_id, updated_at)` and membership indexes | F-DB-1, F-DB-5, F-DB-14 | M | Plans guaranteed; staging reproducible | Low | Database | `EXPLAIN (ANALYZE, BUFFERS)` from Appendix B §5 shows index scans |
| L5 | Catalogue row deltas; alerts catch-up bounded and paged | F-FLD-5, F-PAG-4 | S–M | Smaller catalogue updates; catch-up cannot time out forever | Low | Portal, Mobile | Mark 3,000 read, then catch up within 15 s |
| L6 | Retire the legacy `/sync/pull` path (or chunk and bound it) | F-DB-4, F-PAG-5 | S | Removes a 7–30 MB response path | Low | Portal | No callers in current app builds |

---

## 7. Verification plan

Re-run after each phase of fixes. Thresholds come from the brief's budget table (with the R2 batch adjustment in 2.2).

| Step | What to run | Pass threshold |
|---|---|---|
| 1 | **Region check (staging):** `ALLOW_TARGET=staging BASE_URL=… BEARER=… node docs/audits/perf/scripts/api-latency.mjs` (read-only mode). Read `x-vercel-id` and the p50/p95 per endpoint | Function region = Supabase region. Every JSON read p95 < 1 s, p50 < 300 ms |
| 2 | **Write probes (staging):** same script with `ALLOW_WRITES=1` | Single defect save p95 < 1 s; defect + 3 small photos p95 < 1.5 s (media excluded); 20 changes p95 < 1 s; 100 changes p95 < 4 s |
| 3 | **Payloads:** the script's raw and gzip byte columns for `sync/jobs`, `sync/job/{id}?view=detail`, a 500-defect whole fetch | List/detail < 100 KB gzipped; whole fetch without links < 100 KB gzipped per 500 defects |
| 4 | **Server plans (staging):** the 15 `EXPLAIN (ANALYZE, BUFFERS)` statements and catalog queries in Appendix B §5, on data seeded to the brief's scale | No sequential scan on `snagging_snags`, `snagging_snag_photos`, `snagging_notifications`, `snagging_sync_mutations`; each < 50 ms |
| 5 | **Phone SQLite:** `node docs/audits/perf/scripts/sqlite-plans.mjs --json out.json` | Desktop medians ≤ 15 ms for every screen-critical read (≈ 50 ms on a phone at ×3), single-row writes ≤ 30 ms, whole-job pull-apply ≤ 60 ms, checklist probe = 120 rows |
| 6 | **Phone runtime (real mid-range Android, release build):** React DevTools profiler and Perf Monitor on a seeded 500-defect job: open inspect, verdict taps, checklist taps, a pull tick, a video upload in the background | No commit > 16 ms on taps and pull ticks; JS FPS ≥ 55 during uploads; camera shutter to preview < 400 ms |
| 7 | **Offline (real devices, iOS and Android):** the 9 airplane-mode scenarios in Appendix F | Every scenario matches its expected result; no blank image or broken screen in the inspection flow after a pack |
| 8 | **Pagination and deltas (staging):** update a row inside a long transaction during a pull; delete a row between two pages of a whole fetch; page Done across two jobs with the same `created_at` | Nothing lost, nothing duplicated, nothing wrongly deleted on the phone |
| 9 | **Load (staging):** replay the Appendix H model for 200 devices (k6 or the script in a loop) including a reconnect storm | Error rate < 0.5%; p95 within the step 1–2 thresholds during the storm |
| 10 | **Growth:** monthly row counts for `snagging_sync_mutations`, `snagging_notifications`, `snagging_audit_events`, and storage object count vs photo rows | Flat after retention; orphaned objects < 1% |

---

*Report assembled from six read-only investigations (Sections 4.1–4.6 and Appendices A–I), with the key claims spot-checked against the code for this report: the offline-pack ready logic (`offlinePack.ts:278, 328-331`), the 220 ms comments and missing region config, the submit re-lock (`sync-push.ts:1256`), the missing `snagging_jobs` migration, the cursor clock (`sync-pull.ts:116`), visit triggers, the upload byte path (`uploader.ts:30, 319`), and an independent re-run of the SQLite benchmark.*
