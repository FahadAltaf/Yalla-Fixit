-- =====================================================================
-- AMC Proposals v2 — Phase 4: internal approval
--
-- FR5.1  submitting sends the submission to the AMC approver
-- FR5.2  the approver approves, or sends back with a written reason
-- FR5.3  the approver sees every submission waiting for review
-- FR5.8  the §9.2 status shows on the list and on each submission
-- FR3.4  locked once sent for review, until approved or sent back
--
-- Idempotent. Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The §9.2 status set
-- ---------------------------------------------------------------------

/*
  The table shipped with CHECK (status IN ('draft','generated')).

  'generated' has no equivalent in §9.2 -- it meant "a PDF was produced
  from this", which under v2 is no longer a state the workflow cares
  about. The one row carrying it is mapped to 'draft': it was never
  submitted, never approved and never sent, so draft is what it actually
  is under the new model.

  The constraint is dropped BEFORE the backfill. Doing it the other way
  round fails: the old constraint rejects every new value.

  TEXT with a CHECK rather than a Postgres enum, matching the rest of this
  codebase. The status list in a workflow this young will move, and
  ALTER TYPE ... ADD VALUE cannot run in the same transaction that uses
  it, which makes enums awkward in a migration.
*/

ALTER TABLE public.amc_submissions
  DROP CONSTRAINT IF EXISTS amc_submissions_status_check;

UPDATE public.amc_submissions
   SET status = 'draft'
 WHERE status NOT IN (
   'draft', 'awaiting_approval', 'sent_back', 'approved',
   'proposal_sent', 'proposal_rejected', 'proposal_approved',
   'contract_sent', 'signed'
 );

ALTER TABLE public.amc_submissions
  ADD CONSTRAINT amc_submissions_status_check
  CHECK (status IN (
    'draft',              -- being filled in by the team
    'awaiting_approval',  -- submitted for internal review
    'sent_back',          -- returned by the approver with a reason
    'approved',           -- approved internally, ready to send
    'proposal_sent',      -- sent to the client, waiting for an answer
    'proposal_rejected',  -- the client rejected it
    'proposal_approved',  -- the client approved it
    'contract_sent',      -- sent to the client for signature
    'signed'              -- the client signed. Final
  ));


-- ---------------------------------------------------------------------
-- 2. Approval bookkeeping
-- ---------------------------------------------------------------------

ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_back_reason TEXT;

/* FR5.2: a send-back is only actionable if it says what to fix, so the
   reason is required whenever the submission is in that state. NOT VALID
   then VALIDATE, so the ten existing rows are checked in one pass rather
   than the statement failing outright if one of them is short. */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'amc_submissions_sent_back_needs_reason'
  ) THEN
    ALTER TABLE public.amc_submissions
      ADD CONSTRAINT amc_submissions_sent_back_needs_reason
      CHECK (
        status <> 'sent_back'
        OR (sent_back_reason IS NOT NULL AND length(trim(sent_back_reason)) > 0)
      ) NOT VALID;

    ALTER TABLE public.amc_submissions
      VALIDATE CONSTRAINT amc_submissions_sent_back_needs_reason;
  END IF;
END
$$;

/* FR5.3 — the approver's queue is "everything awaiting review", ordered
   oldest first. */
CREATE INDEX IF NOT EXISTS idx_amc_submissions_status_submitted
  ON public.amc_submissions (status, submitted_at);


-- ---------------------------------------------------------------------
-- 3. The approver's row-level access
-- ---------------------------------------------------------------------

/*
  Deferred from the phase 0 migration, which said this would land here --
  the AMC resource and the review statuses did not exist yet, and a policy
  referencing them would have matched nothing.

  FR3.2: "The approver also sees every submission sent for review." Which
  submissions, and who counts as an approver, are both expressed here
  rather than only in the route, so a future route that forgets the check
  still cannot read another user's drafts.

  Approval rights come from role_access, not from a hardcoded identity
  (FR5.3), so changing the approver is a permissions edit rather than a
  release.
*/
DROP POLICY IF EXISTS "amc_submissions approver read" ON public.amc_submissions;
CREATE POLICY "amc_submissions approver read"
ON public.amc_submissions FOR SELECT TO authenticated
USING (
  status IN (
    'awaiting_approval', 'approved', 'sent_back',
    'proposal_sent', 'proposal_rejected', 'proposal_approved',
    'contract_sent', 'signed'
  )
  AND EXISTS (
    SELECT 1
      FROM public.user_profile up
      JOIN public.role_access ra ON ra.role_id = up.role_id
     WHERE up.id = auth.uid()
       AND ra.resource = 'amc'
       AND ra.action = 'approve'
       AND COALESCE(ra.enabled, TRUE)
  )
);

/* The decision itself. Narrower than the read: an approver may move a
   submission out of awaiting_approval and nothing else. Editing stays
   with the owner (§4: "The approver reviews and approves, but does not
   edit"). */
DROP POLICY IF EXISTS "amc_submissions approver decide" ON public.amc_submissions;
CREATE POLICY "amc_submissions approver decide"
ON public.amc_submissions FOR UPDATE TO authenticated
USING (
  status = 'awaiting_approval'
  AND EXISTS (
    SELECT 1
      FROM public.user_profile up
      JOIN public.role_access ra ON ra.role_id = up.role_id
     WHERE up.id = auth.uid()
       AND ra.resource = 'amc'
       AND ra.action = 'approve'
       AND COALESCE(ra.enabled, TRUE)
  )
)
WITH CHECK (status IN ('approved', 'sent_back'));


-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.amc_submissions
    WHERE status NOT IN ('draft','awaiting_approval','sent_back','approved',
                         'proposal_sent','proposal_rejected','proposal_approved',
                         'contract_sent','signed'))          AS invalid_statuses_expect_0,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'amc_submissions')
                                                             AS policies_expect_5,
  (SELECT count(*) FROM public.amc_submissions
    WHERE status = 'draft')                                  AS drafts;
