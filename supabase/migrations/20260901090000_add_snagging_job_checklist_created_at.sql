-- snagging_job_checklist: record when each row was created.
--
-- Every other snagging table carries created_at; this one never did, so
-- the checklist was the one list that could not be ordered by when its
-- rows came into existence. sort_order stood in for it, which is correct
-- today only because the rows happen to be inserted in that sequence.
--
-- A note on what this buys you. The rows for a job are written in a single
-- transaction at setup, so they will share a timestamp to the microsecond
-- and creation time alone cannot separate them. The application therefore
-- orders by created_at with sort_order as the tie-break: creation order
-- leads, and within one batch the defined sequence keeps the list stable
-- instead of arbitrary. Rows copied onto a de-snag round are inserted one
-- at a time and do get distinct stamps.
--
-- Existing rows are backfilled from the job they belong to, which is the
-- closest true statement available: the checklist was attached when the
-- job was created.

alter table public.snagging_job_checklist
  add column if not exists created_at timestamptz;

update public.snagging_job_checklist c
   set created_at = j.created_at
  from public.snagging_jobs j
 where j.id = c.job_id
   and c.created_at is null;

alter table public.snagging_job_checklist
  alter column created_at set default now();

alter table public.snagging_job_checklist
  alter column created_at set not null;

-- The checklist is always read one job at a time and now ordered by
-- creation, so the index matches the query.
create index if not exists idx_snagging_job_checklist_job_created
  on public.snagging_job_checklist (job_id, created_at);
