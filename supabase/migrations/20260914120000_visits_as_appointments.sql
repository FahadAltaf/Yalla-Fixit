-- An additional visit is an appointment on the job, not a second job
-- (BA v2, changes 25-29; BRD update FR-9.01 to FR-9.04, BR-14).
--
-- Today a return visit is a whole `snagging_jobs` row: its own code
-- (UNIT-V2), its own areas, its own floor plans, its own checklist copy,
-- its own report. That framing is what the document rejects, and it has a
-- concrete cost — anything the inspector finds on the return lands on a
-- DIFFERENT job from the inspection it belongs to, so the client receives
-- two reports for one property and has to reconcile them.
--
-- A visit becomes what it actually is: another appointment against the
-- same job, on a date, with an inspector and a charge. Defects found on it
-- go straight onto the original (change 28 — "new snags join the original
-- report"), tagged with the visit that found them so the report can still
-- say which pass each one came from.
--
-- This migration adds the shape. It deliberately does NOT move the five
-- visit jobs that already exist — two of which an inspector is part-way
-- through — because that is a decision about live work, not about schema.

-- ---------------------------------------------------------------------
-- 1. The appointment itself
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_job_visits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES public.snagging_jobs(id) ON DELETE CASCADE,

  -- Second visit, third visit. Counted per job, not globally.
  visit_number  integer NOT NULL,

  /*
    requested  raised, not yet payable or bookable
    scheduled  the client has paid (or agreed to) and a date is set
    in_progress the inspector is on site
    completed  the visit happened and its findings are on the job
    cancelled  called off; kept for the record rather than deleted
  */
  status        text NOT NULL DEFAULT 'requested',

  scheduled_date timestamptz,
  appointment_at timestamptz,
  inspector_id   uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,

  /*
    How the client is paying for it (change 26 / BR-14).

    The team often sends a payment link rather than raising a quotation,
    because the visit is a penalty the client pays rather than work they
    are choosing to buy. Both are legitimate and the coordinator records
    which one was used; `quotation` points at the document, `payment_link`
    carries whatever reference the coordinator has to hand.
  */
  charge         numeric,
  charge_method  text NOT NULL DEFAULT 'quotation',
  quotation_id   uuid REFERENCES public.snagging_quotations(id) ON DELETE SET NULL,
  payment_reference text,

  started_at    timestamptz,
  completed_at  timestamptz,
  notes         text,

  created_by    uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.snagging_job_visits IS
  'A return appointment on an existing job (BA v2, change 25 / FR-9.01). '
  'Replaces the child job a visit used to be; defects found on it are '
  'written to the parent job and tagged with visit_id.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'snagging_job_visits_status_check'
  ) THEN
    ALTER TABLE public.snagging_job_visits
      ADD CONSTRAINT snagging_job_visits_status_check
      CHECK (status IN ('requested','scheduled','in_progress','completed','cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'snagging_job_visits_charge_method_check'
  ) THEN
    ALTER TABLE public.snagging_job_visits
      ADD CONSTRAINT snagging_job_visits_charge_method_check
      CHECK (charge_method IN ('quotation','payment_link'));
  END IF;

  /*
    A visit charged by quotation names one; a visit charged by a payment
    link does not. Without this the two methods blur — a row could claim
    "quotation" while pointing at nothing, and the scheduling gate would
    have no document to check.
  */
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'snagging_job_visits_charge_target_check'
  ) THEN
    ALTER TABLE public.snagging_job_visits
      ADD CONSTRAINT snagging_job_visits_charge_target_check
      CHECK (charge_method <> 'payment_link' OR quotation_id IS NULL);
  END IF;
END $$;

-- One visit number per job, so two coordinators cannot both open "visit 2".
CREATE UNIQUE INDEX IF NOT EXISTS snagging_job_visits_number_idx
  ON public.snagging_job_visits (job_id, visit_number);

-- "What is outstanding on this job" is the question every screen asks.
CREATE INDEX IF NOT EXISTS snagging_job_visits_job_status_idx
  ON public.snagging_job_visits (job_id, status);

-- ---------------------------------------------------------------------
-- 2. Which visit found a defect
-- ---------------------------------------------------------------------

/*
  Null means the original inspection, which is where the overwhelming
  majority of defects come from and what every existing row is.

  This is what lets change 28 work without a second report: a defect found
  on visit two is written to the JOB, so it appears in the one report the
  client receives, while still being attributable to the pass that found
  it.
*/
ALTER TABLE public.snagging_snags
  ADD COLUMN IF NOT EXISTS visit_id uuid
    REFERENCES public.snagging_job_visits(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.snagging_snags.visit_id IS
  'The return visit that raised this defect (change 28). Null for the '
  'original inspection.';

CREATE INDEX IF NOT EXISTS snagging_snags_visit_idx
  ON public.snagging_snags (visit_id);

-- Same question for the checklist: change 29 shows only the items an
-- earlier pass could not reach, and the answer given on the return has to
-- be attributable to it.
ALTER TABLE public.snagging_job_checklist
  ADD COLUMN IF NOT EXISTS visit_id uuid
    REFERENCES public.snagging_job_visits(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 3. Row-level security, matching the tables either side of it
-- ---------------------------------------------------------------------

ALTER TABLE public.snagging_job_visits ENABLE ROW LEVEL SECURITY;

-- Every route reaches this table through the service role, which bypasses
-- RLS; the policy exists so an authenticated read is possible and an
-- anonymous one is not.
DROP POLICY IF EXISTS "snagging job visits readable" ON public.snagging_job_visits;
CREATE POLICY "snagging job visits readable"
  ON public.snagging_job_visits FOR SELECT TO authenticated USING (true);
