-- Additional snagging visit (Q1-Q6 / F13).
--
-- A job can now be one of three visit kinds. Until now a follow-up was
-- inferred purely from round_number > 1, which cannot tell an additional
-- visit (a fresh, chargeable inspection pass) apart from a de-snag round
-- (re-inspecting carried-forward snags). visit_charge snapshots the
-- additional-visit price at booking time so the charge is fixed even if
-- the pricing config later changes.

alter table public.snagging_jobs
  add column if not exists visit_type text not null default 'initial',
  add column if not exists visit_charge numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'snagging_jobs_visit_type_check'
  ) then
    alter table public.snagging_jobs
      add constraint snagging_jobs_visit_type_check
      check (visit_type in ('initial', 'desnag', 'additional'));
  end if;
end $$;

-- Backfill: every existing follow-up round is a de-snag round (the only
-- kind of child job that existed before this feature).
update public.snagging_jobs
   set visit_type = 'desnag'
 where round_number > 1
   and visit_type = 'initial'
   and parent_job_id is not null;
