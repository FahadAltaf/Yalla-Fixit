-- De-snagging becomes a job of its own, with its own quotation
-- (BA v2, change 31; BRD update §5.2, FR-8.01).
--
-- A de-snag has always been a separate row in `snagging_jobs` — its own
-- code, its own inspector, its own submission — but it was framed as ROUND
-- TWO of the original and it was free. Neither matches how the work is
-- sold: the client is quoted for a return visit to verify fixes, and they
-- agree a price for it the same way they agreed the first inspection.
--
-- So a de-snag now begins where every other piece of work begins, in the
-- Quotations section. Which leaves one thing the quotation cannot express
-- yet: WHICH job is being de-snagged.
--
-- `job_id` cannot carry it. That column means "the job this quotation paid
-- for", and for a de-snag quotation it stays null until the de-snag job is
-- created and then points AT that new job. The original is a different
-- relationship — the thing being returned to — and it needs its own column
-- or the two get confused the first time someone writes a query.

ALTER TABLE public.snagging_quotations
  ADD COLUMN IF NOT EXISTS source_job_id uuid
    REFERENCES public.snagging_jobs(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.snagging_quotations.source_job_id IS
  'The original inspection a de-snag quotation returns to (change 31). '
  'Null for an inspection quotation, which has no earlier job. Distinct '
  'from job_id, which names the job this quotation PAID FOR — on a '
  'de-snag quotation that is the new de-snag job, not this one.';

/*
  A de-snag quotation names the job it returns to; nothing else does.

  Without this the column is merely available, and an inspection quotation
  could be saved pointing at some unrelated job — which reads as a de-snag
  to every query that goes looking for one.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'snagging_quotations_source_job_check'
  ) THEN
    ALTER TABLE public.snagging_quotations
      ADD CONSTRAINT snagging_quotations_source_job_check
      CHECK (
        (quote_kind = 'desnag' AND source_job_id IS NOT NULL)
        OR (quote_kind <> 'desnag' AND source_job_id IS NULL)
      ) NOT VALID;

    /*
      NOT VALID, and deliberately left that way for the five existing
      'visit' rows and fifteen 'inspection' rows — every one of which has a
      null source_job_id and therefore already satisfies it. Validating
      costs a scan and proves what the backfill already guarantees.
    */
    ALTER TABLE public.snagging_quotations
      VALIDATE CONSTRAINT snagging_quotations_source_job_check;
  END IF;
END $$;

-- "What is outstanding against this inspection" is the question the job
-- screen asks, so the original is the thing indexed.
CREATE INDEX IF NOT EXISTS snagging_quotations_source_job_idx
  ON public.snagging_quotations (source_job_id, status);
