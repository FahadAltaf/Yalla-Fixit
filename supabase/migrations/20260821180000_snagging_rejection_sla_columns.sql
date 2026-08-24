-- Reconcile columns the lean rebuild dropped (§5.3, FR-2.06, K1-K3, G3).
--
-- The out-of-band snagging_tasks -> snagging_jobs rebuild stripped several
-- columns that this session's features read and write. Verified missing on
-- the live DB (not just the migration files), so the reject flow, photo
-- EXIF/GPS, multi-floor pins, and delivery all fail until these exist.
-- Idempotent — safe to re-run.

-- Rejection category + remediation SLA + delivery timestamp.
alter table public.snagging_jobs
  add column if not exists rejection_category text,
  add column if not exists rejection_count integer not null default 0,
  add column if not exists remediation_due_at timestamptz,
  add column if not exists delivered_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'snagging_jobs_rejection_category_check'
  ) then
    alter table public.snagging_jobs
      add constraint snagging_jobs_rejection_category_check
      check (rejection_category is null
             or rejection_category in ('minor', 'data_correction', 'critical'));
  end if;
end $$;

-- Which floor plan a snag is pinned on (G3). No FK: the plan may be
-- deleted independently and the pin simply stops resolving.
alter table public.snagging_snags
  add column if not exists floor_plan_id uuid;

-- Where and (via EXIF) when a photo was taken (FR-2.06).
alter table public.snagging_snag_photos
  add column if not exists gps_lat double precision,
  add column if not exists gps_lng double precision,
  add column if not exists exif jsonb;
