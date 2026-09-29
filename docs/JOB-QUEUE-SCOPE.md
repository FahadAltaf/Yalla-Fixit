# Job queue — scope

**Date:** 29 September 2026
**Why now:** `AUDIT_SCALABILITY.md` traces five Critical/High findings to one
root cause — every expensive operation runs inside an HTTP request. A-3, A-5,
B-5, B-12, B-13 and B-24 are all the same shape and none can be properly fixed
without somewhere to put the work.

---

## 1. What actually needs queueing

Not speculative — each is an existing finding with a file behind it.

| Work | Today | Runs for | Finding |
|---|---|---|---|
| **Report PDF render** | `report-pdf-headless.ts`, now semaphore-gated | up to 3 min, ~300 MB Chrome | A-1, B-5 |
| **Zoho reconcile** | `zoho/reconcile.ts:86-217`, inside the board request | 1 FSM call + 2-4 writes **per entry**, no checkpoint | A-5 |
| **Zoho day import** | `schedule/route.ts:93-115`, inline on a plain GET | 1 call per appointment, 8 at a time | B-1 |
| **Escalation sweep** | `approvals/escalations/run`, HTTP-triggered | 200 serial claim+email+audit | B-12 |
| **Todo reminders** | `todos/reminders/run`, HTTP-triggered | 50 × (2 reads + email + write) | B-13 |
| **Publish schedule** | `publish-schedule.ts:57-63` | 1 serial FSM write per entry | B-24 |
| **Bulk photo copy** | `tasks/[id]/rounds/route.ts:726-747` | object copy per photo, 6 at a time | — |
| **Outbound email** | 4 routes send inline; 3 already use `after()` | up to 30 s per Resend call | B-5 note |

Common shape: unbounded duration, external dependency, no resume, and a user
waiting on an HTTP response that has nothing to do with the work.

---

## 2. Constraints this codebase actually has

These were checked, not assumed, and they rule out the obvious answer.

| Constraint | Evidence | Consequence |
|---|---|---|
| **No direct Postgres access anywhere** | No `pg`/`postgres`/`drizzle`/`knex` in `package.json`; no `DATABASE_URL` in `.env` | Everything goes through supabase-js → PostgREST. **pg-boss and Graphile Worker both require a direct connection** — adopting either means a new driver, a new secret and a new pool. |
| **`max_connections = 60`**, ~16 in use (PostgREST holds 11) | `pg_stat_activity` | ~44 spare. Enough for a worker pool, but not a detail to ignore. |
| **Long-running Node server, not serverless** | No `x-vercel-id`/CDN headers on `portal.yallafixit.ae` | A worker process is viable. On lambdas it would not be. |
| **`pg_cron` 1.6.4 installed**, `pg_net` 0.19.5 installed | `pg_extension` | Scheduling can live in Postgres. No external cron service needed. |
| **`pgmq` available (1.5.1), not installed** | `pg_available_extensions` | An option, but see §3. |
| **No Dockerfile, compose, PM2 config or CI in the repo** | filesystem | Deployment is configured outside version control. **Adding a second process is an ops change somebody must make by hand** — this is the main external dependency. |
| **No Redis** | `package.json` | BullMQ means new infrastructure. |

One more worth knowing before touching the deploy: `package.json` has
`"build": "next build"`, which is the Turbopack path that fails on this
project (`docs/` notes and the team's own experience — `next build --webpack`
is what works). Whatever runs the deploy is already overriding this, and a
worker process will need the same treatment.

---

## 3. Recommendation

**A jobs table in Postgres, claimed through an RPC with `SKIP LOCKED`, drained
by a separate worker process.**

Not pg-boss. Here is the honest comparison:

