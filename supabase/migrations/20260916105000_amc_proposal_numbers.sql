-- =====================================================================
-- AMC Proposals v2 — Phase 1, step 1.7: server-allocated proposal numbers
--
-- Timestamped to run AFTER phase 4 (20260916100000) and BEFORE phase 5
-- (20260916110000), because phase 5's routes select this column.
--
-- This was planned in phase 0, moved to phase 1 step 1.7 so the column
-- and the code that writes it would land together, and then missed. It
-- surfaced when checking completeness: the phase 5 send route and the
-- public client route both SELECT proposal_number as a column, which did
-- not exist. Neither tsc nor the build could catch it -- a column name in
-- a select string is not type-checked -- so without this migration both
-- routes fail with "column does not exist".
--
-- It also closes audit finding F6: generateProposalNumber() built
-- AMC-{year}-{random 1000-9999} in the browser with no uniqueness check,
-- 9,000 values a year, so a collision becomes more likely than not at
-- about 112 proposals in a year.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

CREATE SEQUENCE IF NOT EXISTS public.amc_proposal_number_seq;

ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS proposal_number TEXT;

/*
  Backfill from the customer JSONB, where the wizard has been keeping the
  browser-generated number. Existing numbers are preserved rather than
  reissued: one of these submissions has had a proposal and a contract PDF
  produced from it, and renumbering an issued document is a discrepancy
  with somebody's records, not a tidy-up.
*/
UPDATE public.amc_submissions
   SET proposal_number = NULLIF(trim(customer->>'proposalNumber'), '')
 WHERE proposal_number IS NULL;

/*
  The old generator could already have produced a duplicate. Rather than
  let the unique index below fail the whole migration, the second and
  later holders of a repeated number are cleared; they are then issued a
  fresh one by the default on the next step.

  Clearing is safe for exactly the reason renumbering generally is not:
  every existing row is a draft (the phase 4 migration mapped the lone
  'generated' row back to draft), so none of these numbers has reached a
  client. The earliest holder keeps its number.
*/
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY proposal_number ORDER BY created_at, id) AS rn
    FROM public.amc_submissions
   WHERE proposal_number IS NOT NULL
)
UPDATE public.amc_submissions s
   SET proposal_number = NULL
  FROM ranked r
 WHERE s.id = r.id AND r.rn > 1;

/*
  Start past anything already issued, so a fresh number cannot collide
  with a backfilled one.

  The third argument matters. With is_called = true the next value is
  max + 1, which is right when numbers exist. On an empty table there is
  no max, and is_called = true would skip 1 and hand out AMC-YYYY-0002
  first -- so it is only set when there is something to follow.
*/
WITH issued AS (
  SELECT COALESCE(MAX((regexp_match(proposal_number, '^AMC-\d{4}-(\d+)$'))[1]::bigint), 0) AS max_n
    FROM public.amc_submissions
   WHERE proposal_number ~ '^AMC-\d{4}-\d+$'
)
SELECT setval('public.amc_proposal_number_seq', GREATEST(max_n, 1), max_n > 0)
  FROM issued;

/*
  A column DEFAULT, mirroring snagging_quote_number_seq: it is evaluated
  inside the INSERT, so two people creating a proposal at the same moment
  cannot be handed the same number.
*/
ALTER TABLE public.amc_submissions
  ALTER COLUMN proposal_number
  SET DEFAULT 'AMC-'
    || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY')
    || '-'
    || lpad(nextval('public.amc_proposal_number_seq')::text, 4, '0');

/* Rows left without a number (never had one, or cleared as a duplicate
   above) get one now, from the same sequence. */
UPDATE public.amc_submissions
   SET proposal_number = 'AMC-'
     || to_char(created_at AT TIME ZONE 'Asia/Dubai', 'YYYY')
     || '-'
     || lpad(nextval('public.amc_proposal_number_seq')::text, 4, '0')
 WHERE proposal_number IS NULL;

/* Keep the JSONB copy in step with the column, because the document
   renderer reads it from the form data. From here on the column is the
   source of truth and the API writes both. */
UPDATE public.amc_submissions
   SET customer = jsonb_set(customer, '{proposalNumber}', to_jsonb(proposal_number))
 WHERE customer->>'proposalNumber' IS DISTINCT FROM proposal_number;

ALTER TABLE public.amc_submissions
  ALTER COLUMN proposal_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_submissions_proposal_number
  ON public.amc_submissions (proposal_number);


-- ---------------------------------------------------------------------
-- Verification -- expect duplicates = 0 and nulls = 0.
-- ---------------------------------------------------------------------
SELECT
  (SELECT count(*) - count(DISTINCT proposal_number)
     FROM public.amc_submissions)                          AS duplicates_expect_0,
  (SELECT count(*) FROM public.amc_submissions
    WHERE proposal_number IS NULL)                         AS nulls_expect_0,
  (SELECT count(*) FROM public.amc_submissions
    WHERE customer->>'proposalNumber' IS DISTINCT FROM proposal_number)
                                                           AS out_of_sync_expect_0;
