-- An approver may decide their own amendment (24 Nov 2026).
--
-- Sami Farah, 24 Nov 2026: someone who asks for approval and is also an
-- approver may approve their own request, even when they are the only
-- approver. The portal now allows it for proposals and contract
-- amendments (lib/amc/workflow.ts AMC_SELF_APPROVAL_ALLOWED).
--
-- Proposals had no database rule against it. Amendments did: this check
-- refused any amendment decided by the person who asked for it, so
-- approving your own early termination failed with
-- "violates check constraint amc_amendments_not_self_decided".
--
-- Live-safe: only drops a check; nothing else changes and no row is touched.

ALTER TABLE public.amc_contract_amendments
  DROP CONSTRAINT IF EXISTS amc_amendments_not_self_decided;

-- Rollback (puts the two-person rule back; fails if a self-decided row exists):
-- ALTER TABLE public.amc_contract_amendments
--   ADD CONSTRAINT amc_amendments_not_self_decided
--   CHECK (decided_by IS NULL OR requested_by IS NULL OR decided_by <> requested_by);
