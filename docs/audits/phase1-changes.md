# Phase 1 performance fixes: changes report

**Date:** 1 October 2026
**Source:** `docs/audits/performance-audit-2026-10-01.md` (finding IDs below refer to it)
**Inputs:** `SUPABASE_REGION` and `VERCEL_FUNCTION_REGION` blank; `STAGING_AVAILABLE=no`.

Nothing was pushed, merged, deployed or applied. No production endpoint, key or database was used, and no dev server was started. Every fix sits on its own branch in its own git worktree, branched from `main`. The main checkouts were not modified: the mobile checkout is still clean, and the portal's 7 uncommitted files are yours and untouched.

## 1. Status

| # | Finding | Status | Repo | Branch | Commit(s) | Proof (main → branch) |
|---|---|---|---|---|---|---|
| 1 | F-OFF-1 offline pack never "Ready" after a failed download | ✅ done | mobile | `perf/p1-f-off-1-pack-ready` | `cc1f6d7` | `f-off-1.test.mjs`: 1/3 → 3/3 pass |
| 2 | F-DB-7 submit locks only unlocked defects | ✅ done | portal | `perf/p1-f-db-7-submit-lock` | `59adc35` | `f-db-7.test.mjs`: 1/3 → 3/3 |
| 3 | F-DB-8 area-status trigger writes only on change | ✅ done (migration **not applied**) | portal | `perf/p1-f-db-8-area-status-trigger` | `3b2fa94` | `f-db-8.test.mjs`: 0/3 → 3/3 (body diff = the guard only) |
| 4a | F-API-13 "Mark all read" marks all | ✅ done | mobile + portal | `perf/p1-f-api-13-mark-all-read` (both repos) | mobile `9eefd67`, portal `6121a89` | `f-api-13.test.mjs`: 0/2 → 2/2 (portal response 3,002 rows → 2) |
| 4b | F-DB-11 history audit lookup uses its index | ✅ done | portal | `perf/p1-f-db-11-history-index` | `bfa4cd7` | `f-db-11.test.mjs`: 0/2 → 2/2, results identical |
| 4c | F-SYNC-6 no unfiltered Realtime DELETE | ✅ done | mobile | `perf/p1-f-sync-6-realtime-delete` | `3064cf9` | `f-sync-6.test.mjs`: 0/1 → 1/1 |
| 4d | F-SQL-10 checklist item listed once | ✅ done | mobile | `perf/p1-f-sql-10-checklist-dup` | `a6fc7af` | `f-sql-10.test.mjs`: 3/5 → 5/5 |
| 5 | F-SQL-5 + F-SQL-12 phone DB v39 | ✅ done (3 of the 4 listed indexes dropped; see 2.5) | mobile | `perf/p1-f-sql-5-12-v39-indexes` | `7261d02`, `997120a` | `f-sql-5-12.test.mjs`: 1/6 → 6/6; harness table in 2.5 |
| 6 | F-SQL-4 all phone writes through the transaction queue | ✅ done | mobile | `perf/p1-f-sql-4-tx-queue` | `987259b` | `f-sql-4.test.mjs`: 3/7 → 7/7; guard script 45 problems → ok |
| 7 | F-SYNC-3 / F-SYNC-4 timeout is slow, not offline; jitter | ✅ done | mobile | `perf/p1-f-sync-3-4-timeout-jitter` | `6accf01`, `6acb9bc` | `f-sync-3-4.test.mjs`: 3/13 → 13/13 |
| 8a | Defect history job-membership check (option A) | ✅ done | portal | `perf/p1-sec-1-history-access` | `987f6d1` | `sec-1-history.test.mjs`: 3/4 → 4/4 |
| 8b | `/media/sign` on a lead-less job | ✅ done | portal | `perf/p1-sec-2-media-sign-access` | `96690f7` | `sec-2-media-sign.test.mjs`: 3/6 → 6/6 |
| 9 | F-API-1 pin the API region | ⏭ skipped (regions not given) | portal | — | — | ready-to-apply change in 2.9 |

Every "done" test above was re-run by the reviewer against both `main` and the branch. Type-check is clean on every branch. The mobile repo uses full `tsc --noEmit`; the portal uses a per-file tsconfig, because a full portal `tsc` runs out of memory. ESLint shows no new problems on any changed file: the only warnings are ones `main` already has. The harness smoke tests pass.

## How the proof works

Neither repo has a test framework, and adding one would be a dependency change. So the tests use Node's built-in runner and live beside the audit in **`docs/audits/perf/tests/`** (portal repo, untracked docs, not on any branch). The harness:

- loads the apps' real TypeScript, compiled per file with each repo's own `typescript`;
- fakes `expo-sqlite` on `node:sqlite`, keeping the real library's non-exclusive transactions;
- records every portal Supabase query through a fake client, so no database is touched.

Each test fails on `main` and passes on its branch:

```bash
cd docs/audits/perf/tests
node --test f-off-1.test.mjs                                   # main checkouts: fails
MOBILE_ROOT=/c/Users/Technisia/Documents/Prohelp-Work/_perf-wt/mobile-perf-p1-f-off-1-pack-ready node --test f-off-1.test.mjs   # passes
PORTAL_ROOT=/c/Users/Technisia/Documents/Prohelp-Work/_perf-wt/portal-perf-p1-f-db-7-submit-lock node --test f-db-7.test.mjs
```

`harness/new-worktree.sh <mobile|portal> <branch>` recreates a worktree. All worktrees live in `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\`. Remove them once the branches are reviewed:

```bash
git -C "<repo>" worktree remove "<worktree path>"
```

## Reviewer changes on top of the implementers' work

- **Item 7:** the implementer flagged that a `TimeoutError` made the snag-history panel say "This defect has only been seen on this visit" instead of "needs a connection". That is a behaviour regression the fix itself introduced, so I added a one-line follow-up commit on the same branch (`6acb9bc`, `SnagHistory.tsx`). It treats a timeout like offline there, as it was before.
- **Item 5:** the brief says to drop only indexes that are provably redundant, meaning prefixes of newer ones. `idx_snag_sync (sync_state)` is not a prefix of any index, and the reconcile deletes in `pull.ts` filter on it. I kept it with a follow-up commit (`997120a`), corrected the migration comment, which said "nothing reads by sync_state", and updated the test to assert it is kept.

## 1a. Merged into `dev` (1 October 2026, local only, not pushed)

Decision received: **option A for 8a**. It is implemented (2.8a below), and every branch is merged into `dev` with `--no-ff`, one merge commit per finding. Nothing was pushed.

| Repo | `dev` before | Merges (in order) | `dev` now |
|---|---|---|---|
| mobile | local and `origin/dev` at `bacb406`, 7 commits behind `main`, nothing of its own | fast-forward to `main` (`04ce640`), then F-OFF-1, F-SQL-10, F-SYNC-6, F-SQL-5/12, F-SQL-4, F-SYNC-3/4, F-API-13 | `cd6183c` |
| portal | did not exist; created from `main` (`b626c4f`) | F-DB-7, F-DB-11, sec-2, sec-1, F-API-13, F-DB-8 | `e7c9378` |

**Conflicts resolved (mobile only; the portal merged cleanly):**
- **`src/sync/alerts.ts`, F-SQL-4 into F-SYNC-6:** kept F-SYNC-6's removal of the Realtime DELETE binding. F-SQL-4 had only wrapped that handler's write.
- **`src/sync/outbox.ts` `markRetry`, F-SYNC-3/4 into F-SQL-4:** kept F-SQL-4's transaction block, with F-SYNC-3/4's jittered delay and Retry-After inside it.
- **`src/sync/alerts.ts`, F-API-13 into the above (3 hunks):** every write goes through the transaction queue and nothing is nested.
  - `syncAlerts` keeps F-SYNC-3/4's backoff reset and clears the read-all flag inside `transaction()`.
  - `markAllAlertsRead` calls `writeMeta` (already queued), then runs the UPDATE in its own `transaction()`.
  - `clearAlerts` is one transaction that includes the read-all flag.

**Verified on the merged `dev` branches:**
- mobile: `tsc --noEmit` clean, and `npm run check:db-writes` ok.
- portal: per-file `tsc` clean on the 5 changed TypeScript files, and eslint clean.
- Every test passes against the merged branches:

  | Repo | Test | Result |
  |---|---|---|
  | mobile | harness smoke | 1/1 |
  | mobile | f-off-1 | 3/3 |
  | mobile | f-sql-10 | 5/5 |
  | mobile | f-sync-6 | 1/1 |
  | mobile | f-sql-5-12 | 6/6 |
  | mobile | f-sql-4 | 7/7 |
  | mobile | f-sync-3-4 | 13/13 |
  | portal | harness smoke | 1/1 |
  | portal | f-db-7 | 3/3 |
  | portal | f-db-8 | 3/3 |
  | portal | f-db-11 | 2/2 |
  | portal | sec-1-history | 4/4 |
  | portal | sec-2-media-sign | 6/6 |
  | both | f-api-13 | 2/2 |

The portal migration `20261001120800_area_status_write_only_on_change.sql` is now on `dev` but **still not applied**. Apply it to staging first (section 3.1). The `dev` worktrees are at `_perf-wt/mobile-dev` and `_perf-wt/portal-dev`.

## 2. Details per finding

Each subsection is the implementer's own record: files changed, summary, verification output, the manual check for the team, behaviour change and anything noticed. The reviewer's notes are marked as such.

### 2.1 Item 1 · F-OFF-1: the offline pack must never report "Ready" after a failed download

- **Status:** done
- **Repo + branch:** mobile (YFI-MobileApp), `perf/p1-f-off-1-pack-ready` (not pushed, not merged)
- **Worktree path:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\mobile-perf-p1-f-off-1-pack-ready`
- **Commit hash:** `cc1f6d78603a33d7aecf306f4fd8bfa4ca74c25f`

#### Files changed
- `src/sync/offlinePack.ts`: the records step `pullJob(taskId, { full: true, bundle: true })` no longer has `.catch(() => undefined)`, so its error now reaches the caller. The step also re-reads `children_at` and throws if it is still null, which happens when the request came back but its rows did not apply. In both cases `downloadJobPack` rejects before the plans and photos steps and never writes `pack_state`. The rest of the function is unchanged: photos, the family pulls (still best-effort), the plan retry, `verifyPack`, and the final `plansMissing === 0 ? 'ready' : 'none'` write. Comments are updated to match.
- `app/(app)/job/[id]/index.tsx`: the Download button gets `disabled={offline}`, plus a caption "Needs a connection to download." while offline. `offline` means `useSyncStore.online` is false or the developer "simulate offline" switch is on, the same as `review.tsx` and `_layout.tsx`. In the existing `catch`, an `OfflineError` now shows "No connection, so nothing was downloaded." Any other error still goes through `describeError(error, downloadFailed)`.
- `src/i18n/strings.ts`: two new `jobDetail` strings, `downloadNothing` and `downloadNeedsConnection`. Nothing existing said "nothing was downloaded". `errors.offline` and `downloadFailed` ("Tap to pick up where it left off") would both be misleading when nothing was saved.

#### Summary
Before the fix, a failed records request was swallowed. The plan and photo steps then found zero rows, `verifyPack` counted zero plans missing, and the job was marked `'ready'`. Now the pack rejects, `pack_state` stays as it was (`'none'` for a job that was never packed), and the job screen's existing catch shows the error and puts the Download button back. The result shape (`PackProgress`) is unchanged. A failure arrives as a rejection, which the screen already handled.

#### Verification
Test file: `C:\Users\Technisia\Documents\Prohelp-Work\Yalla Fixit\docs\audits\perf\tests\f-off-1.test.mjs`. It uses two new fakes in `tests/fakes/`:
- `f-off-1-pull.mjs`: a fake `src/sync/pull` with a controllable `pullJob`.
- `f-off-1-floorplans.mjs`: a fake `src/sync/floorPlanCache` that downloads nothing.

It also uses the existing `api-offline.mjs`. The rest is the real `offlinePack.ts`, the real migrations on the fake expo-sqlite, and the native stub filesystem.

Tests:
1. `a failed records download leaves pack_state 'none' and reports failure`: `pullJob` rejects. The test asserts that `pack_state` is `'none'` and that the call rejects with the original error, or else returns a result whose step is not `'done'`.
2. `records fetched (children_at set) and every plan on disk gives 'ready'`: `pullJob` inserts a plan row and sets `children_at`, and the plan file is on disk. The test asserts the result is `'done'`, `plansFailed` is 0 and `pack_state` is `'ready'`.
3. `records request resolved but nothing applied (children_at null) is not 'ready'`.

Against main (`MOBILE_ROOT=.../yfi-mobile-app/YFI-MobileApp node --test f-off-1.test.mjs`):
```
not ok 1 - a failed records download leaves pack_state 'none' and reports failure
ok 2 - records fetched (children_at set) and every plan on disk gives 'ready'
not ok 3 - records request resolved but nothing applied (children_at null) is not 'ready'
# pass 1
# fail 2
```
Against the worktree (`MOBILE_ROOT=.../_perf-wt/mobile-perf-p1-f-off-1-pack-ready node --test f-off-1.test.mjs`):
```
ok 1 - a failed records download leaves pack_state 'none' and reports failure
ok 2 - records fetched (children_at set) and every plan on disk gives 'ready'
ok 3 - records request resolved but nothing applied (children_at null) is not 'ready'
# pass 3
# fail 0
```
- Harness smoke tests still pass: `node --test harness-smoke.test.mjs harness-portal-smoke.test.mjs` gives `# pass 2`, `# fail 0`.
- `npx tsc --noEmit -p .` in the worktree is clean (exit 0).
- `npx eslint` on the 3 changed files gives 0 errors and 1 warning. The warning is `react-hooks/exhaustive-deps` on the useCallback in `index.tsx`, and main has the same warning (main line 150, branch line 156). Nothing new.

#### Manual check for the team (device)
1. With signal, open an active job that has never been packed. Wait for its details to load so the "Download for offline" card shows.
2. Turn on airplane mode. Within a moment the Download button greys out and the line "Needs a connection to download." appears above it. Tapping does nothing.
3. Turn airplane mode off. The button re-enables and the hint disappears.
4. Race case: tap Download and turn on airplane mode immediately, before the "Getting the job" step finishes. Or use a proxy (e.g. Charles) to fail `GET /api/snagging/sync/job/<id>`.
   - Expected: the bar disappears and the card shows "No connection, so nothing was downloaded. Connect, then try again." For a 500, it shows "The office system is busy. Tap to try again."
   - The Download button comes back. "Ready for offline" never appears and the Start CTA stays disabled ("Download the job first").
   - `pack_state` for the job stays `'none'`. Reopening the job still shows the Download card, not the Ready line.
