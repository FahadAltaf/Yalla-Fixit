-- Floor plans get an updated_at, so the inspector app's delta pull can send
-- only the plans that changed since the device last synced.
--
-- Until now every pull re-sent (and re-signed) every plan for every job the
-- inspector holds, because there was no way to tell a renamed or reordered
-- plan from an untouched one. The pull route falls back to created_at while
-- this column is missing, so it is safe to deploy the code first.
--
-- Existing rows take now() as their updated_at, so each device receives its
-- plans once more on the first pull after this runs, then only changes.

alter table public.snagging_floor_plans
  add column if not exists updated_at timestamptz not null default now();

-- Same body as the module's shared helper; restated so this migration does
-- not depend on which earlier migration last defined it.
create or replace function public.snagging_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists snagging_floor_plans_touch on public.snagging_floor_plans;
create trigger snagging_floor_plans_touch
  before update on public.snagging_floor_plans
  for each row execute function public.snagging_touch_updated_at();

create index if not exists idx_snagging_floor_plans_job_updated
  on public.snagging_floor_plans (job_id, updated_at);
