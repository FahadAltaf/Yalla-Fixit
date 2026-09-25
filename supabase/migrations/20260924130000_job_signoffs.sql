-- Every inspector on a job signs it off (2026-09-24).
--
-- A job walked by two or more inspectors went to the office on one
-- signature, the submitter's. Each inspector now signs for their part from
-- their own phone, one row per inspector per pass (the job, or a return
-- visit on it), and the sync refuses a submission until everyone on the
-- pass has signed.
--
-- A rejection (job) or a send-back (visit) reopens the work, so the
-- signatures given for it no longer stand: they are cleared by trigger and
-- everyone signs again when it is resubmitted.
--
-- Additive only.

create table if not exists public.snagging_job_signoffs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.snagging_jobs (id) on delete cascade,
  visit_id uuid references public.snagging_job_visits (id) on delete cascade,
  inspector_id uuid not null references public.user_profile (id) on delete cascade,
  signer_name text,
  signature_path text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.snagging_job_signoffs is
  'One sign-off per inspector per pass (the job, or a return visit). Written by the app sync.';

-- One sign-off per inspector per pass.
create unique index if not exists snagging_job_signoffs_one_per_pass
  on public.snagging_job_signoffs (
    job_id,
    coalesce(visit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    inspector_id
  );

-- Service role only (the sync); no policies means no direct client access.
alter table public.snagging_job_signoffs enable row level security;

-- Reopened work is signed again.
create or replace function public.snagging_clear_job_signoffs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    delete from public.snagging_job_signoffs where job_id = new.id and visit_id is null;
  end if;
  return new;
exception when others then
  raise warning 'sign-offs not cleared: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists snagging_clear_job_signoffs on public.snagging_jobs;
create trigger snagging_clear_job_signoffs
  after update on public.snagging_jobs
  for each row execute function public.snagging_clear_job_signoffs();

create or replace function public.snagging_clear_visit_signoffs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'submitted' and new.status = 'in_progress' then
    delete from public.snagging_job_signoffs where visit_id = new.id;
  end if;
  return new;
exception when others then
  raise warning 'visit sign-offs not cleared: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists snagging_clear_visit_signoffs on public.snagging_job_visits;
create trigger snagging_clear_visit_signoffs
  after update on public.snagging_job_visits
  for each row execute function public.snagging_clear_visit_signoffs();
