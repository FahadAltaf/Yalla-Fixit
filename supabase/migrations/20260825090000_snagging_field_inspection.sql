-- Field inspection additions (Module 4).

-- FR-4.06 — the exact defect spot ON THE PHOTO, as 0..1 fractions of the image
-- (distinct from the floor-plan pin, which lives on the snag). All-or-nothing.
alter table public.snagging_snag_photos
  add column if not exists marker_x real,
  add column if not exists marker_y real;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'snag_photos_marker_range') then
    alter table public.snagging_snag_photos
      add constraint snag_photos_marker_range
      check (
        (marker_x is null or (marker_x >= 0 and marker_x <= 1)) and
        (marker_y is null or (marker_y >= 0 and marker_y <= 1))
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'snag_photos_marker_complete') then
    alter table public.snagging_snag_photos
      add constraint snag_photos_marker_complete
      check ((marker_x is null) = (marker_y is null));
  end if;
end $$;

-- FR-4.01 — record when the inspector STARTED an area (the finish is already
-- captured as confirmed_at). The job-level start already lives on
-- snagging_jobs.started_at.
alter table public.snagging_areas
  add column if not exists started_at timestamptz;

-- FR-4.11 — for a limited-access area, name WHICH elements were not checked,
-- separate from access_reason (the "why").
alter table public.snagging_areas
  add column if not exists elements_not_checked text;