5. Repeat with signal on. The pack completes and shows "Ready for offline" as before.

#### Behaviour change
- A pack whose records request fails, times out or returns an error now fails visibly with a message, and the job stays un-packed. Before, it said "Ready for offline".
- While the phone is offline, or the dev "simulate offline" switch is on, the Download button is disabled with a short hint.
- Nothing changes when the request succeeds. Photo downloads are untouched (Phase 2).

#### Noticed but not changed
- If a job was already `'ready'` and a later re-pack fails, `pack_state` stays `'ready'` because the failure path does not write it. The UI hides the button once ready, so this is not reachable from the screen today.
- The `children_at` check is satisfied by an earlier successful open. A full fetch that reaches the server but whose rows fail to apply will still pass if `children_at` was already set. The audit's suggested stricter criteria (`children_full_at` newer than the pack start, a minimum room or checklist count) were left out because the brief said not to add readiness criteria beyond `children_at`.
- The family pulls for other rounds (`pullJob(id, { full: true }).catch(() => undefined)`) are still best-effort, as before.
- F-OFF-2 (the Start gate needs a pack made online) is untouched.

#### Open questions
None.

#### `git -C <wt> show --stat HEAD`
```
commit cc1f6d78603a33d7aecf306f4fd8bfa4ca74c25f
Author: DanishAli232 <balochdanish2020@gmail.com>
Date:   Thu Oct 1 12:56:36 2026 +0500

    perf(p1): F-OFF-1 never mark the offline pack ready after a failed download

    The records step (pullJob) no longer swallows its error: the pack rejects,
    pack_state is left untouched, and it also rejects if children_at is still
    unset afterwards. The job screen shows "nothing was downloaded" for a
    connection failure and disables Download while offline, with a hint.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 app/(app)/job/[id]/index.tsx | 18 +++++++++++++++++-
 src/i18n/strings.ts          |  2 ++
 src/sync/offlinePack.ts      | 19 +++++++++++++++++--
 3 files changed, 36 insertions(+), 3 deletions(-)
```

### 2.2 Items 2, 3, 4b: portal database fixes (F-DB-7, F-DB-8, F-DB-11)

Tests live in `C:\Users\Technisia\Documents\Prohelp-Work\Yalla Fixit\docs\audits\perf\tests\` (`f-db-7.test.mjs`, `f-db-8.test.mjs`, `f-db-11.test.mjs`). Smoke tests still pass (`node --test harness-smoke.test.mjs harness-portal-smoke.test.mjs` → `# pass 2 / # fail 0`). The harness was not changed.

---

#### F-DB-7: submit locks only unlocked defects

- **Status:** done
- **Repo + branch:** portal, `perf/p1-f-db-7-submit-lock`
- **Worktree:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\portal-perf-p1-f-db-7-submit-lock`
- **Commit:** `59adc351eb1832df5524727496b3d4af5840b2c9`

**Files changed**
- `lib/server/snagging/sync-push.ts`: `.eq("locked", false)` added to the job-submission snag lock (`applySubmission`) and to the visit snag lock (`submitVisit`). The one-line job lock is now wrapped over several lines to match the visit lock's layout. CRLF kept.

**Summary**
Both submission locks now update only snags where `locked = false`, so a resubmission after a rejection no longer rewrites (and re-sends through the next delta) rows that are already locked. `snagging_snags.locked` is `BOOLEAN NOT NULL DEFAULT FALSE` (20260817090000:424), so NULL rows can't slip past the filter.

**Verification**
- `f-db-7.test.mjs` runs the real `handleSyncPush` with one `submission` mutation against the recording fake. The caller is the job's lead inspector, a non-admin with edit rights. The responder supplies the job, mutation ledger, snags, photos, checklist, rosters, profiles and sign-offs.
  - `job submission locks only unlocked defects, everything else unchanged`: the snag lock has `eq job_id` + `eq locked false` and values `{locked:true}`. The job update still sets `status: submitted`, `locked: true`, signer name and signature path, filtered by `eq id`. The signature is uploaded, the sign-off row is inserted (`visit_id null`), and the `task_submitted` audit row is written.
  - `visit submission locks only the visit's unlocked defects`: the lock has `eq job_id`, `eq visit_id` and `eq locked false`. The visit update sets `status: submitted`. The job row is not updated. The `visit_submitted` audit row is written.
  - `submission checks still refuse: photo-less snag, unsigned teammate`: both are rejected with the existing messages, and no lock is issued.
- Main: `# pass 1` / `# fail 2` (both lock tests fail with "lock must be filtered by locked = false"). Branch: `# pass 3` / `# fail 0`.
- tsc (temp tsconfig, `sync-push.ts`): exit 0. eslint `sync-push.ts`: exit 0.

**Manual check for the team (staging)**
Submit a job, reject it as "minor" (snags stay locked), then resubmit from the phone. Before the fix, every snag's `updated_at` (if the touch trigger is present) and every device's next delta included all snags. After the fix, `select count(*) from snagging_snags where job_id = :job and updated_at > :before_resubmit` should be 0 for an untouched minor rejection. Audit Q13 run twice in one transaction: the second run shows `rows=0`.

**Behaviour change:** none visible. Rows that are already locked stay locked and are just not rewritten.

**Noticed but not changed**
- `app/api/snagging/tasks/[id]/reject/route.ts:93-96` unlocks every snag on the job with no `.eq("locked", true)` filter. It's the mirror image of this finding and rewrites rows that are already unlocked. `app/api/snagging/tasks/[id]/visits/[visitId]/review/route.ts:112` follows the same pattern.

**Open questions:** none.

```
commit 59adc351eb1832df5524727496b3d4af5840b2c9
    perf(p1): F-DB-7 submit locks only unlocked defects
 lib/server/snagging/sync-push.ts | 9 +++++++--
 1 file changed, 7 insertions(+), 2 deletions(-)
```

---

#### F-DB-8: area-status trigger writes only when the status changes

- **Status:** done (migration written, NOT applied)
- **Repo + branch:** portal, `perf/p1-f-db-8-area-status-trigger`
- **Worktree:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\portal-perf-p1-f-db-8-area-status-trigger`
- **Commit:** `3b2fa94f9e2f7138e748e09eaa5216998fb95380`

**Files changed**
- `supabase/migrations/20261001120800_area_status_write_only_on_change.sql` (new, LF): `create or replace function` for `public.snagging_refresh_area_status()` and `public.snagging_refresh_area_status_self()`. The logic is the same, and the only change is a WHERE guard on each UPDATE. The header comment holds the staging test.

**Summary**
- I grepped every migration for the function and trigger names. The latest definitions are in `20260904100000_restore_area_status_trigger.sql`. The only other definition is the older one in 20260817090000, and nothing after 0904 redefines them.
- Both triggers are AFTER triggers that issue an UPDATE. Neither is a BEFORE trigger that sets NEW.status. So both functions got the guard `and status is distinct from <the same case expression as the SET>`.
- `security definer`, `set search_path = public` and the function signatures are unchanged. Triggers are not recreated: `snagging_snags_refresh_area` is AFTER INSERT / UPDATE OF status, area_id / DELETE, and `snagging_areas_refresh_status` is AFTER UPDATE OF confirmed_at.

**Verification**
- `f-db-8.test.mjs` is a textual proof. It finds the newest migration that defines each function, diffs its body against the 0904 body, and asserts:
  - exactly one line was removed (`where id = …;`);
  - it was re-added without the `;`, followed by `and status is distinct from case`;
  - the guard's case arms are identical to the SET's;
  - `security definer` / `set search_path` are unchanged;
  - the new migration contains no `create/drop trigger` outside comments.
- Main: `# pass 0` / `# fail 3` (no later migration redefines the functions). Branch: `# pass 3` / `# fail 0`.
- Diff output from the test:

```
--- 20260904100000_restore_area_status_trigger.sql
+++ 20261001120800_area_status_write_only_on_change.sql
   update public.snagging_areas
      set status = case
            when v_count > 0 then 'has_snags'
            when confirmed_at is not null then 'clear'
            else 'pending'
          end
-   where id = v_area_id;
+   where id = v_area_id
+     -- Only when it changes: an unchanged status is not written.
+     and status is distinct from case
+           when v_count > 0 then 'has_snags'
+           when confirmed_at is not null then 'clear'
+           else 'pending'
+         end;

(snagging_refresh_area_status_self, same shape)
-   where id = new.id;
+   where id = new.id
+     -- Only when it changes: an unchanged status is not written.
+     and status is distinct from case
+           when v_count > 0 then 'has_snags'
+           when new.confirmed_at is not null then 'clear'
+           else 'pending'
+         end;
```
(All other lines of both bodies are identical. The test prints the full bodies.)
- No tsc/eslint, because the change is SQL only. The SQL was not run anywhere, as the rules require.

**Manual check for the team (staging; the header comment has the full script)**
Inside `begin; … rollback;`:
1. Before and after inserting a second snag into an area that already has a live snag, run `select ctid, xmin, status, updated_at from snagging_areas where id = :area`. With the fix, all four are unchanged, which means the trigger's UPDATE touched 0 rows. Without the fix, ctid changes and xmin becomes the current transaction id. A no-op `update snagging_snags set status = status where id = :live_snag` gives the same check without needing an insert.
2. The first snag into an empty, unconfirmed area still flips the area to `has_snags`, and its ctid/xmin change.
3. Withdrawing that last live snag reverts the area to `pending` (or `clear` if it is confirmed).

With `auto_explain.log_nested_statements = on`, case 1 logs `Update on snagging_areas` with 0 rows. The area row must have been last written before the test transaction for the xmin check to mean anything.

**Behaviour change**
- The area's status values are identical. The difference is that the area row is no longer rewritten when its status doesn't change, so `snagging_areas.updated_at` stops moving on every snag write.
- I checked who reads that timestamp. `changedJobIds` in `lib/server/snagging/sync-pull.ts:1060-1118` uses area `updated_at` only for the list view (`rooms: listView`). The list card shows rooms done/total, which comes from `confirmed_at`, a direct client write that still bumps `updated_at`. So the card loses nothing. Snags carry their own `updated_at` in the full delta.

**Noticed but not changed**
- The concurrent-withdrawal race and the lock serialisation described in the finding are not addressed (they would need `select … for update` on the area, or status computed at read time). The finding's diagnosis stands.
- The self-trigger could become a BEFORE trigger that sets `NEW.status`, which would remove the second write entirely. That would recreate the trigger, so it is out of scope.
- The copied in-body comment "The trigger below fires on confirmed_at" refers to the 0904 file's trigger. I left it verbatim so the body diff stays limited to the guard.

**Open questions:** none.

```
commit 3b2fa94f9e2f7138e748e09eaa5216998fb95380
    perf(p1): F-DB-8 area-status trigger writes only on change
 ...1001120800_area_status_write_only_on_change.sql | 129 +++++++++++++++++++++
 1 file changed, 129 insertions(+)
```

---

#### F-DB-11: defect-history audit lookup uses its index

- **Status:** done
- **Repo + branch:** portal, `perf/p1-f-db-11-history-index`
- **Worktree:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\portal-perf-p1-f-db-11-history-index`
- **Commit:** `bfa4cd77102627af90edd9b9b2a533231879e098`

**What I confirmed first**
- Both queries filter only `event_type = 'snag_verified'`.
- The only writer of `snag_verified` is `applyVerification` in `lib/server/snagging/sync-push.ts:938-945`, with `entityType: "verification"`. `audit.ts` `toRow` maps it straight to `entity_type`. No SQL function writes that event.
- `git log -S'snag_verified'` shows it has always been written as `"verification"`, from the commit that introduced it (aa4c2e0, 2026-08-27) onward, so existing rows match too.
- The index is `idx_snagging_audit_entity on snagging_audit_events (entity_type, entity_id, created_at desc)` (20260817090000:586-587, restored in 20260821160000:29-30).

**Files changed** (both LF)
- `app/api/snagging/snags/[id]/history/route.ts`: `.eq("entity_type", "verification")` added to the verdict lookup, with a two-line comment.
- `lib/server/snagging/job-detail-sections.ts`: the same in `attachPeople`, which `loadJobSnags` uses.

**Query shape** (as recorded by the fake)
- Before: `from("snagging_audit_events").select("entity_id, actor_label, created_at, payload").eq("event_type", "snag_verified").in("entity_id", [...]).order("created_at", {ascending:false})`
- After: `from("snagging_audit_events").select("entity_id, actor_label, created_at, payload").eq("event_type", "snag_verified").eq("entity_type", "verification").in("entity_id", [...]).order("created_at", {ascending:false})`
- The history route and the job-detail query have the same shape.

**Verification**
- `f-db-11.test.mjs`. The fake answers the audit query by applying its eq/in/order filters to a table of audit rows: two `snag_verified`/`verification` rows on the round copy, plus unrelated `snag` events.
  - `snag history: same legs, audit query filtered by entity_type`: an admin caller runs the real `GET`. Legs are deep-equal to the expected values: recorded_by Alice on round 1, verified_by Bob (the latest verdict) on round 2, and photo counts. The query carries `eq entity_type verification`.
  - `job detail snags: same people, audit query filtered by entity_type`: the real `loadJobSnags(admin, ROUND)` returns `people` deep-equal to `[recorded Alice r1, verified Bob r2 verified_closed]`. The query carries the filter.
- On main, both deep-equal result checks pass and only the filter assertion fails, which shows the results are unchanged. Main: `# pass 0` / `# fail 2`. Branch: `# pass 2` / `# fail 0`.
- tsc (temp tsconfig with `app/api/snagging/snags/*/history/route.ts` and `job-detail-sections.ts`): exit 0. eslint on both: exit 0.

**Manual check for the team (staging)**
Run audit Q15: `explain (analyze, buffers) select entity_id, actor_label, created_at, payload from snagging_audit_events where event_type = 'snag_verified' and entity_type = 'verification' and entity_id in (…) order by created_at desc;`. Expect `Index Scan using idx_snagging_audit_entity`, under 1 ms, fewer than 30 buffers. Then open a de-snagged defect's history in the portal: the "verified by" names should be the same as before.

