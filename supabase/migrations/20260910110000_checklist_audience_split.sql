-- The checklist splits in two (Action Points N1, N7, N8).
--
-- One library, two audiences:
--
--   TECHNICIAN — the short list an inspector works through on site. It is
--   copied onto each job at creation, filtered by property type (N2), and
--   answered per item as the inspection proceeds.
--
--   CLIENT — the longer list YFI publishes, held as ONE stored document
--   and shared on request rather than generated per job (N7). It is never
--   copied onto a job and never answered, so nothing about job creation or
--   submission looks at it.
--
-- Both live in this table rather than two, because they are the same shape
-- and are edited by the same people on the same screen (N8). The audience
-- is what separates them, and it is the only thing job generation filters
-- on beyond property type.
--
-- Existing rows become TECHNICIAN. The forty-seven already seeded are the
-- list jobs are being created against today, and every job in flight has a
-- copy of them; re-labelling them as client would leave new jobs with an
-- empty checklist and no way to submit under N5. The client document is
-- explicitly the later pass (N7), so its rows arrive when its content
-- does.

ALTER TABLE public.snagging_checklist_items
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'technician';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'snagging_checklist_items_audience_check'
  ) THEN
    ALTER TABLE public.snagging_checklist_items
      ADD CONSTRAINT snagging_checklist_items_audience_check
      CHECK (audience IN ('technician', 'client'));
  END IF;
END $$;

COMMENT ON COLUMN public.snagging_checklist_items.audience IS
  'technician = copied onto each job and answered on site (N2). '
  'client = the published list, stored once and shared on request (N7); '
  'never copied onto a job.';

-- Job generation reads active technician rows for one property type, and
-- the admin screen lists one audience at a time. Both are this index.
CREATE INDEX IF NOT EXISTS snagging_checklist_items_audience_idx
  ON public.snagging_checklist_items (audience, active, sort_order);

/*
  Codes are unique per audience, not globally.

  The two lists are written by different people for different readers and
  will collide on numbering — CHK-001 means the first technician check and
  the first client check, and neither should have to renumber around the
  other. Dropped and re-made only where a global unique already exists.
*/
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'snagging_checklist_items_code_key'
  ) THEN
    ALTER TABLE public.snagging_checklist_items
      DROP CONSTRAINT IF EXISTS snagging_checklist_items_code_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS snagging_checklist_items_audience_code_idx
  ON public.snagging_checklist_items (audience, code);
