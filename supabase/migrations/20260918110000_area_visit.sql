-- ---------------------------------------------------------------------
-- A room remembers which visit added it (BA v2, changes 25-28).
--
-- Rooms have no finish tick on a return visit: every room stays open for
-- the length of it. So a room the inspector ADDS on a visit can never be
-- signed off, and the job page read "Areas confirmed 6 / 7 - Plant Room
-- still pending" on a job whose walk was complete and approved.
--
-- Snags and checklist answers already carry the visit that produced them
-- (20260914120000). This gives rooms the same link, so a room added on a
-- visit is told apart from one the original walk left unfinished.
-- ---------------------------------------------------------------------

ALTER TABLE public.snagging_areas
  ADD COLUMN IF NOT EXISTS visit_id uuid
    REFERENCES public.snagging_job_visits(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.snagging_areas.visit_id IS
  'The return visit that added this room. Null for rooms on the original '
  'walk. Such a room is not held to the walk''s sign-off.';

CREATE INDEX IF NOT EXISTS snagging_areas_visit_idx
  ON public.snagging_areas (visit_id);

-- Rooms added on a visit before this column existed.
--
-- There is no record of when a room was added relative to a visit, so
-- this goes by what is in it: a room never signed off whose every snag was
-- raised on a visit can only have been added on that visit. A room the
-- original walk simply left unfinished holds walk snags, or none, and is
-- left alone.
UPDATE public.snagging_areas AS a
   SET visit_id = first_visit.visit_id
  FROM (
    SELECT DISTINCT ON (area_id) area_id, visit_id
      FROM public.snagging_snags
     WHERE visit_id IS NOT NULL
     ORDER BY area_id, created_at
  ) AS first_visit
 WHERE first_visit.area_id = a.id
   AND a.visit_id IS NULL
   AND a.confirmed_at IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.snagging_snags AS walk
      WHERE walk.area_id = a.id
        AND walk.visit_id IS NULL
   );