**Behaviour change:** none. Every `snag_verified` row already has `entity_type = 'verification'`.

**Noticed but not changed:** none.

**Open questions:** none.

```
commit bfa4cd77102627af90edd9b9b2a533231879e098
    perf(p1): F-DB-11 history audit lookup names its entity type
 app/api/snagging/snags/[id]/history/route.ts | 3 +++
 lib/server/snagging/job-detail-sections.ts   | 3 +++
 2 files changed, 6 insertions(+)
```

### 2.3 Item 4a · F-API-13 · "Mark all read" must actually mark all (mobile + portal)

**Status:** done

| | Mobile | Portal |
|---|---|---|
| Branch | `perf/p1-f-api-13-mark-all-read` | `perf/p1-f-api-13-mark-all-read` |
| Worktree | `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\mobile-perf-p1-f-api-13-mark-all-read` | `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\portal-perf-p1-f-api-13-mark-all-read` |
| Commit | `9eefd670ed696e29f855dc138cbaa20268512171` | `6121a89d89f93e24423d36ef1312744b04f348e6` |

#### Files changed
- Mobile `src/sync/alerts.ts` (LF, kept LF)
  - New sync_meta key `alerts_read_all_pending`, holding the time of the tap. `markAllAlertsRead` sets it. `syncAlerts` sends `{since, read_all: true}` while it is set, in place of the id list. After a successful response it deletes the key only if the value is still the one it sent, so a second tap made while the request was out is still sent.
  - `markAllAlertsRead` keeps the optimistic update (local rows read, `unreadAdjust = 0`, badge refresh). It now sends even when no local row changed. Before, a badge of 2,800 with all 200 local rows already read meant the tap did nothing at all.
  - The badge after a response: if a mark-all is still pending (it was tapped while this request was out), `unreadAdjust = 0` instead of the server's older count.
  - `sendReadsSoon`: if a request is already out, the follow-up send waits for it. Before, `syncAlerts` handed back the in-flight promise, which was built before the tap, and the tap was not sent until some later sync.
  - `clearAlerts` (sign-out) also deletes the key, so an unsent mark-all can never mark the next inspector's alerts read.
- Portal `app/api/snagging/sync/alerts/route.ts` (LF): when this request applied reads (`read_all`, or a non-empty `read`), the delta's `or` becomes `created_at.gt.since, and(read_at.gt.since, read_at.neq.serverTime)`. Rows this request has just marked read are not sent back. Rows created since the cursor are still sent, already marked read. The plain delta is unchanged.

#### Summary
The phone used to send the ids of the 200 or fewer alerts it holds. The server marked only those and answered with `unread: 2800`, so the badge jumped back. The phone now sends `read_all: true`, which survives offline in sync_meta until a send succeeds. The server already supported `read_all`, and its update runs before the count (verified), so it answers `unread: 0`. It no longer sends back the 3,000 rows it just marked (in the test the response went from 642,586 bytes to under 5,000).

**Compatibility:** `read_all: z.boolean().optional()` has been in the route's body schema on `main` since before this change, so a portal deployed without this commit still accepts the new app's request: it marks everything read and answers `unread: 0`. The only difference is that the unfixed portal still sends back every row it marked read (paged, up to all of them). That is heavier but correct. The phone's KEEP trim then drops all but the newest 200. Older app builds keep sending `read: [ids]`, and the server handles that as before, minus the re-sent rows. The response shape is unchanged: `{server_time, me, alerts, unread}`.

**`read: [ids]` path:** the same exclusion applies, because it is the same condition and trivial. The phone already shows those rows as read, since it sent their ids.

#### Verification
Test: `C:\Users\Technisia\Documents\Prohelp-Work\Yalla Fixit\docs\audits\perf\tests\f-api-13.test.mjs`. It is a driver that runs each half in its own process, because the mobile and portal loaders cannot be registered in one process. It strips `NODE_TEST_CONTEXT` so a failing child really fails. The halves:
- `tests/fakes/f-api-13-mobile.part.mjs`, with `tests/fakes/f-api-13-api.mjs` stubbing `src/lib/api` and recording each request body:
  1. setup: 250 unread on the phone (3,000 on the server)
  2. mark all offline: badge 0 at once, the request carries read_all, the flag survives the failure
  3. back online: read_all sent again, flag cleared, badge stays 0 (not 2,750)
  4. mark all with every local alert already read still tells the server
  5. signing out drops an unsent mark-all, so the next inspector's alerts stay unread
- `tests/fakes/f-api-13-portal.part.mjs`: the route runs against an in-memory table. The fake responder applies `eq`, `is`, `in`, the PostgREST `or`/`and` string, `order` and `range`. The table holds 3,000 old unread alerts, 2 new ones and one row for another user.
  1. read_all with 3,000 unread: unread 0, only the 2 new alerts come back, scoped update. It also asserts that the update has `eq user_id` and `is read_at null`, that `read_at` equals `server_time`, that the update runs before the count, that the other user's row is untouched, that the response is under 5 KB, and that the response keys are unchanged.
  2. read: [250 ids]: those rows are not sent back; new ones still are (unread 2,752)
  3. a plain delta still sends rows read since the cursor elsewhere (regression guard)

Results:
```
# main (no env)
not ok 1 - mobile: Mark all sends read_all, badge 0, flag survives offline and clears on success
not ok 2 - portal: read_all answers unread 0 and does not re-send the rows it marked read
# pass 0
# fail 2
   (mobile part on main: pass 1 / fail 4; portal part on main: pass 1 / fail 2, "got 3002 alerts, 642586 bytes", "got 252 alerts")

# branch (MOBILE_ROOT=<mobile wt> PORTAL_ROOT=<portal wt>)
ok 1 - mobile: Mark all sends read_all, badge 0, flag survives offline and clears on success
ok 2 - portal: read_all answers unread 0 and does not re-send the rows it marked read
# pass 2
# fail 0
   (mobile part: pass 5 / fail 0; portal part: pass 3 / fail 0)
```
Harness smoke tests still pass: `# pass 2`, `# fail 0`.

- Mobile: `npx tsc --noEmit -p .` was clean. `npx eslint src/sync/alerts.ts` was clean.
- Portal: the temp-tsconfig tsc on `app/api/snagging/sync/alerts/route.ts` exited 0, and the temp file was deleted. `npx eslint` on the route was clean.

#### Manual check for the team
1. On staging, give one inspector 300 or more unread alerts (for example by assigning or rescheduling jobs).
2. On the phone, open Alerts. The badge shows the server count, for example 300.
3. Tap "Mark all read". The badge goes to 0 at once and stays 0 after the request returns. In the network log, the `POST /api/snagging/sync/alerts` body is `{since, read_all: true}` and the response is a few KB, not around 135 KB.
4. In the portal, that inspector has no unread notifications (`snagging_notifications.read_at` is set on all of their rows).
5. Offline variant: turn on airplane mode, tap "Mark all read" (badge 0), kill and reopen the app, then go online. The first alerts request carries `read_all: true` and the server count goes to 0.
6. Sign-out variant: offline, tap Mark all, sign out, then sign in as another inspector online. Their alerts stay unread.

#### Behaviour change
- "Mark all read" now marks every unread alert of that inspector on the server, not just the up to 200 the phone holds. The badge stays at 0.
- The tap is sent even when the phone's own rows are all read. The button only shows while the badge is above 0.
- A mark-all made offline is sent with the next alerts request, even after an app restart.
- The server no longer echoes rows it just marked read in the same request, unless they are new since the cursor. Other devices still get those reads through their own `since`.

#### Noticed but not changed
- When the server marks 3,000 rows read, Realtime sends this phone, and the inspector's other devices, one `UPDATE` event per row. Each event triggers a `storeAlerts` call and a badge refresh on the phone. That is a burst of work after a big mark-all. A candidate for a follow-up: debounce the UPDATE handler, or skip rows already read locally.
- F-SYNC-6 (item 4c/d) edits the Realtime `subscribe` block of the same `src/sync/alerts.ts`. Its hunks are different, so I expect at most a trivial merge.
- The audit's suggested `read_applied: n` field was not added (the item said to keep the response shape).
- A race older than this change remains: rows that arrive by Realtime while a mark-all request is out, and are created after the server's `serverTime`, stay unread. That is correct, because they are new.

#### Open questions
None.

#### `git show --stat HEAD`
Mobile:
```
commit 9eefd670ed696e29f855dc138cbaa20268512171
Author: DanishAli232 <balochdanish2020@gmail.com>
Date:   Thu Oct 1 12:57:06 2026 +0500

    perf(p1): F-API-13 send read_all for "Mark all read"

    The phone holds at most 200 alerts, so sending their ids marked only those
    and the server's count put the badge back. Mark all now sends read_all,
    kept in sync_meta (alerts_read_all_pending) until a send succeeds, is sent
    even when every local alert is already read, and is dropped on sign-out.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 src/sync/alerts.ts | 48 ++++++++++++++++++++++++++++++++++++------------
 1 file changed, 36 insertions(+), 12 deletions(-)
```
Portal:
```
commit 6121a89d89f93e24423d36ef1312744b04f348e6
Author: DanishAli232 <balochdanish2020@gmail.com>
Date:   Thu Oct 1 12:57:07 2026 +0500

    perf(p1): F-API-13 do not re-send alerts this request marked read

    On read_all (or read: [ids]) the delta skipped nothing, so marking 3,000
    alerts read sent all 3,000 back. Rows with read_at = this request's
    server_time are now left out unless created since the cursor. The update
    still runs before the unread count, so read_all answers unread 0.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 app/api/snagging/sync/alerts/route.ts | 11 ++++++++++-
 1 file changed, 10 insertions(+), 1 deletion(-)
```

### 2.4 Item 4c / 4d: F-SYNC-6 and F-SQL-10 (mobile)

#### 4c · F-SYNC-6: Realtime DELETE no longer broadcast to every device

- **Status:** done
- **Repo + branch:** mobile, `perf/p1-f-sync-6-realtime-delete`
- **Worktree path:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\mobile-perf-p1-f-sync-6-realtime-delete`
- **Commit hash:** `3064cf9d9f88088288a061f2d440dae69e551342`

**Files changed**
- `src/sync/alerts.ts`: removed the unfiltered `{ event: 'DELETE', table: 'snagging_notifications' }` `.on(...)` binding and its handler, which was the only code that existed just for it. Added a 3-line comment so nobody puts it back. `rawDb` and `refreshLocalCount` are still used elsewhere, so no imports changed. LF line endings kept.

**Summary**
Supabase cannot filter DELETE events by user, so every deleted notification row (job or visit cascades, any purge) was sent to every subscribed phone. The channel now has only the INSERT and UPDATE bindings, both filtered with `user_id=eq.<me>`. No replacement mechanism was added.

**Verification**
- Test: `docs/audits/perf/tests/f-sync-6.test.mjs`. It stubs `src/lib/supabase` with `tests/fakes/recording-supabase.mjs`, whose `channel().on()` records each binding, and `src/lib/api` with `tests/fakes/api-offline.mjs` so the catch-up never touches the network. It runs the real migrations, calls `startAlerts()`, and asserts that INSERT and UPDATE are bound with `user_id=eq.u-1` and that no binding has event `DELETE` without a filter.
  - Test name: `startAlerts subscribes with no unfiltered DELETE binding`
  - main: `not ok 1 ... unfiltered DELETE binding(s) on: snagging_notifications` → `# pass 0` / `# fail 1`
  - branch: `# pass 1` / `# fail 0`
  - A `[alerts] sync failed Error: offline (test fake)` line is printed by the deliberately offline catch-up. It is expected and harmless.
- `npx tsc --noEmit -p .`: clean. `npx eslint src/sync/alerts.ts`: no output (clean).
- Harness smoke tests: `node --test harness-smoke.test.mjs harness-portal-smoke.test.mjs` → `# pass 2` / `# fail 0`.

**Manual check for the team**
1. Sign in as inspector A on device 1 and inspector B on device 2. Keep both apps in the foreground.
2. In the portal, delete a job (or visit) that has notifications for A only.
3. Expected: device 2 (B) gets no Realtime message for it (Supabase Realtime inspector or a network log shows no `postgres_changes` DELETE frame). Device 1 (A) also gets no instant removal. A's alert stays in the Alerts tab (see Behaviour change). The badge number is corrected at the next alerts sync.
4. A new assignment for A still shows up on device 1 straight away (the INSERT live feed is unchanged), and a read on the portal still updates device 1 (UPDATE).

**Behaviour change**
- A notification deleted on the server no longer disappears from the phone straight away.
- **Does the catch-up remove server-deleted alerts? No.** `POST /api/snagging/sync/alerts` returns only rows that still exist and were `created_at > since` or `read_at > since` (portal `app/api/snagging/sync/alerts/route.ts:126-134`). `storeAlerts` only upserts, so a deleted row is never reported and never removed.
- **What happens instead:** the alert stays in SQLite and in the Alerts tab until the 200-cap trim in `syncAlerts` (`DELETE FROM alerts WHERE read_pending = 0 AND id NOT IN (newest 200 by created_at)`) pushes it out. That happens only after 200 newer alerts have arrived, and never while it has an unsent local read.
- **The badge number** still corrects itself at the next sync. `unreadAdjust = server unread - pending - local`, and the server count no longer includes the deleted row. The list row itself still shows as unread until the trim removes it.
- As instructed, this was not changed. It is acceptable, but stating it plainly: "on the next catch-up" is not accurate for this codebase. The real answer is "at the 200-cap trim".

**Noticed but not changed**
- If an inspector taps one of these stale alerts, it may open a job that no longer exists. I did not check how the job screen handles a missing job.
- Before this change, the job-deleted case removed the alert at once. Getting that back properly needs the deletions-as-data approach from the report (soft-delete or tombstones in the catch-up). That is out of scope here.

**Open questions:** none.

```
commit 3064cf9d9f88088288a061f2d440dae69e551342
    perf(p1): F-SYNC-6 drop the unfiltered Realtime DELETE binding on alerts
 src/sync/alerts.ts | 16 ++++------------
 1 file changed, 4 insertions(+), 12 deletions(-)
```

