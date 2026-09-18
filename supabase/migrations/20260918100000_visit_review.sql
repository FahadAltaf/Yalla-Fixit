-- ---------------------------------------------------------------------
-- An additional visit can be submitted, reviewed and reissued
-- (BA v2, changes 25-28; FR-9.02, FR-9.03).
--
-- Visits became appointments on the job on 2026-09-14, but only the
-- booking half moved. Running one did not: nothing could submit a visit,
-- nothing could approve it, and the report reissue still looked for the
-- retired visit-JOB. This gives the visit the states and the links that
-- executing it needs.
-- ---------------------------------------------------------------------

-- 1. A visit waits for its manager, the same way an inspection does.
--
-- The manager reviews what the visit found before the client's report is
-- reissued with it (decided 2026-09-18). So between "the inspector has
-- finished" and "the report is out" there is a state the old constraint
-- had no word for.
ALTER TABLE public.snagging_job_visits
  DROP CONSTRAINT IF EXISTS snagging_job_visits_status_check;

ALTER TABLE public.snagging_job_visits
  ADD CONSTRAINT snagging_job_visits_status_check
  CHECK (status IN (
    'requested', 'scheduled', 'in_progress', 'submitted', 'completed', 'cancelled'
  ));

ALTER TABLE public.snagging_job_visits
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  -- Why the manager sent it back, shown to the inspector on the handset.
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

COMMENT ON COLUMN public.snagging_job_visits.review_note IS
  'The approval manager''s reason for sending the visit back. Cleared when '
  'the visit is resubmitted.';

-- 2. The report version a visit produces points at the VISIT.
--
-- `source_visit_id` has referenced snagging_jobs since versions were
-- created, because a visit was a job then. A visit is a row in
-- snagging_job_visits now, and a version issued for one would fail this
-- key. Repointed NOT VALID: versions issued under the old model keep the
-- job ids they were written with, and every new one is checked against
-- the table it now belongs to.
ALTER TABLE public.snagging_report_versions
  DROP CONSTRAINT IF EXISTS snagging_report_versions_source_visit_id_fkey;

ALTER TABLE public.snagging_report_versions
  ADD CONSTRAINT snagging_report_versions_source_visit_id_fkey
  FOREIGN KEY (source_visit_id)
  REFERENCES public.snagging_job_visits(id)
  ON DELETE SET NULL
  NOT VALID;

COMMENT ON COLUMN public.snagging_report_versions.source_visit_id IS
  'The additional visit this version was issued for, in snagging_job_visits. '
  'Rows written before 2026-09-18 hold the id of the retired visit job.';
