-- Several inspectors on one additional visit (2026-09-24).
--
-- A job has been a SET of inspectors since 20260923100000, but a visit --
-- which is a trip to that same unit -- could still only name one person.
-- A villa re-walked by two inspectors had to be booked under one of them,
-- and the other never got it on their phone.
--
-- Shaped exactly like snagging_job_inspectors, for the same reason: the
-- set lives in its own table, and snagging_job_visits.inspector_id stays
-- as the FIRST of them. The visit row, the report and the app's existing
-- sync all still read that column, so nothing breaks while the app is
-- still on the old build; it is a compatibility anchor now rather than a
-- rank above the others.
--
-- Service-role only (RLS on, no policies), as every other snagging table:
-- the portal and the app both reach these through the API.

create table if not exists public.snagging_visit_inspectors (
  visit_id uuid not null
    references public.snagging_job_visits (id) on delete cascade,
  inspector_id uuid not null
    references public.user_profile (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (visit_id, inspector_id)
);

-- "Which visits am I on?", which is how the app's sync selects its work.
create index if not exists snagging_visit_inspectors_inspector_idx
  on public.snagging_visit_inspectors (inspector_id);

alter table public.snagging_visit_inspectors enable row level security;

/*
  Carry across every visit that already names an inspector, so nobody has
  to re-enter what is already there. Re-runnable: on conflict do nothing,
  and the insert is skipped entirely where a row already exists.
*/
insert into public.snagging_visit_inspectors (visit_id, inspector_id)
select v.id, v.inspector_id
  from public.snagging_job_visits v
 where v.inspector_id is not null
on conflict do nothing;

comment on table public.snagging_visit_inspectors is
  'Who attends an additional visit. snagging_job_visits.inspector_id is '
  'the first of them, kept for the report and the app''s sync.';