---

#### 4d · F-SQL-10: Checklist no longer lists an item twice

- **Status:** done
- **Repo + branch:** mobile, `perf/p1-f-sql-10-checklist-dup`
- **Worktree path:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\mobile-perf-p1-f-sql-10-checklist-dup`
- **Commit hash:** `a6fc7af985ae5eae6f3262193f0e647ecd0ff799`

**Files changed**
- `src/db/repositories/checklist.ts`: in `listChecklist`, replaced `LEFT JOIN outbox` with two correlated scalar subqueries for `queue_state` and `queue_error`. The SELECT list, the column names, the ORDER BY and the TS mapping are unchanged. LF line endings kept.

**Summary**
A refused answer stays as `state='error'`, and re-answering queues a second `queued` row (`enqueue` folds only queued updates). The join matched both rows, so the item came back twice. Each subquery now picks exactly one outbox row per item: `WHERE entity='checklist' AND entity_id=c.id AND state IN ('queued','error') ORDER BY o.state = 'error' DESC, o.seq DESC LIMIT 1`.
- `queue_state` is `'error'` if any error row exists, else `'queued'` if a queued row exists, else NULL.
- `queue_error` is the `last_error` of that same row, so it is the latest error message whenever there is an error row.

**I did not use the report's SQL as written, for two reasons:**
1. `SELECT CASE WHEN SUM(o.state='error') > 0 THEN 'error' ELSE 'queued' END FROM outbox ...` is an aggregate, so it returns one row even when nothing matches. `SUM` is NULL, and the CASE falls through to `'queued'`. Every item with no outbox row would have shown "queued". I confirmed this on node:sqlite (`{ q: 'queued' }` on an empty table).
2. The report's `queue_error` only reads error rows. The old join returned a queued row's `last_error` too, and `markRetry` sets `last_error` on rows that stay queued. Taking `last_error` from the same chosen row keeps the single-row meaning exactly as it was. In practice this does not change the UI, which shows `syncError` only when `sync === 'error'`.

**Verification**
- Test: `docs/audits/perf/tests/f-sql-10.test.mjs`. It runs the real migrations on the fake expo-sqlite, with `src/sync/pull` stubbed by `tests/fakes/pull-noop.mjs` and `src/features/auth/authStore` by `tests/fakes/auth-store.mjs`. The outbox rows are made through the app's own code path: `setChecklistStatus` → `markRejected` → `setChecklistStatus` again. That gives exactly one `error` row plus one `queued` row, with the same entity, entity_id and payload conventions as on a phone.
  - `set-up: item-both has one 'error' and one 'queued' outbox row`
  - `an item with an error row and a queued row is listed once, as 'error'` (also checks `syncError` = the refusal message, and 3 rows for 3 items)
  - `an item with no outbox row is synced (queue_state null)`
  - `an item with only a queued row is 'queued'`
  - `order and returned fields are unchanged`
  - main: `not ok 2 ... item-both listed 2 times`, `not ok 5` (duplicate id in the order) → `# pass 3` / `# fail 2`
  - branch: `# pass 5` / `# fail 0`
- Query plan on the branch (EXPLAIN QUERY PLAN, migrated schema): `SEARCH c USING INDEX idx_job_checklist_task (task_id=?)`, then `CORRELATED SCALAR SUBQUERY` with `SEARCH o USING COVERING INDEX idx_outbox_entity (entity=? AND entity_id=? AND state=?)`. The subquery's temp B-tree sorts only the one or two outbox rows per item.
- `npx tsc --noEmit -p .`: exit 0. `npx eslint src/db/repositories/checklist.ts`: exit 0.
- `docs/audits/perf/scripts/sqlite-plans.mjs` was not used as proof. Its `checklistDupProbe` runs its own embedded copy of the old SQL (line ~417), not the code in the worktree, so it cannot test the branch without editing the script. The unit test above is the proof.

**Manual check for the team**
1. On a device, open a job's checklist and answer an item in a way the server refuses (for example on a job the office has locked), so the item shows the red "failed to send" badge.
2. Answer the same item again while offline.
3. Expected: the item appears once, with the error badge and its message. Before the fix it appeared twice, and React logged a duplicate-key warning.
4. An untouched item shows as synced. An item answered offline shows as queued.

**Behaviour change:** none except the fix. An item with both an error row and a queued row now shows once, as `error`. Before, it showed twice, once as error and once as queued.

**Noticed but not changed**
- The list `ORDER BY c.created_at, c.sort_order` has no `c.id` tie-breaker (also flagged in the audit table). I left it alone.

**Open questions:** none.

```
commit a6fc7af985ae5eae6f3262193f0e647ecd0ff799
    perf(p1): F-SQL-10 list each checklist item once
 src/db/repositories/checklist.ts | 15 +++++++++++----
 1 file changed, 11 insertions(+), 4 deletions(-)
```

#### Shared harness additions (additive only, under `docs/audits/perf/tests/fakes/`)
- `recording-supabase.mjs`: a supabase fake that records `channel().on()` bindings and has `getChannels()`.
- `api-offline.mjs`: an `apiRequest` that always rejects as offline.
- `pull-noop.mjs`: a `refreshJob` / `onPullApplied` no-op.
- `auth-store.mjs`: a fixed `useAuthStore.getState()` (userId `u-1`).

### 2.5 Item 5 · F-SQL-5 + F-SQL-12: phone DB v39, indexes and query terms

> **Reviewer follow-up (commit `997120a`).** `idx_snag_sync` is **kept**. It is not a prefix of any wider index, and the reconcile deletes in `pull.ts` filter on `sync_state`, so it fails the brief's "provably redundant" test. v39 therefore drops 3 indexes, not 4. The migration comment ("nothing reads by sync_state") was corrected and `f-sql-5-12.test.mjs` now asserts the index is kept: main 1/6, branch 6/6.
>
> **Re-measured after the follow-up** (`sqlite-plans.mjs`, desktop node:sqlite, ms, median; a phone is ≈3–10× slower):
>
> | Measurement | main (v38) | branch (v39) |
> |---|---|---|
> | First download of the big job (8 interleaved runs, fresh DB) | 329.6 | 152.8 |
> | Whole-job pull-apply (pullBig) | 246.1 | 222.2 |
> | Q14 `listUploads`, real statistics (main) vs upgraded phone after v39 (branch) | 132.9 | 6.4 |
> | Q14b `uploadSummary`, same states | 48.3 | 1.0 |
> | Q13b / Q13c alert counts, same states | 0.3 / 0.4 | 0.1 / 0.0 |
>
> Other timed queries stayed within run-to-run noise. Several sub-millisecond queries (0.4 → 0.9 ms) moved in both directions between runs and between states of the same run. The figures in the implementer's write-up below were measured before the follow-up, with 4 indexes dropped.

- **Status:** done
- **Repo + branch:** mobile, `perf/p1-f-sql-5-12-v39-indexes`
- **Worktree:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\mobile-perf-p1-f-sql-5-12-v39-indexes`
- **Commit:** `7261d02` perf(p1): F-SQL-5 F-SQL-12 phone DB v39 indexes and statistics

#### Files changed
- `src/db/migrations.ts` (CRLF kept): new migration v39, in its own transaction with the version stamp inside, like the others. It creates `idx_photo_unsent_snag`, `idx_photo_unsent_taken`, `idx_alerts_unread` and `idx_alerts_read_pending`. It drops `idx_snag_task`, `idx_snag_area`, `idx_photo_snag` and `idx_snag_sync`. It ends with `PRAGMA optimize(0x10002)`.
- `src/db/repositories/syncQueue.ts` (CRLF): new `UNSENT` constant. `listUploads` now filters on `p.upload_state <> 'uploaded' AND p.upload_state IN (...)`, and `uploadSummary` uses the same filter without the `p.` prefix.
- `src/sync/uploader.ts` (CRLF): `uploadPending` (both the pick query and the `remaining` count) and `uploadCounts` gain the `<> 'uploaded'` term. Their IN lists stay.
- `src/sync/sendWithMedia.ts` (LF): `choosePhotos` gains the term. Its IN list stays.
- `app/(app)/sync.tsx` (CRLF): `readFailedPhotos` gains the term. Its `= 'error'` filter stays.

#### Summary
v39 adds the partial indexes from the audit and drops the four redundant indexes, then refreshes planner statistics. Each "not yet uploaded" query now repeats the partial-index term, so SQLite is allowed to use the new index. The existing filters are all kept, so the queries mean exactly what they meant before. On an upgraded phone with real statistics, the Sync screen no longer reads every photo: listUploads went from about 110–250 ms to 9–13 ms, and uploadSummary from 85–150 ms to 1.4–1.9 ms. A first job download is about 2x faster.

#### Choices and evidence

**Where statistics are refreshed: inside the v39 transaction, with `PRAGMA optimize(0x10002)`, not plain `ANALYZE`.**
- **Inside the transaction is safe.** expo-sqlite 57.0.2 implements `withTransactionAsync` as `execAsync('BEGIN')` → task → `COMMIT`. Each migration statement goes through `execAsync` on the same connection. ANALYZE is allowed inside a transaction; v29 already does exactly this. `PRAGMA optimize` runs its per-table `ANALYZE` statements through `OP_SqlExec` on the same connection, so they are also allowed. Checked on node:sqlite 3.47.2 inside BEGIN/COMMIT. expo-sqlite bundles SQLite 3.50.3 (3.49.1 for SQLCipher), and both have the mask semantics below (added in 3.46). So nothing needs to change in `migrate()` or `initDatabase()`.
- **Why not plain `ANALYZE`.** My first version was `PRAGMA analysis_limit = 400; ANALYZE`. I found that on a fresh install, ANALYZE over empty tables writes a `'0 0'` stat row for each partial index, and only for those. Ordinary indexes on empty tables get no row, which is why v29 left 0 rows. The planner then believes the unsent and alert indexes are empty for good, even after the tables fill. In the harness that did no measurable harm, but it is a skewed partial-statistics state that would never be corrected.
- **What `PRAGMA optimize(0x10002)` does instead.** Read from the bundled `sqlite3.c`, `case PragTyp_OPTIMIZE`. It analyzes a table only if the table holds rows (`OP_Rewind` skips empty tables), and only if either some index on it has no statistics or (with the 0x10000 bit) its row count has changed tenfold since it was measured.
  - Fresh install: nothing is written. The test asserts 0 rows in `sqlite_stat1`.
  - Upgraded phone with data: `snag_photos` and `alerts` are always measured, because the new indexes have no statistics. So is any table never analyzed (most phones installed since v29) or grown tenfold since.
- **Why I left `analysis_limit` out.** Without the 0x10 bit, SQLite applies no sampling cap of its own, so statistics are exact. With a 400-row limit, `idx_photo_upload` was measured at `13500 401` instead of the true `13500 3375`, because it samples the first rows, which are all 'error'. That would distort the plans for other upload_state queries, such as freeUpSpace.
- **Cost of the upgrade migration.** On a full harness device (13,500 photos, 4,500 snags, 3,000 alerts) it took 151–292 ms on desktop, including building the indexes. Plain ANALYZE took 208–267 ms. It runs once.
- **Caveat.** On SQLite older than 3.46, optimize would analyze nothing during migration. That does not apply here, because SQLite is bundled.

**Index drops. Each drop was checked against the exact definitions in migrations.ts:**

| Dropped (v1) | Covered by (v29) | Why it is safe to drop |
|---|---|---|
| `idx_snag_task ON snags(task_id)` | `idx_snag_task_created ON snags(task_id, created_at)` | prefix of the wider index |
| `idx_snag_area ON snags(area_id)` | `idx_snag_area_status ON snags(area_id, status)` | prefix of the wider index |
| `idx_photo_snag ON snag_photos(snag_id)` | `idx_photo_snag_taken ON snag_photos(snag_id, taken_at)` | prefix of the wider index |
| `idx_snag_sync ON snags(sync_state)` | none | not a prefix of anything; see below |

- No table is ever rebuilt, and no later migration drops the v29 indexes.
- A grep of `src` and `app` finds no `INDEXED BY` or `NOT INDEXED`, and nothing names any of the four indexes outside migrations.ts and schema.ts.
- **`idx_snag_sync` is the only drop that is not a prefix.** The only queries filtering on `sync_state` are the two reconcile deletes in `pull.ts:970` and `pull.ts:1107`, which combine `sync_state = 'synced'` with other conditions. On main, without statistics, the job-scope delete used `SEARCH snags USING INDEX idx_snag_sync`. On the branch it uses `idx_snag_task_created (task_id=?)`, which reads one job's snags instead of every synced snag. That is the better plan.
- **Plans compared.** Main state A against branch state A (fresh install) differ only where expected:
  - Q6, Q6r, Q7 and Q20 use `idx_photo_snag_taken` instead of `idx_photo_snag`, with the same `snag_id=?` seek.
  - Q13b and Q13c use the new alert indexes.
  - The reconcile delete changes as described above.
  - No other plan changed. I kept none of the four; all are provably redundant.

**Query terms.**
- **The IN filters are kept as the task asked.** Because of that, with statistics present the planner seeks `idx_photo_upload (upload_state=?)` for listUploads, uploadCounts, the pick and choosePhotos, and uses `idx_photo_unsent_snag` for uploadSummary. Both kinds of plan read only the unsent rows.
- **What matters is the failure mode is gone.** Main flipped to `SCAN p USING INDEX idx_photo_snag`, a pass over all 13,500 photos. Now, with the term present, the partial index is always available as a cheap fallback.
- **The term makes the partial index usable.** The test forces each captured query with `INDEXED BY idx_photo_unsent_*`. That succeeds only because the query repeats the index's WHERE term; on main it is "no query solution".
- **If the team wants the planner to pick the partial index outright,** dropping the IN lists, as the audit originally proposed for uploadCounts, does that. It is equivalent, since `upload_state` is NOT NULL and typed `'pending'|'uploading'|'uploaded'|'error'`. I did not do it, because the task said to keep them.
- **`pendingUploadCount` is unchanged.** It already reads `task_id = ? AND upload_state <> 'uploaded'` and is served by `idx_photo_task_upload`.
- **The `remaining` count inside `uploadPending`** also got the term, since it is part of that function.

**Drizzle schema (`src/db/schema.ts`): left alone.** Its index declarations are not type-only, and they are already out of date: none of the v29 indexes are declared there. Nothing generates migrations from it; there is no drizzle-kit config.

#### Verification

##### Unit test
`docs/audits/perf/tests/f-sql-5-12.test.mjs` runs the app's own `initDatabase()`/`migrate()` on the fake expo-sqlite. It imports the real `listUploads`, `uploadSummary` and `uploadCounts` and captures the SQL they send by wrapping `getAllAsync` and `getFirstAsync` on the fake connection.

The tests:
1. `user_version is 39`
2. `v39 creates the four partial indexes` (exact definitions)
3. `v39 drops the four redundant indexes and keeps the wider ones`
4. `upload queries name upload_state <> 'uploaded' and keep their IN filters (source)`: uploadPending ×2, uploadCounts, choosePhotos, readFailedPhotos, plus pendingUploadCount unchanged.
5. `fresh install ...: no upload query scans every photo`: asserts 0 rows in `sqlite_stat1`.
6. `with statistics, listUploads / uploadSummary / uploadCounts ...`:
   - Seeds 6,000 photos, 90 % uploaded, then runs v39's `PRAGMA optimize(0x10002)`.
   - Checks the results against a `NOT INDEXED` ground truth.
   - Checks that failures still sort first.
   - Checks that each captured query can use both `idx_photo_unsent_*` indexes when forced with `INDEXED BY`.
   - Checks that no plan scans every photo, and that uploadSummary's plan uses `idx_photo_unsent_snag`.
   - For reference, on the same seed main's SQL plans `SCAN p USING INDEX idx_photo_snag` and `SCAN snag_photos`.

Results:
- Branch (`MOBILE_ROOT=<worktree> node --test f-sql-5-12.test.mjs`): `# tests 6`, `# pass 6`, `# fail 0`.
- Main (`node --test f-sql-5-12.test.mjs`): `# tests 6`, `# pass 1`, `# fail 5`. Test 5 also passes on main, because main has no statistics on a fresh install either.
- Smoke tests: `node --test harness-smoke.test.mjs harness-portal-smoke.test.mjs` gives `# pass 2`, `# fail 0`. Mobile smoke against the worktree gives `# pass 1`.

