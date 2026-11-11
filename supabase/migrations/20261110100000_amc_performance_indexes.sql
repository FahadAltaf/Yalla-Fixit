-- AMC performance indexes (10 Nov 2026).
--
-- Live-safe: indexes only. No table, column, row, grant or policy changes.
-- Each CREATE INDEX takes a short lock on its table while it builds; the AMC
-- tables are small, so this is seconds. Safe to run twice (IF NOT EXISTS).
-- Run in the Supabase SQL editor on production (never `supabase db push`).
--
-- Each index backs a filter or sort the AMC screens use on every load, found
-- by the server audit of lib/server/amc and app/api/amc-*:
--
--   Part 1  plain btree indexes for the list sorts and lookups
--   Part 2  trigram indexes for the "contains" searches (ILIKE '%term%')
--
-- Rollback: DROP INDEX IF EXISTS <name>; for each name below.

-- ---------------------------------------------------------------------
-- Part 1. Sorts and lookups
-- ---------------------------------------------------------------------

/* Property page: the additional-service quotes for one property (quotesFor). */
CREATE INDEX IF NOT EXISTS idx_amc_additional_quotes_property
  ON public.amc_additional_quotes (property_id, created_at DESC)
  WHERE property_id IS NOT NULL;

/* Proposal page: the site visit a proposal came from (amc_assessments.submission_id). */
CREATE INDEX IF NOT EXISTS idx_amc_assessments_submission
  ON public.amc_assessments (submission_id)
  WHERE submission_id IS NOT NULL;

/* Site visits list: newest first, and "mine" (created by me or assigned to me). */
CREATE INDEX IF NOT EXISTS idx_amc_assessments_created
  ON public.amc_assessments (created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_amc_assessments_created_by
  ON public.amc_assessments (created_by)
  WHERE created_by IS NOT NULL;

/* Proposals list: newest first, for everyone and for one owner (the existing index is by updated_at). */
CREATE INDEX IF NOT EXISTS idx_amc_submissions_created
  ON public.amc_submissions (created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_amc_submissions_owner_created
  ON public.amc_submissions (owner_id, created_at DESC, id);

/* Contracts list: the default sort. */
CREATE INDEX IF NOT EXISTS idx_amc_contracts_created
  ON public.amc_contracts (created_at DESC);

/* Enquiries list: newest first across stages (the stage index cannot serve "every open stage"). */
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_enquired
  ON public.amc_enquiries (enquired_at DESC, id);

/* Client pickers and the Clients page: sorted by name (amc_client_directory reads snagging_clients). */
CREATE INDEX IF NOT EXISTS idx_snagging_clients_name
  ON public.snagging_clients (name);

-- ---------------------------------------------------------------------
-- Part 2. "Contains" searches
-- ---------------------------------------------------------------------
-- A search box matches anywhere in the text (ILIKE '%term%'), which a btree
-- cannot help with: without these, every search reads the whole table.
-- pg_trgm is a standard Postgres extension that Supabase ships; on Supabase
-- it lives in the "extensions" schema.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

/* Contracts search (client, proposal number, property, client reference). */
CREATE INDEX IF NOT EXISTS idx_amc_contracts_customer_name_trgm
  ON public.amc_contracts USING gin (customer_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_amc_contracts_proposal_number_trgm
  ON public.amc_contracts USING gin (proposal_number extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_amc_contracts_property_label_trgm
  ON public.amc_contracts USING gin (property_label extensions.gin_trgm_ops);

/* Enquiries search (number, contact, what they need). */
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_number_trgm
  ON public.amc_enquiries USING gin (enquiry_number extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_contact_name_trgm
  ON public.amc_enquiries USING gin (contact_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_amc_enquiries_need_trgm
  ON public.amc_enquiries USING gin (need extensions.gin_trgm_ops);

/* Proposals search by number. */
CREATE INDEX IF NOT EXISTS idx_amc_submissions_proposal_number_trgm
  ON public.amc_submissions USING gin (proposal_number extensions.gin_trgm_ops);

/* Client search by name (pickers, Clients page, enquiry search). */
CREATE INDEX IF NOT EXISTS idx_snagging_clients_name_trgm
  ON public.snagging_clients USING gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Check (read-only): every index above should be listed.
-- ---------------------------------------------------------------------
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public' AND indexname IN (
--   'idx_amc_additional_quotes_property', 'idx_amc_assessments_submission', 'idx_amc_assessments_created',
--   'idx_amc_assessments_created_by', 'idx_amc_submissions_created', 'idx_amc_submissions_owner_created',
--   'idx_amc_contracts_created', 'idx_amc_enquiries_enquired', 'idx_snagging_clients_name',
--   'idx_amc_contracts_customer_name_trgm', 'idx_amc_contracts_proposal_number_trgm', 'idx_amc_contracts_property_label_trgm',
--   'idx_amc_enquiries_number_trgm', 'idx_amc_enquiries_contact_name_trgm', 'idx_amc_enquiries_need_trgm',
--   'idx_amc_submissions_proposal_number_trgm', 'idx_snagging_clients_name_trgm'
-- ) ORDER BY indexname;
