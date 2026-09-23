-- Several inspectors on one job, none senior to another (point 6, 2026-09-23).
--
-- Supersedes snagging_areas.inspector_id, added on 22 September, which
-- could only ever name one person per room. Two things it could not say,
-- and this can:
--
--   1. a job is worked by a SET of inspectors, with no lead among them
--   2. a room can be walked by more than one of them
--
-- Assignment stays optional. A room nobody is named on carries on exactly
-- as it does today: open to whoever is on the job. Naming people is how
-- you split a job (civil and MEP, or floor by floor), not a precondition
-- for working one.
--
-- Who recorded a snag is already on snagging_snags.created_by, so the
-- portal can show "recorded by X" without a new column. It is null on 41
-- of the 115 snags that exist today, which predate the app writing it.
--
-- Service-role only (RLS on, no policies), as every other snagging table:
-- the portal and the app both reach these through the API.

create table if not exists public.snagging_job_inspectors (
  job_id uuid not null
    references public.snagging_jobs (id) on delete cascade,
  inspector_id uuid not null
    references public.user_profile (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, inspector_id)
);

-- "Which jobs am I on?", which is how the app's sync selects its work.
create index if not exists snagging_job_inspectors_inspector_idx
  on public.snagging_job_inspectors (inspector_id);

create table if not exists public.snagging_area_inspectors (
  area_id uuid not null
    references public.snagging_areas (id) on delete cascade,
  inspector_id uuid not null
    references public.user_profile (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (area_id, inspector_id)
);

-- "Which rooms are mine?", asked per job on every sync.
create index if not exists snagging_area_inspectors_inspector_idx
  on public.snagging_area_inspectors (inspector_id);

alter table public.snagging_job_inspectors  enable row level security;
alter table public.snagging_area_inspectors enable row level security;

/*
  Carry the 31 jobs that already name an inspector into the new table, so
  nobody has to re-enter what is already there. snagging_jobs.inspector_id
  is left in place: submission, the report cover and the app's existing
  sync all still read it, and it is now simply the first inspector on the
  job rather than a rank above the others.

  snagging_areas.inspector_id has no rows at all (checked 2026-09-23), so
  there is nothing to carry across from it. It is left alone rather than
  dropped, so this migration cannot fail on a database where something
  still reads it; the code stops using it in the same change.
*/
insert into public.snagging_job_inspectors (job_id, inspector_id)
select id, inspector_id
  from public.snagging_jobs
 where inspector_id is not null
on conflict do nothing;