##### Type check and lint
- `npx tsc --noEmit -p .` in the worktree is clean (exit 0).
- `npx eslint` on the 5 changed files: 0 errors and 1 warning (`sendWithMedia.ts:70`, array-type). The same warning appears on main.

##### Harness (`docs/audits/perf/scripts/sqlite-plans.mjs`)
**Changes to the script (additive, CRLF kept):**
- `MOBILE_ROOT` is accepted as well as the existing `YFI_MOBILE`.
- `YFI_SQL=f-sql-5-12` swaps the six photo-query copies (Q12, Q12d, Q12e, Q14, Q14b, Q14e) for the branch's text. The block is clearly marked "Phase 1 F-SQL-5/12". Without the variable, main's copies run unchanged.
- New state U: an upgraded device. It applies v1–v38 to an empty DB, seeds it, runs ANALYZE (that is state B), then applies v39 on top of the data and times it.
- New state U2: the same with a plain ANALYZE instead of optimize.
- New plan dumps for U and U2.

**How the runs were done:**
- Main ran three times: main-1, plus main-2 and main-3 interleaved with the branch runs. The branch ran twice with the final variant (branch-2, branch-3).
- Each state is built fresh from that checkout's own migrations, so state A is that checkout's fresh install.
- A run took 3–5.5 minutes on this machine. Desktop noise was large: unrelated queries vary up to 2–3x between runs.

**Results:** median ms per run, listed run by run. Main B is main with real statistics. The branch has no B column; its "upgraded" state is U.

| query | main A (fresh install) | main B (stats) | branch A (fresh install) | branch U (upgraded, v39 applied) | branch U2 (plain ANALYZE) |
|---|---|---|---|---|---|
| Q14 listUploads 100 | 12.2 / 8.95 / 7.92 | **246.5 / 179.5 / 110.1** | 11.5 / 6.82 | **13.3 / 8.54** | 8.47 / 12.5 |
| Q14b uploadSummary | 3.38 / 1.76 / 1.73 | **152.0 / 90.7 / 84.6** | 3.09 / 1.42 | **1.85 / 1.42** | 0.80 / 1.82 |
| Q12 uploadCounts | 1.30 / 0.72 / 0.86 | 1.04 / 1.00 / 0.36 | 0.77 / 0.81 | 0.71 / 0.94 | 0.53 / 2.15 |
| Q12d uploadPending pick 10 | 2.92 / 0.72 / 0.76 | 2.11 / 2.11 / 1.86 | 2.57 / 1.41 | 2.65 / 1.38 | 1.35 / 2.60 |
| Q12e choosePhotos | 3.43 / 1.60 / 1.14 | 5.66 / 2.99 / 1.39 | 3.26 / 2.17 | 3.58 / 1.21 | 1.49 / 3.82 |
| Q14e readFailedPhotos | 1.51 / 0.67 / 0.82 | 2.37 / 1.58 / 1.02 | 1.02 / 0.85 | 1.06 / 0.97 | 0.98 / 0.94 |
| Q13b alerts unread count | 0.73 / 0.40 / 0.40 | 1.13 / 0.52 / 0.30 | **0.11 / 0.09** | 0.17 / 0.20 | 0.08 / 0.17 |
| Q13c alerts read_pending count | 0.70 / 0.55 / 0.37 | 1.31 / 0.80 / 0.27 | **0.02 / 0.02** | 0.03 / 0.04 | 0.02 / 0.03 |

Branch with full ANALYZE (its own state B): Q14 14.0 / 9.75 ms, Q14b 2.01 / 1.64 ms.

**Write paths:**

| measure | main | branch |
|---|---|---|
| First job download, empty child tables, median of 8 interleaved inside each main run: shipped vs v39 indexes | 847.7 vs 400.3 · 796.4 vs 361.6 · 404.8 vs 179.2 (2.1–2.3x faster, 8/8 pairs in main-1 and main-2) | branch shipped (= v39): 210.5 · 221.3 |
| Pull-apply of the whole big job (upserts), median of 3 | 461 / 258 / 354 | 373 / 315 |
| Cards snapshot + reconcile | 344 / 404 / 242 | 186 / 273 |
| captureSnag | 10.5 / 7.85 / 4.28 | 5.05 / 4.28 |
| setChecklistStatus | 4.72 / 3.17 / 2.01 | 2.26 / 1.56 |
| Fresh-install migrate | 167 / 118 / 123 | 84 / 60 |

**Regression check (state A, every timed query, median of main runs against median of branch runs):**
- Only two crossed the 1.3x and +0.5 ms flag: Q12d (0.76 → 1.41 ms) and Q12e (1.60 → 2.17 ms).
- Their plans are byte-identical between main and branch (`SEARCH idx_photo_upload` + temp B-tree), and the per-run spread on main alone is 0.72–2.92 and 1.14–3.43 ms. I read both as noise.
- Every other query was the same or faster.

#### Manual check for the team
**Upgraded device:**
1. Start with a phone on the current store build that has used the app for a while and has some photos waiting (turn on airplane mode, capture 3–4 photos on two defects).
2. Install this branch's build and open the app. The Metro or logcat log shows `[migrate] start: user_version=38, latest=39`, then `[migrate] applied v39`.
3. Open the Sync screen. The waiting defects are listed with failures first; the headline counts and the Jobs header pill match what was there before.
4. Turn airplane mode off. The photos upload, and the list and pill drop to zero.

**Fresh install:** the log should show `applied v39` on first launch, and capture and sync behave as before.

**Optional check with a dev build:**
- Run `SELECT tbl, idx FROM sqlite_stat1` after the upgrade. It should show rows for `snag_photos`, including `idx_photo_unsent_snag`, and for `alerts`.
- On a fresh install it should return none.

#### Behaviour change
- **None that users see.** Query results are identical (the test compares them against ground truth).
- **One-off migration cost.** On an upgraded phone, the first launch on this build builds the new indexes and analyzes `snag_photos`, `alerts` and any never-analyzed table. That is about 150–300 ms on desktop for a heavy device, so expect a few hundred ms to about a second on a mid-range phone, once.

#### Noticed but not changed
- **Statistics stay frozen between upgrades.** F-SQL-5 also suggests running `PRAGMA optimize` after a sync pass at most once a day. That is a separate code path, not part of this item. Without it, statistics stay as v39 left them until a table changes tenfold and some later optimize runs.
- **Other "not uploaded" counts without the term.** These are outside the list I was given: `sendWithMedia.ts:410` `photosWaiting`, `sendSoon.ts:101` (by snag), `authStore.ts:240` (the sign-out pending count). None regresses: `idx_photo_upload` and `idx_photo_snag_taken` remain. They could take the term later.
- **Drizzle schema is stale.** `src/db/schema.ts` still declares the four dropped indexes, and never declared the v29 ones. It is metadata only, since nothing generates migrations from it.
- **Harness comment is slightly off.** The header of `sqlite-plans.mjs` calls its copies "verbatim", but they omit the SQL comments, and `CHOOSE_PHOTOS` omits one comment line. That does not affect plans.

#### Open questions
- **Keep or drop the IN filters?** With the IN filters kept, the planner chooses `idx_photo_upload` over the new partial index for listUploads and uploadCounts. Both are fast and both read only unsent rows. If you would rather the partial index be chosen outright, drop the IN lists, which is semantically the same. Not done, because the item said to keep them.

#### `git -C <wt> show --stat HEAD`
```
commit 7261d02371e9a9e04301fb5a0fc16586abb3c879
Author: DanishAli232 <balochdanish2020@gmail.com>
Date:   Thu Oct 1 13:19:37 2026 +0500

    perf(p1): F-SQL-5 F-SQL-12 phone DB v39 indexes and statistics

    Migration v39 adds partial indexes over unsent photos and unread / pending
    alerts, drops four redundant indexes (three prefixes of v29 indexes, plus
    sync_state), and runs PRAGMA optimize(0x10002) so upgraded phones get
    statistics. The "not yet uploaded" queries add upload_state <> 'uploaded'.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 app/(app)/sync.tsx               |  6 +++++-
 src/db/migrations.ts             | 35 +++++++++++++++++++++++++++++++++++
 src/db/repositories/syncQueue.ts | 11 +++++++++--
 src/sync/sendWithMedia.ts        |  3 ++-
 src/sync/uploader.ts             | 15 +++++++++++----
 5 files changed, 62 insertions(+), 8 deletions(-)
```

Raw harness outputs (main-1..3, branch-1..3 as .txt and .json; branch-1 was an earlier analysis_limit+ANALYZE variant) and `summary.txt` are in the scratchpad `item5/` folder.

### 2.6 Item 6 · F-SQL-4 · All phone writes go through the transaction queue

