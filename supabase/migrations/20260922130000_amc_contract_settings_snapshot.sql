-- =====================================================================
-- AMC Proposals: the contract keeps its own copy of AMC Settings
--
-- FR6.4 says a document keeps the text it was sent with. Until now one
-- copy (settings_snapshot) was taken when the PROPOSAL was sent, and the
-- contract reused it, so a clause edited between the two sends never
-- reached the contract.
--
-- The contract now takes its own copy when it is sent. The proposal's copy
-- is left alone, so the proposal the client already holds never changes.
--
-- Contracts sent before this column existed went out with the proposal's
-- copy; the application falls back to settings_snapshot for those.
--
-- Safe to run more than once.
-- =====================================================================

ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS contract_settings_snapshot JSONB;

COMMENT ON COLUMN public.amc_submissions.contract_settings_snapshot IS
  'FR6.4: the resolved AMC Settings at the moment the contract was sent. NULL until then. The proposal keeps its own copy in settings_snapshot.';

-- ---------------------------------------------------------------------
-- Verification: expect 1
-- ---------------------------------------------------------------------
SELECT count(*) AS contract_snapshot_column_expect_1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'amc_submissions'
  AND column_name = 'contract_settings_snapshot';
