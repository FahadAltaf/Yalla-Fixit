-- Review routing and approval escalation (FR-6.01, FR-6.04, FR-6.07).
--
-- Until now the review chain had one party: the approval manager picked a
-- submitted job up and signed it off in the same act. FR-6.01 describes two
-- hops -- submitted goes to a reviewer, the reviewer hands it to the named
-- approval manager, and only then is a decision taken.
--
-- Rather than add a status for "the reviewer has finished", the existing
-- `in_review` state carries both halves and `reviewed_at` marks the hand-off
-- inside it. That keeps every status filter, analytics bucket and mobile
-- constant working unchanged, which a new status would have broken across
-- the whole module.
--
-- Nothing here is destructive: every column is nullable and added only if
-- absent, so jobs already mid-flight keep their data and stay valid.

alter table public.snagging_jobs
  -- FR-6.01 — who checks the work before the manager signs it. Null on
  -- historical jobs and on jobs nobody has been assigned to yet.
  add column if not exists reviewer_id uuid
    references public.user_profile (id) on delete set null,

  -- When the reviewer opened it, and when they handed it on. `reviewed_at`
  -- is the gate: the approval manager cannot decide until it is set.
  add column if not exists review_started_at timestamptz,
  add column if not exists reviewed_at timestamptz,

  -- FR-6.07 — the 48-hour deadline, stored rather than recomputed on every
  -- read so the escalation sweep can index it and so the deadline a job was
  -- given does not move when the SLA constant changes.
  add column if not exists approval_due_at timestamptz,

  -- Stamped once when the job is escalated. This is what makes the sweep
  -- idempotent: a stamped row is never picked up again.
  add column if not exists escalated_at timestamptz;

-- The reviewer's own queue.
create index if not exists idx_snagging_jobs_reviewer
  on public.snagging_jobs (reviewer_id)
  where reviewer_id is not null;

-- FR-6.06 — the review queue reads exactly this: the two open statuses,
-- oldest submission first.
create index if not exists idx_snagging_jobs_review_queue
  on public.snagging_jobs (status, submitted_at);

-- FR-6.07 — the escalation sweep's only query. Partial, because a job that
-- has already escalated is never a candidate again.
create index if not exists idx_snagging_jobs_escalation
  on public.snagging_jobs (approval_due_at)
  where escalated_at is null;

-- Give jobs already awaiting a decision the deadline they should have had.
-- Only fills nulls, so re-running this migration cannot move a deadline.
update public.snagging_jobs
   set approval_due_at = submitted_at + interval '48 hours'
 where submitted_at is not null
   and approval_due_at is null;
