-- Several inspectors on one job (point 6, 2026-09-22).
--
-- A room can be given to an inspector other than the job's own: civil and
-- MEP split across two people, or one inspector per floor. Empty means the
-- job's lead inspector (snagging_jobs.inspector_id), which is every room on
-- every job created before this. Findings still belong to the job, so the
-- report combines them without any change.

alter table public.snagging_areas
  add column if not exists inspector_id uuid
    references public.user_profile (id) on delete set null;

-- Sync asks "which jobs is this inspector on?" through their rooms.
create index if not exists snagging_areas_inspector_id_idx
  on public.snagging_areas (inspector_id)
  where inspector_id is not null;
