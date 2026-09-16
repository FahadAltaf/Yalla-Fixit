-- Retire the additional visits that were modelled as jobs (BA v2, change 25).
--
-- Run AFTER 20260914120000_visits_as_appointments.sql.
--
-- A visit is an appointment on the job now, so the child `snagging_jobs`
-- rows that used to represent one have nothing left to be. They are not
-- converted into `snagging_job_visits` rows: a converted row would claim a
-- trip happened with findings attached to it, and the findings live on the
-- child job, which is exactly the split change 25 exists to remove.
-- Rewriting that history automatically would invent a record nobody kept.
--
-- Danish confirmed on 2026-09-16 that every job in this database is test
-- data and may be removed, which is what makes a delete the right answer
-- here rather than a migration of live work.
--
-- De-snag jobs are NOT touched. A de-snag is still its own job under
-- change 31 — it has its own quotation and scope of work — so only
-- visit_type = 'additional' is in scope.

BEGIN;

/*
  What is about to go, recorded before it goes.

  A delete with no trace is indistinguishable from data loss when somebody
  asks about it in three months, so the codes are written to the audit
  trail on the PARENT job — the record that survives.
*/
INSERT INTO public.snagging_audit_events (
  entity_type, entity_id, task_id, event_type, actor_label, origin, payload, created_at
)
SELECT
  'task',
  COALESCE(v.parent_job_id, v.id),
  COALESCE(v.parent_job_id, v.id),
  'additional_visit_job_retired',
  'Migration 20260916120000',
  'system',
  jsonb_build_object(
    'retired_job_id', v.id,
    'retired_code', v.code,
    'status', v.status,
    'round_number', v.round_number,
    'reason', 'Visits became appointments on the job (BA v2, change 25)'
  ),
  now()
FROM public.snagging_jobs v
WHERE v.visit_type = 'additional';

/*
  The children go with the parent.

  Most of these cascade from snagging_jobs already, but the ones that do
  not — or that cascade through a nullable FK and would be orphaned rather
  than removed — are deleted explicitly so nothing is left pointing at a
  job that no longer exists.
*/
CREATE TEMP TABLE _retiring ON COMMIT DROP AS
  SELECT id FROM public.snagging_jobs WHERE visit_type = 'additional';

DELETE FROM public.snagging_snag_photos
  WHERE job_id IN (SELECT id FROM _retiring);

DELETE FROM public.snagging_snags
  WHERE job_id IN (SELECT id FROM _retiring);

DELETE FROM public.snagging_areas
  WHERE job_id IN (SELECT id FROM _retiring);

DELETE FROM public.snagging_floor_plans
  WHERE job_id IN (SELECT id FROM _retiring);

DELETE FROM public.snagging_job_checklist
  WHERE job_id IN (SELECT id FROM _retiring);

/*
  A quotation raised against a retired visit job would otherwise point at
  nothing. Detached rather than deleted: it is a document that was sent to
  a client, and the client still has their copy.
*/
UPDATE public.snagging_quotations
   SET job_id = NULL
 WHERE job_id IN (SELECT id FROM _retiring);

DELETE FROM public.snagging_jobs
  WHERE id IN (SELECT id FROM _retiring);

COMMIT;

/*
  Afterwards, `visit_type` should carry only 'initial' and 'desnag'.

    SELECT visit_type, count(*)
      FROM public.snagging_jobs
     GROUP BY visit_type;
*/
