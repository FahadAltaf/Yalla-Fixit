-- DEV-494 on site visits (26 Nov 2026): the client's no-login pass upload
-- link for a site visit, as for a planned visit. The link table took only
-- visits; it now takes site visits (amc_assessments) too.
--
-- Live-safe: widens one CHECK; no data changes.

ALTER TABLE public.amc_client_links DROP CONSTRAINT IF EXISTS amc_client_links_entity_type_check;
ALTER TABLE public.amc_client_links
  ADD CONSTRAINT amc_client_links_entity_type_check CHECK (entity_type IN ('visit', 'assessment'));

-- Rollback (only once no site visit link exists):
--   DELETE FROM public.amc_client_links WHERE entity_type = 'assessment';
--   ALTER TABLE public.amc_client_links DROP CONSTRAINT IF EXISTS amc_client_links_entity_type_check;
--   ALTER TABLE public.amc_client_links ADD CONSTRAINT amc_client_links_entity_type_check CHECK (entity_type IN ('visit'));
