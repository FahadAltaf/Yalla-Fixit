-- =====================================================================
-- AMC Proposals v2 — Phase 5: client links, decisions and signature
--
-- FR5.4  send the proposal by email, or copy the link for WhatsApp
-- FR5.5  the client approves or rejects through the link, without an account
-- FR5.6  the contract is built from the same data and sent the same way
-- FR5.7  the client signs through the link; signature and time recorded
-- NFR4   the client link works without an account and uses a token that
--        cannot be guessed
--
-- Idempotent. Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tokens
-- ---------------------------------------------------------------------

/*
  Two tokens, not one: the proposal link and the contract link are sent at
  different times to answer different questions, and the proposal link must
  stop working once the contract stage begins. Sharing one token would mean
  a client who kept the first email could re-open a decision they had
  already made.

  Only the SHA-256 hash is stored, mirroring snagging_quotations. The raw
  token exists in the URL and in the email; if this table leaks it cannot
  be turned back into working links.

  The *_hint columns keep the last six characters in the clear, so the team
  can tell which link a client is quoting back at them over the phone
  without the database holding anything usable.
*/
ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS proposal_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS proposal_token_hint TEXT,
  ADD COLUMN IF NOT EXISTS proposal_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposal_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS contract_token_hint TEXT,
  ADD COLUMN IF NOT EXISTS contract_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_sent_at TIMESTAMPTZ;

/* The public route looks a submission up by hash and nothing else, so
   these are the only indexes that matter for it. Unique because a
   collision would hand one client another client's contract. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_submissions_proposal_token
  ON public.amc_submissions (proposal_token_hash)
  WHERE proposal_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_submissions_contract_token
  ON public.amc_submissions (contract_token_hash)
  WHERE contract_token_hash IS NOT NULL;


-- ---------------------------------------------------------------------
-- 2. The client's answers
-- ---------------------------------------------------------------------

/* FR5.5 — the answer and the time are recorded. The name and contact are
   whatever the person at the other end of the link gave; there is no
   account behind them, so they are evidence of who answered rather than
   an identity the system trusts. */
ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS client_decision TEXT
    CHECK (client_decision IS NULL OR client_decision IN ('approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS client_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_decided_by_name TEXT,
  ADD COLUMN IF NOT EXISTS client_rejected_reason TEXT;

/* FR5.7 — the signature and the time. Typed full name, matching how
   snagging records approved_by_name; see the phase 5 report for the open
   question about whether a drawn signature is wanted instead. */
ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS signed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

/* A signed AMC has to say who signed it. Enforced in the schema so the
   status cannot be reached without the evidence for it. */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'amc_submissions_signed_needs_name'
  ) THEN
    ALTER TABLE public.amc_submissions
      ADD CONSTRAINT amc_submissions_signed_needs_name
      CHECK (
        status <> 'signed'
        OR (signed_by_name IS NOT NULL AND length(trim(signed_by_name)) > 0)
      ) NOT VALID;

    ALTER TABLE public.amc_submissions
      VALIDATE CONSTRAINT amc_submissions_signed_needs_name;
  END IF;
END
$$;

/* FR5.5 — a rejection has to say why, same as an internal send-back. */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'amc_submissions_client_rejection_needs_reason'
  ) THEN
    ALTER TABLE public.amc_submissions
      ADD CONSTRAINT amc_submissions_client_rejection_needs_reason
      CHECK (
        client_decision IS DISTINCT FROM 'rejected'
        OR (client_rejected_reason IS NOT NULL AND length(trim(client_rejected_reason)) > 0)
      ) NOT VALID;

    ALTER TABLE public.amc_submissions
      VALIDATE CONSTRAINT amc_submissions_client_rejection_needs_reason;
  END IF;
END
$$;


-- ---------------------------------------------------------------------
-- 3. Access
-- ---------------------------------------------------------------------

/*
  Nothing is granted to anon here, deliberately.

  The client link is served by a route handler that looks the submission up
  by token hash using the service-role client, exactly as the snagging
  quotation link does. The browser never queries this table, so the client
  needs no database access at all -- which is what keeps "no account"
  (NFR4) from meaning "public table".
*/


-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'amc_submissions'
      AND column_name IN (
        'proposal_token_hash','contract_token_hash','client_decision',
        'signed_by_name','signed_at'
      ))                                                    AS new_columns_expect_5,
  (SELECT count(*) FROM pg_indexes
    WHERE tablename = 'amc_submissions'
      AND indexname LIKE 'idx_amc_submissions_%_token')     AS token_indexes_expect_2;
