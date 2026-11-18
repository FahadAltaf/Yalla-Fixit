-- A gate pass's access type and status (17 Nov 2026).
--
-- A pass (an amc_documents row, category 'Gate pass', on a visit, a site
-- visit or a property) can say which of the property's access rules it is
-- for, and where it stands: approved, pending, rejected, expired or not
-- required. A pass for a rule starts approved; one for no rule starts
-- pending. A visit's access is worked out from its passes' statuses.
--
-- Live-safe: two nullable columns, nothing rewritten. Passes from before
-- this keep NULL and count as approved, as they did.

ALTER TABLE public.amc_documents
  ADD COLUMN IF NOT EXISTS access_rule_id uuid REFERENCES public.amc_property_access_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS access_status text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amc_documents_access_status_check') THEN
    ALTER TABLE public.amc_documents
      ADD CONSTRAINT amc_documents_access_status_check
      CHECK (access_status IS NULL OR access_status IN ('not_required', 'pending', 'approved', 'rejected', 'expired'));
  END IF;
END $$;

-- A site visit's own passes: documents at a new level, 'site_visit'
-- (entity_id = amc_assessments.id). Every existing row keeps its level.
ALTER TABLE public.amc_documents DROP CONSTRAINT IF EXISTS amc_documents_level_check;
ALTER TABLE public.amc_documents
  ADD CONSTRAINT amc_documents_level_check
  CHECK (level IN ('customer', 'property', 'contract', 'proposal', 'enquiry', 'visit', 'call_out', 'site_visit'));

CREATE INDEX IF NOT EXISTS idx_amc_documents_access_rule
  ON public.amc_documents (access_rule_id) WHERE access_rule_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