- **Status:** done
- **Repo + branch:** mobile, `perf/p1-f-sql-4-tx-queue` (not pushed)
- **Worktree path:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\mobile-perf-p1-f-sql-4-tx-queue`
- **Commit hash:** `987259b21120013814b901edfcacd8895cf3223b`

#### Files changed
- `src/db/repositories/jobs.ts`: `attachPhoto` INSERT now goes through `transaction()`. `startArea` puts its UPDATE and `enqueue` in one transaction, which also makes it atomic.
- `src/sync/outbox.ts`: `markDone`, `markRejected`, `markRetry` (its read and write now share one transaction), `discardMutation`, `retryErrored`, `clearBackoff` and `pruneDone` each wrapped. `enqueue` stays bare because it is meant to run inside its caller's transaction.
- `src/sync/uploader.ts`: wrapped the `reclaimStranded` reset, the failure UPDATE, the `uploading` mark, the missing-file mark and `requeueFailedUploads`.
- `src/sync/alerts.ts`: wrapped `writeMeta`, the read_pending reset plus the trim (now one transaction), `markAlertRead`, `markAllAlertsRead`, the realtime DELETE and `clearAlerts` (both deletes in one transaction).
- `src/sync/offlinePack.ts`: wrapped the `local_path` UPDATE in `fetchPhoto` and the `pack_state` UPDATE.
- `src/sync/floorPlanCache.ts`: wrapped the `local_path` UPDATE.
- `src/features/auth/authStore.ts`: the sign-out pending check, path read and all 7 DELETEs now run in one transaction. Files are deleted only after it commits.
- `src/sync/push.ts`: wrapped `getDeviceId`'s INSERT, the `snag_code` updates and the two `markSyncedRows` updates (each runs only when it has work). The finding lists these but the item's list does not. They had to be wrapped for the guard to pass.
- `src/sync/sendWithMedia.ts`: wrapped the 3 `choosePhotos` state marks, the `uploading` claim and the offline reset to `pending`. Same reason as push.ts: listed in the finding, needed for the guard.
- `src/db/repositories/catalogue.ts`, `catalogueTree.ts`: wrapped `markDefectUsed`, a user-triggered write the guard found that the finding did not list.
- `scripts/check-db-writes.mjs` (new, Node, no deps): the guard script.
- `package.json`: adds the `"check:db-writes": "node scripts/check-db-writes.mjs"` script.

#### Summary
`withTransactionAsync` is not exclusive, so any `rawDb.runAsync` issued while a pull's BEGIN was open joined that transaction and rolled back with it. Every standalone write in `src/` now goes through the serial `transaction()` queue. The only exceptions are the pull-apply helpers and `enqueue`, which only ever run inside a transaction callback. I did not switch to `withExclusiveTransactionAsync`. A grep-style guard script now keeps it this way.

#### Deadlock audit (call sites of every wrapped function)
`transaction()` is a serial promise chain, so any wrapped function that is awaited from inside a transaction callback would deadlock. Method: I listed every `transaction(` callback in `src/` and checked what each one awaits. The files with callbacks are checklist.ts, jobs.ts (16 callbacks), alerts `storeAlerts`, freeSpace, pull.ts (7), the sendWithMedia photo outcome and the uploader success. Then I grepped every caller of each wrapped function.
- **What the callbacks call:** pull.ts imports only `@/db/client`, `@/lib/*`, `./loading` and `./localFiles`. None of those write to the database or call a wrapped function, so no pull apply can reach any of them. The jobs.ts and checklist.ts callbacks call only `rawDb` and `enqueue`. The uploader success callback calls `rawDb` and `enqueue`. The `storeAlerts`, freeSpace and sendWithMedia callbacks call only `rawDb`.
- **`attachPhoto`:** called from inspectionStore.ts:315 and :402, desnag.ts:153, and desnag/index.tsx:455 and :545. These are all plain async UI or store code, not inside a transaction. Safe to wrap.
- **`startArea`:** the only caller is area/[areaId].tsx:115 (`void startArea(...)`). Safe.
- **`markDone` / `markRejected` / `markRetry`:** called from push.ts (`push()` and `settlePush`) and sendWithMedia.ts:332. `settlePush` itself is called from `push()` and `sendUnlocked`, and neither of those is inside a transaction. The sendWithMedia photo-outcome transaction runs after `settlePush` returns, not around it. Wrapped directly, so no `markDoneIn(db)` variant was needed.
- **`retryErrored` / `clearBackoff` / `pruneDone`:** called from engine.ts:93, 165, 167, 279 and 352 and sendSoon.ts:137. engine.ts and sendSoon.ts contain no `transaction(` calls. Safe.
- **`discardMutation`:** called from sync.tsx:164 in a UI handler. Safe.
- **`enqueue`:** not wrapped. All 18 call sites are lexically inside a `transaction(` callback after this fix. On main, `startArea` was the one exception. The guard now checks every `enqueue(` call.
- **Uploader writers:** `uploadPending` is called from engine.ts:219 and `requeueFailedUploads` from review.tsx:174 and snag/[snagId].tsx:114. `uploadOne` and `reclaimStranded` are internal. None of these is inside a transaction.
- **Alerts writers:** `syncAlerts` and the mark functions are called from engine, the notifications screen and timers. `clearAlerts` is called from `signOut` before the wipe transaction, not inside it. `writeMeta` is called only from `syncAlerts`, outside the `storeAlerts` transaction.
- **`fetchPhoto`, `downloadJobPack`, `cacheFloorPlans`:** called from offlinePack, engine.ts:243, floorplan.tsx:197 and job/[id]/index.tsx:207. None is inside a transaction.
- **`getDeviceId`:** called from `push()` and `sendUnlocked` while the request body is being built, outside any transaction.
- **`markDefectUsed`:** called from CaptureSheet.tsx:369 (`void`). Safe.
- **`signOut`:** called from the UI. It awaits `clearAlerts`' transaction and then its own wipe transaction one after the other, not nested.
- **Runtime check:** test 4 below runs the wrapped writers back to back, then two copies at once alongside a sync transaction that succeeds and one that fails, under a 5 s deadline. It finishes in about 1.8 s.

#### Guard script
`node scripts/check-db-writes.mjs` (or `npm run check:db-writes`; add `--verbose` to list the allow-listed sites). It scans `src/` and `app/` and fails on:
- `rawDb.runAsync/execAsync/runSync/execSync` outside the body of a `transaction(` call. SELECT and PRAGMA statements without `=` count as reads and are skipped.
- any `enqueue(` call outside a `transaction(` body.
- a `transaction(` call written directly inside another one's body, which is a deadlock.

What it allows:
- Skipped files: `src/db/migrations.ts`, `client.ts` and `client.web.ts`.
- Allowed functions, each with a reason in the script: the pull.ts apply helpers (`writeMeta`, `markChildrenLoaded`, `reconcileCards`, `insertMany`, `reconcileDeletions`, `applyCatalogue`, `loadUnsentTasks`, `applyTaskDetail`, `applyAreas`), which are only reached from pull.ts transaction callbacks, and `outbox.enqueue`.

Limits, documented in the script header:
- "Inside" means lexically inside. A helper in another function that only runs inside a transaction has to be on the allow-list.
- It checks only the `rawDb` name.
- It cannot see a nested transaction reached through a function call.
- It recognises regex literals from the character before the slash.

Results:
- On main: 45 violations, including `startArea`'s bare `enqueue`.
- On the branch: `check-db-writes: ok (32 allow-listed write sites)`.

#### Verification
Test file: `C:\Users\Technisia\Documents\Prohelp-Work\Yalla Fixit\docs\audits\perf\tests\f-sql-4.test.mjs`. New fakes: `tests/fakes/f-sql-4-pull.mjs` and `tests/fakes/f-sql-4-engine.mjs`. It also reuses `fakes/api-offline.mjs`.

Tests:
1. `a photo saved while a sync transaction fails survives the rollback`: a pull-like `transaction()` writes, waits on a gate the test controls, then throws. `attachPhoto` is called while it is open. After the rollback, the test checks that the photo row exists. It also checks that the sync's own write was rolled back.
2. `an outbox markDone made while a sync transaction fails is kept`
3. `startArea's start and its outbox row land together, outside a failing sync`
4. `the wrapped writers run in sequence and side by side without deadlocking`: covers attachPhoto, startArea, markRetry, markRejected, retryErrored, clearBackoff, markDone, pruneDone, discardMutation, requeueFailedUploads, getDeviceId, markDefectUsed, markAllAlertsRead, clearAlerts, and enqueue inside a transaction. Deadline 5 s.
5. `sign-out wipes the job rows in one transaction when nothing is unsent`
6. `sign-out keeps everything when a photo is still to upload` (the unsent-work guard is still in place)
7. `the guard script passes on the app and catches what it is for`: runs the script on the app, then on a throwaway tree containing a bare write, a nested transaction and valid code that has braces inside SQL strings.

Results:
- **Main** (`MOBILE_ROOT=<main checkout>`): tests 1, 2, 3 and 7 fail. Test 1 fails with "the photo row was rolled back with the failed sync (evidence lost)". Test 3 fails with "started_at was rolled back". Test 7 fails because the script is missing.
  ```
  # pass 3
  # fail 4
  ```
- **Branch** (`MOBILE_ROOT=<worktree>`):
  ```
  # pass 7
  # fail 0
  ```
- **Smoke tests:** `node --test harness-smoke.test.mjs harness-portal-smoke.test.mjs` gives `# pass 2 # fail 0`. The mobile smoke test against the worktree gives `# pass 1 # fail 0`.
- **Other mobile tests in the folder** (f-off-1, f-sql-10, f-sync-3-4, f-sync-6, f-api-13), run against main and against this branch: same pass/fail counts and the same failure messages, with no timeouts. The only difference is a randomised "spread N" number in f-sync-3-4, which also varies from run to run on main.
- **tsc:** `npx tsc --noEmit -p .` is clean.
- **eslint** (changed files plus the script): 0 errors and 4 `array-type` warnings, the same 4 that main has (jobs.ts:30 and :316, push.ts:30, sendWithMedia.ts:70).

#### `git -C <wt> show --stat HEAD`
```
commit 987259b21120013814b901edfcacd8895cf3223b
    perf(p1): F-SQL-4 send every phone write through the transaction queue

 package.json                         |   3 +-
 scripts/check-db-writes.mjs          | 279 +++++++++++++++++++++++++++++++++++
 src/db/repositories/catalogue.ts     |  12 +-
 src/db/repositories/catalogueTree.ts |  14 +-
 src/db/repositories/jobs.ts          |  82 +++++-----
 src/features/auth/authStore.ts       |  25 ++--
 src/sync/alerts.ts                   |  74 ++++++----
 src/sync/floorPlanCache.ts           |   9 +-
 src/sync/offlinePack.ts              |  19 +--
 src/sync/outbox.ts                   |  78 ++++++----
 src/sync/push.ts                     |  54 ++++---
 src/sync/sendWithMedia.ts            |  32 ++--
 src/sync/uploader.ts                 |  52 ++++---
 13 files changed, 545 insertions(+), 188 deletions(-)
```

#### Manual check for the team
1. **Photo during a failing sync.** On a dev build with a job that has some snags, start a sync (Sync now). While it applies, capture a snag with 2 to 3 photos. To force the failure, temporarily `throw` inside `reconcileCards` in a dev build. Expected: the sync shows its error, and the new snag still shows all of its photos after reopening the job and after relaunching the app. On main the photo tiles can disappear.
2. **Opening a room.** Open a room for the first time with the device offline. Expected: the Sync screen shows exactly one queued change for the area, and the start time reaches the portal once the device is back online.
3. **Sign-out.** Sign out with nothing pending. Expected: the job list is empty after the next sign-in, until a pull runs. Sign out again with one photo still waiting for signal. Expected: nothing is wiped.
4. **Guard.** Run `npm run check:db-writes` in the repo root. Expected: `ok`.

#### Behaviour change
- A write that runs while a sync transaction is in progress now waits for that transaction to finish, measured at about 150 to 250 ms on a phone (see F-SQL-3), instead of joining it. A sync that fails no longer undoes the write.
- `startArea` and the sign-out wipe are now all-or-nothing. On sign-out, the "anything unsent?" check runs in the same transaction as the deletes. Photo and plan files are deleted only after the rows are gone.
- `markRetry` reads and updates `attempts` in one transaction.
- There are no API or payload changes.

#### Noticed but not changed
- **Merge conflict ahead:** F-SYNC-3/4 (item `f-sync-3-4.test.mjs`) changes `markRetry` in `src/sync/outbox.ts`. Expect a textual conflict there. To resolve it, keep that item's backoff change inside the `transaction(async () => { ... })` body.
- `settlePush` still runs `markDone`, `markSyncedRows` and the `snag_code` updates as separate transactions, so a crash between them can leave a snag on "queued" until the next pull. That is no worse than before, and making them one transaction would need `...In(db)` variants.
- Fire-and-forget calls such as `void refreshJob(...)` from inside transaction callbacks would only wait in the queue, not deadlock. I did not change them.

#### Open questions
None.

### 2.7 Item 7 · F-SYNC-3 / F-SYNC-4 (minimal): a timeout is "slow", not "offline"; jitter

> **Reviewer follow-up (commit `6acb9bc`).** The open question at the end of this section is resolved. A timeout on the snag-history panel would have changed its caption from "needs a connection" to "This defect has only been seen on this visit", a regression the fix introduced. `SnagHistory.tsx` now treats `TimeoutError` like `OfflineError`, as before. Type-check and lint are clean; `f-sync-3-4.test.mjs` still passes 13/13 on the branch.

- **Status:** done (one open question, below: a timeout on the snag-history panel now gets the wrong caption)
- **Repo + branch:** mobile, `perf/p1-f-sync-3-4-timeout-jitter`
- **Worktree path:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\mobile-perf-p1-f-sync-3-4-timeout-jitter`
- **Commit:** `6accf01ac530af38c0c6691f5aaf55a4d6738cdc`

#### Files changed
- `src/lib/api.ts`: new `TimeoutError extends ApiError` (status 504, retryable, the same 504 the uploader already uses for its own timeout). It is thrown when `controller.signal.aborted`, and only our timer ever aborts. A dropped connection or DNS failure still throws `OfflineError`. New optional `ApiError.retryAfterMs`, parsed from `Retry-After` (seconds or HTTP date) on 429/503 only.
- `src/lib/jitter.ts` (new, 29 lines): `retryDelay(base, retryAfterMs?)` returns full jitter in [1 s, base], or the Retry-After value clamped to [1 s, 1 h]. `around(ms, 0.2)` returns ±20%. It is a new file because three modules (outbox, engine, alerts) share it.
- `src/lib/config.ts`: comment only. The `retryDelays` values are unchanged and are now upper bounds.
- `src/sync/outbox.ts`: `markRetry` takes an optional `retryAfterMs`, and its delay is now `retryDelay(base, retryAfterMs)`.
- `src/sync/push.ts`: passes `retryAfterMs` to `markRetry`. The comment now says a timeout backs off. The branch logic did not need to change: `TimeoutError` is a retryable `ApiError`, so it already goes down the `markRetry` path.
- `src/sync/sendWithMedia.ts`: same `markRetry` change. Adds an adaptive bundle budget: the pure exported `nextBundleBudget(prev, 'timeout'|'success')` plus a module-level `bundleBudget` (in memory only). `choosePhotos` breaks on `bundleBudget.bytes` instead of `MAX_BUNDLE_BYTES`, and only once one photo is already chosen, so the 500 KB floor never strands a single larger photo. At the full 3.5 MB budget this is the same as before, because a single photo (at most 2.5 MB) always fit.
- `src/sync/engine.ts`: `setInterval(5 min)` becomes a `setTimeout` that re-arms itself with `around(5 min)` (4 to 6 min). `clearInterval` becomes `clearTimeout`. The `if (!timer)` launch guard still works, because the timer stays set while the engine runs.
- `src/sync/alerts.ts`: when a catch-up fails, the code used to set `lastSyncAt = 0`, so the next rejoin, focus or reconnect went straight away. Now a server-side failure sets `retryNotBefore` to 30 s, then 2 min, then 10 min (each ±20%), and only unforced calls respect it. A request that succeeds resets the backoff. `OfflineError` keeps the old behaviour (`lastSyncAt = 0`), so coming back into signal still catches up at once.
- `src/sync/uploader.ts`: one comment line. No logic change was needed: a `TimeoutError` from the sign call is not `OfflineError`, so the photo now gets `next_attempt_at` and the batch keeps going instead of stopping as "offline".

#### Summary
A request timeout used to throw `OfflineError`. As a result nothing backed off, the 3.5 MB bundle was re-sent unchanged on every pass, and pull timeouts set the status to "offline". Now a timeout is a retryable `TimeoutError`:
- push and the snag bundle back their rows off, with jitter;
- the user sees the existing "The office system is busy" wording;
- the next photo bundle is halved after a timeout and doubles back after 3 bundles that get through.

Retries use full jitter and honour Retry-After. The 5-minute pass and the alerts failure retry are spread out.

**Why the budget helper is exported:** `nextBundleBudget` is a pure function, so the halve/floor/recover sequence can be tested without a reset hook. The real request path is tested separately (test 7), and that test does not need a reset because it starts from the module's fresh state.

#### Verification
Test file: `docs/audits/perf/tests/f-sync-3-4.test.mjs`. It stubs global `fetch`, shrinks the long request timers to 5 ms so the real abort path runs, and uses the real migrations on the fake expo-sqlite.

| # | Test | main | branch |
|---|---|---|---|
| 1 | (a) a request that times out throws TimeoutError (retryable), not OfflineError | FAIL ("got OfflineError") | pass |
| 2 | (a) a lost connection is still OfflineError | pass (guard) | pass |
| 3 | (a) push: a timeout backs the batch off (next_attempt_at set) | FAIL | pass |
| 4 | (a) push: lost signal still leaves the rows ready to go | pass (guard) | pass |
| 5 | (a) engine: a timeout is not reported as offline (`refreshLatest` → not 'offline', lastError = serverBusy) | FAIL | pass |
| 6 | (b) nextBundleBudget halves to a 500 KB floor and doubles back after 3 successes | FAIL | pass |
| 7 | (b) sendWithMedia: a timeout backs the rows off, and the next bundle carries half the photos until 3 get through (photos per request 8 → 4,4,4 → 8) | FAIL | pass |
| 8 | (b) one photo always goes, however small the budget | pass (guard) | pass |
| 9 | (c) markRetry waits a random time in [1 s, base], spread across the range (200 samples per attempt) | FAIL ("spread 40 too narrow") | pass |
| 10 | (c) retryDelay stays in [1 s, base] over many samples; Retry-After overrides; around() within ±20% | FAIL (no jitter.ts) | pass |
| 11 | (c) a 503 with Retry-After: 120 is exposed on ApiError and backs the rows off by 120 s | FAIL | pass |
| 12 | (c) a 400 never carries Retry-After; an HTTP-date form is read too | FAIL | pass |
| 13 | (c) alerts: after a server failure the next unasked catch-up waits (30 s ±20%, then 2 min ±20%) instead of going at once; a forced one still goes | FAIL | pass |

```
main:   # tests 13  # pass 3   # fail 10
branch: # tests 13  # pass 13  # fail 0
```
- Harness smoke test (`harness-smoke.test.mjs`): `# pass 1 # fail 0`. The harness was not modified.
- `npx tsc --noEmit -p .` in the worktree: clean, no output.
- `npx eslint` on the 9 changed files: 0 errors and 2 warnings (`array-type` at push.ts:30 and sendWithMedia.ts:97). The main checkout shows the same 2 warnings on the same lines (push.ts:30, sendWithMedia.ts:70), so both are pre-existing.
- Line endings: CRLF is kept in engine.ts, outbox.ts and uploader.ts (`git ls-files --eol` shows i/crlf w/crlf). The other files are LF.

#### Manual check for the team
1. **Throttled uplink.** Use a device or simulator with Network Link Conditioner (or an Android emulator network profile) set to about 0.2 Mbps up and 300 ms latency. Queue a snag with 8 or more photos offline, then go "online" on the slow profile and tap Sync now. Expected:
   - the pill or toast never says "No connection"; on a timeout a non-silent sync shows "The office system is busy. Tap to try again.";
   - in the network log, each later `/api/snagging/sync/snag` request carries fewer `photo:` parts (half, then a quarter, down to 1 to 2 photos at 500 KB);
   - the outbox rows show `attempts` going up and `next_attempt_at` set;
   - photos drain over a few passes instead of the same 3.5 MB being re-sent.
2. **Recovery.** Restore a normal network. After 3 photo bundles get through, the bundle size grows back (doubles every 3 successes, up to 3.5 MB).
3. **Timer spread.** Leave the app idle in the foreground and log the times of the `/sync/jobs` or `/sync/snag` requests. The gaps should vary between about 4 and 6 minutes instead of exactly 5.
4. **Alerts backoff.** Make `/api/snagging/sync/alerts` return 500 on a staging build (or block it with a proxy), open the Alerts tab, then switch tabs and come back within 30 s. There is no second request until about 24 to 36 s have passed. Pull-to-refresh on the tab still sends at once.

#### Behaviour change
- A timed-out request now shows the "server busy" wording, through `describeError`, instead of "No connection". This applies anywhere a screen shows a failed `apiRequest`. Pull-to-refresh on Jobs shows the busy toast instead of the offline toast.
- After a timeout or a 5xx, outbox rows wait a random time between 1 s and the attempt's delay (5/15/60/300 s) instead of exactly that delay. A 429/503 with Retry-After waits what the server asked for (clamped to [1 s, 1 h]).
- After a timeout, the snag bundle is smaller for a while. Photos that do not fit simply wait for the next request.
- The background sync fires every 4 to 6 minutes instead of every 5.
- After a server failure, an alerts catch-up nobody asked for (rejoin, focus, reconnect) waits 30 s, then 2 min, then 10 min. A forced one (tap or read) is unchanged. Lost signal still retries at once, as before.

#### Noticed but not changed
- `src/features/inspection/SnagHistory.tsx:83`: `setOffline(error instanceof OfflineError)`. After this change, a timeout there shows the caption "This defect has only been seen on this visit." instead of "The history needs a connection…". That caption is wrong for a timeout. See the open question.
- `src/lib/errors.ts:59-65`: the raw-text fallback still maps messages containing "timeout"/"timed out" to `offline`. It only applies to errors that are not an `ApiError` (for example a storage-client error), so `TimeoutError` never reaches it. I left it alone.
- `src/sync/uploader.ts:197`: `RETRY_DELAYS_MS` (30 s to 60 min) has no jitter. Not in this item's scope.
- `src/sync/engine.ts:351-355`: reconnect still runs `clearBackoff` + `syncNow` + `syncAlerts` immediately, with no U(0,10) s delay. The first pass at launch has no random offset. There is no circuit breaker and no adaptive 600/900 s idle interval. These are the larger parts of F-SYNC-4/5.
- After a bundle times out, its photos go back to `pending` without a `next_attempt_at` (as before). They retry on the next pass at the smaller budget.
- The budget is in memory only and not per network type (the audit suggested persisting it). Timeouts are still fixed (60 s push, 120 s bundle, 120 s upload), and there is no streaming, TUS or progress UI, as the brief asked.
- `alerts.ts:477`: every Realtime `SUBSCRIBED` still calls `syncAlerts()`. It is throttled to 20 s, and now also subject to the failure backoff.
- `npx prettier --check` with default settings flags all 8 existing files (the repo has no prettier config, and the defaults expect double quotes). This was already the case before my change.

#### Open questions
- **SnagHistory caption on a timeout:** should a timeout there keep the "needs a connection" caption? The brief limited `instanceof OfflineError` changes to the send/upload/status paths, so I did not change it. The one-line fix is `setOffline(error instanceof OfflineError || error instanceof TimeoutError)` in `SnagHistory.tsx:83`. I recommend taking it, or adding a "slow connection" caption.

#### `git -C <wt> show --stat HEAD`
```
commit 6accf01ac530af38c0c6691f5aaf55a4d6738cdc
Author: DanishAli232 <balochdanish2020@gmail.com>
Date:   Thu Oct 1 12:56:18 2026 +0500

    perf(p1): F-SYNC-3/F-SYNC-4 timeout is slow not offline; jittered retries

    A timeout throws TimeoutError (retryable 504 ApiError): rows back off, the
    pill says busy not offline, and the next photo bundle halves (500 KB floor,
    grows back after 3 successes). Outbox retries use full jitter + Retry-After;
    the 5-min pass is spread +-20%; failed alerts catch-up backs off 30s/2m/10m.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 src/lib/api.ts            | 39 ++++++++++++++++++++++++++++++++++--
 src/lib/config.ts         |  5 ++++-
 src/lib/jitter.ts         | 29 +++++++++++++++++++++++++++
 src/sync/alerts.ts        | 28 +++++++++++++++++++++++---
 src/sync/engine.ts        | 24 ++++++++++++++++-------
 src/sync/outbox.ts        | 10 ++++++++--
 src/sync/push.ts          | 10 ++++++++--
 src/sync/sendWithMedia.ts | 50 ++++++++++++++++++++++++++++++++++++++++-------
 src/sync/uploader.ts      |  1 +
 9 files changed, 172 insertions(+), 24 deletions(-)
```

### 2.8 Item 8 · Security access checks (portal)

#### 8b · `/media/sign` on a job with no lead inspector

- **Status:** done
- **Repo + branch:** portal, `perf/p1-sec-2-media-sign-access`
- **Worktree path:** `C:\Users\Technisia\Documents\Prohelp-Work\_perf-wt\portal-perf-p1-sec-2-media-sign-access`
- **Commit hash:** `96690f7` (96690f711e50f98658b449ecb2ab606f1525333f)

**Files changed**
- `app/api/snagging/media/sign/route.ts`: removed the `job.inspector_id &&` short-circuit that let any Edit user through on a lead-less job. Callers who are not the lead, not admin, and fail `mayWriteJob` now get 403, unless the job is unassigned (no lead and an empty roster via `loadJobRosters`) and they hold Snagging Approve.

**Summary**
The check reuses the existing helpers: `mayWriteJob` (roster, live-visit inspector, visit crew, room holder) and `loadJobRosters` for the "nobody is on it" test. The roster read only runs on the deny path, so the cost for a legitimate inspector is unchanged. The request and response shapes are unchanged. The 403 body is the same one as before.

**Callers**
- Mobile: `src/sync/uploader.ts:294` is the only caller (photo and video uploads). It always sends the snag's `task_id`, which is the job the inspector is working.
- Portal: **no caller.** Grepping `media/sign`, `api/snagging/media`, `createSignedUploadUrl` and `uploadToSignedUrl` across `app`, `components`, `lib`, `modules` and `hooks` finds only the route itself. Floor plans (`/api/snagging/floor-plans`), documents, NOC and gate pass upload server-side through their own routes. No office flow uses this route, so no portal flow is blocked.

**Verification**
- Test file: `docs/audits/perf/tests/sec-2-media-sign.test.mjs`. It uses the recording fake supabase. The responder returns job lead rows and `snagging_job_inspectors` roster rows filtered by job id, plus empty visit, crew and room counts.
  1. assigned inspectors are allowed (lead, and a co-inspector on the roster)
  2. an unrelated inspector gets 403 on a job with a lead
  3. an unrelated inspector gets 403 on a job with no lead but a roster
  4. admin is allowed on any job
  5. unassigned job: edit-only inspector 403, Approve holder allowed
  6. Approve does not open a job someone is already on
- Main: `# pass 3` / `# fail 3` (tests 3, 5 and 6 fail: on main the unrelated, edit-only and Approve callers all get 200)
- Branch (`PORTAL_ROOT=<worktree>`): `# pass 6` / `# fail 0`
- Harness smoke (`harness-smoke` + `harness-portal-smoke`): `# pass 2` / `# fail 0`
- tsc (temp tsconfig, route file only): exit 0, clean. Temp file deleted.
- eslint on the route: exit 0, clean.

**Manual check for the team (staging)**
1. Create a job with no inspector. As an inspector with Snagging View+Edit who is not on it, `POST /api/snagging/media/sign` with `{task_id, media_id: <uuid>, content_type: "image/jpeg"}`. Expect 403 "Not assigned to this inspection" (main gives 200).
2. Same job, as a non-admin with Snagging Approve: expect 200.
3. Assign the inspector (roster), then retry step 1: expect 200. On the phone, capture a photo on that job and let it sync. The upload should succeed.

**Behaviour change**
On a job with no lead, an Edit user who is not on the roster, the live visit, the visit crew or a room can no longer get an upload URL. On a job with no lead but some roster members, Approve holders who are not on it are now refused too (previously anyone with Edit got through). Admins, leads and everyone `mayWriteJob` accepts are unaffected. If an inspector is taken off a lead-less job while photos are still queued on their phone, those uploads now get 403. That matches the push, which already refuses their photo records through `mayWriteJob`.

**Noticed but not changed**
- The older comment above the check ("An inspector may only add evidence to their own job...") still stands. I added a short new block comment rather than rewriting it.
- On the deny path `mayWriteJob` and `loadJobRosters` both read the job's lead and roster, which is about 2 extra queries. This only happens on a 403, so I left it.

`git -C <wt> show --stat HEAD`:
```
commit 96690f711e50f98658b449ecb2ab606f1525333f
Author: DanishAli232 <balochdanish2020@gmail.com>
Date:   Thu Oct 1 12:48:32 2026 +0500

    perf(p1): sec-2 require job membership for media/sign on a lead-less job

    A job with no inspector_id used to hand an upload URL to anyone with
    Snagging edit. Now the caller must be admin, the lead or pass mayWriteJob;
    a job nobody is on yet (no lead, empty roster) is open to Approve only.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 app/api/snagging/media/sign/route.ts | 14 +++++++++++---
 1 file changed, 11 insertions(+), 3 deletions(-)
```

---

#### 8a · Defect history needs a job-membership check

- **Status:** needs-decision (not implemented, no branch or worktree created)
- **Repo + branch:** portal, `perf/p1-sec-1-history-access` (to be created once a decision is made)

**Callers**
- Mobile: `src/features/inspection/SnagHistory.tsx:79`, rendered on `app/(app)/job/[id]/inspect/snag/[snagId].tsx:503` and `.../verify/[snagId].tsx:496`. The caller is the inspector working that job or round. The membership check would not affect these callers.
- Portal: `components/dashboard/snagging/snag-history.tsx:51`, rendered as the "Status history" card in the snag dialog of `snag-walk-list.tsx:1230`. That list is used on:
  - `app/(dashboard)/snagging/[id]/page.tsx` (inspection detail), gated by `canViewSnagging()`, which means **Snagging View only**;
  - `app/(dashboard)/snagging/[id]/visits/[visitId]/page.tsx` and `.../desnag/page.tsx`, both View-gated;
  - `review-workspace.tsx` (`/snagging/review`). Its actions require Approve, so reviewers are fine.
- The data routes behind the job page (`GET /api/snagging/tasks/[id]`, `GET /api/snagging/tasks/[id]/snags`) check only Snagging View and have no membership check. In the portal, View means "may read every job".

**Why I stopped**
As specified (admin, Approve, or on the snag's job family), the check would block legitimate portal users. An office user with Snagging View or View+Edit but no Approve, who is not on the roster (for example a coordinator who books and assigns jobs), can open any job page today. Opening a defect would show "Forbidden" in the Status history card, while every other part of the same page, including the snag itself, still loads. Rule 10 and the item's own instruction both say to stop in this case.

**Exactly what I would change (pick one)**

- **Option A (recommended): check membership only for app callers.** The app does not use the portal's read-everything model; the portal is unchanged. In `app/api/snagging/snags/[id]/history/route.ts`, take `origin` from `getRequestUserAccess(req)`. After `const family = await loadJobFamily(admin, snag.job_id)`, add:
  ```ts
  /*
    The app only shows a defect to the people on its job. The portal's
    job pages show every job to anyone with view access, so they keep it.
  */
  if (
    origin === "mobile" &&
    !isAdminUser(accessUser) &&
    !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.APPROVE)
  ) {
    const rosters = await loadJobRosters(admin, family.allIds);
    const onFamily =
      family.allIds.some((jobId) => rosters.get(jobId)?.has(profile.id)) ||
      (await mayWriteJob(admin, snag.job_id as string, profile.id));
    if (!onFamily) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ```
  `loadJobRosters` over the family covers the lead and roster of the original job and every round or visit. `mayWriteJob` on the snag's own job adds the live-visit inspector, visit crew and room holders, so a second crew member on a booked visit is not blocked. Caveat: a user who signs in to the portal with a cookie session can still read any job's snags, as today. That is the portal's View model, not something this route can close by itself.
- **Option B: the same check for all callers, also allowing Snagging Edit.** This keeps coordinators working but still blocks View-only office users (managers or operations who only browse).
- **Option C: as written in the item** (admin, Approve, or family for everyone). This blocks View and View+Edit office users on the job pages. It would only make sense together with a membership check on `/tasks/[id]` and `/tasks/[id]/snags`, which is a product change to the portal's access model.

**Planned test** (`sec-1-history.test.mjs`, to be written once the option is chosen): the fake supabase answers the snag row, the family (`snagging_jobs` with a children embed), the lead and roster rows, and the legs and verdicts. Cases: assigned inspector 200, unrelated inspector 403 (200 on main), admin 200, Approve holder 200. With option A, also a portal-origin View-only caller 200 (so the portal is shown to be unchanged).

**Open questions**
1. Which option for 8a: A (app-only membership check, portal unchanged), B (all callers, Edit also allowed), or C (as written, which blocks View and Edit office users on job pages)?
2. Separately: should portal Snagging View keep meaning "may read every job"? If not, `/tasks/[id]`, `/tasks/[id]/snags` and the job pages need the same check. That would be a larger access-model change than this item.

### 2.9 Item 9 · F-API-1: pin the API region (skipped)

- **Status:** skipped. `SUPABASE_REGION` and `VERCEL_FUNCTION_REGION` were left blank, so whether they match cannot be checked. Run `docs/audits/perf/scripts/api-latency.mjs` on staging first: it prints the `x-vercel-id` header, which names the function's region.
- **Shared deployment:** yes. The same Next.js project serves Snagging (58 routes under `app/api/snagging/`) plus scheduling, AMC, to-dos, users and settings. A `vercel.json` `"regions"` entry would move every function in the project, so the per-route option below is the safer first step. No snagging route sets `runtime`, `preferredRegion` or `maxDuration` today, except `sync/snag`, which sets `runtime = "nodejs"`.
- **Ready to apply once the regions are confirmed:** add one line to each of the 58 `app/api/snagging/**/route.ts` files, next to the imports:

  ```ts
  // Run beside the database: every Supabase call from here is a round trip.
  export const preferredRegion = "<VERCEL_FUNCTION_REGION>";
  ```

  If the team prefers one switch for the whole project instead, use `vercel.json` at the repo root:

  ```json
  { "regions": ["<VERCEL_FUNCTION_REGION>"] }
  ```

- **Choosing the value:** use the Vercel region in the same AWS region as the Supabase project:

  | Supabase | Vercel |
  |---|---|
  | ap-south-1 | bom1 |
  | ap-southeast-1 | sin1 |
  | eu-central-1 | fra1 |
  | eu-west-2 | lhr1 |
  | us-east-1 | iad1 |

  Check the current list in the Vercel dashboard before committing.
- **Verification once applied:** run `api-latency.mjs` against staging. `x-vercel-id` should show the chosen region, and p95 should drop below 1 s on `sync/jobs`, `sync/job/{id}?view=detail` and a single-defect `sync/snag`. The audit predicts ≈220 ms → single-digit ms per database call if the mismatch is real.

### 2.8a 8a · Defect history: option A (done)

- **Status:** done. Branch `perf/p1-sec-1-history-access`, commit `987f6d1`, merged into `dev`.
- **File changed:** `app/api/snagging/snags/[id]/history/route.ts`. After the job family is loaded, a request from the inspector app (`origin === "mobile"`, i.e. a bearer token) must come from an admin, an Approve holder, or someone on the family. That means the lead or roster of the job or any of its rounds or visits (`loadJobRosters`), or the live visit's inspector or crew, or a room holder (`mayWriteJob`). Portal (cookie) requests are unchanged: Snagging View still reads any job, as the job pages do.
- **Verification:** `sec-1-history.test.mjs`. Main 3/4 (an unrelated inspector using the app is served); branch 4/4. The cases are: lead, roster member and room holder served; unrelated inspector 403; admin and Approve holder served; a portal View-only user still served. Per-file tsc and eslint clean.
- **Manual check:**
  - Sign in on the phone as an inspector who is not on a job. Calling `GET /api/snagging/snags/<snag id on that job>/history` with their token returns 403.
  - The same call by that job's inspector returns the legs.
  - In the portal, a coordinator with View only opens the job, then a defect; the Status history card still loads.
- **Behaviour change:** only for app requests by inspectors who are not on the job, who could never reach these screens in the app anyway.

## 3. Migrations to apply on staging first

### 3.1 Postgres: `supabase/migrations/20261001120800_area_status_write_only_on_change.sql` (branch `perf/p1-f-db-8-area-status-trigger`)

Not applied anywhere. It is idempotent: two `create or replace function` statements, `security definer` and `search_path` kept, triggers not recreated. Apply to staging with the team's normal migration flow, then run these checks inside `begin; … rollback;` (the full script is in the file's header comment):

```sql
begin;
-- A: a second snag in an area that already has a live snag must not rewrite the area
select ctid, xmin, status, updated_at from snagging_areas where id = :area;   -- note values
update snagging_snags set status = status where id = :live_snag_in_area;      -- fires the trigger
select ctid, xmin, status, updated_at from snagging_areas where id = :area;   -- expect all four unchanged
-- B: the first snag in an empty, unconfirmed area still sets has_snags
--    (insert a test snag into :empty_area; status becomes 'has_snags', ctid/xmin change)
-- C: withdrawing that last live snag reverts the status
update snagging_snags set status = 'withdrawn' where snag_code = 'TEST-S998';
select status from snagging_areas where id = :empty_area;                     -- expect 'pending' (or 'clear' if confirmed)
rollback;
```

Pass: A leaves ctid/xmin/updated_at unchanged; B and C change status exactly as before. With `auto_explain.log_nested_statements = on`, A logs `Update on snagging_areas` with 0 rows.

### 3.2 Phone SQLite: migration v39 (branch `perf/p1-f-sql-5-12-v39-indexes`)

This is not a server migration. It runs on each phone the first time the new app build starts, inside its own transaction, like every other phone migration. It adds 4 partial indexes, drops 3 prefix indexes and refreshes statistics with `PRAGMA optimize(0x10002)`. The bundled SQLite is 3.49 or newer, and 0x10000 needs 3.46. Expect a one-off few hundred ms to about 1 s on a heavy, mid-range phone at that first launch. Check it on a test device by upgrading a build that has data, then confirm `PRAGMA user_version` is 39 and the Sync screen opens normally.

## 4. Behaviour changes anyone should know about

| Item | Who notices | What changes |
|---|---|---|
| 1 F-OFF-1 | Inspectors | A failed "Download for offline" now shows "No connection, so nothing was downloaded" (or the busy message) and the job stays un-packed, instead of falsely saying "Ready for offline". The Download button is disabled while offline, with "Needs a connection to download." |
| 4a F-API-13 | Inspectors | "Mark all read" now clears every unread alert on the server, not just the 200 or fewer on the phone. A mark-all made offline is sent later, even after a restart. |
| 4c F-SYNC-6 | Inspectors | A notification deleted on the server no longer disappears from the phone at once. It stays until the 200-alert trim pushes it out. The catch-up does not remove deleted alerts. The badge count still corrects itself at the next sync. |
| 6 F-SQL-4 | Nobody visibly | A write made during a sync now waits for that sync transaction (≈150–250 ms) instead of joining it, so a failed sync can no longer undo it. Sign-out's "anything unsent?" check and the wipe are one transaction. |
| 7 F-SYNC-3/4 | Inspectors | A timed-out request shows "The office system is busy. Tap to try again." instead of "No connection". The history panel still says it needs a connection. Retries wait a random 1 s–base delay. Background sync fires every 4–6 min instead of every 5. A failed alerts catch-up backs off 30 s, then 2 min, then 10 min. After a timeout, smaller photo bundles are sent for a while. |
| 8b media/sign | Office (edge case), inspectors | On a job with no lead inspector, only people on the job (roster, live visit, visit crew, room holder) or admins can get an upload URL. If nobody is on the job yet, Approve holders can too. The only caller is the phone uploader; no portal flow uses this route. An inspector removed from a lead-less job gets 403 for still-queued photos, which matches how the push already refuses their photo records. |
| 3 F-DB-8 | Nobody visibly | A room is no longer rewritten (and no longer counts as "changed" for phone sync) on every defect write, only when its status really changes. Card room counts come from `confirmed_at`, so the cards are unaffected. |
| 2, 4b, 4d, 5 | Nobody | No visible change. Fewer rows re-sent after a submit; the history query uses its index; the checklist shows each item once; local queries are faster. |

## 5. Merge notes

The branches are independent and each is based on `main`. A few touch the same files:

| File | Branches | Expect |
|---|---|---|
| `src/sync/outbox.ts` (`markRetry`) | F-SQL-4, F-SYNC-3/4 | Textual conflict. Keep F-SYNC-3/4's jittered delay inside F-SQL-4's `transaction(async () => { … })` block. |
| `src/sync/alerts.ts` | F-API-13, F-SYNC-6, F-SQL-4, F-SYNC-3/4 | Different hunks; mostly trivial. With F-SQL-4 merged, make sure F-API-13's new `sync_meta` writes go through `transaction()`. Run `npm run check:db-writes` (added by F-SQL-4) after merging. |
| `src/sync/uploader.ts`, `sendWithMedia.ts`, `push.ts` | F-SQL-4, F-SYNC-3/4, F-SQL-5/12 | Small overlaps (query text vs transaction wrappers vs error handling). Re-run the tests listed in section 1 after each merge. |
| `src/sync/offlinePack.ts` | F-OFF-1, F-SQL-4 | Different hunks. |
| `app/api/snagging/snags/[id]/history/route.ts` | F-DB-11 (and 8a when decided) | Trivial. |

Suggested merge order: F-OFF-1 → F-SQL-10 → F-SYNC-6 → F-SQL-5/12 → F-SQL-4 → F-SYNC-3/4 → F-API-13 (mobile); F-DB-7 → F-DB-11 → sec-2 → F-API-13 → F-DB-8 (portal, the last only after the staging check in 3.1).

## 6. Noticed but not changed

- **Portal, the mirror of F-DB-7:** `app/api/snagging/tasks/[id]/reject/route.ts:93-96` and `tasks/[id]/visits/[visitId]/review/route.ts:112` unlock every snag with no `locked = true` filter.
- **F-DB-8 leftovers:** the concurrent-withdrawal race and the lock serialisation remain. Making the self-trigger a BEFORE trigger would remove its second write, but that recreates the trigger.
- **F-API-13:** a mark-all on thousands of alerts makes Realtime send one UPDATE event per row to the inspector's devices. Debounce the handler or skip rows already read locally.
- **F-SYNC-6:** server-side deletions never reach the phone's alert list; it needs deletions-as-data (soft delete or tombstones). A stale alert may open a job that no longer exists.
- **F-SQL-10:** the checklist order has no unique tie-breaker (`ORDER BY created_at, sort_order`).
- **F-SQL-5/12:**
  - Statistics are only refreshed at the v39 upgrade; a periodic `PRAGMA optimize` after sync is a separate change.
  - Three more "not uploaded" counts could take the `upload_state <> 'uploaded'` term: `sendWithMedia.ts:410`, `sendSoon.ts:101`, `authStore.ts:240`.
  - `src/db/schema.ts` (Drizzle) still lists dropped indexes. It is metadata only.
- **F-SQL-4:**
  - `settlePush` runs `markDone`, the synced flags and the code updates as separate transactions, as before.
  - Fire-and-forget `void refreshJob(...)` calls inside transaction callbacks only queue; they do not deadlock.
- **F-SYNC-3/4, the larger parts left for later:**
  - no jitter on uploader retries or on reconnect;
  - no circuit breaker or adaptive idle interval;
  - the bundle budget is not persisted;
  - the `errors.ts` text fallback still maps "timeout" text to offline, for non-API errors only.
- **F-OFF-1:**
  - A job already `'ready'` stays ready if a later re-pack fails; the screen hides the button once ready.
  - `children_at` from an earlier open satisfies the check (stricter criteria were out of scope).
  - Family pulls are still best-effort.
- **sec-2:** the deny path reads the roster twice (about 2 extra queries, only on a 403).
- **Snag history route (8a):** checks only Snagging View, so any View user can read any snag's history, the same as the portal's job pages (see Open questions).

## 7. Open questions

1. ~~**8a, defect history access.**~~ **Resolved: option A, implemented (2.8a).** Original question kept for the record: As written (admin, Approve, or on the job family), the check would show "Forbidden" in the Status history card for office users who have Snagging View, or View+Edit, but not Approve. That includes coordinators browsing job pages, which today load for any View user. Options, with the exact code in 2.8:
   - **A, recommended:** check membership only for requests from the phone app. The portal is unchanged.
   - **B:** check all callers, but also allow Edit holders. View-only office users are still blocked.
   - **C:** as written. This only makes sense if the job pages get the same check.

   Related: should Snagging View in the portal keep meaning "may read every job"?
2. **Item 5, keep the `IN (...)` filters?** With them kept (as the brief asked), the planner chooses `idx_photo_upload` instead of the new partial index for `listUploads` and `uploadCounts`. Both read only unsent rows and both are fast. Dropping the IN lists would select the partial index outright, with the same meaning.
3. **Item 9, regions.** Please fill in `SUPABASE_REGION` and `VERCEL_FUNCTION_REGION`, ideally after running `api-latency.mjs` on staging, and choose per-route `preferredRegion` (recommended) or project-wide `vercel.json`.
