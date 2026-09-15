-- A quotation can exist before the job (BA v2, changes 1-3; BRD §5.1, BR-2).
--
-- Until now the order was fixed the other way round: a job was created
-- first and its quotation generated inside it, enforced by a NOT NULL
-- `job_id`. The team works the opposite way — they quote a client, and the
-- job only exists once that quotation comes back approved — so the system
-- was asking them to commit to work before anyone had agreed to pay for
-- it, and every abandoned enquiry left a draft job behind.
--
-- Three changes make the other order possible:
--
--   1. `job_id` becomes optional. It is filled in when the approved
--      quotation is turned into a job, and stays null before that.
--   2. The quotation carries its own client and property, because with no
--      job there is nothing else holding them.
--   3. Quote numbers stop being derived from the job code.
--
-- What does NOT change: a quotation for an additional visit is still
-- raised against its job and still carries `job_id` from the start (change
-- 25 keeps a visit on the same job). Both shapes are legal, which is why
-- `job_id` is nullable rather than gone.

-- ---------------------------------------------------------------------
-- 1. The link to a job becomes optional
-- ---------------------------------------------------------------------

ALTER TABLE public.snagging_quotations
  ALTER COLUMN job_id DROP NOT NULL;

COMMENT ON COLUMN public.snagging_quotations.job_id IS
  'The job this quotation paid for. Null until an approved inspection '
  'quotation is turned into one (BR-2); set from the start for a visit '
  'quotation, which belongs to a job that already exists.';

-- ---------------------------------------------------------------------
-- 2. Who and what is being quoted
-- ---------------------------------------------------------------------

-- ON DELETE RESTRICT, not CASCADE: a quotation is a financial record, and
-- removing a client must not silently take the documents issued to them.
ALTER TABLE public.snagging_quotations
  ADD COLUMN IF NOT EXISTS client_id uuid
    REFERENCES public.snagging_clients(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS property_id uuid
    REFERENCES public.snagging_properties(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quote_kind text NOT NULL DEFAULT 'inspection';

COMMENT ON COLUMN public.snagging_quotations.quote_kind IS
  'inspection = quoted before any job exists, and creates one on approval. '
  'visit = an additional visit on an existing job (FR-9.04). '
  'desnag = a de-snagging job raised against an earlier one (change 31).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'snagging_quotations_kind_check'
  ) THEN
    ALTER TABLE public.snagging_quotations
      ADD CONSTRAINT snagging_quotations_kind_check
      CHECK (quote_kind IN ('inspection', 'visit', 'desnag'));
  END IF;
END $$;

/*
  Every quotation points at SOMETHING.

  Dropping the NOT NULL on `job_id` without this would allow a row that
  names neither a job nor a property — a priced document for nobody, which
  nothing downstream could render and nothing could ever reach.

  Added NOT VALID and validated separately so the check applies to new
  rows immediately while the existing twenty are confirmed in one pass,
  rather than the whole statement failing if one of them is short.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'snagging_quotations_target_check'
  ) THEN
    ALTER TABLE public.snagging_quotations
      ADD CONSTRAINT snagging_quotations_target_check
      CHECK (job_id IS NOT NULL OR property_id IS NOT NULL) NOT VALID;

    ALTER TABLE public.snagging_quotations
      VALIDATE CONSTRAINT snagging_quotations_target_check;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Backfill from the job every existing quotation already has
-- ---------------------------------------------------------------------

UPDATE public.snagging_quotations q
   SET client_id = j.client_id,
       property_id = j.property_id
  FROM public.snagging_jobs j
 WHERE q.job_id = j.id
   AND (q.client_id IS NULL OR q.property_id IS NULL);

-- A quotation raised against a de-snag round or an additional visit is
-- that kind of quotation, whatever it was called before.
UPDATE public.snagging_quotations q
   SET quote_kind = CASE j.visit_type
                      WHEN 'additional' THEN 'visit'
                      WHEN 'desnag'     THEN 'desnag'
                      ELSE 'inspection'
                    END
  FROM public.snagging_jobs j
 WHERE q.job_id = j.id;

-- The Quotations list filters on these two, and the job page still looks
-- a quotation up by its job.
CREATE INDEX IF NOT EXISTS snagging_quotations_client_idx
  ON public.snagging_quotations (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS snagging_quotations_kind_status_idx
  ON public.snagging_quotations (quote_kind, status, created_at DESC);

-- ---------------------------------------------------------------------
-- 4. Numbering that does not need a job
-- ---------------------------------------------------------------------

/*
  Quote numbers were built as `<job code>-Q<n>`, which cannot be produced
  before the job exists. They become a sequence of their own — which is
  also what the team's issued quotations actually look like ("Quote
  #9899"), rather than anything carrying a job code.

  A column DEFAULT rather than a helper the route calls: the default is
  evaluated inside the INSERT, so two coordinators quoting at the same
  moment cannot be handed the same number. Nothing else in this codebase
  calls a Postgres function over PostgREST, and this avoids being the
  first thing that does.

  Rows that supply their own number — the visit quotations, which still
  derive theirs from the job — are unaffected: an explicit value always
  beats a default.
*/
CREATE SEQUENCE IF NOT EXISTS public.snagging_quote_number_seq;

ALTER TABLE public.snagging_quotations
  ALTER COLUMN quote_number
  SET DEFAULT 'Q-'
    || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY')
    || '-'
    || lpad(nextval('public.snagging_quote_number_seq')::text, 4, '0');

/*
  Existing numbers are left exactly as they are.

  Sixteen of the twenty quotations on the system are approved, and several
  have been sent to clients who hold a PDF quoting that number. Renumbering
  an issued financial document to tidy a format is not a migration, it is a
  discrepancy with somebody's records.
*/