| Option | Fit | Verdict |
|---|---|---|
| **pg-boss** | Mature, cron built in, Postgres-backed | Needs `pg` + `DATABASE_URL` + its own pool, none of which exist here. It also creates and migrates its own schema, which sits awkwardly beside a hand-managed `supabase/migrations` folder. **Rejected on integration cost, not quality.** |
| **BullMQ** | Best-in-class | Needs Redis. New infrastructure to run, secure and back up for one service. **Rejected.** |
| **Supabase Queues (pgmq)** | Native to the stack, available | Still needs a worker to drain it, so it solves the storage half and leaves the harder half. Adds an extension to reason about. **Reasonable second choice.** |
| **Jobs table + `SKIP LOCKED` RPC** | One migration, zero dependencies, uses the service-role client already everywhere | Requires writing the claim/complete/retry logic — perhaps 150 lines. **Recommended.** |

The deciding factor: the claim logic is small and well understood, whereas
introducing a direct Postgres connection changes how this application talks to
its database. That is a bigger decision than the queue itself.

### Where the worker runs — the decision that matters

The point of A-1 is that *a Chrome OOM takes down the server*. Running the
worker inside the Next process does **not** fix that; it relocates it.

```
┌─────────────────┐        ┌──────────────────┐
│  Next server    │        │  Worker process  │
│  (portal)       │        │  (same host)     │
│                 │        │                  │
│  enqueue ───────┼───────►│  claim ──► run   │
│  read status    │        │  Chrome lives    │
│                 │        │  HERE            │
└────────┬────────┘        └────────┬─────────┘
         │      Supabase Postgres   │
         └──────────► jobs ◄────────┘
```

Same host is fine to start; same *process* is not. An OOM then kills the
worker, systemd or PM2 restarts it, and in-flight jobs return to the queue by
lease expiry. The portal stays up.

---

## 4. Schema

```sql
create type job_state as enum ('queued','running','done','failed','cancelled');

create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text        not null,
  payload       jsonb       not null default '{}'::jsonb,
  state         job_state   not null default 'queued',

  run_after     timestamptz not null default now(),
  attempts      int         not null default 0,
  max_attempts  int         not null default 5,

  -- Lease, not a lock: a worker that dies stops renewing and the job is
  -- reclaimed. A held lock would strand it until someone noticed.
  leased_until  timestamptz,
  leased_by     text,

  -- One row per logical unit of work. "Reconcile 2026-09-29" enqueued twice
  -- while still queued is one job, not two.
  dedupe_key    text,

  last_error    text,
  result        jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The claim query's index: ready jobs, oldest first.
create index jobs_claimable_idx
  on public.jobs (run_after, id)
  where state = 'queued';

-- Dedupe applies only to work not yet finished.
create unique index jobs_dedupe_idx
  on public.jobs (kind, dedupe_key)
  where dedupe_key is not null and state in ('queued','running');

create index jobs_lease_idx
  on public.jobs (leased_until) where state = 'running';

alter table public.jobs enable row level security;  -- service role only
```

### Claiming

```sql
create or replace function public.claim_jobs(
  p_worker   text,
  p_kinds    text[],
  p_limit    int  default 1,
  p_lease_ms int  default 60000
)
returns setof public.jobs
language sql volatile as $$
  with ready as (
    select id from public.jobs
     where state = 'queued'
       and run_after <= now()
       and kind = any(p_kinds)
     order by run_after, id
     limit p_limit
     -- Two workers never take the same row, and neither waits on the other.
     for update skip locked
  )
  update public.jobs j
     set state        = 'running',
         attempts     = j.attempts + 1,
         leased_by    = p_worker,
         leased_until = now() + make_interval(secs => p_lease_ms / 1000.0),
         updated_at   = now()
    from ready
   where j.id = ready.id
  returning j.*;
$$;
```

Plus `complete_job(id, result)`, `fail_job(id, error)` — which either
re-queues with exponential backoff or marks `failed` once `attempts >=
max_attempts` — and `reclaim_expired_jobs()`, run by the worker each tick to
return leases from processes that died mid-job.

---

## 5. The worker

A separate entry point, not a route:

```
worker/
  index.ts          # poll loop: reclaim → claim → dispatch → complete/fail
  handlers/
    report-pdf.ts       # wraps the existing generateReportPdf
    zoho-reconcile.ts   # one DAY per job, checkpointed
    zoho-import.ts
    escalations.ts
    todo-reminders.ts
    send-email.ts
```

