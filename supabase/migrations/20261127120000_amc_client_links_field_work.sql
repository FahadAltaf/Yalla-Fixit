-- 27 Nov 2026: the client's pass and access-rule link (DEV-494) for a call out
-- and for additional work, as for a planned visit and a site visit.
-- Live-safe: widens a CHECK constraint only; no data changes.

ALTER TABLE public.amc_client_links DROP CONSTRAINT IF EXISTS amc_client_links_entity_type_check;
ALTER TABLE public.amc_client_links
  ADD CONSTRAINT amc_client_links_entity_type_check CHECK (entity_type IN ('visit', 'assessment', 'call_out', 'additional_work'));

-- Rollback:
--   DELETE FROM public.amc_client_links WHERE entity_type IN ('call_out', 'additional_work');
--   ALTER TABLE public.amc_client_links DROP CONSTRAINT IF EXISTS amc_client_links_entity_type_check;
--   ALTER TABLE public.amc_client_links ADD CONSTRAINT amc_client_links_entity_type_check CHECK (entity_type IN ('visit', 'assessment'));
