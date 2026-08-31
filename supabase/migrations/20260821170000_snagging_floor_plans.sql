-- Multi-floor floor plans (G3, FR-1.02).
--
-- The lean rebuild collapsed floor plans to a single image on the job
-- (floor_plan_path / _width / _height). A villa or townhouse needs one
-- plan per floor, and a pinned snag must record which plan it sits on, so
-- plans move back into their own table (one job → many plans) and
-- snagging_snags.floor_plan_id points at it.
--
-- Service-role only (RLS on, no policies): every snagging read/write goes
-- through the service-role client, and the mobile app reads via the API.

create table if not exists public.snagging_floor_plans (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.snagging_jobs(id) on delete cascade,
  label text not null default 'Floor plan',
  storage_path text not null,
  width integer,
  height integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_snagging_floor_plans_job
  on public.snagging_floor_plans (job_id, sort_order);

alter table public.snagging_floor_plans enable row level security;

-- Carry the single plan currently held on the job into the new table so
-- existing jobs keep their plan. The job columns are left in place as a
-- harmless legacy; the table is now the source of truth.
insert into public.snagging_floor_plans (job_id, label, storage_path, width, height, sort_order)
select id, 'Floor plan', floor_plan_path, floor_plan_width, floor_plan_height, 0
  from public.snagging_jobs
 where floor_plan_path is not null
   and not exists (
     select 1 from public.snagging_floor_plans fp where fp.job_id = snagging_jobs.id
   );