```jsonc
// package.json
"worker": "tsx worker/index.ts"
```

Three properties that matter:

- **Handlers must be idempotent.** A lease can expire mid-run and the job be
  claimed again. The repo already has the pattern in three places —
  `report-generate.ts:86-99` claims by status guard, and
  `escalations/run:109-115` claims before the side effect.
- **Concurrency is per kind**, not global: 2 for `report-pdf` (Chrome memory),
  8 for `send-email`, 1 for `zoho-reconcile` (FSM credits are shared).
- **The queue is not the checkpoint.** A-5's real fix is that reconcile
  enqueues one job *per day*, each of which pages entries and records progress
  — so a 429 at entry 900 costs one page, not the run.

### Scheduling

`pg_cron` is already installed, so recurring work is a row, not an HTTP
endpoint:

```sql
select cron.schedule(
  'escalations-hourly', '0 * * * *',
  $$insert into public.jobs (kind, dedupe_key)
    values ('escalations', to_char(now(),'YYYY-MM-DD-HH24'))
    on conflict do nothing$$
);
```

This retires `CRON_SECRET` and the two HTTP cron routes, and with them the
non-constant-time secret comparison (C-5).

---

## 6. Phases

Each lands independently and is useful on its own.

**Phase 1 — foundation (2-3 days).** Migration, the four RPCs, the worker
loop, one handler (`send-email`, the simplest and safest), and a `/admin/jobs`
read-only view so failures are visible. **Nothing else changes.**

**Phase 2 — the OOM (1-2 days).** Move `report-pdf` behind the queue. The
approve route enqueues and returns; the UI polls the report version's status,
which it already models. Chrome leaves the web process entirely, and A-1's
semaphore becomes a worker concurrency setting. **Closes A-1 and B-5.**

**Phase 3 — Zoho (3-4 days).** `zoho-reconcile` and `zoho-import` become
per-day jobs with real checkpointing and batched writes. The board's GET stops
importing inline and reads whatever the last run produced. **Closes A-5 and
B-1**, and is where the FSM backoff added earlier starts paying off.

**Phase 4 — sweeps (1-2 days).** Escalations, todo reminders and
publish-schedule move over; `pg_cron` replaces the HTTP triggers.
**Closes B-12, B-13, B-24, C-5.**

**Total: 7-11 days**, plus the ops work in §7.

---

## 7. What somebody else has to do

This is the dependency most likely to stall the work, so it is listed
separately rather than buried in a phase:

1. **Run a second process on the host.** systemd unit or PM2 entry for
   `npm run worker`, with restart-on-failure. There is no Dockerfile or
   process config in the repo, so this is done wherever the current deploy is
   configured.
2. **Give it the same environment** as the web process — `SUPABASE_URL`,
   service role key, `RESEND_*`, Zoho credentials, `PUPPETEER_EXECUTABLE_PATH`.
3. **Decide the host's memory ceiling**, which sets `report-pdf` concurrency.
   At ~300 MB per Chrome, 2 is a reasonable default.
4. **Confirm the build command.** `npm run build` is the Turbopack path that
   fails here; the worker build needs the same `--webpack` override the web
   build already uses.

---

## 8. What this does not solve

Worth saying plainly so it is not oversold:

- **A-3 (sync cold snapshot)** is not a queue problem. The fix is a server-side
  cap and a resumable cursor in `sync-children.ts`; a device is waiting for
  that response.
- **A-10 / A-12** are frontend rendering problems.
- **Rate limiting** is still absent and is unrelated.
- **The queue adds an operational surface**: a worker that is down looks like
  "reports stopped generating" with nothing in the UI unless the `/admin/jobs`
  view in Phase 1 is built. That view is not optional.

---

## 9. Recommendation in one line

Build Phase 1 and Phase 2 first — three to five days, closes the highest-
severity finding in the audit, and proves the design before Zoho's complexity
is added to it. If Phase 2 works, the rest is repetition.
